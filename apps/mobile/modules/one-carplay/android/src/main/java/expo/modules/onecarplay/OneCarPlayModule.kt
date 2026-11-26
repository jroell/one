package expo.modules.onecarplay

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OneCarPlayModule : Module() {
  private val engineLock = Any()
  private var audioEngine: OneCarPlayAudioEngine? = null

  private fun getOrCreateEngine(): OneCarPlayAudioEngine = synchronized(engineLock) {
    audioEngine?.let { return it }
    val context = appContext.reactContext ?: error("React context is not active.")
    OneCarPlayAudioEngine(
      context = context,
      onAudioChunk = { payload -> sendEvent("onAudioChunk", payload) },
      onAudioLevel = { payload -> sendEvent("onAudioLevel", payload) },
      onAudioInterruption = { payload -> sendEvent("onAudioInterruption", payload) }
    ).also { audioEngine = it }
  }

  override fun definition() = ModuleDefinition {
    Name("OneCarPlay")

    Events(
      "onAudioChunk",
      "onAudioLevel",
      "onCarPlayAction",
      "onCarPlayConnection",
      "onAudioInterruption"
    )

    AsyncFunction("startAudioSession") { options: Map<String, Any?> ->
      val sampleRate = (options["sampleRate"] as? Number)?.toInt() ?: 24_000
      val chunkDurationMs = (options["chunkDurationMs"] as? Number)?.toInt() ?: 100
      val enableEchoCancellation = options["enableEchoCancellation"] as? Boolean ?: true
      val muted = options["muted"] as? Boolean ?: false

      val result = getOrCreateEngine().start(
        AndroidAudioSessionConfig(
          sampleRate = sampleRate,
          chunkDurationMs = chunkDurationMs,
          enableEchoCancellation = enableEchoCancellation,
          muted = muted
        )
      )
      mapOf(
        "started" to result.started,
        "sampleRate" to result.sampleRate,
        "channels" to result.channels,
        "echoCancellationActive" to result.echoCancellationActive,
        "routeName" to result.routeName
      )
    }

    AsyncFunction("stopAudioSession") {
      synchronized(engineLock) { audioEngine }?.stop()
    }

    AsyncFunction("enqueuePcmAudio") { base64Pcm16: String, sampleRate: Int ->
      getOrCreateEngine().enqueuePcmAudio(base64Pcm16, sampleRate)
    }

    AsyncFunction("clearPlaybackQueue") {
      synchronized(engineLock) { audioEngine }?.clearPlaybackQueue()
    }

    AsyncFunction("setMuted") { muted: Boolean ->
      synchronized(engineLock) { audioEngine }?.setMuted(muted)
    }

    AsyncFunction("speakFallbackText") { text: String, options: Map<String, Any?> ->
      val language = options["language"] as? String ?: "en-US"
      val rate = (options["rate"] as? Number)?.toFloat() ?: 1.0f
      val pitch = (options["pitch"] as? Number)?.toFloat() ?: 1.0f
      getOrCreateEngine().speakFallbackText(text, language, rate, pitch)
    }

    AsyncFunction("stopFallbackSpeech") {
      synchronized(engineLock) { audioEngine }?.stopFallbackSpeech()
    }

    AsyncFunction("updateCarPlayState") { _: Map<String, Any?> ->
      // CarPlay head-unit templates are iOS-only; Android uses full-duplex Drive Mode audio.
    }

    AsyncFunction("getCarPlayStatus") {
      val engine = synchronized(engineLock) { audioEngine }
      mapOf(
        "available" to true,
        "connected" to false,
        "voiceControlPresented" to false,
        "entitlementMode" to "none",
        "audioSessionActive" to (engine?.isAudioSessionActive ?: false),
        "muted" to (engine?.isMuted ?: false),
        "platform" to "android",
        "carPlayEntitlementExpected" to false,
        "audioRouteName" to (engine?.currentRouteName() ?: "Speaker")
      )
    }

    OnDestroy {
      synchronized(engineLock) {
        audioEngine?.release()
        audioEngine = null
      }
    }
  }
}
