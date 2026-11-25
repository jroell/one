import * as Haptics from "expo-haptics";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { ThemedSwitch } from "../../../components/ui/ThemedSwitch";
import { DRIVE_COLORS, DRIVE_STATE_VISUALS, SPOKEN_SPEED_OPTIONS } from "./driveTheme";
import {
  providerLabelMessage,
  type ApiKeyProviderId,
  type BridgeThreadView,
  type BridgeThreadRefView,
  type CarPlaySettingsView,
  type DriveSnapshotView,
  type DrivingPersonaView,
  type PersonaId,
  type VoiceProfileView,
} from "./driveUiTypes";

export interface CarPlayPreviewPanelProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly snapshot: DriveSnapshotView;
  readonly voices: readonly VoiceProfileView[];
  readonly personas: readonly DrivingPersonaView[];
  readonly onStartSession: () => void | Promise<unknown>;
  readonly onEndSession: () => void | Promise<unknown>;
  readonly onToggleMute: () => void | Promise<unknown>;
  readonly onInterrupt: () => void | Promise<unknown>;
  readonly onSelectVoice: (voiceId: string) => void | Promise<unknown>;
  readonly onSelectPersona: (personaId: PersonaId) => void | Promise<unknown>;
  readonly onSelectThread: (ref: BridgeThreadRefView | null) => void | Promise<unknown>;
  readonly onUpdateSettings: (partial: Partial<CarPlaySettingsView>) => void | Promise<unknown>;
  readonly onSaveApiKey: (provider: ApiKeyProviderId, value: string) => void | Promise<unknown>;
  readonly onClearApiKey: (provider: ApiKeyProviderId) => void | Promise<unknown>;
  readonly onOpenVoiceStudio?: () => void;
}

type CarPlaySimulatorTab = "talk" | "voices" | "modes" | "threads";

const SIMULATOR_TABS: ReadonlyArray<{ readonly id: CarPlaySimulatorTab; readonly label: string }> =
  [
    { id: "talk", label: msg("Talk") },
    { id: "voices", label: msg("Voices") },
    { id: "modes", label: msg("Modes") },
    { id: "threads", label: msg("Threads") },
  ];

const API_KEY_PROVIDERS: ReadonlyArray<{
  readonly id: ApiKeyProviderId;
  readonly label: string;
  readonly placeholder: string;
  readonly hint: string;
}> = [
  {
    id: "openai",
    label: msg("OpenAI Realtime API key"),
    placeholder: "sk-...",
    hint: msg("Enables 10 OpenAI Realtime full-duplex voices"),
  },
  {
    id: "gemini",
    label: msg("Gemini Live API key"),
    // oxlint-disable-next-line t3code/no-untranslated-copy -- API key prefix format
    placeholder: "AIza...",
    hint: msg("Enables 10 Gemini Live native audio voices"),
  },
  {
    id: "elevenlabs",
    label: msg("ElevenLabs API key"),
    placeholder: "xi-...",
    hint: msg("Enables expressive ElevenLabs voice synthesis and auditions"),
  },
];

const THREAD_STATUS_LABELS: Readonly<Record<BridgeThreadView["status"], string>> = {
  needs_approval: msg("Needs approval"),
  running: msg("Running"),
  ready: msg("Ready"),
  error: msg("Issue"),
};

function threadStatusColor(status: BridgeThreadView["status"]): string {
  switch (status) {
    case "needs_approval":
      return DRIVE_COLORS.amberOrbit;
    case "running":
      return DRIVE_COLORS.goldBright;
    case "ready":
      return DRIVE_COLORS.success;
    case "error":
      return DRIVE_COLORS.danger;
  }
}

function formatClock(): string {
  const now = new Date();
  const hours = now.getHours() % 12 || 12;
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function triggerHaptic() {
  void Haptics.selectionAsync().catch(() => undefined);
}

/**
 * Interactive 16:9 Apple CarPlay head-unit simulator plus secure Voice and CarPlay setup drawer.
 */
export function CarPlayPreviewPanel({
  visible,
  onClose,
  snapshot,
  voices,
  personas,
  onStartSession,
  onEndSession,
  onToggleMute,
  onInterrupt,
  onSelectVoice,
  onSelectPersona,
  onSelectThread,
  onUpdateSettings,
  onSaveApiKey,
  onClearApiKey,
  onOpenVoiceStudio,
}: CarPlayPreviewPanelProps) {
  const gt = useGT();
  const m = useMessages();
  const insets = useSafeAreaInsets();
  const [simTab, setSimTab] = useState<CarPlaySimulatorTab>("talk");
  const [keyDrafts, setKeyDrafts] = useState<Record<ApiKeyProviderId, string>>({
    openai: "",
    gemini: "",
    elevenlabs: "",
  });
  const [revealedKeys, setRevealedKeys] = useState<Record<ApiKeyProviderId, boolean>>({
    openai: false,
    gemini: false,
    elevenlabs: false,
  });
  const [savedNotice, setSavedNotice] = useState<ApiKeyProviderId | null>(null);

  const visual = DRIVE_STATE_VISUALS[snapshot.sessionState];
  // System lines repeat the state title above, so only speech or the linked thread shows here.
  const carPlayCaption =
    snapshot.activeCaptionRole !== "system" && snapshot.activeCaption
      ? snapshot.activeCaption
      : snapshot.activeThreadTitle;
  const favoriteSet = new Set(snapshot.settings.favoriteVoiceIds);
  const carPlayVoices = [...voices]
    .sort((a, b) => {
      const aFav = favoriteSet.has(a.id) ? 1 : 0;
      const bFav = favoriteSet.has(b.id) ? 1 : 0;
      return bFav - aFav;
    })
    .slice(0, 10);

  const handleSaveKey = async (provider: ApiKeyProviderId) => {
    const trimmed = keyDrafts[provider].trim();
    if (!trimmed) return;
    triggerHaptic();
    await onSaveApiKey(provider, trimmed);
    setKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
    setSavedNotice(provider);
  };

  const handleClearKey = async (provider: ApiKeyProviderId) => {
    triggerHaptic();
    await onClearApiKey(provider);
    setKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
    setSavedNotice(null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        testID="carplay-preview-panel"
        style={[
          styles.root,
          {
            paddingTop: Math.max(insets.top, 18),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Modal Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>
              <T>CarPlay & setup</T>
            </Text>
            <Text style={styles.headerSubtitle}>
              {snapshot.carPlayConnected
                ? gt("Apple CarPlay connected")
                : gt("Interactive CarPlay preview and voice keys")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Close CarPlay and setup")}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <SymbolView name="xmark" size={20} tintColor={DRIVE_COLORS.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Section 1: Widescreen 16:9 CarPlay Head-Unit Simulator */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              <T>Apple CarPlay head-unit preview</T>
            </Text>
            <View
              style={[
                styles.connectionBadge,
                snapshot.carPlayConnected && styles.connectionBadgeLive,
              ]}
            >
              <View
                style={[
                  styles.connectionDot,
                  {
                    backgroundColor: snapshot.carPlayConnected
                      ? DRIVE_COLORS.success
                      : DRIVE_COLORS.goldPrimary,
                  },
                ]}
              />
              <Text style={styles.connectionBadgeText}>
                {snapshot.carPlayConnected ? gt("Live CarPlay") : gt("Simulated 16:9")}
              </Text>
            </View>
          </View>

          <View testID="carplay-head-unit" style={styles.carPlayBezel}>
            <View style={styles.carPlayScreen}>
              {/* Left CarPlay Status Sidebar */}
              <View style={styles.carPlaySidebar}>
                <Text style={styles.carPlayClock}>{formatClock()}</Text>
                <View style={styles.carPlaySignalRow}>
                  <SymbolView name="wifi" size={11} tintColor={DRIVE_COLORS.textPrimary} />
                  <Text style={styles.carPlaySignalText}>5G</Text>
                </View>

                <View style={styles.carPlayAppIcon}>
                  <View style={styles.carPlayAppRing} />
                </View>

                <View style={styles.carPlayHomeDots}>
                  <View style={styles.homeDot} />
                  <View style={styles.homeDot} />
                  <View style={styles.homeDot} />
                </View>
              </View>

              {/* Main CarPlay Template Area */}
              <View style={styles.carPlayMain}>
                {/* CarPlay Tab Bar */}
                <View style={styles.carPlayTabBar}>
                  {SIMULATOR_TABS.map((tab) => {
                    const selected = simTab === tab.id;
                    const tabLabel = m(tab.label);
                    return (
                      <Pressable
                        key={tab.id}
                        accessibilityRole="tab"
                        accessibilityLabel={gt("CarPlay {tab} tab", { tab: tabLabel })}
                        accessibilityState={{ selected }}
                        onPress={() => {
                          triggerHaptic();
                          setSimTab(tab.id);
                        }}
                        style={[styles.carPlayTab, selected && styles.carPlayTabActive]}
                      >
                        <Text
                          style={[styles.carPlayTabText, selected && styles.carPlayTabTextActive]}
                        >
                          {tabLabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Tab Content */}
                {simTab === "talk" ? (
                  <View testID="carplay-tab-talk" style={styles.carPlayTalkBody}>
                    <View style={styles.carPlayNowPlayingRow}>
                      <View
                        style={[
                          styles.carPlayMiniOrb,
                          { borderColor: visual.ringPrimary, backgroundColor: visual.haloColor },
                        ]}
                      >
                        <View
                          style={[styles.carPlayMiniOrbInner, { borderColor: visual.ringPrimary }]}
                        />
                      </View>
                      <View style={styles.carPlayNowPlayingInfo}>
                        <Text numberOfLines={1} style={styles.carPlayStateTitle}>
                          {m(visual.label)}
                        </Text>
                        <Text numberOfLines={1} style={styles.carPlayMetaLine}>
                          {`${snapshot.activeVoice.displayName} · ${snapshot.activePersona.shortName}`}
                        </Text>
                        {carPlayCaption ? (
                          <Text numberOfLines={1} style={styles.carPlayCaptionLine}>
                            {carPlayCaption}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.carPlayControlsRow}>
                      {snapshot.isActive ? (
                        <>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={gt("CarPlay mute toggle")}
                            onPress={() => {
                              triggerHaptic();
                              void onToggleMute();
                            }}
                            style={[
                              styles.carPlayActionBtn,
                              snapshot.isMuted && styles.carPlayActionBtnHighlight,
                            ]}
                          >
                            <Text style={styles.carPlayActionLabel}>
                              {snapshot.isMuted ? gt("Unmute") : gt("Mute")}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={gt("CarPlay interrupt")}
                            onPress={() => {
                              triggerHaptic();
                              void onInterrupt();
                            }}
                            style={styles.carPlayActionBtn}
                          >
                            <Text style={styles.carPlayActionLabel}>
                              <T>Interrupt</T>
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={gt("CarPlay end call")}
                            onPress={() => {
                              triggerHaptic();
                              void onEndSession();
                            }}
                            style={[styles.carPlayActionBtn, styles.carPlayActionBtnDanger]}
                          >
                            <Text style={styles.carPlayActionLabel}>
                              <T>End</T>
                            </Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={gt("CarPlay start talking")}
                          onPress={() => {
                            triggerHaptic();
                            void onStartSession();
                          }}
                          style={[styles.carPlayActionBtn, styles.carPlayActionBtnPrimary]}
                        >
                          <Text style={styles.carPlayActionLabelPrimary}>
                            <T>Start talking</T>
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ) : null}

                {simTab === "voices" ? (
                  <ScrollView
                    testID="carplay-tab-voices"
                    nestedScrollEnabled
                    style={styles.carPlayListScroll}
                    contentContainerStyle={styles.carPlayListContent}
                  >
                    {carPlayVoices.map((voice) => {
                      const active = voice.id === snapshot.activeVoice.id;
                      const fav = favoriteSet.has(voice.id);
                      return (
                        <Pressable
                          key={voice.id}
                          accessibilityRole="button"
                          accessibilityLabel={gt("CarPlay select voice {name}", {
                            name: voice.displayName,
                          })}
                          onPress={() => {
                            triggerHaptic();
                            void onSelectVoice(voice.id);
                          }}
                          style={[styles.carPlayListRow, active && styles.carPlayListRowActive]}
                        >
                          <Text numberOfLines={1} style={styles.carPlayListPrimary}>
                            {fav ? `* ${voice.displayName}` : voice.displayName}
                          </Text>
                          <Text numberOfLines={1} style={styles.carPlayListSecondary}>
                            {m(providerLabelMessage(voice.provider))}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}

                {simTab === "modes" ? (
                  <ScrollView
                    testID="carplay-tab-modes"
                    nestedScrollEnabled
                    style={styles.carPlayListScroll}
                    contentContainerStyle={styles.carPlayListContent}
                  >
                    {personas.map((persona) => {
                      const active = persona.id === snapshot.activePersona.id;
                      return (
                        <Pressable
                          key={persona.id}
                          accessibilityRole="button"
                          accessibilityLabel={gt("CarPlay select mode {name}", {
                            name: persona.name,
                          })}
                          onPress={() => {
                            triggerHaptic();
                            void onSelectPersona(persona.id);
                          }}
                          style={[styles.carPlayListRow, active && styles.carPlayListRowActive]}
                        >
                          <Text numberOfLines={1} style={styles.carPlayListPrimary}>
                            {persona.name}
                          </Text>
                          <Text numberOfLines={1} style={styles.carPlayListSecondary}>
                            {persona.tagline}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}

                {simTab === "threads" ? (
                  <ScrollView
                    testID="carplay-tab-threads"
                    nestedScrollEnabled
                    style={styles.carPlayListScroll}
                    contentContainerStyle={styles.carPlayListContent}
                  >
                    {snapshot.threads.length === 0 ? (
                      <View style={styles.carPlayEmptyList}>
                        <Text style={styles.carPlayListSecondary}>
                          <T>No active One threads linked. Voice chat still works standalone.</T>
                        </Text>
                      </View>
                    ) : (
                      snapshot.threads.map((thread) => {
                        const active =
                          thread.threadId === snapshot.activeThreadId &&
                          thread.environmentId === snapshot.activeThreadEnvironmentId;
                        return (
                          <Pressable
                            key={`${thread.environmentId}:${thread.threadId}`}
                            accessibilityRole="button"
                            accessibilityLabel={gt("CarPlay focus thread {title}", {
                              title: thread.title,
                            })}
                            onPress={() => {
                              triggerHaptic();
                              void onSelectThread(
                                active
                                  ? null
                                  : {
                                      environmentId: thread.environmentId,
                                      threadId: thread.threadId,
                                    },
                              );
                            }}
                            style={[styles.carPlayListRow, active && styles.carPlayListRowActive]}
                          >
                            <Text numberOfLines={1} style={styles.carPlayListPrimary}>
                              {thread.title}
                            </Text>
                            <Text
                              style={[
                                styles.carPlayThreadStatus,
                                { color: threadStatusColor(thread.status) },
                              ]}
                            >
                              {m(THREAD_STATUS_LABELS[thread.status])}
                            </Text>
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                ) : null}
              </View>
            </View>
          </View>

          {/* Section 2: Voice & Persona Defaults */}
          <View style={styles.setupCard}>
            <Text style={styles.sectionTitle}>
              <T>Default voice and mode</T>
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Choose default voice in Voice studio")}
              onPress={() => {
                triggerHaptic();
                onOpenVoiceStudio?.();
              }}
              style={({ pressed }) => [styles.summaryRow, pressed && styles.pressed]}
            >
              <View style={styles.summaryRowLeft}>
                <Text style={styles.rowLabel}>
                  <T>Active voice</T>
                </Text>
                <Text style={styles.rowDescription}>
                  {`${snapshot.activeVoice.displayName} (${m(providerLabelMessage(snapshot.activeVoice.provider))})`}
                </Text>
              </View>
              <SymbolView name="chevron.right" size={16} tintColor={DRIVE_COLORS.textMuted} />
            </Pressable>

            <View style={styles.divider} />

            <Text style={styles.rowLabel}>
              <T>Default driving mode</T>
            </Text>
            <View style={styles.personaChipsWrap}>
              {personas.map((persona) => {
                const selected = persona.id === snapshot.settings.selectedPersonaId;
                return (
                  <Pressable
                    key={persona.id}
                    accessibilityRole="button"
                    accessibilityLabel={gt("Select default mode {name}", { name: persona.name })}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      triggerHaptic();
                      void onSelectPersona(persona.id);
                    }}
                    style={[styles.speedPill, selected && styles.speedPillSelected]}
                  >
                    <Text style={[styles.speedPillText, selected && styles.speedPillTextSelected]}>
                      {persona.shortName}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Section 3: Driving Controls & Toggles */}
          <View style={styles.setupCard}>
            <Text style={styles.sectionTitle}>
              <T>Hands-free behavior</T>
            </Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.rowLabel}>
                  <T>Hands-free barge-in</T>
                </Text>
                <Text style={styles.rowDescription}>
                  <T>Interrupt One mid-sentence just by speaking</T>
                </Text>
              </View>
              <ThemedSwitch
                accessibilityLabel={gt("Hands-free barge-in")}
                value={snapshot.settings.bargeInEnabled}
                onValueChange={(value) => {
                  triggerHaptic();
                  void onUpdateSettings({ bargeInEnabled: value });
                }}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.rowLabel}>
                  <T>Auto-start on CarPlay connect</T>
                </Text>
                <Text style={styles.rowDescription}>
                  <T>Begin listening automatically when plugged into CarPlay</T>
                </Text>
              </View>
              <ThemedSwitch
                accessibilityLabel={gt("Auto-start on CarPlay connect")}
                value={snapshot.settings.autoStartOnCarPlay}
                onValueChange={(value) => {
                  triggerHaptic();
                  void onUpdateSettings({ autoStartOnCarPlay: value });
                }}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.rowLabel}>
                  <T>Agent Bridge tools</T>
                </Text>
                <Text style={styles.rowDescription}>
                  <T>Allow voice agent to inspect and steer connected One threads</T>
                </Text>
              </View>
              <ThemedSwitch
                accessibilityLabel={gt("Agent Bridge tools")}
                value={snapshot.settings.agentBridgeEnabled}
                onValueChange={(value) => {
                  triggerHaptic();
                  void onUpdateSettings({ agentBridgeEnabled: value });
                }}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.speedBlock}>
              <View style={styles.speedHeader}>
                <Text style={styles.rowLabel}>
                  <T>Spoken speed</T>
                </Text>
                <Text style={styles.speedValueLabel}>
                  {`${snapshot.settings.spokenSpeed.toFixed(2).replace(/\.00$/, ".0")}x`}
                </Text>
              </View>
              <View style={styles.speedRow}>
                {SPOKEN_SPEED_OPTIONS.map((opt) => {
                  const selected = Math.abs(snapshot.settings.spokenSpeed - opt.value) < 0.03;
                  return (
                    <Pressable
                      key={opt.label}
                      accessibilityRole="button"
                      accessibilityLabel={gt("Spoken speed {speed}", { speed: opt.label })}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        triggerHaptic();
                        void onUpdateSettings({ spokenSpeed: opt.value });
                      }}
                      style={[styles.speedPill, selected && styles.speedPillSelected]}
                    >
                      <Text
                        style={[styles.speedPillText, selected && styles.speedPillTextSelected]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Section 4: Secure Provider API Keys */}
          <View style={styles.setupCard}>
            <Text style={styles.sectionTitle}>
              <T>Realtime voice API keys</T>
            </Text>
            <Text style={styles.keySecurityNote}>
              <T>
                Keys are stored encrypted in Secure Store on this device and never logged. On-Device
                voices need no key and never send your voice to a cloud provider; they hear you only
                where this phone has speech recognition.
              </T>
            </Text>

            {API_KEY_PROVIDERS.map((provider, index) => {
              const configured = snapshot.apiKeysConfigured[provider.id];
              const draft = keyDrafts[provider.id];
              const revealed = revealedKeys[provider.id];
              const providerName = m(provider.label);

              return (
                <View key={provider.id} style={index > 0 ? styles.keyBlockSpaced : styles.keyBlock}>
                  <View style={styles.keyHeaderRow}>
                    <Text style={styles.rowLabel}>{providerName}</Text>
                    <View
                      style={[
                        styles.statusChip,
                        configured ? styles.statusChipConfigured : styles.statusChipMissing,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusChipText,
                          configured
                            ? styles.statusChipTextConfigured
                            : styles.statusChipTextMissing,
                        ]}
                      >
                        {configured ? gt("Configured") : gt("Not set")}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.rowDescription}>{m(provider.hint)}</Text>

                  <View style={styles.keyInputRow}>
                    <TextInput
                      accessibilityLabel={providerName}
                      placeholder={
                        configured ? gt("Enter new key to replace") : provider.placeholder
                      }
                      placeholderTextColor={DRIVE_COLORS.textMuted}
                      value={draft}
                      onChangeText={(value) => {
                        setKeyDrafts((prev) => ({ ...prev, [provider.id]: value }));
                        if (savedNotice === provider.id) setSavedNotice(null);
                      }}
                      secureTextEntry={!revealed}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="none"
                      style={styles.keyInput}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        revealed
                          ? gt("Hide {provider}", { provider: providerName })
                          : gt("Reveal {provider}", { provider: providerName })
                      }
                      onPress={() =>
                        setRevealedKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                      }
                      style={styles.keyIconBtn}
                    >
                      <SymbolView
                        name={revealed ? "eye.slash" : "eye"}
                        size={18}
                        tintColor={DRIVE_COLORS.textSecondary}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.keyActionsRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={gt("Save {provider}", { provider: providerName })}
                      disabled={draft.trim().length === 0}
                      onPress={() => void handleSaveKey(provider.id)}
                      style={({ pressed }) => [
                        styles.saveKeyBtn,
                        draft.trim().length === 0 && styles.saveKeyBtnIdle,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.saveKeyBtnText,
                          draft.trim().length === 0 && styles.saveKeyBtnTextIdle,
                        ]}
                      >
                        {savedNotice === provider.id ? gt("Saved") : gt("Save key")}
                      </Text>
                    </Pressable>

                    {configured ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={gt("Clear {provider}", { provider: providerName })}
                        onPress={() => void handleClearKey(provider.id)}
                        style={({ pressed }) => [styles.clearKeyBtn, pressed && styles.pressed]}
                      >
                        <Text style={styles.clearKeyBtnText}>
                          <T>Clear</T>
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DRIVE_COLORS.obsidian,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: DRIVE_COLORS.borderSubtle,
  },
  headerText: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: DRIVE_COLORS.textSecondary,
  },
  closeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 18,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  connectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
  },
  connectionBadgeLive: {
    backgroundColor: DRIVE_COLORS.successSurface,
    borderColor: DRIVE_COLORS.successBorder,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  carPlayBezel: {
    aspectRatio: 16 / 9,
    width: "100%",
    borderRadius: 22,
    padding: 6,
    backgroundColor: DRIVE_COLORS.carPlayBezel,
    borderWidth: 2,
    borderColor: DRIVE_COLORS.borderStrong,
  },
  carPlayScreen: {
    flex: 1,
    flexDirection: "row",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0A0906",
  },
  carPlaySidebar: {
    width: 52,
    backgroundColor: DRIVE_COLORS.carPlaySidebar,
    borderRightWidth: 1,
    borderRightColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  carPlayClock: {
    fontSize: 11,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  carPlaySignalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  carPlaySignalText: {
    fontSize: 9,
    fontWeight: "700",
    color: DRIVE_COLORS.textSecondary,
  },
  carPlayAppIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#14120D",
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderGold,
    alignItems: "center",
    justifyContent: "center",
  },
  carPlayAppRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: DRIVE_COLORS.goldBright,
  },
  carPlayHomeDots: {
    flexDirection: "row",
    gap: 3,
  },
  homeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: DRIVE_COLORS.textSecondary,
  },
  carPlayMain: {
    flex: 1,
    padding: 10,
    gap: 8,
  },
  carPlayTabBar: {
    flexDirection: "row",
    gap: 6,
  },
  carPlayTab: {
    flex: 1,
    minHeight: 30,
    borderRadius: 8,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    alignItems: "center",
    justifyContent: "center",
  },
  carPlayTabActive: {
    backgroundColor: DRIVE_COLORS.goldPrimary,
  },
  carPlayTabText: {
    fontSize: 11,
    fontWeight: "700",
    color: DRIVE_COLORS.textSecondary,
  },
  carPlayTabTextActive: {
    color: DRIVE_COLORS.obsidian,
  },
  carPlayTalkBody: {
    flex: 1,
    justifyContent: "space-between",
    gap: 8,
  },
  carPlayNowPlayingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  carPlayMiniOrb: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  carPlayMiniOrbInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 4,
    backgroundColor: DRIVE_COLORS.obsidian,
  },
  carPlayNowPlayingInfo: {
    flex: 1,
    gap: 2,
  },
  carPlayStateTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  carPlayMetaLine: {
    fontSize: 12,
    fontWeight: "600",
    color: DRIVE_COLORS.goldBright,
  },
  carPlayCaptionLine: {
    fontSize: 11,
    color: DRIVE_COLORS.textSecondary,
  },
  carPlayControlsRow: {
    flexDirection: "row",
    gap: 6,
  },
  carPlayActionBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  carPlayActionBtnHighlight: {
    backgroundColor: DRIVE_COLORS.slateSurface,
    borderColor: DRIVE_COLORS.slateMuted,
  },
  carPlayActionBtnDanger: {
    backgroundColor: DRIVE_COLORS.dangerSurface,
    borderColor: DRIVE_COLORS.dangerBorder,
  },
  carPlayActionBtnPrimary: {
    backgroundColor: DRIVE_COLORS.goldPrimary,
    borderColor: DRIVE_COLORS.goldBright,
  },
  carPlayActionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  carPlayActionLabelPrimary: {
    fontSize: 12,
    fontWeight: "800",
    color: DRIVE_COLORS.obsidian,
  },
  carPlayListScroll: {
    flex: 1,
  },
  carPlayListContent: {
    gap: 5,
  },
  carPlayListRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
  },
  carPlayListRowActive: {
    borderColor: DRIVE_COLORS.goldPrimary,
    backgroundColor: DRIVE_COLORS.goldSurface,
  },
  carPlayListPrimary: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  carPlayListSecondary: {
    fontSize: 11,
    color: DRIVE_COLORS.textSecondary,
    maxWidth: "46%",
  },
  carPlayThreadStatus: {
    fontSize: 11,
    fontWeight: "700",
  },
  carPlayEmptyList: {
    paddingVertical: 18,
    alignItems: "center",
  },
  setupCard: {
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    padding: 16,
    gap: 12,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  summaryRowLeft: {
    flex: 1,
    gap: 2,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 48,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  rowDescription: {
    fontSize: 13,
    color: DRIVE_COLORS.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: DRIVE_COLORS.borderSubtle,
  },
  personaChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  speedBlock: {
    gap: 10,
  },
  speedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speedValueLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: DRIVE_COLORS.goldBright,
  },
  speedRow: {
    flexDirection: "row",
    gap: 8,
  },
  speedPill: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  speedPillSelected: {
    backgroundColor: DRIVE_COLORS.goldPrimary,
    borderColor: DRIVE_COLORS.goldBright,
  },
  speedPillText: {
    fontSize: 14,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  speedPillTextSelected: {
    color: DRIVE_COLORS.obsidian,
  },
  keySecurityNote: {
    fontSize: 13,
    lineHeight: 19,
    color: DRIVE_COLORS.textSecondary,
  },
  keyBlock: {
    gap: 8,
  },
  keyBlockSpaced: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: DRIVE_COLORS.borderSubtle,
  },
  keyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusChipConfigured: {
    backgroundColor: DRIVE_COLORS.successSurface,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.successBorder,
  },
  statusChipMissing: {
    backgroundColor: DRIVE_COLORS.slateSurface,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  statusChipTextConfigured: {
    color: "#86EFAC",
  },
  statusChipTextMissing: {
    color: DRIVE_COLORS.textSecondary,
  },
  keyInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  keyInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderStrong,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    paddingHorizontal: 14,
    fontSize: 15,
    color: DRIVE_COLORS.textPrimary,
  },
  keyIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  keyActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  saveKeyBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: DRIVE_COLORS.goldPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  saveKeyBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: DRIVE_COLORS.obsidian,
  },
  // Nothing to save yet: a quiet outline, so three idle keys do not read as three gold buttons.
  saveKeyBtnIdle: {
    backgroundColor: DRIVE_COLORS.obsidianCardHover,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderStrong,
  },
  saveKeyBtnTextIdle: {
    color: DRIVE_COLORS.textMuted,
  },
  clearKeyBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: DRIVE_COLORS.dangerSurface,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.dangerBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  clearKeyBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FCA5A5",
  },
  pressed: {
    opacity: 0.78,
  },
});
