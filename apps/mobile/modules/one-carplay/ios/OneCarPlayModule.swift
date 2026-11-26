import ExpoModulesCore
import Foundation

public final class OneCarPlayModule: Module {
  private let audioEngine = OneCarPlayAudioEngine()

  public func definition() -> ModuleDefinition {
    Name("OneCarPlay")

    Events(
      "onAudioChunk",
      "onAudioLevel",
      "onCarPlayAction",
      "onCarPlayConnection",
      "onAudioInterruption"
    )

    OnCreate {
      self.audioEngine.onAudioChunk = { [weak self] payload in
        self?.sendEvent("onAudioChunk", payload)
      }
      self.audioEngine.onAudioLevel = { [weak self] payload in
        self?.sendEvent("onAudioLevel", payload)
      }
      self.audioEngine.onAudioInterruption = { [weak self] payload in
        self?.sendEvent("onAudioInterruption", payload)
      }
      OneCarPlayCoordinator.shared.attachModuleHandlers(
        onAction: { [weak self] payload in
          self?.sendEvent("onCarPlayAction", payload)
        },
        onConnection: { [weak self] payload in
          self?.sendEvent("onCarPlayConnection", payload)
        }
      )
    }

    AsyncFunction("startAudioSession") { (options: [String: Any]) throws -> [String: Any] in
      let sampleRate = options["sampleRate"] as? Double ?? 24_000
      let chunkDurationMs = options["chunkDurationMs"] as? Int ?? 100
      let enableEchoCancellation = options["enableEchoCancellation"] as? Bool ?? true
      let muted = options["muted"] as? Bool ?? false

      let result = try self.audioEngine.start(
        config: OneAudioSessionConfig(
          sampleRate: sampleRate,
          chunkDurationMs: chunkDurationMs,
          enableEchoCancellation: enableEchoCancellation,
          muted: muted
        )
      )
      return [
        "started": result.started,
        "sampleRate": Int(result.sampleRate),
        "channels": result.channels,
        "echoCancellationActive": result.echoCancellationActive,
        "routeName": result.routeName,
      ]
    }

    AsyncFunction("stopAudioSession") {
      self.audioEngine.stop()
    }

    AsyncFunction("enqueuePcmAudio") { (base64Pcm16: String, sampleRate: Double) in
      self.audioEngine.enqueuePcmAudio(base64Pcm16: base64Pcm16, sampleRate: sampleRate)
    }

    AsyncFunction("clearPlaybackQueue") {
      self.audioEngine.clearPlaybackQueue()
    }

    AsyncFunction("setMuted") { (muted: Bool) in
      self.audioEngine.setMuted(muted)
    }

    AsyncFunction("speakFallbackText") { (text: String, options: [String: Any]) in
      let voiceIdentifier = options["voiceIdentifier"] as? String
      let language = options["language"] as? String ?? "en-US"
      let rate = options["rate"] as? Double ?? 1.0
      let pitch = options["pitch"] as? Double ?? 1.0
      self.audioEngine.speakFallbackText(
        text: text,
        voiceIdentifier: voiceIdentifier,
        language: language,
        rate: rate,
        pitch: pitch
      )
    }

    AsyncFunction("stopFallbackSpeech") {
      self.audioEngine.stopFallbackSpeech()
    }

    AsyncFunction("updateCarPlayState") { (state: [String: Any]) in
      let snapshot = OneCarPlayStateSnapshot.parse(from: state)
      OneCarPlayCoordinator.shared.updateState(snapshot)
    }

    AsyncFunction("getCarPlayStatus") { () -> [String: Any] in
      let entitlementExpected =
        Bundle.main.object(forInfoDictionaryKey: "OneCarPlayEntitlementExpected") as? Bool ?? false
      return [
        "available": true,
        "connected": OneCarPlayCoordinator.shared.isConnected,
        "voiceControlPresented": OneCarPlayCoordinator.shared.isVoiceControlPresented,
        "entitlementMode": OneCarPlayEntitlementMode.current.rawValue,
        "audioSessionActive": self.audioEngine.audioSessionActive,
        "muted": self.audioEngine.muted,
        "platform": "ios",
        "carPlayEntitlementExpected": entitlementExpected,
        "audioRouteName": self.audioEngine.currentRouteName,
      ]
    }

    OnDestroy {
      OneCarPlayCoordinator.shared.detachModuleHandlers()
      self.audioEngine.stopFallbackSpeech()
      self.audioEngine.stopSync()
    }
  }
}
