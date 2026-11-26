import AVFoundation
import Foundation

internal struct OneAudioSessionConfig {
  let sampleRate: Double
  let chunkDurationMs: Int
  let enableEchoCancellation: Bool
  let muted: Bool
}

internal struct OneAudioStartResult {
  let started: Bool
  let sampleRate: Double
  let channels: Int
  let echoCancellationActive: Bool
  let routeName: String
}

internal final class OneCarPlayAudioEngine: NSObject, AVSpeechSynthesizerDelegate {
  var onAudioChunk: (([String: Any]) -> Void)?
  var onAudioLevel: (([String: Any]) -> Void)?
  var onAudioInterruption: (([String: Any]) -> Void)?

  private let audioQueue = DispatchQueue(label: "com.jasonroell.one.carplay.audio", qos: .userInteractive)
  private let stateLock = NSLock()

  private var engine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var converter: AVAudioConverter?
  private var targetCaptureFormat: AVAudioFormat?
  private var playbackFormat: AVAudioFormat?
  private var pendingCaptureBytes = Data()

  private var isSessionActive = false
  private var isPlaybackOnlyActive = false
  private var playbackBuffersInFlight = 0
  private var playbackEpoch = 0
  private var idleReleaseToken = 0
  private var isMutedState = false
  private var activeSampleRate: Double = 24_000
  private var chunkByteTarget = 4_800
  private var echoCancellationRequested = true
  private var echoCancellationEnabled = false
  private var lastInputLevelSentMs: Double = 0
  private var lastOutputLevelSentMs: Double = 0

  private let speechSynthesizer = AVSpeechSynthesizer()
  private var observersRegistered = false

  override init() {
    super.init()
    speechSynthesizer.delegate = self
  }

  deinit {
    unregisterSessionObservers()
    playerNode?.stop()
    engine?.inputNode.removeTap(onBus: 0)
    engine?.stop()
  }

  var audioSessionActive: Bool {
    withStateLock { isSessionActive }
  }

  var muted: Bool {
    withStateLock { isMutedState }
  }

  var currentRouteName: String {
    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
    if let firstOutput = outputs.first {
      return firstOutput.portName
    }
    return "Speaker"
  }

  func start(config: OneAudioSessionConfig) throws -> OneAudioStartResult {
    var startResult = OneAudioStartResult(
      started: false,
      sampleRate: config.sampleRate,
      channels: 1,
      echoCancellationActive: false,
      routeName: currentRouteName
    )
    var thrownError: Error?

    audioQueue.sync {
      do {
        self.stopLocked()

        let sampleRate = max(8_000, min(48_000, config.sampleRate))
        let chunkMs = max(20, min(500, config.chunkDurationMs))
        let targetBytes = max(320, Int((sampleRate * 2.0 * Double(chunkMs)) / 1000.0))

        self.withStateLock {
          self.activeSampleRate = sampleRate
          self.chunkByteTarget = targetBytes - (targetBytes % 2)
          self.isMutedState = config.muted
          self.echoCancellationRequested = config.enableEchoCancellation
        }

        let session = AVAudioSession.sharedInstance()
        let mode: AVAudioSession.Mode = config.enableEchoCancellation ? .voiceChat : .default
        let options: AVAudioSession.CategoryOptions = [
          .allowBluetooth,
          .allowBluetoothA2DP,
          .defaultToSpeaker,
        ]
        try session.setCategory(.playAndRecord, mode: mode, options: options)
        try? session.setPreferredSampleRate(sampleRate)
        try? session.setPreferredIOBufferDuration(0.02)
        try session.setActive(true, options: [])

        self.registerSessionObservers()

        let audioEngine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let inputNode = audioEngine.inputNode

        var aecActive = config.enableEchoCancellation
        if config.enableEchoCancellation {
          do {
            try inputNode.setVoiceProcessingEnabled(true)
          } catch {
            aecActive = session.mode == .voiceChat
          }
        }

        guard
          let captureFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: true
          ),
          let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
          )
        else {
          throw NSError(
            domain: "OneCarPlayAudio",
            code: 1001,
            userInfo: [NSLocalizedDescriptionKey: "Unable to create 24kHz PCM audio format."]
          )
        }

        audioEngine.attach(player)
        audioEngine.connect(player, to: audioEngine.mainMixerNode, format: outputFormat)

        self.engine = audioEngine
        self.playerNode = player
        self.targetCaptureFormat = captureFormat
        self.playbackFormat = outputFormat
        self.pendingCaptureBytes.removeAll(keepingCapacity: true)

        try self.installInputTapLocked(engine: audioEngine, captureFormat: captureFormat)

        audioEngine.prepare()
        try audioEngine.start()
        player.play()

        self.withStateLock {
          self.isSessionActive = true
          self.echoCancellationEnabled = aecActive
        }

        startResult = OneAudioStartResult(
          started: true,
          sampleRate: sampleRate,
          channels: 1,
          echoCancellationActive: aecActive,
          routeName: self.currentRouteName
        )
      } catch {
        self.stopLocked()
        thrownError = error
      }
    }

    if let thrownError {
      throw thrownError
    }
    return startResult
  }

  func stop() {
    audioQueue.async { [weak self] in
      self?.stopLocked()
    }
  }

  func stopSync() {
    audioQueue.sync {
      self.stopLocked()
    }
  }

  func setMuted(_ muted: Bool) {
    withStateLock {
      isMutedState = muted
    }
    if muted {
      audioQueue.async { [weak self] in
        self?.pendingCaptureBytes.removeAll(keepingCapacity: true)
      }
      emitLevel(source: "input", level: 0, peak: 0)
    }
  }

  func enqueuePcmAudio(base64Pcm16: String, sampleRate: Double) {
    guard let pcmData = Data(base64Encoded: base64Pcm16), !pcmData.isEmpty else {
      return
    }
    audioQueue.async { [weak self] in
      self?.enqueuePcmLocked(pcmData: pcmData, sampleRate: sampleRate)
    }
  }

  func clearPlaybackQueue() {
    stopFallbackSpeech()
    audioQueue.async { [weak self] in
      guard let self else { return }
      if self.isPlaybackOnlyActive && !self.audioSessionActive {
        self.stopLocked()
        self.emitLevel(source: "output", level: 0, peak: 0)
        return
      }
      guard let player = self.playerNode else { return }
      self.playbackEpoch += 1
      self.playbackBuffersInFlight = 0
      player.stop()
      player.reset()
      if self.engine?.isRunning == true {
        player.play()
      }
      self.emitLevel(source: "output", level: 0, peak: 0)
    }
  }

  func speakFallbackText(
    text: String,
    voiceIdentifier: String?,
    language: String,
    rate: Double,
    pitch: Double
  ) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.speechSynthesizer.isSpeaking {
        self.speechSynthesizer.stopSpeaking(at: .immediate)
      }
      if !self.audioSessionActive {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(
          .playback,
          mode: .spokenAudio,
          options: [.duckOthers, .allowBluetoothA2DP]
        )
        try? session.setActive(true, options: [])
      }

      let utterance = AVSpeechUtterance(string: trimmed)
      if let voiceIdentifier, !voiceIdentifier.isEmpty,
        let specificVoice = AVSpeechSynthesisVoice(identifier: voiceIdentifier)
      {
        utterance.voice = specificVoice
      } else {
        utterance.voice = AVSpeechSynthesisVoice(language: language)
      }

      let normalizedRate = Float(max(0.5, min(2.0, rate)))
      let mappedRate = AVSpeechUtteranceDefaultSpeechRate * normalizedRate
      utterance.rate = max(
        AVSpeechUtteranceMinimumSpeechRate,
        min(AVSpeechUtteranceMaximumSpeechRate, mappedRate)
      )
      utterance.pitchMultiplier = Float(max(0.5, min(2.0, pitch)))
      self.speechSynthesizer.speak(utterance)
    }
  }

  func stopFallbackSpeech() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.speechSynthesizer.isSpeaking {
        self.speechSynthesizer.stopSpeaking(at: .immediate)
      }
    }
  }

  private func installInputTapLocked(engine: AVAudioEngine, captureFormat: AVAudioFormat) throws {
    let inputNode = engine.inputNode
    inputNode.removeTap(onBus: 0)

    let hardwareFormat = inputNode.outputFormat(forBus: 0)
    guard hardwareFormat.sampleRate > 0, hardwareFormat.channelCount > 0 else {
      throw NSError(
        domain: "OneCarPlayAudio",
        code: 1002,
        userInfo: [NSLocalizedDescriptionKey: "Audio input format is unavailable on the current route."]
      )
    }

    guard let audioConverter = AVAudioConverter(from: hardwareFormat, to: captureFormat) else {
      throw NSError(
        domain: "OneCarPlayAudio",
        code: 1003,
        userInfo: [NSLocalizedDescriptionKey: "Could not initialize PCM16 resampler for audio input."]
      )
    }
    converter = audioConverter

    let bufferFrames = AVAudioFrameCount(max(256, Int(hardwareFormat.sampleRate * 0.04)))
    inputNode.installTap(onBus: 0, bufferSize: bufferFrames, format: hardwareFormat) { [weak self] buffer, _ in
      guard let self else { return }
      self.audioQueue.async { [weak self] in
        self?.handleCapturedBufferLocked(buffer)
      }
    }
  }

  private func handleCapturedBufferLocked(_ inputBuffer: AVAudioPCMBuffer) {
    let mutedNow = withStateLock { isMutedState }
    if mutedNow {
      return
    }
    guard let converter, let captureFormat = targetCaptureFormat else {
      return
    }

    let ratio = captureFormat.sampleRate / max(1.0, inputBuffer.format.sampleRate)
    let estimatedFrames = max(1, Int(ceil(Double(inputBuffer.frameLength) * ratio)) + 16)
    guard
      let convertedBuffer = AVAudioPCMBuffer(
        pcmFormat: captureFormat,
        frameCapacity: AVAudioFrameCount(estimatedFrames)
      )
    else {
      return
    }

    var consumed = false
    var convertError: NSError?
    let status = converter.convert(to: convertedBuffer, error: &convertError) { _, outStatus in
      if consumed {
        outStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      outStatus.pointee = .haveData
      return inputBuffer
    }

    guard status != .error, convertError == nil, convertedBuffer.frameLength > 0,
      let channelData = convertedBuffer.int16ChannelData
    else {
      return
    }

    let byteCount = Int(convertedBuffer.frameLength) * MemoryLayout<Int16>.size
    let rawBytes = Data(bytes: channelData[0], count: byteCount)
    pendingCaptureBytes.append(rawBytes)

    let targetBytes = withStateLock { chunkByteTarget }
    let sampleRate = withStateLock { activeSampleRate }

    while pendingCaptureBytes.count >= targetBytes {
      let chunk = pendingCaptureBytes.prefix(targetBytes)
      pendingCaptureBytes.removeFirst(targetBytes)
      emitCapturedChunk(Data(chunk), sampleRate: sampleRate)
    }
  }

  private func emitCapturedChunk(_ chunkData: Data, sampleRate: Double) {
    let (rms, peak) = computePcm16Levels(chunkData)
    let nowMs = currentTimestampMs()
    let frameCount = chunkData.count / MemoryLayout<Int16>.size

    onAudioChunk?([
      "pcm16Base64": chunkData.base64EncodedString(),
      "sampleRate": Int(sampleRate),
      "channels": 1,
      "frameCount": frameCount,
      "rms": rms,
      "timestampMs": nowMs,
    ])

    if nowMs - lastInputLevelSentMs >= 50 {
      lastInputLevelSentMs = nowMs
      emitLevel(source: "input", level: rms, peak: peak, timestampMs: nowMs)
    }
  }

  private func ensurePlaybackOnlyEngineLocked(sampleRate: Double) -> Bool {
    if engine != nil, playerNode != nil {
      return true
    }
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(
      .playback,
      mode: .spokenAudio,
      options: [.allowBluetoothA2DP, .duckOthers]
    )
    try? session.setActive(true, options: [])

    guard
      let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: sampleRate,
        channels: 1,
        interleaved: false
      )
    else {
      return false
    }

    let audioEngine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    audioEngine.attach(player)
    audioEngine.connect(player, to: audioEngine.mainMixerNode, format: outputFormat)
    audioEngine.prepare()

    do {
      try audioEngine.start()
      player.play()
      engine = audioEngine
      playerNode = player
      playbackFormat = outputFormat
      isPlaybackOnlyActive = true
      return true
    } catch {
      player.stop()
      audioEngine.stop()
      return false
    }
  }

  private func enqueuePcmLocked(pcmData: Data, sampleRate: Double) {
    let clampedRate = max(8_000, min(48_000, sampleRate))
    if engine == nil || playerNode == nil {
      guard ensurePlaybackOnlyEngineLocked(sampleRate: clampedRate) else { return }
    }
    guard let engine, let playerNode else { return }

    if playbackFormat == nil || abs((playbackFormat?.sampleRate ?? 0) - clampedRate) > 1.0 {
      if let newFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: clampedRate,
        channels: 1,
        interleaved: false
      ) {
        playerNode.stop()
        engine.disconnectNodeOutput(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: newFormat)
        playbackFormat = newFormat
      }
    }

    guard let format = playbackFormat else { return }
    let sampleCount = pcmData.count / MemoryLayout<Int16>.size
    guard sampleCount > 0 else { return }

    guard
      let buffer = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: AVAudioFrameCount(sampleCount)
      ),
      let floatChannel = buffer.floatChannelData?[0]
    else {
      return
    }

    buffer.frameLength = AVAudioFrameCount(sampleCount)
    var sumSquares = 0.0
    var maxAbs = 0.0

    pcmData.withUnsafeBytes { rawBuffer in
      for index in 0..<sampleCount {
        let rawSample = rawBuffer.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
        let sample = Int16(littleEndian: rawSample)
        let normalized = Double(sample) / 32_768.0
        floatChannel[index] = Float(normalized)
        sumSquares += normalized * normalized
        let magnitude = abs(normalized)
        if magnitude > maxAbs {
          maxAbs = magnitude
        }
      }
    }

    if !engine.isRunning {
      try? engine.start()
    }
    if !playerNode.isPlaying {
      playerNode.play()
    }
    idleReleaseToken += 1
    playbackBuffersInFlight += 1
    let epoch = playbackEpoch
    playerNode.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.audioQueue.async { self?.playbackBufferDidFinish(epoch: epoch) }
    }

    let nowMs = currentTimestampMs()
    if nowMs - lastOutputLevelSentMs >= 50 {
      lastOutputLevelSentMs = nowMs
      let rms = min(1.0, sqrt(sumSquares / Double(sampleCount)) * 2.5)
      let peak = min(1.0, maxAbs)
      emitLevel(source: "output", level: rms, peak: peak, timestampMs: nowMs)
    }
  }

  /// Playback without a started voice session holds the audio session only while audio plays.
  /// Once the last queued buffer has played, the session is released after a short pause.
  private func playbackBufferDidFinish(epoch: Int) {
    guard epoch == playbackEpoch else { return }
    playbackBuffersInFlight = max(0, playbackBuffersInFlight - 1)
    guard playbackBuffersInFlight == 0, isPlaybackOnlyActive else { return }
    idleReleaseToken += 1
    let token = idleReleaseToken
    audioQueue.asyncAfter(deadline: .now() + 1.5) { [weak self] in
      guard let self, token == self.idleReleaseToken, self.playbackBuffersInFlight == 0,
        self.isPlaybackOnlyActive
      else { return }
      self.stopLocked()
      self.emitLevel(source: "output", level: 0, peak: 0)
    }
  }

  /// Text-to-speech fallback also takes the audio session, so it gives it back when it is done.
  private func releaseSessionAfterFallbackSpeech() {
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.speechSynthesizer.isSpeaking else { return }
      self.audioQueue.async { [weak self] in
        guard let self, !self.audioSessionActive, !self.isPlaybackOnlyActive else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
      }
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    releaseSessionAfterFallbackSpeech()
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    releaseSessionAfterFallbackSpeech()
  }

  private func stopLocked() {
    unregisterSessionObservers()
    if let playerNode {
      playerNode.stop()
      playerNode.reset()
    }
    if let engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    engine = nil
    playerNode = nil
    converter = nil
    targetCaptureFormat = nil
    playbackFormat = nil
    isPlaybackOnlyActive = false
    playbackEpoch += 1
    playbackBuffersInFlight = 0
    idleReleaseToken += 1
    pendingCaptureBytes.removeAll(keepingCapacity: false)

    withStateLock {
      isSessionActive = false
      echoCancellationEnabled = false
    }

    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  private func registerSessionObservers() {
    guard !observersRegistered else { return }
    observersRegistered = true
    let center = NotificationCenter.default
    center.addObserver(
      self,
      selector: #selector(handleAudioInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance()
    )
    center.addObserver(
      self,
      selector: #selector(handleRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: AVAudioSession.sharedInstance()
    )
  }

  private func unregisterSessionObservers() {
    guard observersRegistered else { return }
    observersRegistered = false
    NotificationCenter.default.removeObserver(self)
  }

  @objc
  private func handleAudioInterruption(_ notification: Notification) {
    guard
      let userInfo = notification.userInfo,
      let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
      let interruptionType = AVAudioSession.InterruptionType(rawValue: typeValue)
    else {
      return
    }

    switch interruptionType {
    case .began:
      audioQueue.async { [weak self] in
        self?.playerNode?.pause()
      }
      onAudioInterruption?([
        "type": "began",
        "shouldResume": false,
        "reason": "system_interruption",
        "routeName": currentRouteName,
        "timestampMs": currentTimestampMs(),
      ])

    case .ended:
      let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
      let shouldResume = options.contains(.shouldResume)
      if shouldResume {
        audioQueue.async { [weak self] in
          guard let self, self.audioSessionActive, let engine = self.engine else { return }
          try? AVAudioSession.sharedInstance().setActive(true, options: [])
          if !engine.isRunning {
            try? engine.start()
          }
          self.playerNode?.play()
        }
      }
      onAudioInterruption?([
        "type": "ended",
        "shouldResume": shouldResume,
        "reason": "interruption_ended",
        "routeName": currentRouteName,
        "timestampMs": currentTimestampMs(),
      ])

    @unknown default:
      break
    }
  }

  @objc
  private func handleRouteChange(_ notification: Notification) {
    let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
    let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
    let reasonLabel = routeChangeReasonName(reason)
    let route = currentRouteName

    audioQueue.async { [weak self] in
      guard let self, self.audioSessionActive,
        let engine = self.engine,
        let captureFormat = self.targetCaptureFormat
      else {
        return
      }
      self.playerNode?.pause()
      engine.stop()
      try? self.installInputTapLocked(engine: engine, captureFormat: captureFormat)
      engine.prepare()
      try? engine.start()
      self.playerNode?.play()
    }

    onAudioInterruption?([
      "type": "route_changed",
      "shouldResume": true,
      "reason": reasonLabel,
      "routeName": route,
      "timestampMs": currentTimestampMs(),
    ])
  }

  private func routeChangeReasonName(_ reason: AVAudioSession.RouteChangeReason?) -> String {
    switch reason {
    case .newDeviceAvailable:
      return "new_device_available"
    case .oldDeviceUnavailable:
      return "old_device_unavailable"
    case .categoryChange:
      return "category_change"
    case .override:
      return "override"
    case .wakeFromSleep:
      return "wake_from_sleep"
    case .routeConfigurationChange:
      return "route_configuration_change"
    default:
      return "route_changed"
    }
  }

  private func computePcm16Levels(_ data: Data) -> (Double, Double) {
    let sampleCount = data.count / MemoryLayout<Int16>.size
    guard sampleCount > 0 else { return (0, 0) }
    var sumSquares = 0.0
    var maxAbs = 0.0

    data.withUnsafeBytes { rawBuffer in
      for index in 0..<sampleCount {
        let rawSample = rawBuffer.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
        let sample = Int16(littleEndian: rawSample)
        let normalized = Double(sample) / 32_768.0
        sumSquares += normalized * normalized
        let magnitude = abs(normalized)
        if magnitude > maxAbs {
          maxAbs = magnitude
        }
      }
    }

    let rms = min(1.0, sqrt(sumSquares / Double(sampleCount)) * 2.5)
    return (rms, min(1.0, maxAbs))
  }

  private func emitLevel(source: String, level: Double, peak: Double, timestampMs: Double? = nil) {
    onAudioLevel?([
      "source": source,
      "level": level,
      "peak": peak,
      "timestampMs": timestampMs ?? currentTimestampMs(),
    ])
  }

  private func currentTimestampMs() -> Double {
    floor(Date().timeIntervalSince1970 * 1000.0)
  }

  private func withStateLock<T>(_ body: () -> T) -> T {
    stateLock.lock()
    defer { stateLock.unlock() }
    return body()
  }
}
