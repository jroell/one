import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { DRIVING_PERSONAS, VOICE_CATALOG, useDriveController } from "../engine/index";
import { CarPlayPreviewPanel } from "./CarPlayPreviewPanel";
import {
  DASH_PRIMARY_CTA_HEIGHT,
  DASH_TOUCH_TARGET_MIN,
  DRIVE_COLORS,
  DRIVE_STATE_VISUALS,
} from "./driveTheme";
import {
  providerLabelMessage,
  type ApiKeyProviderId,
  type BridgeThreadRefView,
  type CarPlaySettingsView,
  type DriveSnapshotView,
  type DrivingPersonaView,
  type PersonaId,
  type VoiceProfileView,
} from "./driveUiTypes";
import { OneVoiceOrb } from "./OneVoiceOrb";
import { useAppIsActive, useProposalSendGuard } from "./proposalSendGuard";
import { VoiceStudioSheet } from "./VoiceStudioSheet";

const KEEP_AWAKE_TAG = "one-drive-mode";

const SPEAKER_ROLE_LABELS: Readonly<Record<"user" | "assistant" | "system" | "tool", string>> = {
  user: msg("You"),
  assistant: msg("One"),
  tool: msg("Agent Bridge"),
  system: msg("Status"),
};

export interface DriveStageViewProps {
  readonly snapshot: DriveSnapshotView;
  readonly voices: readonly VoiceProfileView[];
  readonly personas: readonly DrivingPersonaView[];
  readonly onClose: () => void;
  readonly onStartSession: () => void | Promise<unknown>;
  readonly onEndSession: () => void | Promise<unknown>;
  readonly onToggleMute: () => void | Promise<unknown>;
  readonly onInterrupt: () => void | Promise<unknown>;
  readonly onSelectVoice: (voiceId: string) => void | Promise<unknown>;
  readonly onSelectPersona: (personaId: PersonaId) => void | Promise<unknown>;
  readonly onSelectThread: (ref: BridgeThreadRefView | null) => void | Promise<unknown>;
  readonly onToggleFavoriteVoice: (voiceId: string) => void | Promise<unknown>;
  readonly onPreviewVoice: (voiceId: string) => void | Promise<unknown>;
  readonly onStopPreview: () => void | Promise<unknown>;
  readonly onUpdateSettings: (partial: Partial<CarPlaySettingsView>) => void | Promise<unknown>;
  readonly onSaveApiKey: (provider: ApiKeyProviderId, value: string) => void | Promise<unknown>;
  readonly onClearApiKey: (provider: ApiKeyProviderId) => void | Promise<unknown>;
  readonly onSendTextPrompt: (text: string) => void | Promise<unknown>;
  readonly onConfirmPendingAction: (proposalId: string) => void | Promise<unknown>;
  readonly onDismissPendingAction: (proposalId: string) => void | Promise<unknown>;
}

function hapticTap() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

function hapticHeavy() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
}

function hapticSelection() {
  void Haptics.selectionAsync().catch(() => undefined);
}

type PendingProposal = NonNullable<DriveSnapshotView["pendingConfirmation"]>;

/**
 * Keyed by proposal id by its parent, so a replacement proposal mounts a fresh card (and a fresh
 * guard) instead of reusing the Send button the driver was about to press. `covered` is true while
 * a sheet hides the stage; the guard counts only time the driver can see the card.
 */
function PendingConfirmationCard(props: {
  readonly proposal: PendingProposal;
  readonly covered: boolean;
  readonly onConfirm: (proposalId: string) => void | Promise<unknown>;
  readonly onDismiss: (proposalId: string) => void | Promise<unknown>;
}) {
  const { proposal } = props;
  const gt = useGT();
  const appIsActive = useAppIsActive();
  const armed = useProposalSendGuard(appIsActive && !props.covered);

  return (
    <View testID="pending-confirmation-card" style={styles.confirmCard}>
      <Text style={styles.confirmTitle}>
        <T>Send this message?</T>
      </Text>
      <Text style={styles.confirmSummary}>{proposal.summary}</Text>
      <View style={styles.confirmButtons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Send pending message")}
          accessibilityState={{ disabled: !armed }}
          disabled={!armed}
          onPress={() => {
            if (!armed) return;
            hapticHeavy();
            void props.onConfirm(proposal.id);
          }}
          style={({ pressed }) => [
            styles.confirmApproveBtn,
            !armed && styles.disabledBtn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.confirmApproveText}>
            <T>Send</T>
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Cancel pending message")}
          onPress={() => {
            hapticTap();
            void props.onDismiss(proposal.id);
          }}
          style={({ pressed }) => [styles.confirmDismissBtn, pressed && styles.pressed]}
        >
          <Text style={styles.confirmDismissText}>
            <T>Cancel</T>
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Hands-Free Driving Stage with glanceable dash-safe controls, live One Ring voice orb,
 * spoken caption ticker, expandable transcript drawer, Voice Studio, and CarPlay preview.
 */
export function DriveStageView({
  snapshot,
  voices,
  personas,
  onClose,
  onStartSession,
  onEndSession,
  onToggleMute,
  onInterrupt,
  onSelectVoice,
  onSelectPersona,
  onSelectThread,
  onToggleFavoriteVoice,
  onPreviewVoice,
  onStopPreview,
  onUpdateSettings,
  onSaveApiKey,
  onClearApiKey,
  onSendTextPrompt,
  onConfirmPendingAction,
  onDismissPendingAction,
}: DriveStageViewProps) {
  const gt = useGT();
  const m = useMessages();
  const insets = useSafeAreaInsets();
  const [voiceStudioOpen, setVoiceStudioOpen] = useState(false);
  const [carPlayPanelOpen, setCarPlayPanelOpen] = useState(false);
  const [personaDrawerOpen, setPersonaDrawerOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const stageCovered = voiceStudioOpen || carPlayPanelOpen || personaDrawerOpen || transcriptOpen;

  // Keep the display awake while a hands-free driving session is running.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- manages the native screen keep-awake lock tied to active driving sessions
  useEffect(() => {
    if (!snapshot.isActive) {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      return;
    }
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [snapshot.isActive]);

  const visual = DRIVE_STATE_VISUALS[snapshot.sessionState];
  const stateLabel = m(visual.label);
  const liveLevel =
    snapshot.sessionState === "speaking"
      ? snapshot.outputLevel
      : snapshot.sessionState === "listening" || snapshot.sessionState === "interrupted"
        ? snapshot.inputLevel
        : 0;

  // Idle needs no second line (the ring and the Start button say it), and the error banner
  // already explains a failure.
  const stateSublabel =
    snapshot.reconnectAttempt > 0
      ? gt("Reconnecting (attempt {attempt})", { attempt: snapshot.reconnectAttempt })
      : snapshot.sessionState === "idle" || snapshot.errorMessage
        ? null
        : m(visual.sublabel);

  // Only real speech is a caption. System lines ("Connecting...", "Session ended") repeat the
  // state readout or the error banner, so they never fill the card.
  const lastTurn = snapshot.transcript.at(-1);
  const caption =
    snapshot.activeCaption && snapshot.activeCaptionRole !== "system"
      ? { role: snapshot.activeCaptionRole, text: snapshot.activeCaption }
      : lastTurn
        ? { role: lastTurn.role, text: lastTurn.text }
        : null;

  const transportLabel = m(
    providerLabelMessage(snapshot.activeTransport ?? snapshot.activeVoice.provider),
  );

  const handleOrbPress = () => {
    hapticTap();
    if (!snapshot.isActive) {
      void onStartSession();
      return;
    }
    if (snapshot.sessionState === "speaking" || snapshot.sessionState === "thinking") {
      void onInterrupt();
      return;
    }
    void onToggleMute();
  };

  const handleSendDraft = () => {
    const trimmed = promptDraft.trim();
    if (!trimmed) return;
    hapticSelection();
    setPromptDraft("");
    void onSendTextPrompt(trimmed);
  };

  const handleExit = () => {
    hapticSelection();
    if (snapshot.previewingVoiceId) {
      void onStopPreview();
    }
    onClose();
  };

  return (
    <View
      testID="drive-stage-screen"
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 14),
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      {/* Drive is black in both themes, so the system bar keeps light icons in light mode too. */}
      <StatusBar barStyle="light-content" />
      {/* Top Status Bar */}
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            snapshot.carPlayConnected
              ? gt("CarPlay connected, open CarPlay preview and setup")
              : gt("Phone Drive mode, open CarPlay preview and setup")
          }
          onPress={() => {
            hapticSelection();
            setCarPlayPanelOpen(true);
          }}
          style={({ pressed }) => [
            styles.connectionPill,
            snapshot.carPlayConnected && styles.connectionPillCarPlay,
            pressed && styles.pressed,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: snapshot.carPlayConnected
                  ? DRIVE_COLORS.success
                  : DRIVE_COLORS.goldPrimary,
              },
            ]}
          />
          <SymbolView
            name="car"
            size={16}
            tintColor={snapshot.carPlayConnected ? "#86EFAC" : DRIVE_COLORS.goldBright}
          />
          <Text style={styles.connectionPillText}>
            {snapshot.carPlayConnected ? gt("CarPlay connected") : gt("Phone Drive mode")}
          </Text>
        </Pressable>

        <View style={styles.topRightActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Open CarPlay preview and setup")}
            onPress={() => {
              hapticSelection();
              setCarPlayPanelOpen(true);
            }}
            style={({ pressed }) => [styles.iconCircleBtn, pressed && styles.pressed]}
          >
            <SymbolView name="slider.horizontal.3" size={20} tintColor={DRIVE_COLORS.textPrimary} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Exit Drive mode")}
            onPress={handleExit}
            style={({ pressed }) => [styles.iconCircleBtn, pressed && styles.pressed]}
          >
            <SymbolView name="xmark" size={20} tintColor={DRIVE_COLORS.textPrimary} />
          </Pressable>
        </View>
      </View>

      {/* Active Persona & Active Voice Pills */}
      <View style={styles.pillStrip}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Active mode {name}, tap to switch", {
            name: snapshot.activePersona.name,
          })}
          onPress={() => {
            hapticSelection();
            setPersonaDrawerOpen(true);
          }}
          style={({ pressed }) => [styles.contextPill, pressed && styles.pressed]}
        >
          <View
            style={[
              styles.pillAccentDot,
              { backgroundColor: snapshot.activePersona.accentColor || DRIVE_COLORS.goldPrimary },
            ]}
          />
          <Text numberOfLines={1} style={styles.contextPillText}>
            {snapshot.activePersona.shortName}
          </Text>
          <SymbolView name="chevron.down" size={12} tintColor={DRIVE_COLORS.textMuted} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Active voice {name}, tap to open Voice studio", {
            name: snapshot.activeVoice.displayName,
          })}
          onPress={() => {
            hapticSelection();
            setVoiceStudioOpen(true);
          }}
          style={({ pressed }) => [styles.contextPill, styles.voicePill, pressed && styles.pressed]}
        >
          <SymbolView name="headphones" size={14} tintColor={DRIVE_COLORS.goldBright} />
          <Text numberOfLines={1} style={styles.voicePillText}>
            {snapshot.activeVoice.displayName}
          </Text>
          <Text numberOfLines={1} style={styles.voiceProviderMini}>
            {transportLabel}
          </Text>
        </Pressable>
      </View>

      {snapshot.activeThreadTitle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Linked thread {title}", { title: snapshot.activeThreadTitle })}
          onPress={() => {
            hapticSelection();
            setCarPlayPanelOpen(true);
          }}
          style={styles.threadBanner}
        >
          <SymbolView name="terminal" size={14} tintColor={DRIVE_COLORS.goldPrimary} />
          <Text numberOfLines={1} style={styles.threadBannerText}>
            {gt("Thread: {title}", { title: snapshot.activeThreadTitle })}
          </Text>
        </Pressable>
      ) : null}

      {/* Center Hero: Animated One Ring Voice Orb + State + Caption Ticker */}
      <View style={styles.heroArea}>
        <OneVoiceOrb
          state={snapshot.sessionState}
          level={liveLevel}
          accentColor={snapshot.activeVoice.accentColor}
          onPress={handleOrbPress}
          accessibilityLabel={gt("One voice orb, {state}", { state: stateLabel })}
          accessibilityHint={
            snapshot.isActive
              ? gt("Tap to interrupt speaking or toggle mute")
              : gt("Tap to start hands-free voice chat")
          }
        />

        <View style={styles.stateReadout}>
          <View
            style={[
              styles.statePill,
              { backgroundColor: visual.badgeBg, borderColor: visual.badgeBorder },
            ]}
          >
            <Text style={[styles.stateTitle, { color: visual.badgeText }]}>{stateLabel}</Text>
          </View>
          {stateSublabel ? <Text style={styles.stateSublabel}>{stateSublabel}</Text> : null}
        </View>

        {/* Proposed follow-up message: sends only when this exact card is tapped. */}
        {snapshot.pendingConfirmation ? (
          <PendingConfirmationCard
            key={snapshot.pendingConfirmation.id}
            proposal={snapshot.pendingConfirmation}
            covered={stageCovered}
            onConfirm={onConfirmPendingAction}
            onDismiss={onDismissPendingAction}
          />
        ) : null}

        {/* Recoverable Error Banner */}
        {snapshot.errorMessage ? (
          <View testID="drive-error-banner" style={styles.errorBanner}>
            <Text numberOfLines={2} style={styles.errorText}>
              {snapshot.errorMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Retry hands-free voice session")}
              onPress={() => {
                hapticTap();
                void onStartSession();
              }}
              style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.retryBtnText}>
                <T>Retry</T>
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Live 2-Line Spoken Caption Ticker */}
        {caption ? (
          <Pressable
            testID="caption-ticker"
            accessibilityRole="button"
            accessibilityLabel={gt("Live spoken caption, tap to open full transcript")}
            onPress={() => {
              hapticSelection();
              setTranscriptOpen(true);
            }}
            style={({ pressed }) => [styles.captionCard, pressed && styles.pressed]}
          >
            <View style={styles.captionHeader}>
              <Text style={styles.captionRole}>{m(SPEAKER_ROLE_LABELS[caption.role])}</Text>
              <Text style={styles.captionExpandHint}>
                {gt("Transcript ({count})", { count: snapshot.transcript.length })}
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.captionText}>
              {caption.text}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Bottom Thumb-Zone Control Dock */}
      <View testID="drive-control-dock" style={styles.dockArea}>
        {snapshot.isActive ? (
          <View style={styles.activeDockGrid}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                snapshot.isMuted ? gt("Unmute microphone") : gt("Mute microphone")
              }
              accessibilityState={{ selected: snapshot.isMuted }}
              onPress={() => {
                hapticTap();
                void onToggleMute();
              }}
              style={({ pressed }) => [
                styles.dockTile,
                snapshot.isMuted && styles.dockTileMuted,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={snapshot.isMuted ? "slash.circle" : "mic"}
                size={26}
                tintColor={snapshot.isMuted ? DRIVE_COLORS.textPrimary : DRIVE_COLORS.goldBright}
              />
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.dockTileLabel}>
                {snapshot.isMuted ? gt("Unmute") : gt("Mute")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Interrupt response")}
              onPress={() => {
                hapticHeavy();
                void onInterrupt();
              }}
              style={({ pressed }) => [
                styles.dockTile,
                snapshot.sessionState === "speaking" && styles.dockTileHighlight,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name="bolt.circle"
                size={26}
                tintColor={
                  snapshot.sessionState === "speaking"
                    ? DRIVE_COLORS.obsidian
                    : DRIVE_COLORS.goldPrimary
                }
              />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  styles.dockTileLabel,
                  snapshot.sessionState === "speaking" && styles.dockTileLabelDark,
                ]}
              >
                <T>Interrupt</T>
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Switch voice")}
              onPress={() => {
                hapticSelection();
                setVoiceStudioOpen(true);
              }}
              style={({ pressed }) => [styles.dockTile, pressed && styles.pressed]}
            >
              <SymbolView name="headphones" size={26} tintColor={DRIVE_COLORS.textPrimary} />
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.dockTileLabel}>
                <T>Voice</T>
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("End call")}
              onPress={() => {
                hapticHeavy();
                void onEndSession();
              }}
              style={({ pressed }) => [
                styles.dockTile,
                styles.dockTileDanger,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView name="stop.fill" size={24} tintColor="#FFFFFF" />
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.dockTileLabel}>
                <T>End call</T>
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.idleDockWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Start hands-free chat")}
              onPress={() => {
                hapticHeavy();
                void onStartSession();
              }}
              style={({ pressed }) => [styles.startCta, pressed && styles.pressed]}
            >
              <SymbolView name="mic" size={26} tintColor={DRIVE_COLORS.obsidian} />
              <Text style={styles.startCtaText}>
                <T>Start hands-free chat</T>
              </Text>
            </Pressable>

            <View style={styles.idleSecondaryRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Open Voice studio")}
                onPress={() => {
                  hapticSelection();
                  setVoiceStudioOpen(true);
                }}
                style={({ pressed }) => [styles.idleSecondaryBtn, pressed && styles.pressed]}
              >
                <SymbolView name="headphones" size={20} tintColor={DRIVE_COLORS.goldBright} />
                <Text style={styles.idleSecondaryLabel}>
                  <T>Voices</T>
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Choose driving mode")}
                onPress={() => {
                  hapticSelection();
                  setPersonaDrawerOpen(true);
                }}
                style={({ pressed }) => [styles.idleSecondaryBtn, pressed && styles.pressed]}
              >
                <SymbolView name="brain" size={20} tintColor={DRIVE_COLORS.goldBright} />
                <Text style={styles.idleSecondaryLabel}>
                  <T>Modes</T>
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Open CarPlay preview and setup")}
                onPress={() => {
                  hapticSelection();
                  setCarPlayPanelOpen(true);
                }}
                style={({ pressed }) => [styles.idleSecondaryBtn, pressed && styles.pressed]}
              >
                <SymbolView name="car" size={20} tintColor={DRIVE_COLORS.goldBright} />
                <Text style={styles.idleSecondaryLabel}>
                  <T>CarPlay</T>
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Voice Gallery & Audition Studio Sheet */}
      <VoiceStudioSheet
        visible={voiceStudioOpen}
        onClose={() => setVoiceStudioOpen(false)}
        voices={voices}
        activeVoiceId={snapshot.activeVoice.id}
        favoriteVoiceIds={snapshot.settings.favoriteVoiceIds}
        previewingVoiceId={snapshot.previewingVoiceId}
        apiKeysConfigured={snapshot.apiKeysConfigured}
        sessionActive={snapshot.isActive}
        onSelectVoice={onSelectVoice}
        onToggleFavorite={onToggleFavoriteVoice}
        onPreviewVoice={onPreviewVoice}
        onStopPreview={onStopPreview}
        onOpenSetup={() => {
          setVoiceStudioOpen(false);
          setCarPlayPanelOpen(true);
        }}
      />

      {/* Interactive CarPlay Head-Unit Simulator & Setup Drawer */}
      <CarPlayPreviewPanel
        visible={carPlayPanelOpen}
        onClose={() => setCarPlayPanelOpen(false)}
        snapshot={snapshot}
        voices={voices}
        personas={personas}
        onStartSession={onStartSession}
        onEndSession={onEndSession}
        onToggleMute={onToggleMute}
        onInterrupt={onInterrupt}
        onSelectVoice={onSelectVoice}
        onSelectPersona={onSelectPersona}
        onSelectThread={onSelectThread}
        onUpdateSettings={onUpdateSettings}
        onSaveApiKey={onSaveApiKey}
        onClearApiKey={onClearApiKey}
        onOpenVoiceStudio={() => {
          setCarPlayPanelOpen(false);
          setVoiceStudioOpen(true);
        }}
      />

      {/* Driving Persona Picker Modal */}
      <Modal
        visible={personaDrawerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPersonaDrawerOpen(false)}
      >
        <View
          testID="persona-picker-sheet"
          style={[
            styles.modalRoot,
            {
              paddingTop: Math.max(insets.top, 18),
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              <T>Driving modes</T>
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Close driving modes")}
              onPress={() => setPersonaDrawerOpen(false)}
              style={styles.iconCircleBtn}
            >
              <SymbolView name="xmark" size={20} tintColor={DRIVE_COLORS.textPrimary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            {personas.map((persona) => {
              const selected = persona.id === snapshot.activePersona.id;
              return (
                <Pressable
                  key={persona.id}
                  accessibilityRole="button"
                  accessibilityLabel={gt("Select mode {name}", { name: persona.name })}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    hapticTap();
                    void onSelectPersona(persona.id);
                    setPersonaDrawerOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.personaCard,
                    selected && styles.personaCardActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.personaCardTop}>
                    <View
                      style={[
                        styles.pillAccentDot,
                        { backgroundColor: persona.accentColor || DRIVE_COLORS.goldPrimary },
                      ]}
                    />
                    <Text style={styles.personaCardName}>{persona.name}</Text>
                    {selected ? (
                      <SymbolView
                        name="checkmark.circle.fill"
                        size={20}
                        tintColor={DRIVE_COLORS.goldBright}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.personaCardTagline}>{persona.tagline}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Expandable Transcript Drawer */}
      <Modal
        visible={transcriptOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTranscriptOpen(false)}
      >
        <View
          testID="transcript-drawer"
          style={[
            styles.modalRoot,
            {
              paddingTop: Math.max(insets.top, 18),
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              <T>Live transcript</T>
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Close transcript")}
              onPress={() => setTranscriptOpen(false)}
              style={styles.iconCircleBtn}
            >
              <SymbolView name="xmark" size={20} tintColor={DRIVE_COLORS.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.transcriptScroll}
            contentContainerStyle={styles.modalScrollContent}
          >
            {snapshot.transcript.length === 0 ? (
              <View style={styles.emptyTranscript}>
                <Text style={styles.emptyTranscriptText}>
                  <T>No spoken turns yet. Start hands-free chat or send a quick message below.</T>
                </Text>
              </View>
            ) : (
              snapshot.transcript.map((entry) => (
                <View
                  key={entry.id}
                  style={[
                    styles.transcriptItem,
                    entry.role === "user" && styles.transcriptItemUser,
                  ]}
                >
                  <Text style={styles.transcriptRoleLabel}>
                    {m(SPEAKER_ROLE_LABELS[entry.role])}
                  </Text>
                  <Text style={styles.transcriptBody}>{entry.text}</Text>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.transcriptInputRow}>
            <TextInput
              accessibilityLabel={gt("Send a text turn to voice session")}
              placeholder={gt("Type a turn to test voice response...")}
              placeholderTextColor={DRIVE_COLORS.textMuted}
              value={promptDraft}
              onChangeText={setPromptDraft}
              onSubmitEditing={handleSendDraft}
              returnKeyType="send"
              style={styles.transcriptInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Send text turn")}
              disabled={promptDraft.trim().length === 0}
              onPress={handleSendDraft}
              style={({ pressed }) => [
                styles.transcriptSendBtn,
                promptDraft.trim().length === 0 && styles.disabledBtn,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView name="arrow.up" size={20} tintColor={DRIVE_COLORS.obsidian} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DriveStageScreen(props: { readonly onClose: () => void }) {
  const controller = useDriveController();
  return (
    <DriveStageView
      snapshot={controller.snapshot}
      voices={VOICE_CATALOG}
      personas={DRIVING_PERSONAS}
      onClose={props.onClose}
      onStartSession={controller.startSession}
      onEndSession={controller.endSession}
      onToggleMute={controller.toggleMute}
      onInterrupt={controller.interrupt}
      onSelectVoice={controller.selectVoice}
      onSelectPersona={controller.selectPersona}
      onSelectThread={controller.selectThread}
      onToggleFavoriteVoice={controller.toggleFavoriteVoice}
      onPreviewVoice={controller.previewVoice}
      onStopPreview={controller.stopPreview}
      onUpdateSettings={controller.updateSettings}
      onSaveApiKey={controller.saveApiKey}
      onClearApiKey={controller.clearApiKey}
      onSendTextPrompt={controller.sendTextPrompt}
      onConfirmPendingAction={controller.confirmPendingAction}
      onDismissPendingAction={controller.dismissPendingAction}
    />
  );
}

export function DriveModeRouteScreen() {
  const navigation = useNavigation();
  return <DriveStageScreen onClose={() => navigation.goBack()} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DRIVE_COLORS.obsidian,
    paddingHorizontal: 20,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  connectionPill: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  connectionPillCarPlay: {
    backgroundColor: DRIVE_COLORS.successSurface,
    borderColor: DRIVE_COLORS.successBorder,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  connectionPillText: {
    fontSize: 14,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  topRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  pillStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  contextPill: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  voicePill: {
    flex: 1,
    borderColor: DRIVE_COLORS.borderGold,
    backgroundColor: "#17140E",
  },
  pillAccentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  contextPillText: {
    fontSize: 15,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  voicePillText: {
    fontSize: 15,
    fontWeight: "800",
    color: DRIVE_COLORS.goldBright,
  },
  voiceProviderMini: {
    fontSize: 12,
    fontWeight: "600",
    color: DRIVE_COLORS.textSecondary,
    flexShrink: 1,
  },
  threadBanner: {
    marginTop: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  threadBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: DRIVE_COLORS.textSecondary,
  },
  heroArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 8,
  },
  stateReadout: {
    alignItems: "center",
    gap: 6,
  },
  statePill: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  stateTitle: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  stateSublabel: {
    fontSize: 15,
    color: DRIVE_COLORS.textSecondary,
    textAlign: "center",
  },
  confirmCard: {
    width: "100%",
    backgroundColor: DRIVE_COLORS.amberSurface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.amberOrbit,
    padding: 14,
    gap: 10,
  },
  confirmTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DRIVE_COLORS.goldBright,
  },
  confirmSummary: {
    fontSize: 15,
    lineHeight: 21,
    color: DRIVE_COLORS.textPrimary,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 10,
  },
  confirmApproveBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: DRIVE_COLORS.goldPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmApproveText: {
    fontSize: 16,
    fontWeight: "800",
    color: DRIVE_COLORS.obsidian,
  },
  confirmDismissBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDismissText: {
    fontSize: 16,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  errorBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: DRIVE_COLORS.dangerSurface,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.dangerBorder,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: "#FECACA",
  },
  retryBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: DRIVE_COLORS.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  captionCard: {
    width: "100%",
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 6,
  },
  captionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  captionRole: {
    fontSize: 13,
    fontWeight: "700",
    color: DRIVE_COLORS.goldPrimary,
  },
  captionExpandHint: {
    fontSize: 12,
    fontWeight: "600",
    color: DRIVE_COLORS.textMuted,
  },
  captionText: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "600",
    color: DRIVE_COLORS.textPrimary,
  },
  dockArea: {
    paddingTop: 10,
  },
  activeDockGrid: {
    flexDirection: "row",
    gap: 10,
  },
  dockTile: {
    flex: 1,
    minHeight: Math.max(DASH_TOUCH_TARGET_MIN, 76),
    borderRadius: 22,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  dockTileMuted: {
    backgroundColor: DRIVE_COLORS.slateSurface,
    borderColor: DRIVE_COLORS.slateMuted,
  },
  dockTileHighlight: {
    backgroundColor: DRIVE_COLORS.goldPrimary,
    borderColor: DRIVE_COLORS.goldBright,
  },
  dockTileDanger: {
    backgroundColor: DRIVE_COLORS.danger,
    borderColor: "#F87171",
  },
  dockTileLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  dockTileLabelDark: {
    color: DRIVE_COLORS.obsidian,
  },
  idleDockWrap: {
    gap: 12,
  },
  startCta: {
    minHeight: DASH_PRIMARY_CTA_HEIGHT,
    borderRadius: 24,
    backgroundColor: DRIVE_COLORS.goldPrimary,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.goldBright,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  startCtaText: {
    fontSize: 20,
    fontWeight: "800",
    color: DRIVE_COLORS.obsidian,
  },
  idleSecondaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  idleSecondaryBtn: {
    flex: 1,
    minHeight: DASH_TOUCH_TARGET_MIN,
    borderRadius: 18,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  idleSecondaryLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: DRIVE_COLORS.obsidian,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: DRIVE_COLORS.borderSubtle,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  modalScrollContent: {
    padding: 20,
    gap: 12,
  },
  personaCard: {
    minHeight: 72,
    padding: 16,
    borderRadius: 18,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    gap: 6,
  },
  personaCardActive: {
    borderColor: DRIVE_COLORS.goldPrimary,
    backgroundColor: "#191712",
  },
  personaCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  personaCardName: {
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  personaCardTagline: {
    fontSize: 14,
    color: DRIVE_COLORS.textSecondary,
  },
  transcriptScroll: {
    flex: 1,
  },
  emptyTranscript: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyTranscriptText: {
    fontSize: 15,
    color: DRIVE_COLORS.textSecondary,
    textAlign: "center",
  },
  transcriptItem: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    gap: 4,
  },
  transcriptItemUser: {
    backgroundColor: "#17140E",
    borderColor: DRIVE_COLORS.borderGold,
  },
  transcriptRoleLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: DRIVE_COLORS.goldPrimary,
  },
  transcriptBody: {
    fontSize: 16,
    lineHeight: 22,
    color: DRIVE_COLORS.textPrimary,
  },
  transcriptInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: DRIVE_COLORS.borderSubtle,
  },
  transcriptInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderStrong,
    paddingHorizontal: 14,
    fontSize: 15,
    color: DRIVE_COLORS.textPrimary,
  },
  transcriptSendBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: DRIVE_COLORS.goldPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledBtn: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.78,
  },
});
