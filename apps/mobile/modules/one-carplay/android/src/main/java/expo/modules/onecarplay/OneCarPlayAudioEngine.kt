package expo.modules.onecarplay

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.speech.tts.TextToSpeech
import android.util.Base64
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

internal data class AndroidAudioSessionConfig(
  val sampleRate: Int,
  val chunkDurationMs: Int,
  val enableEchoCancellation: Boolean,
  val muted: Boolean
)

internal data class AndroidAudioStartResult(
  val started: Boolean,
  val sampleRate: Int,
  val channels: Int,
  val echoCancellationActive: Boolean,
  val routeName: String
)

private data class PlaybackPacket(
  val generation: Long,
  val sampleRate: Int,
  val pcmBytes: ByteArray
)

private data class PendingSpeechRequest(
  val text: String,
  val language: String,
  val rate: Float,
  val pitch: Float
)

internal class OneCarPlayAudioEngine(
  private val context: Context,
  private val onAudioChunk: (Map<String, Any>) -> Unit,
  private val onAudioLevel: (Map<String, Any>) -> Unit,
  private val onAudioInterruption: (Map<String, Any>) -> Unit
) {
  private val lifecycleLock = Any()
  private val playbackLock = Any()
  private val ttsLock = Any()

  private val running = AtomicBoolean(false)
  private val playbackActive = AtomicBoolean(false)
  private val mutedFlag = AtomicBoolean(false)
  private val playbackGeneration = AtomicLong(0L)
  private val playbackQueue = LinkedBlockingQueue<PlaybackPacket>(256)

  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var previousAudioMode: Int = AudioManager.MODE_NORMAL
  private var audioModeChanged: Boolean = false
  private var audioFocusRequested: Boolean = false
  private var audioFocusRequest: AudioFocusRequest? = null

  private var audioRecord: AudioRecord? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var audioTrack: AudioTrack? = null
  private var playbackSampleRate: Int = 24_000

  private var captureThread: Thread? = null
  private var playbackThread: Thread? = null
  private var activeSampleRate: Int = 24_000
  private var chunkByteTarget: Int = 4_800
  private var lastInputLevelMs: Long = 0L
  private var lastOutputLevelMs: Long = 0L

  private var tts: TextToSpeech? = null
  private var ttsReady: Boolean = false
  private var pendingSpeech: PendingSpeechRequest? = null

  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        onAudioInterruption(
          mapOf(
            "type" to "began",
            "shouldResume" to false,
            "reason" to "audio_focus_lost",
            "routeName" to currentRouteName(),
            "timestampMs" to System.currentTimeMillis().toDouble()
          )
        )
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        onAudioInterruption(
          mapOf(
            "type" to "ended",
            "shouldResume" to true,
            "reason" to "audio_focus_gained",
            "routeName" to currentRouteName(),
            "timestampMs" to System.currentTimeMillis().toDouble()
          )
        )
      }
    }
  }

  val isAudioSessionActive: Boolean
    get() = running.get()

  val isMuted: Boolean
    get() = mutedFlag.get()

  @SuppressLint("MissingPermission")
  fun start(config: AndroidAudioSessionConfig): AndroidAudioStartResult = synchronized(lifecycleLock) {
    stopLocked()

    val hasMicPermission = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED
    if (!hasMicPermission) {
      throw IllegalStateException("Microphone permission (RECORD_AUDIO) is required for voice chat.")
    }

    val sampleRate = config.sampleRate.coerceIn(8_000, 48_000)
    val chunkMs = config.chunkDurationMs.coerceIn(20, 500)
    val rawChunkBytes = ((sampleRate * 2L * chunkMs) / 1000L).toInt().coerceAtLeast(320)
    activeSampleRate = sampleRate
    chunkByteTarget = rawChunkBytes - (rawChunkBytes % 2)
    mutedFlag.set(config.muted)

    try {
      requestVoiceAudioFocus()
      previousAudioMode = audioManager.mode
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      audioModeChanged = true

      val record = createAudioRecord(sampleRate, config.enableEchoCancellation)
      audioRecord = record
      val aecActive = attachAudioEffects(record, config.enableEchoCancellation)

      val track = createAudioTrack(sampleRate, voiceCommunication = true)
      synchronized(playbackLock) {
        audioTrack = track
        playbackSampleRate = sampleRate
      }
      playbackQueue.clear()
      running.set(true)
      playbackActive.set(true)

      record.startRecording()
      track.play()

      captureThread = Thread({ runCaptureLoop(record) }, "OneCarPlayCapture").apply {
        isDaemon = true
        start()
      }
      playbackThread = Thread({ runPlaybackLoop() }, "OneCarPlayPlayback").apply {
        isDaemon = true
        start()
      }

      AndroidAudioStartResult(
        started = true,
        sampleRate = sampleRate,
        channels = 1,
        echoCancellationActive = aecActive || config.enableEchoCancellation,
        routeName = currentRouteName()
      )
    } catch (error: Throwable) {
      stopLocked()
      throw error
    }
  }

  fun stop() = synchronized(lifecycleLock) {
    stopLocked()
  }

  fun setMuted(muted: Boolean) {
    mutedFlag.set(muted)
    if (muted) {
      emitLevel("input", 0.0, 0.0)
    }
  }

  fun enqueuePcmAudio(base64Pcm16: String, sampleRate: Int) {
    if (base64Pcm16.isEmpty()) return
    val decoded = runCatching { Base64.decode(base64Pcm16, Base64.DEFAULT) }.getOrNull() ?: return
    if (decoded.isEmpty()) return
    val clampedRate = sampleRate.coerceIn(8_000, 48_000)
    if (!running.get() && !playbackActive.get()) {
      ensurePlaybackOnlyStarted(clampedRate)
    }
    if (!running.get() && !playbackActive.get()) return
    val packet = PlaybackPacket(
      generation = playbackGeneration.get(),
      sampleRate = clampedRate,
      pcmBytes = decoded
    )
    if (!playbackQueue.offer(packet)) {
      playbackQueue.poll()
      playbackQueue.offer(packet)
    }
  }

  fun clearPlaybackQueue() {
    playbackGeneration.incrementAndGet()
    playbackQueue.clear()
    stopFallbackSpeech()
    if (!running.get() && playbackActive.get()) {
      stop()
      emitLevel("output", 0.0, 0.0)
      return
    }
    synchronized(playbackLock) {
      val track = audioTrack ?: return@synchronized
      runCatching {
        track.pause()
        track.flush()
        if (running.get()) {
          track.play()
        }
      }
    }
    emitLevel("output", 0.0, 0.0)
  }

  private fun ensurePlaybackOnlyStarted(sampleRate: Int) = synchronized(lifecycleLock) {
    if (running.get() || playbackActive.get()) return@synchronized
    try {
      val track = createAudioTrack(sampleRate, voiceCommunication = false)
      synchronized(playbackLock) {
        audioTrack = track
        playbackSampleRate = sampleRate
      }
      playbackQueue.clear()
      playbackActive.set(true)
      track.play()
      playbackThread = Thread({ runPlaybackLoop() }, "OneCarPlayPlayback").apply {
        isDaemon = true
        start()
      }
    } catch (_: Throwable) {
      stopLocked()
    }
  }

  fun speakFallbackText(text: String, language: String, rate: Float, pitch: Float) {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return
    val request = PendingSpeechRequest(
      text = trimmed,
      language = language,
      rate = rate.coerceIn(0.5f, 2.0f),
      pitch = pitch.coerceIn(0.5f, 2.0f)
    )
    synchronized(ttsLock) {
      val existing = tts
      if (existing != null && ttsReady) {
        speakWithTts(existing, request)
        return
      }
      pendingSpeech = request
      if (existing == null) {
        tts = TextToSpeech(context.applicationContext) { status ->
          synchronized(ttsLock) {
            ttsReady = status == TextToSpeech.SUCCESS
            val queued = pendingSpeech
            pendingSpeech = null
            if (ttsReady && queued != null) {
              tts?.let { speakWithTts(it, queued) }
            }
          }
        }
      }
    }
  }

  fun stopFallbackSpeech() {
    synchronized(ttsLock) {
      pendingSpeech = null
      runCatching { tts?.stop() }
    }
  }

  fun release() {
    stop()
    synchronized(ttsLock) {
      pendingSpeech = null
      ttsReady = false
      runCatching {
        tts?.stop()
        tts?.shutdown()
      }
      tts = null
    }
  }

  fun currentRouteName(): String {
    val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val preferred = devices.firstOrNull { device ->
      device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
        device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
        device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
        device.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
        device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET
    } ?: devices.firstOrNull()
    val name = preferred?.productName?.toString()?.trim()
    return if (!name.isNullOrEmpty()) name else "Speaker"
  }

  @SuppressLint("MissingPermission")
  private fun createAudioRecord(sampleRate: Int, enableEchoCancellation: Boolean): AudioRecord {
    val minRecordBuffer = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    ).coerceAtLeast(chunkByteTarget * 2)

    val source = if (enableEchoCancellation) {
      MediaRecorder.AudioSource.VOICE_COMMUNICATION
    } else {
      MediaRecorder.AudioSource.MIC
    }
    val record = AudioRecord(
      source,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      minRecordBuffer * 2
    )
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw IllegalStateException("Failed to initialize Android AudioRecord at ${sampleRate}Hz.")
    }
    return record
  }

  private fun attachAudioEffects(record: AudioRecord, enableEchoCancellation: Boolean): Boolean {
    var aecActive = false
    if (enableEchoCancellation && AcousticEchoCanceler.isAvailable()) {
      echoCanceler = runCatching {
        AcousticEchoCanceler.create(record.audioSessionId)?.also {
          it.enabled = true
          aecActive = it.enabled
        }
      }.getOrNull()
    }
    if (enableEchoCancellation && NoiseSuppressor.isAvailable()) {
      noiseSuppressor = runCatching {
        NoiseSuppressor.create(record.audioSessionId)?.also { it.enabled = true }
      }.getOrNull()
    }
    return aecActive
  }

  private fun stopLocked() {
    running.set(false)
    playbackActive.set(false)
    playbackGeneration.incrementAndGet()
    playbackQueue.clear()

    // Stop active I/O before joining threads so blocking read/write calls unblock immediately.
    runCatching { audioRecord?.stop() }
    synchronized(playbackLock) {
      runCatching {
        audioTrack?.pause()
        audioTrack?.flush()
        audioTrack?.stop()
      }
    }

    val capture = captureThread
    val playback = playbackThread
    captureThread = null
    playbackThread = null

    capture?.interrupt()
    playback?.interrupt()
    runCatching { capture?.join(800) }
    runCatching { playback?.join(800) }

    runCatching { echoCanceler?.release() }
    echoCanceler = null
    runCatching { noiseSuppressor?.release() }
    noiseSuppressor = null
    runCatching { audioRecord?.release() }
    audioRecord = null

    synchronized(playbackLock) {
      runCatching { audioTrack?.release() }
      audioTrack = null
    }

    restoreAudioModeAndFocus()
  }

  private fun runCaptureLoop(record: AudioRecord) {
    val readBuffer = ByteArray(1024)
    val pending = ByteArrayOutputStream(chunkByteTarget * 2)
    while (running.get() && !Thread.currentThread().isInterrupted) {
      val bytesRead = record.read(readBuffer, 0, readBuffer.size)
      if (bytesRead <= 0) continue
      if (mutedFlag.get()) {
        pending.reset()
        continue
      }
      pending.write(readBuffer, 0, bytesRead)
      while (pending.size() >= chunkByteTarget) {
        val allBytes = pending.toByteArray()
        val chunk = allBytes.copyOfRange(0, chunkByteTarget)
        pending.reset()
        if (allBytes.size > chunkByteTarget) {
          pending.write(allBytes, chunkByteTarget, allBytes.size - chunkByteTarget)
        }
        emitCapturedChunk(chunk)
      }
    }
  }

  private fun emitCapturedChunk(chunk: ByteArray) {
    val (rms, peak) = computeLevels(chunk)
    val nowMs = System.currentTimeMillis()
    onAudioChunk(
      mapOf(
        "pcm16Base64" to Base64.encodeToString(chunk, Base64.NO_WRAP),
        "sampleRate" to activeSampleRate,
        "channels" to 1,
        "frameCount" to (chunk.size / 2),
        "rms" to rms,
        "timestampMs" to nowMs.toDouble()
      )
    )
    if (nowMs - lastInputLevelMs >= 50L) {
      lastInputLevelMs = nowMs
      emitLevel("input", rms, peak, nowMs.toDouble())
    }
  }

  private fun runPlaybackLoop() {
    while ((running.get() || playbackActive.get()) && !Thread.currentThread().isInterrupted) {
      val packet = try {
        playbackQueue.poll(100, TimeUnit.MILLISECONDS)
      } catch (_: InterruptedException) {
        break
      } ?: continue

      if (packet.generation != playbackGeneration.get()) continue
      writePlaybackPacket(packet)
    }
  }

  private fun writePlaybackPacket(packet: PlaybackPacket) {
    val track = synchronized(playbackLock) {
      if (!running.get() && !playbackActive.get()) return@synchronized null
      if (audioTrack == null || playbackSampleRate != packet.sampleRate) {
        runCatching {
          audioTrack?.pause()
          audioTrack?.flush()
          audioTrack?.stop()
          audioTrack?.release()
        }
        playbackSampleRate = packet.sampleRate
        audioTrack = createAudioTrack(
          packet.sampleRate,
          voiceCommunication = running.get()
        ).also { it.play() }
      }
      audioTrack
    } ?: return

    if ((!running.get() && !playbackActive.get()) || packet.generation != playbackGeneration.get()) {
      return
    }
    val (rms, peak) = computeLevels(packet.pcmBytes)
    val nowMs = System.currentTimeMillis()
    if (nowMs - lastOutputLevelMs >= 50L) {
      lastOutputLevelMs = nowMs
      emitLevel("output", rms, peak, nowMs.toDouble())
    }
    runCatching {
      track.write(packet.pcmBytes, 0, packet.pcmBytes.size, AudioTrack.WRITE_BLOCKING)
    }
  }

  private fun createAudioTrack(sampleRate: Int, voiceCommunication: Boolean): AudioTrack {
    val minBuffer = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    ).coerceAtLeast(4_800)

    val usage = if (voiceCommunication) {
      AudioAttributes.USAGE_VOICE_COMMUNICATION
    } else {
      AudioAttributes.USAGE_MEDIA
    }
    val attributes = AudioAttributes.Builder()
      .setUsage(usage)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setSampleRate(sampleRate)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()

    val builder = AudioTrack.Builder()
      .setAudioAttributes(attributes)
      .setAudioFormat(format)
      .setBufferSizeInBytes(minBuffer * 2)
      .setTransferMode(AudioTrack.MODE_STREAM)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
    }
    return builder.build()
  }

  private fun requestVoiceAudioFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(focusChangeListener)
        .build()
      audioFocusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        focusChangeListener,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
      )
    }
    audioFocusRequested = true
  }

  private fun restoreAudioModeAndFocus() {
    if (audioModeChanged) {
      runCatching { audioManager.mode = previousAudioMode }
      audioModeChanged = false
    }
    if (audioFocusRequested) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { runCatching { audioManager.abandonAudioFocusRequest(it) } }
        audioFocusRequest = null
      } else {
        @Suppress("DEPRECATION")
        runCatching { audioManager.abandonAudioFocus(focusChangeListener) }
      }
      audioFocusRequested = false
    }
  }

  private fun speakWithTts(engine: TextToSpeech, request: PendingSpeechRequest) {
    engine.language = Locale.forLanguageTag(request.language)
    engine.setSpeechRate(request.rate)
    engine.setPitch(request.pitch)
    engine.speak(request.text, TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString())
  }

  private fun computeLevels(pcmBytes: ByteArray): Pair<Double, Double> {
    val sampleCount = pcmBytes.size / 2
    if (sampleCount <= 0) return 0.0 to 0.0
    var sumSquares = 0.0
    var maxAbs = 0.0
    var index = 0
    while (index + 1 < pcmBytes.size) {
      val lo = pcmBytes[index].toInt() and 0xFF
      val hi = pcmBytes[index + 1].toInt() shl 8
      val sample = (lo or hi).toShort().toDouble() / 32_768.0
      sumSquares += sample * sample
      val magnitude = abs(sample)
      if (magnitude > maxAbs) maxAbs = magnitude
      index += 2
    }
    val rms = min(1.0, sqrt(sumSquares / sampleCount) * 2.5)
    return rms to min(1.0, maxAbs)
  }

  private fun emitLevel(
    source: String,
    level: Double,
    peak: Double,
    timestampMs: Double = System.currentTimeMillis().toDouble()
  ) {
    onAudioLevel(
      mapOf(
        "source" to source,
        "level" to level,
        "peak" to peak,
        "timestampMs" to timestampMs
      )
    )
  }
}
