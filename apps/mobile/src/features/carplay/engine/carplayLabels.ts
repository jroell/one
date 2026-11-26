import type { CarPlayLabels } from "@t3tools/mobile-carplay-native";
import { msg } from "gt-react-native";

import { m } from "../../../i18n/messages";

/** Native Swift draws every CarPlay string, so the current language is resolved here per sync. */
export function buildCarPlayLabels(): CarPlayLabels {
  return {
    talkTab: m(msg("Talk")),
    voicesTab: m(msg("Voices")),
    modesTab: m(msg("Modes")),
    threadsTab: m(msg("Threads")),
    talkTitle: m(msg("One")),
    statusRow: m(msg("Status")),
    voiceAndModeRow: m(msg("Voice and mode")),
    topicRow: m(msg("Topic")),
    defaultTopic: m(msg("Hands-free chat")),
    startTalking: m(msg("Start talking")),
    nowPlaying: m(msg("Now playing")),
    mute: m(msg("Mute")),
    unmute: m(msg("Unmute")),
    interrupt: m(msg("Interrupt")),
    end: m(msg("End")),
    stateReady: m(msg("Ready")),
    stateConnecting: m(msg("Connecting")),
    stateListening: m(msg("Listening")),
    stateThinking: m(msg("Thinking")),
    stateSpeaking: m(msg("Speaking")),
    stateMuted: m(msg("Muted")),
    stateError: m(msg("Connection lost")),
    stateActive: m(msg("Active")),
    activeSuffix: m(msg("Active")),
    voicesEmpty: m(msg("No voices loaded yet")),
    voicesEmptyDetail: m(msg("Open One on your iPhone to sync your voices.")),
    modesHeader: m(msg("Driving modes")),
    modesFallbackDetail: m(msg("Hands-free conversational companion")),
    threadsHeader: m(msg("Active threads")),
    threadsEmpty: m(msg("No active threads")),
    threadsEmptyDetail: m(msg("Connect to a workspace or talk without one.")),
  };
}
