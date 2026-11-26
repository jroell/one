import CarPlay
import Foundation
import MediaPlayer
import UIKit

internal struct OneCarPlayVoiceSnapshot {
  let id: String
  let displayName: String
  let subtitle: String
  let group: String
  let isFavorite: Bool
  let isSelected: Bool
}

internal struct OneCarPlayModeSnapshot {
  let id: String
  let title: String
  let subtitle: String
  let isSelected: Bool
}

internal struct OneCarPlayThreadSnapshot {
  let id: String
  let title: String
  let subtitle: String
  let status: String
  let statusLabel: String
  let projectName: String?
  let isSelected: Bool
}

internal struct OneCarPlayStateSnapshot {
  let sessionActive: Bool
  let phase: String
  let muted: Bool
  let voiceId: String
  let voiceName: String
  let personaId: String
  let personaName: String
  let topicTitle: String
  let labels: OneCarPlayLabels
  let activeThreadId: String?
  let activeThreadTitle: String?
  let voices: [OneCarPlayVoiceSnapshot]
  let modes: [OneCarPlayModeSnapshot]
  let threads: [OneCarPlayThreadSnapshot]

  static let empty = OneCarPlayStateSnapshot(
    sessionActive: false,
    phase: "idle",
    muted: false,
    voiceId: "marin",
    voiceName: "Marin",
    personaId: "copilot",
    personaName: "Road Co-Pilot",
    topicTitle: "One Drive",
    labels: .english,
    activeThreadId: nil,
    activeThreadTitle: nil,
    voices: [],
    modes: [],
    threads: []
  )

  static func parse(from dictionary: [String: Any]) -> OneCarPlayStateSnapshot {
    let rawVoices = dictionary["voices"] as? [[String: Any]] ?? []
    let voices = rawVoices.compactMap { item -> OneCarPlayVoiceSnapshot? in
      guard let id = item["id"] as? String, !id.isEmpty else { return nil }
      return OneCarPlayVoiceSnapshot(
        id: id,
        displayName: item["displayName"] as? String ?? id,
        subtitle: item["subtitle"] as? String ?? "",
        group: item["group"] as? String ?? "Voices",
        isFavorite: item["isFavorite"] as? Bool ?? false,
        isSelected: item["isSelected"] as? Bool ?? false
      )
    }

    let rawModes = dictionary["modes"] as? [[String: Any]] ?? []
    let modes = rawModes.compactMap { item -> OneCarPlayModeSnapshot? in
      guard let id = item["id"] as? String, !id.isEmpty else { return nil }
      return OneCarPlayModeSnapshot(
        id: id,
        title: item["title"] as? String ?? id,
        subtitle: item["subtitle"] as? String ?? "",
        isSelected: item["isSelected"] as? Bool ?? false
      )
    }

    let rawThreads = dictionary["threads"] as? [[String: Any]] ?? []
    let threads = rawThreads.compactMap { item -> OneCarPlayThreadSnapshot? in
      guard let id = item["id"] as? String, !id.isEmpty else { return nil }
      return OneCarPlayThreadSnapshot(
        id: id,
        title: item["title"] as? String ?? "Thread",
        subtitle: item["subtitle"] as? String ?? "",
        status: item["status"] as? String ?? "idle",
        statusLabel: item["statusLabel"] as? String ?? "Ready",
        projectName: item["projectName"] as? String,
        isSelected: item["isSelected"] as? Bool ?? false
      )
    }

    return OneCarPlayStateSnapshot(
      sessionActive: dictionary["sessionActive"] as? Bool ?? false,
      phase: dictionary["phase"] as? String ?? "idle",
      muted: dictionary["muted"] as? Bool ?? false,
      voiceId: dictionary["voiceId"] as? String ?? "marin",
      voiceName: dictionary["voiceName"] as? String ?? "Marin",
      personaId: dictionary["personaId"] as? String ?? "copilot",
      personaName: dictionary["personaName"] as? String ?? "Road Co-Pilot",
      topicTitle: dictionary["topicTitle"] as? String ?? "One Drive",
      labels: OneCarPlayLabels.parse(from: dictionary["labels"] as? [String: Any] ?? [:]),
      activeThreadId: dictionary["activeThreadId"] as? String,
      activeThreadTitle: dictionary["activeThreadTitle"] as? String,
      voices: voices,
      modes: modes,
      threads: threads
    )
  }
}

/// Text the CarPlay templates draw. JavaScript sends it translated; English is the fallback.
internal struct OneCarPlayLabels {
  let talkTab: String
  let voicesTab: String
  let modesTab: String
  let threadsTab: String
  let talkTitle: String
  let statusRow: String
  let voiceAndModeRow: String
  let topicRow: String
  let defaultTopic: String
  let startTalking: String
  let nowPlaying: String
  let mute: String
  let unmute: String
  let interrupt: String
  let end: String
  let stateReady: String
  let stateConnecting: String
  let stateListening: String
  let stateThinking: String
  let stateSpeaking: String
  let stateMuted: String
  let stateError: String
  let stateActive: String
  let activeSuffix: String
  let voicesEmpty: String
  let voicesEmptyDetail: String
  let modesHeader: String
  let modesFallbackDetail: String
  let threadsHeader: String
  let threadsEmpty: String
  let threadsEmptyDetail: String

  static let english = OneCarPlayLabels.parse(from: [:])

  static func parse(from raw: [String: Any]) -> OneCarPlayLabels {
    func text(_ key: String, _ fallback: String) -> String {
      guard let value = raw[key] as? String, !value.isEmpty else { return fallback }
      return value
    }
    return OneCarPlayLabels(
      talkTab: text("talkTab", "Talk"),
      voicesTab: text("voicesTab", "Voices"),
      modesTab: text("modesTab", "Modes"),
      threadsTab: text("threadsTab", "Threads"),
      talkTitle: text("talkTitle", "One"),
      statusRow: text("statusRow", "Status"),
      voiceAndModeRow: text("voiceAndModeRow", "Voice and mode"),
      topicRow: text("topicRow", "Topic"),
      defaultTopic: text("defaultTopic", "Hands-free chat"),
      startTalking: text("startTalking", "Start talking"),
      nowPlaying: text("nowPlaying", "Now playing"),
      mute: text("mute", "Mute"),
      unmute: text("unmute", "Unmute"),
      interrupt: text("interrupt", "Interrupt"),
      end: text("end", "End"),
      stateReady: text("stateReady", "Ready"),
      stateConnecting: text("stateConnecting", "Connecting"),
      stateListening: text("stateListening", "Listening"),
      stateThinking: text("stateThinking", "Thinking"),
      stateSpeaking: text("stateSpeaking", "Speaking"),
      stateMuted: text("stateMuted", "Muted"),
      stateError: text("stateError", "Connection lost"),
      stateActive: text("stateActive", "Active"),
      activeSuffix: text("activeSuffix", "Active"),
      voicesEmpty: text("voicesEmpty", "No voices loaded yet"),
      voicesEmptyDetail: text("voicesEmptyDetail", "Open One on your iPhone to sync your voices."),
      modesHeader: text("modesHeader", "Driving modes"),
      modesFallbackDetail: text("modesFallbackDetail", "Hands-free conversational companion"),
      threadsHeader: text("threadsHeader", "Active threads"),
      threadsEmpty: text("threadsEmpty", "No active threads"),
      threadsEmptyDetail: text("threadsEmptyDetail", "Connect to a workspace or talk without one.")
    )
  }
}

/// The CarPlay category this build was signed for, written to Info.plist by the config plugin.
/// Each category allows a fixed set of templates and an unsupported one raises an exception.
internal enum OneCarPlayEntitlementMode: String {
  case none
  case communication
  case audio
  case both
  case voice

  static let current: OneCarPlayEntitlementMode = {
    let raw = Bundle.main.object(forInfoDictionaryKey: "OneCarPlayEntitlementMode") as? String
    return raw.flatMap(OneCarPlayEntitlementMode.init(rawValue:)) ?? .none
  }()

  /// Audio and communication apps may use Now Playing. The voice category may not.
  var allowsNowPlayingTemplate: Bool {
    self == .audio || self == .communication || self == .both
  }

  /// Voice-based conversational apps must show the voice control template while talking.
  var usesVoiceControlTemplate: Bool {
    self == .voice
  }
}

/// Bridges the UIKit CarPlay scene lifecycle with the Expo module and steering-wheel controls.
internal final class OneCarPlayCoordinator {
  static let shared = OneCarPlayCoordinator()

  private let lock = NSLock()
  private var latestState: OneCarPlayStateSnapshot = .empty
  private var connectedFlag = false
  private var interfaceStyleName = "unspecified"
  private var remoteCommandsInstalled = false
  private var ringArtworkCache: MPMediaItemArtwork?
  private var voiceControlPresentedFlag = false

  private weak var activeDelegate: OneCarPlaySceneDelegate?
  private var actionHandler: (([String: Any]) -> Void)?
  private var connectionHandler: (([String: Any]) -> Void)?

  private init() {}

  var isConnected: Bool {
    withLock { connectedFlag }
  }

  var stateSnapshot: OneCarPlayStateSnapshot {
    withLock { latestState }
  }

  var isVoiceControlPresented: Bool {
    withLock { voiceControlPresentedFlag }
  }

  func setVoiceControlPresented(_ presented: Bool) {
    withLock { voiceControlPresentedFlag = presented }
  }

  func attachModuleHandlers(
    onAction: @escaping ([String: Any]) -> Void,
    onConnection: @escaping ([String: Any]) -> Void
  ) {
    let snapshot: (Bool, String) = withLock {
      actionHandler = onAction
      connectionHandler = onConnection
      return (connectedFlag, interfaceStyleName)
    }
    if snapshot.0 {
      onConnection([
        "connected": true,
        "interfaceStyle": snapshot.1,
        "timestampMs": currentTimestampMs(),
      ])
    }
  }

  func detachModuleHandlers() {
    withLock {
      actionHandler = nil
      connectionHandler = nil
    }
  }

  func registerSceneDelegate(_ delegate: OneCarPlaySceneDelegate, interfaceStyle: UIUserInterfaceStyle) {
    let styleName = styleString(interfaceStyle)
    let handler: (([String: Any]) -> Void)? = withLock {
      activeDelegate = delegate
      connectedFlag = true
      interfaceStyleName = styleName
      return connectionHandler
    }
    DispatchQueue.main.async {
      self.installRemoteCommandsIfNeeded()
      self.updateNowPlayingMetadata(self.stateSnapshot)
      delegate.applyState(self.stateSnapshot)
    }
    handler?([
      "connected": true,
      "interfaceStyle": styleName,
      "timestampMs": currentTimestampMs(),
    ])
  }

  func unregisterSceneDelegate(_ delegate: OneCarPlaySceneDelegate) {
    let handler: (([String: Any]) -> Void)? = withLock {
      if activeDelegate === delegate {
        activeDelegate = nil
      }
      connectedFlag = false
      return connectionHandler
    }
    handler?([
      "connected": false,
      "interfaceStyle": "unspecified",
      "timestampMs": currentTimestampMs(),
    ])
  }

  func updateState(_ state: OneCarPlayStateSnapshot) {
    let delegate: OneCarPlaySceneDelegate? = withLock {
      latestState = state
      return activeDelegate
    }
    DispatchQueue.main.async {
      if state.sessionActive {
        self.installRemoteCommandsIfNeeded()
      }
      self.updateNowPlayingMetadata(state)
      delegate?.applyState(state)
    }
  }

  func emitAction(
    _ action: String,
    source: String,
    voiceId: String? = nil,
    modeId: String? = nil,
    threadId: String? = nil
  ) {
    let handler: (([String: Any]) -> Void)? = withLock { actionHandler }
    var payload: [String: Any] = [
      "action": action,
      "source": source,
      "timestampMs": currentTimestampMs(),
    ]
    if let voiceId {
      payload["voiceId"] = voiceId
    }
    if let modeId {
      payload["modeId"] = modeId
    }
    if let threadId {
      payload["threadId"] = threadId
    }
    handler?(payload)
  }

  func installRemoteCommandsIfNeeded() {
    guard !remoteCommandsInstalled else { return }
    remoteCommandsInstalled = true

    let center = MPRemoteCommandCenter.shared()

    center.togglePlayPauseCommand.isEnabled = true
    center.togglePlayPauseCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      let action = self.stateSnapshot.sessionActive ? "toggle_mute" : "start_session"
      self.emitAction(action, source: "steering_wheel")
      return .success
    }

    center.playCommand.isEnabled = true
    center.playCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      let snapshot = self.stateSnapshot
      if !snapshot.sessionActive {
        self.emitAction("start_session", source: "steering_wheel")
      } else if snapshot.muted {
        self.emitAction("toggle_mute", source: "steering_wheel")
      }
      return .success
    }

    center.pauseCommand.isEnabled = true
    center.pauseCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      let snapshot = self.stateSnapshot
      if snapshot.sessionActive && !snapshot.muted {
        self.emitAction("toggle_mute", source: "steering_wheel")
      }
      return .success
    }

    center.nextTrackCommand.isEnabled = true
    center.nextTrackCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      self.emitAction("interrupt", source: "steering_wheel")
      return .success
    }

    center.previousTrackCommand.isEnabled = true
    center.previousTrackCommand.addTarget { [weak self] _ in
      guard let self else { return .commandFailed }
      self.emitAction("repeat_or_new_topic", source: "steering_wheel")
      return .success
    }
  }

  func updateNowPlayingMetadata(_ state: OneCarPlayStateSnapshot) {
    // Metadata only feeds the Now Playing template, which the voice category does not have.
    guard OneCarPlayEntitlementMode.current.allowsNowPlayingTemplate else { return }
    let phaseLabel = readablePhase(state)
    let title = state.activeThreadTitle ?? (state.topicTitle.isEmpty ? "One Drive" : state.topicTitle)
    let artist = "\(state.voiceName) | \(state.personaName)"
    let album = "One: \(phaseLabel)"

    var info: [String: Any] = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: artist,
      MPMediaItemPropertyAlbumTitle: album,
      MPNowPlayingInfoPropertyIsLiveStream: true,
      MPNowPlayingInfoPropertyPlaybackRate: state.sessionActive && !state.muted ? 1.0 : 0.0,
    ]
    info[MPMediaItemPropertyArtwork] = ringArtwork()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func ringArtwork() -> MPMediaItemArtwork {
    if let cached = ringArtworkCache {
      return cached
    }
    let size = CGSize(width: 512, height: 512)
    let renderer = UIGraphicsImageRenderer(size: size)
    let image = renderer.image { context in
      let cgContext = context.cgContext
      let rect = CGRect(origin: .zero, size: size)

      // Obsidian backdrop with subtle gold radial glow behind the One Ring.
      UIColor(red: 0.04, green: 0.04, blue: 0.05, alpha: 1.0).setFill()
      cgContext.fill(rect)

      let colorSpace = CGColorSpaceCreateDeviceRGB()
      let glowColors = [
        UIColor(red: 0.96, green: 0.77, blue: 0.30, alpha: 0.35).cgColor,
        UIColor(red: 0.96, green: 0.77, blue: 0.30, alpha: 0.0).cgColor,
      ] as CFArray
      if let gradient = CGGradient(colorsSpace: colorSpace, colors: glowColors, locations: [0.0, 1.0]) {
        let center = CGPoint(x: size.width / 2.0, y: size.height / 2.0)
        cgContext.drawRadialGradient(
          gradient,
          startCenter: center,
          startRadius: 60,
          endCenter: center,
          endRadius: 230,
          options: []
        )
      }

      let ringRect = rect.insetBy(dx: 112, dy: 112)
      let ringPath = UIBezierPath(ovalIn: ringRect)
      ringPath.lineWidth = 34
      UIColor(red: 0.96, green: 0.77, blue: 0.30, alpha: 1.0).setStroke()
      ringPath.stroke()

      let innerHighlight = UIBezierPath(ovalIn: ringRect.insetBy(dx: 8, dy: 8))
      innerHighlight.lineWidth = 5
      UIColor(red: 1.0, green: 0.93, blue: 0.70, alpha: 0.65).setStroke()
      innerHighlight.stroke()
    }

    let artwork = MPMediaItemArtwork(boundsSize: size) { _ in image }
    ringArtworkCache = artwork
    return artwork
  }

  private func readablePhase(_ state: OneCarPlayStateSnapshot) -> String {
    let labels = state.labels
    if !state.sessionActive {
      return labels.stateReady
    }
    if state.muted || state.phase == "muted" {
      return labels.stateMuted
    }
    switch state.phase {
    case "connecting":
      return labels.stateConnecting
    case "listening":
      return labels.stateListening
    case "thinking":
      return labels.stateThinking
    case "speaking":
      return labels.stateSpeaking
    case "error":
      return labels.stateError
    default:
      return labels.stateReady
    }
  }

  private func styleString(_ style: UIUserInterfaceStyle) -> String {
    switch style {
    case .dark:
      return "dark"
    case .light:
      return "light"
    default:
      return "unspecified"
    }
  }

  private func currentTimestampMs() -> Double {
    floor(Date().timeIntervalSince1970 * 1000.0)
  }

  private func withLock<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }
}

@objc(OneCarPlaySceneDelegate)
public final class OneCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  // Voice-based conversational apps may push at most 3 templates including the root. This scene
  // pushes none: the tab bar is the root and the voice control template is presented modally.
  private var interfaceController: CPInterfaceController?
  private var tabBarTemplate: CPTabBarTemplate?
  private var talkTemplate: CPInformationTemplate?
  private var voicesTemplate: CPListTemplate?
  private var modesTemplate: CPListTemplate?
  private var threadsTemplate: CPListTemplate?

  private var voiceControlTemplate: CPVoiceControlTemplate?
  private var voiceControlBusy = false
  private var voiceControlDismissIsOurs = false
  private var voiceControlClosedBySystem = false

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    interfaceController.delegate = self

    let initialState = OneCarPlayCoordinator.shared.stateSnapshot
    let labels = initialState.labels
    let talk = buildTalkTemplate(state: initialState)
    let voices = CPListTemplate(title: labels.voicesTab, sections: buildVoiceSections(state: initialState))
    voices.tabTitle = labels.voicesTab
    voices.tabImage = UIImage(systemName: "waveform")

    let modes = CPListTemplate(title: labels.modesTab, sections: buildModeSections(state: initialState))
    modes.tabTitle = labels.modesTab
    modes.tabImage = UIImage(systemName: "sparkles")

    let threads = CPListTemplate(title: labels.threadsTab, sections: buildThreadSections(state: initialState))
    threads.tabTitle = labels.threadsTab
    threads.tabImage = UIImage(systemName: "terminal")

    talkTemplate = talk
    voicesTemplate = voices
    modesTemplate = modes
    threadsTemplate = threads

    let tabBar = CPTabBarTemplate(templates: [talk, voices, modes, threads])
    tabBarTemplate = tabBar

    configureNowPlayingTemplate(state: initialState)
    interfaceController.setRootTemplate(tabBar, animated: false, completion: nil)

    OneCarPlayCoordinator.shared.registerSceneDelegate(
      self,
      interfaceStyle: interfaceController.carTraitCollection.userInterfaceStyle
    )
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    OneCarPlayCoordinator.shared.unregisterSceneDelegate(self)
    OneCarPlayCoordinator.shared.setVoiceControlPresented(false)
    interfaceController.delegate = nil
    self.interfaceController = nil
    tabBarTemplate = nil
    talkTemplate = nil
    voicesTemplate = nil
    modesTemplate = nil
    threadsTemplate = nil
    voiceControlTemplate = nil
    voiceControlBusy = false
    voiceControlDismissIsOurs = false
    voiceControlClosedBySystem = false
  }

  internal func applyState(_ state: OneCarPlayStateSnapshot) {
    guard interfaceController != nil else { return }

    if let talkTemplate {
      talkTemplate.items = buildTalkItems(state: state)
      talkTemplate.actions = buildTalkActions(state: state)
    }
    voicesTemplate?.updateSections(buildVoiceSections(state: state))
    modesTemplate?.updateSections(buildModeSections(state: state))
    threadsTemplate?.updateSections(buildThreadSections(state: state))
    configureNowPlayingTemplate(state: state)
    syncVoiceControl(state)
  }

  private func buildTalkTemplate(state: OneCarPlayStateSnapshot) -> CPInformationTemplate {
    let template = CPInformationTemplate(
      title: state.labels.talkTitle,
      layout: .leading,
      items: buildTalkItems(state: state),
      actions: buildTalkActions(state: state)
    )
    template.tabTitle = state.labels.talkTab
    template.tabImage = UIImage(systemName: "mic.fill")
    return template
  }

  /// Rows show state and names only. Answers are spoken, so no response text is drawn here.
  private func buildTalkItems(state: OneCarPlayStateSnapshot) -> [CPInformationItem] {
    let labels = state.labels
    let topic = state.activeThreadTitle ?? (state.topicTitle.isEmpty ? labels.defaultTopic : state.topicTitle)
    return [
      CPInformationItem(title: labels.statusRow, detail: readableStatus(state)),
      CPInformationItem(
        title: labels.voiceAndModeRow,
        detail: "\(state.voiceName) | \(state.personaName)"
      ),
      CPInformationItem(title: labels.topicRow, detail: topic),
    ]
  }

  private func buildTalkActions(state: OneCarPlayStateSnapshot) -> [CPTextButton] {
    let labels = state.labels
    if !state.sessionActive {
      let startButton = CPTextButton(title: labels.startTalking, textStyle: .confirm) { [weak self] _ in
        OneCarPlayCoordinator.shared.emitAction("start_session", source: "carplay_ui")
        self?.openNowPlayingTemplate()
      }
      guard OneCarPlayEntitlementMode.current.allowsNowPlayingTemplate else {
        return [startButton]
      }
      let nowPlayingButton = CPTextButton(title: labels.nowPlaying, textStyle: .normal) { [weak self] _ in
        self?.openNowPlayingTemplate()
      }
      return [startButton, nowPlayingButton]
    }

    let muteTitle = state.muted ? labels.unmute : labels.mute
    let muteButton = CPTextButton(title: muteTitle, textStyle: .normal) { _ in
      OneCarPlayCoordinator.shared.emitAction("toggle_mute", source: "carplay_ui")
    }
    let interruptButton = CPTextButton(title: labels.interrupt, textStyle: .confirm) { _ in
      OneCarPlayCoordinator.shared.emitAction("interrupt", source: "carplay_ui")
    }
    let endButton = CPTextButton(title: labels.end, textStyle: .cancel) { _ in
      OneCarPlayCoordinator.shared.emitAction("end_session", source: "carplay_ui")
    }
    return [muteButton, interruptButton, endButton]
  }

  // MARK: Now Playing (audio and communication entitlements only)

  private func configureNowPlayingTemplate(state: OneCarPlayStateSnapshot) {
    guard OneCarPlayEntitlementMode.current.allowsNowPlayingTemplate else { return }
    let nowPlaying = CPNowPlayingTemplate.shared
    nowPlaying.isUpNextButtonEnabled = false
    nowPlaying.isAlbumArtistButtonEnabled = false

    let muteImage = UIImage(systemName: state.muted ? "mic.slash.fill" : "mic.fill") ?? UIImage()
    let muteButton = CPNowPlayingImageButton(image: muteImage) { _ in
      let action = OneCarPlayCoordinator.shared.stateSnapshot.sessionActive ? "toggle_mute" : "start_session"
      OneCarPlayCoordinator.shared.emitAction(action, source: "now_playing")
    }

    let interruptImage = UIImage(systemName: "hand.raised.fill") ?? UIImage()
    let interruptButton = CPNowPlayingImageButton(image: interruptImage) { _ in
      OneCarPlayCoordinator.shared.emitAction("interrupt", source: "now_playing")
    }

    let switchVoiceImage = UIImage(systemName: "waveform.circle.fill") ?? UIImage()
    let switchVoiceButton = CPNowPlayingImageButton(image: switchVoiceImage) { _ in
      OneCarPlayCoordinator.shared.emitAction("cycle_voice", source: "now_playing")
    }

    let endImage = UIImage(systemName: "xmark.circle.fill") ?? UIImage()
    let endButton = CPNowPlayingImageButton(image: endImage) { _ in
      OneCarPlayCoordinator.shared.emitAction("end_session", source: "now_playing")
    }

    nowPlaying.updateNowPlayingButtons([muteButton, interruptButton, switchVoiceButton, endButton])
  }

  private func openNowPlayingTemplate() {
    guard OneCarPlayEntitlementMode.current.allowsNowPlayingTemplate,
      let interfaceController
    else { return }
    let nowPlaying = CPNowPlayingTemplate.shared
    if interfaceController.topTemplate !== nowPlaying {
      interfaceController.pushTemplate(nowPlaying, animated: true, completion: nil)
    }
  }

  // MARK: Voice control (voice-based conversational entitlement)

  /// Shows the voice control template while a voice session is active and removes it when the
  /// session ends. Older systems keep the Talk tab, which already shows the state and buttons.
  private func syncVoiceControl(_ state: OneCarPlayStateSnapshot) {
    guard OneCarPlayEntitlementMode.current.usesVoiceControlTemplate else { return }
    if #available(iOS 26.4, *) {
      reconcileVoiceControl(state)
    }
  }

  @available(iOS 26.4, *)
  private func reconcileVoiceControl(_ state: OneCarPlayStateSnapshot) {
    guard let controller = interfaceController, !voiceControlBusy else { return }

    guard state.sessionActive else {
      voiceControlClosedBySystem = false
      dismissVoiceControl(using: controller)
      return
    }
    guard !voiceControlClosedBySystem else { return }

    let identifier = voiceStateIdentifier(state)
    if let template = voiceControlTemplate, controller.presentedTemplate === template {
      if template.activeStateIdentifier != identifier {
        template.activateVoiceControlState(withIdentifier: identifier)
      }
      return
    }
    guard controller.presentedTemplate == nil else { return }

    let template = makeVoiceControlTemplate(state: state, firstIdentifier: identifier)
    voiceControlTemplate = template
    voiceControlBusy = true
    controller.presentTemplate(template, animated: true) { [weak self] success, error in
      guard let self else { return }
      self.voiceControlBusy = false
      guard success else {
        self.voiceControlTemplate = nil
        NSLog("OneCarPlay: could not present the voice control template: \(String(describing: error))")
        return
      }
      OneCarPlayCoordinator.shared.setVoiceControlPresented(true)
      self.reconcileVoiceControl(OneCarPlayCoordinator.shared.stateSnapshot)
    }
  }

  @available(iOS 26.4, *)
  private func dismissVoiceControl(using controller: CPInterfaceController) {
    guard let template = voiceControlTemplate else { return }
    guard controller.presentedTemplate === template else {
      voiceControlTemplate = nil
      OneCarPlayCoordinator.shared.setVoiceControlPresented(false)
      return
    }
    voiceControlBusy = true
    voiceControlDismissIsOurs = true
    controller.dismissTemplate(animated: true) { [weak self] _, _ in
      guard let self else { return }
      self.voiceControlBusy = false
      self.voiceControlDismissIsOurs = false
      self.voiceControlTemplate = nil
      OneCarPlayCoordinator.shared.setVoiceControlPresented(false)
      self.reconcileVoiceControl(OneCarPlayCoordinator.shared.stateSnapshot)
    }
  }

  /// The voice control template has five states. The one in use goes first because a template
  /// opens on its first state.
  @available(iOS 26.4, *)
  private func makeVoiceControlTemplate(
    state: OneCarPlayStateSnapshot,
    firstIdentifier: String
  ) -> CPVoiceControlTemplate {
    let identifiers = ["connecting", "listening", "thinking", "speaking", "muted"]
    let ordered = [firstIdentifier] + identifiers.filter { $0 != firstIdentifier }
    let states = ordered.map { makeVoiceControlState(identifier: $0, labels: state.labels) }
    return CPVoiceControlTemplate(voiceControlStates: states)
  }

  @available(iOS 26.4, *)
  private func makeVoiceControlState(identifier: String, labels: OneCarPlayLabels) -> CPVoiceControlState {
    let gold = UIColor(red: 0.96, green: 0.77, blue: 0.30, alpha: 1.0)
    let white = UIColor.white
    let end = voiceControlButton(symbol: "xmark.circle.fill", title: labels.end, action: "end_session")

    let title: String
    let image: UIImage
    let buttons: [CPButton]
    switch identifier {
    case "connecting":
      title = labels.stateConnecting
      image = voiceControlImage(symbol: "antenna.radiowaves.left.and.right", color: white)
      buttons = [end]
    case "thinking":
      title = labels.stateThinking
      image = voiceControlImage(symbol: "ellipsis.circle", color: white)
      buttons = [
        voiceControlButton(symbol: "mic.slash.fill", title: labels.mute, action: "toggle_mute"), end,
      ]
    case "speaking":
      title = labels.stateSpeaking
      image = voiceControlImage(symbol: "waveform", color: gold)
      buttons = [
        voiceControlButton(symbol: "hand.raised.fill", title: labels.interrupt, action: "interrupt"), end,
      ]
    case "muted":
      title = labels.stateMuted
      image = voiceControlImage(symbol: "mic.slash.fill", color: white)
      buttons = [
        voiceControlButton(symbol: "mic.fill", title: labels.unmute, action: "toggle_mute"), end,
      ]
    default:
      title = labels.stateListening
      image = voiceControlImage(symbol: "mic.fill", color: gold)
      buttons = [
        voiceControlButton(symbol: "mic.slash.fill", title: labels.mute, action: "toggle_mute"), end,
      ]
    }

    let controlState = CPVoiceControlState(
      identifier: identifier,
      titleVariants: [title],
      image: image,
      repeats: false
    )
    controlState.actionButtons = Array(buttons.prefix(CPVoiceControlState.maximumActionButtonCount))
    return controlState
  }

  private func voiceControlButton(symbol: String, title: String, action: String) -> CPButton {
    let button = CPButton(image: UIImage(systemName: symbol) ?? UIImage()) { _ in
      OneCarPlayCoordinator.shared.emitAction(action, source: "carplay_ui")
    }
    button.title = title
    return button
  }

  /// CarPlay shows voice control images up to 150 pt square.
  private func voiceControlImage(symbol: String, color: UIColor) -> UIImage {
    let side: CGFloat = 150
    let configuration = UIImage.SymbolConfiguration(pointSize: 96, weight: .regular)
    guard
      let symbolImage = UIImage(systemName: symbol, withConfiguration: configuration)?
        .withTintColor(color, renderingMode: .alwaysOriginal)
    else {
      return UIImage()
    }
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
    return renderer.image { _ in
      let size = symbolImage.size
      let scale = min(1.0, min(side / size.width, side / size.height))
      let width = size.width * scale
      let height = size.height * scale
      symbolImage.draw(
        in: CGRect(x: (side - width) / 2.0, y: (side - height) / 2.0, width: width, height: height)
      )
    }
  }

  private func voiceStateIdentifier(_ state: OneCarPlayStateSnapshot) -> String {
    if state.muted || state.phase == "muted" {
      return "muted"
    }
    switch state.phase {
    case "connecting", "listening", "thinking", "speaking":
      return state.phase
    default:
      return "listening"
    }
  }

  /// The system or the driver closed the voice control screen while a session was running. The
  /// session then ends so the microphone and audio session are released. A short wait avoids
  /// ending it when the same event comes from the phone being unplugged.
  fileprivate func voiceControlDidDisappear(_ template: CPTemplate) {
    guard template === voiceControlTemplate, !voiceControlDismissIsOurs else { return }
    voiceControlTemplate = nil
    voiceControlClosedBySystem = true
    OneCarPlayCoordinator.shared.setVoiceControlPresented(false)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) { [weak self] in
      guard let self, self.interfaceController != nil, self.voiceControlClosedBySystem else { return }
      if OneCarPlayCoordinator.shared.stateSnapshot.sessionActive {
        OneCarPlayCoordinator.shared.emitAction("end_session", source: "carplay_ui")
      }
    }
  }

  // MARK: Lists

  private func buildVoiceSections(state: OneCarPlayStateSnapshot) -> [CPListSection] {
    let labels = state.labels
    guard !state.voices.isEmpty else {
      let empty = CPListItem(text: labels.voicesEmpty, detailText: labels.voicesEmptyDetail)
      return [CPListSection(items: [empty])]
    }

    var groupOrder: [String] = []
    var grouped: [String: [OneCarPlayVoiceSnapshot]] = [:]
    for voice in state.voices {
      if grouped[voice.group] == nil {
        groupOrder.append(voice.group)
      }
      grouped[voice.group, default: []].append(voice)
    }

    let maxSections = max(1, CPListTemplate.maximumSectionCount)
    let maxItemsTotal = max(12, CPListTemplate.maximumItemCount)
    var remainingItems = maxItemsTotal
    var sections: [CPListSection] = []

    for groupName in groupOrder.prefix(maxSections) {
      guard remainingItems > 0, let voicesInGroup = grouped[groupName] else { break }
      let slice = voicesInGroup.prefix(remainingItems)
      remainingItems -= slice.count

      let listItems = slice.map { voice -> CPListItem in
        let title = voice.isSelected ? "\(voice.displayName) (\(labels.activeSuffix))" : voice.displayName
        let item = CPListItem(text: title, detailText: voice.subtitle)
        item.accessoryType = voice.isSelected ? .none : .disclosureIndicator
        item.isPlaying = voice.isSelected && state.sessionActive
        item.handler = { _, completion in
          OneCarPlayCoordinator.shared.emitAction(
            "select_voice",
            source: "carplay_ui",
            voiceId: voice.id
          )
          completion()
        }
        return item
      }
      sections.append(CPListSection(items: listItems, header: groupName, sectionIndexTitle: nil))
    }

    return sections
  }

  private func buildModeSections(state: OneCarPlayStateSnapshot) -> [CPListSection] {
    let labels = state.labels
    guard !state.modes.isEmpty else {
      let fallback = CPListItem(text: state.personaName, detailText: labels.modesFallbackDetail)
      fallback.handler = { _, completion in
        OneCarPlayCoordinator.shared.emitAction(
          "select_mode",
          source: "carplay_ui",
          modeId: state.personaId
        )
        completion()
      }
      return [CPListSection(items: [fallback], header: labels.modesHeader, sectionIndexTitle: nil)]
    }

    let items = state.modes.prefix(CPListTemplate.maximumItemCount).map { mode -> CPListItem in
      let title = mode.isSelected ? "\(mode.title) (\(labels.activeSuffix))" : mode.title
      let item = CPListItem(text: title, detailText: mode.subtitle)
      item.isPlaying = mode.isSelected && state.sessionActive
      item.handler = { _, completion in
        OneCarPlayCoordinator.shared.emitAction(
          "select_mode",
          source: "carplay_ui",
          modeId: mode.id
        )
        completion()
      }
      return item
    }
    return [CPListSection(items: items, header: labels.modesHeader, sectionIndexTitle: nil)]
  }

  /// Rows show the thread title with a short status. The assistant's replies never appear here.
  private func buildThreadSections(state: OneCarPlayStateSnapshot) -> [CPListSection] {
    let labels = state.labels
    guard !state.threads.isEmpty else {
      let empty = CPListItem(text: labels.threadsEmpty, detailText: labels.threadsEmptyDetail)
      return [CPListSection(items: [empty], header: labels.threadsHeader, sectionIndexTitle: nil)]
    }

    let items = state.threads.prefix(CPListTemplate.maximumItemCount).map { thread -> CPListItem in
      let detailParts = [thread.statusLabel, thread.projectName]
        .compactMap { part -> String? in
          guard let part, !part.isEmpty else { return nil }
          return part
        }
      let item = CPListItem(
        text: thread.title,
        detailText: detailParts.joined(separator: " | ")
      )
      item.isPlaying = thread.isSelected && state.sessionActive
      item.handler = { [weak self] _, completion in
        OneCarPlayCoordinator.shared.emitAction(
          "select_thread",
          source: "carplay_ui",
          threadId: thread.id
        )
        self?.openNowPlayingTemplate()
        completion()
      }
      return item
    }
    return [CPListSection(items: items, header: labels.threadsHeader, sectionIndexTitle: nil)]
  }

  private func readableStatus(_ state: OneCarPlayStateSnapshot) -> String {
    let labels = state.labels
    if !state.sessionActive {
      return state.phase == "error" ? labels.stateError : labels.stateReady
    }
    if state.muted || state.phase == "muted" {
      return labels.stateMuted
    }
    switch state.phase {
    case "connecting":
      return labels.stateConnecting
    case "listening":
      return labels.stateListening
    case "thinking":
      return labels.stateThinking
    case "speaking":
      return labels.stateSpeaking
    default:
      return labels.stateActive
    }
  }
}

extension OneCarPlaySceneDelegate: CPInterfaceControllerDelegate {
  public func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
    voiceControlDidDisappear(aTemplate)
  }
}
