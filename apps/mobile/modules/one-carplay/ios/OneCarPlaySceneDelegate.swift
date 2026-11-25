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
  let liveCaption: String
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
    liveCaption: "Tap Start Talking to begin hands-free voice chat.",
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
      liveCaption: dictionary["liveCaption"] as? String ?? "",
      activeThreadId: dictionary["activeThreadId"] as? String,
      activeThreadTitle: dictionary["activeThreadTitle"] as? String,
      voices: voices,
      modes: modes,
      threads: threads
    )
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
    let phaseLabel = readablePhase(state.phase, muted: state.muted, active: state.sessionActive)
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

  private func readablePhase(_ phase: String, muted: Bool, active: Bool) -> String {
    if !active {
      return "Ready"
    }
    if muted || phase == "muted" {
      return "Muted"
    }
    switch phase {
    case "connecting":
      return "Connecting"
    case "listening":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "speaking":
      return "Speaking"
    case "error":
      return "Reconnecting"
    default:
      return "Ready"
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
  private var interfaceController: CPInterfaceController?
  private var tabBarTemplate: CPTabBarTemplate?
  private var talkTemplate: CPInformationTemplate?
  private var voicesTemplate: CPListTemplate?
  private var modesTemplate: CPListTemplate?
  private var threadsTemplate: CPListTemplate?

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController

    let initialState = OneCarPlayCoordinator.shared.stateSnapshot
    let talk = buildTalkTemplate(state: initialState)
    let voices = CPListTemplate(title: "Voices", sections: buildVoiceSections(state: initialState))
    voices.tabTitle = "Voices"
    voices.tabImage = UIImage(systemName: "waveform")

    let modes = CPListTemplate(title: "Modes", sections: buildModeSections(state: initialState))
    modes.tabTitle = "Modes"
    modes.tabImage = UIImage(systemName: "sparkles")

    let threads = CPListTemplate(title: "Threads", sections: buildThreadSections(state: initialState))
    threads.tabTitle = "Threads"
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
      interfaceStyle: templateApplicationScene.carTraitCollection.userInterfaceStyle
    )
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    OneCarPlayCoordinator.shared.unregisterSceneDelegate(self)
    self.interfaceController = nil
    tabBarTemplate = nil
    talkTemplate = nil
    voicesTemplate = nil
    modesTemplate = nil
    threadsTemplate = nil
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
  }

  private func buildTalkTemplate(state: OneCarPlayStateSnapshot) -> CPInformationTemplate {
    let template = CPInformationTemplate(
      title: "One Talk",
      layout: .leading,
      items: buildTalkItems(state: state),
      actions: buildTalkActions(state: state)
    )
    template.tabTitle = "Talk"
    template.tabImage = UIImage(systemName: "mic.fill")
    return template
  }

  private func buildTalkItems(state: OneCarPlayStateSnapshot) -> [CPInformationItem] {
    let statusText = readableStatus(state)
    let topic = state.activeThreadTitle ?? (state.topicTitle.isEmpty ? "Hands-Free Chat" : state.topicTitle)
    let caption = state.liveCaption.isEmpty
      ? (state.sessionActive ? "Listening for your voice..." : "Tap Start Talking to connect.")
      : state.liveCaption

    return [
      CPInformationItem(title: "Status", detail: statusText),
      CPInformationItem(title: "Voice & Mode", detail: "\(state.voiceName) | \(state.personaName)"),
      CPInformationItem(title: "Topic", detail: topic),
      CPInformationItem(title: "Live", detail: caption),
    ]
  }

  private func buildTalkActions(state: OneCarPlayStateSnapshot) -> [CPTextButton] {
    if !state.sessionActive {
      let startButton = CPTextButton(title: "Start Talking", textStyle: .confirm) { [weak self] _ in
        OneCarPlayCoordinator.shared.emitAction("start_session", source: "carplay_ui")
        self?.openNowPlayingTemplate()
      }
      let nowPlayingButton = CPTextButton(title: "Now Playing", textStyle: .normal) { [weak self] _ in
        self?.openNowPlayingTemplate()
      }
      return [startButton, nowPlayingButton]
    }

    let muteTitle = state.muted ? "Unmute" : "Mute"
    let muteButton = CPTextButton(title: muteTitle, textStyle: .normal) { _ in
      OneCarPlayCoordinator.shared.emitAction("toggle_mute", source: "carplay_ui")
    }
    let interruptButton = CPTextButton(title: "Interrupt", textStyle: .confirm) { _ in
      OneCarPlayCoordinator.shared.emitAction("interrupt", source: "carplay_ui")
    }
    let endButton = CPTextButton(title: "End", textStyle: .cancel) { _ in
      OneCarPlayCoordinator.shared.emitAction("end_session", source: "carplay_ui")
    }
    return [muteButton, interruptButton, endButton]
  }

  private func configureNowPlayingTemplate(state: OneCarPlayStateSnapshot) {
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
    guard let interfaceController else { return }
    let nowPlaying = CPNowPlayingTemplate.shared
    if interfaceController.topTemplate !== nowPlaying {
      interfaceController.pushTemplate(nowPlaying, animated: true, completion: nil)
    }
  }

  private func buildVoiceSections(state: OneCarPlayStateSnapshot) -> [CPListSection] {
    guard !state.voices.isEmpty else {
      let empty = CPListItem(
        text: "No voices loaded yet",
        detailText: "Open One on your iPhone to sync your voice catalog."
      )
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
        let title = voice.isSelected ? "\(voice.displayName) (Active)" : voice.displayName
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
    guard !state.modes.isEmpty else {
      let fallback = CPListItem(
        text: "Road Co-Pilot",
        detailText: "Hands-free conversational companion"
      )
      fallback.handler = { _, completion in
        OneCarPlayCoordinator.shared.emitAction("select_mode", source: "carplay_ui", modeId: "copilot")
        completion()
      }
      return [CPListSection(items: [fallback], header: "Driving Modes", sectionIndexTitle: nil)]
    }

    let items = state.modes.prefix(CPListTemplate.maximumItemCount).map { mode -> CPListItem in
      let title = mode.isSelected ? "\(mode.title) (Active)" : mode.title
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
    return [CPListSection(items: items, header: "Driving Personas", sectionIndexTitle: nil)]
  }

  private func buildThreadSections(state: OneCarPlayStateSnapshot) -> [CPListSection] {
    guard !state.threads.isEmpty else {
      let empty = CPListItem(
        text: "No active One threads",
        detailText: "Connect to a One workspace or use Road Co-Pilot standalone."
      )
      return [CPListSection(items: [empty], header: "Workspace Threads", sectionIndexTitle: nil)]
    }

    let items = state.threads.prefix(CPListTemplate.maximumItemCount).map { thread -> CPListItem in
      let detailPrefix = "[\(thread.statusLabel)]"
      let detailParts = [detailPrefix, thread.projectName, thread.subtitle]
        .compactMap { part -> String? in
          guard let part, !part.isEmpty else { return nil }
          return part
        }
      let item = CPListItem(
        text: thread.title,
        detailText: detailParts.joined(separator: " ")
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
    return [CPListSection(items: items, header: "Active One Threads", sectionIndexTitle: nil)]
  }

  private func readableStatus(_ state: OneCarPlayStateSnapshot) -> String {
    if !state.sessionActive {
      return "Ready"
    }
    if state.muted || state.phase == "muted" {
      return "Muted"
    }
    switch state.phase {
    case "connecting":
      return "Connecting..."
    case "listening":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "speaking":
      return "Speaking"
    case "error":
      return "Reconnecting"
    default:
      return "Active"
    }
  }
}
