import * as Haptics from "expo-haptics";
import { T, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { DRIVE_COLORS } from "./driveTheme";
import {
  PROVIDER_FILTER_OPTIONS,
  VIBE_FILTER_OPTIONS,
  isProviderKeyReady,
  providerLabelMessage,
  vibeLabelMessage,
  type ApiKeysConfiguredView,
  type VoiceProfileView,
  type VoiceProviderId,
  type VoiceVibeId,
} from "./driveUiTypes";

export interface VoiceStudioSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly voices: readonly VoiceProfileView[];
  readonly activeVoiceId: string;
  readonly favoriteVoiceIds: readonly string[];
  readonly previewingVoiceId: string | null;
  readonly apiKeysConfigured: ApiKeysConfiguredView;
  readonly sessionActive: boolean;
  readonly onSelectVoice: (voiceId: string) => void | Promise<unknown>;
  readonly onToggleFavorite: (voiceId: string) => void | Promise<unknown>;
  readonly onPreviewVoice: (voiceId: string) => void | Promise<unknown>;
  readonly onStopPreview: () => void | Promise<unknown>;
  readonly onOpenSetup?: () => void;
}

function triggerSelectionHaptic() {
  void Haptics.selectionAsync().catch(() => undefined);
}

function triggerMediumHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

/**
 * Voice Gallery and Audition Studio for browsing, filtering, starring,
 * auditioning, and switching voices live mid-conversation.
 */
export function VoiceStudioSheet({
  visible,
  onClose,
  voices,
  activeVoiceId,
  favoriteVoiceIds,
  previewingVoiceId,
  apiKeysConfigured,
  sessionActive,
  onSelectVoice,
  onToggleFavorite,
  onPreviewVoice,
  onStopPreview,
  onOpenSetup,
}: VoiceStudioSheetProps) {
  const gt = useGT();
  const m = useMessages();
  const insets = useSafeAreaInsets();
  const [selectedProvider, setSelectedProvider] = useState<"all" | VoiceProviderId>("all");
  const [selectedVibe, setSelectedVibe] = useState<"all" | VoiceVibeId>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const favoriteSet = new Set(favoriteVoiceIds);

  const filteredVoices = voices
    .filter((voice) => {
      if (selectedProvider !== "all" && voice.provider !== selectedProvider) return false;
      if (selectedVibe !== "all" && voice.vibe !== selectedVibe) return false;
      if (favoritesOnly && !favoriteSet.has(voice.id)) return false;
      return true;
    })
    .sort((a, b) => {
      const aFav = favoriteSet.has(a.id) ? 1 : 0;
      const bFav = favoriteSet.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      if (a.id === activeVoiceId) return -1;
      if (b.id === activeVoiceId) return 1;
      return 0;
    });

  const handleClose = () => {
    if (previewingVoiceId) {
      void onStopPreview();
    }
    onClose();
  };

  const resetFilters = () => {
    triggerSelectionHaptic();
    setSelectedProvider("all");
    setSelectedVibe("all");
    setFavoritesOnly(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View
        testID="voice-studio-sheet"
        style={[
          styles.sheetRoot,
          {
            paddingTop: Math.max(insets.top, 18),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>
              <T>Voice studio</T>
            </Text>
            <Text style={styles.headerSubtitle}>
              {sessionActive
                ? gt("{shown} of {total} voices · Switches live mid-call", {
                    shown: filteredVoices.length,
                    total: voices.length,
                  })
                : gt("{shown} of {total} voices · Star voices to pin on CarPlay", {
                    shown: filteredVoices.length,
                    total: voices.length,
                  })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Close Voice studio")}
            onPress={handleClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.buttonPressed]}
          >
            <SymbolView name="xmark" size={20} tintColor={DRIVE_COLORS.textPrimary} />
          </Pressable>
        </View>

        {/* Provider filter pills */}
        <View style={styles.filterBlock}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {PROVIDER_FILTER_OPTIONS.map((option) => {
              const selected = selectedProvider === option.id;
              const optionLabel = m(option.label);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={gt("Filter provider {label}", { label: optionLabel })}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setSelectedProvider(option.id);
                  }}
                  style={({ pressed }) => [
                    styles.filterPill,
                    selected && styles.filterPillSelected,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text
                    style={[styles.filterPillLabel, selected && styles.filterPillLabelSelected]}
                  >
                    {optionLabel}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Filter pinned favorites")}
              accessibilityState={{ selected: favoritesOnly }}
              onPress={() => {
                triggerSelectionHaptic();
                setFavoritesOnly((current) => !current);
              }}
              style={({ pressed }) => [
                styles.filterPill,
                favoritesOnly && styles.filterPillSelected,
                pressed && styles.buttonPressed,
              ]}
            >
              <SymbolView
                name={favoritesOnly ? "star.fill" : "star"}
                size={14}
                tintColor={favoritesOnly ? DRIVE_COLORS.obsidian : DRIVE_COLORS.goldPrimary}
              />
              <Text
                style={[styles.filterPillLabel, favoritesOnly && styles.filterPillLabelSelected]}
              >
                {gt("Pinned ({count})", { count: favoriteVoiceIds.length })}
              </Text>
            </Pressable>
          </ScrollView>

          {/* Vibe filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {VIBE_FILTER_OPTIONS.map((option) => {
              const selected = selectedVibe === option.id;
              const optionLabel = m(option.label);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={gt("Filter vibe {label}", { label: optionLabel })}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setSelectedVibe(option.id);
                  }}
                  style={({ pressed }) => [
                    styles.vibePill,
                    selected && styles.vibePillSelected,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={[styles.vibePillLabel, selected && styles.vibePillLabelSelected]}>
                    {optionLabel}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Voice cards list */}
        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {filteredVoices.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                <T>No voices match these filters</T>
              </Text>
              <Text style={styles.emptyDetail}>
                {gt("Try switching provider or vibe filters to browse all {total} voices.", {
                  total: voices.length,
                })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Reset voice filters")}
                onPress={resetFilters}
                style={({ pressed }) => [styles.resetButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.resetButtonLabel}>
                  <T>Reset filters</T>
                </Text>
              </Pressable>
            </View>
          ) : (
            filteredVoices.map((voice) => {
              const isActive = voice.id === activeVoiceId;
              const isFavorite = favoriteSet.has(voice.id);
              const isPreviewing = previewingVoiceId === voice.id;
              const keyReady = isProviderKeyReady(voice.provider, apiKeysConfigured);
              const providerLabel = m(providerLabelMessage(voice.provider));
              const vibeLabel = m(vibeLabelMessage(voice.vibe));

              return (
                <View
                  key={voice.id}
                  testID={`voice-card-${voice.id}`}
                  style={[
                    styles.voiceCard,
                    isActive && styles.voiceCardActive,
                    isPreviewing && styles.voiceCardPreviewing,
                  ]}
                >
                  {/* Card top row: identity + favorite star */}
                  <View style={styles.cardTopRow}>
                    <View style={styles.cardIdentity}>
                      <View
                        style={[
                          styles.voiceAccentDot,
                          { backgroundColor: voice.accentColor || DRIVE_COLORS.goldPrimary },
                        ]}
                      />
                      <View style={styles.cardTitleGroup}>
                        <View style={styles.nameBadgeRow}>
                          <Text style={styles.voiceName}>{voice.displayName}</Text>
                          {isActive ? (
                            <View style={styles.activeChip}>
                              <Text style={styles.activeChipText}>
                                <T>Active</T>
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.metaChipRow}>
                          <View style={styles.providerBadge}>
                            <Text style={styles.providerBadgeText}>{providerLabel}</Text>
                          </View>
                          <View style={styles.vibeBadge}>
                            <Text style={styles.vibeBadgeText}>{vibeLabel}</Text>
                          </View>
                          {!keyReady ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={gt("Add API key for {provider}", {
                                provider: providerLabel,
                              })}
                              onPress={onOpenSetup}
                              style={styles.keyNeededBadge}
                            >
                              <Text style={styles.keyNeededText}>
                                <T>Key optional for preview</T>
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        isFavorite
                          ? gt("Unpin {name} from CarPlay favorites", { name: voice.displayName })
                          : gt("Pin {name} to CarPlay favorites", { name: voice.displayName })
                      }
                      accessibilityState={{ selected: isFavorite }}
                      onPress={() => {
                        triggerSelectionHaptic();
                        void onToggleFavorite(voice.id);
                      }}
                      style={({ pressed }) => [
                        styles.starButton,
                        isFavorite && styles.starButtonActive,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <SymbolView
                        name={isFavorite ? "star.fill" : "star"}
                        size={20}
                        tintColor={isFavorite ? DRIVE_COLORS.goldBright : DRIVE_COLORS.textMuted}
                      />
                    </Pressable>
                  </View>

                  <Text style={styles.voiceTagline}>{voice.tagline}</Text>
                  <Text numberOfLines={2} style={styles.sampleLine}>
                    {`"${voice.sampleLine}"`}
                  </Text>

                  {/* Card action row */}
                  <View style={styles.cardActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        isPreviewing
                          ? gt("Stop sample for {name}", { name: voice.displayName })
                          : gt("Play sample for {name}", { name: voice.displayName })
                      }
                      accessibilityState={{ busy: isPreviewing }}
                      onPress={() => {
                        triggerSelectionHaptic();
                        if (isPreviewing) {
                          void onStopPreview();
                        } else {
                          void onPreviewVoice(voice.id);
                        }
                      }}
                      style={({ pressed }) => [
                        styles.sampleButton,
                        isPreviewing && styles.sampleButtonPlaying,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <SymbolView
                        name={isPreviewing ? "stop.fill" : "play"}
                        size={16}
                        tintColor={
                          isPreviewing ? DRIVE_COLORS.goldBright : DRIVE_COLORS.textPrimary
                        }
                      />
                      <Text
                        style={[
                          styles.sampleButtonLabel,
                          isPreviewing && styles.sampleButtonLabelPlaying,
                        ]}
                      >
                        {isPreviewing ? gt("Stop sample") : gt("Play sample")}
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        isActive
                          ? gt("{name} selected", { name: voice.displayName })
                          : gt("Use {name}", { name: voice.displayName })
                      }
                      accessibilityState={{ selected: isActive }}
                      onPress={() => {
                        triggerMediumHaptic();
                        void onSelectVoice(voice.id);
                      }}
                      style={({ pressed }) => [
                        styles.useVoiceButton,
                        isActive && styles.useVoiceButtonSelected,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      {isActive ? (
                        <SymbolView
                          name="checkmark"
                          size={16}
                          tintColor={DRIVE_COLORS.goldBright}
                        />
                      ) : null}
                      <Text
                        style={[styles.useVoiceLabel, isActive && styles.useVoiceLabelSelected]}
                      >
                        {isActive ? gt("Selected") : gt("Use voice")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetRoot: {
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
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
    gap: 2,
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
  filterBlock: {
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: DRIVE_COLORS.borderSubtle,
  },
  filterRow: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: "center",
  },
  filterPill: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterPillSelected: {
    backgroundColor: DRIVE_COLORS.goldPrimary,
    borderColor: DRIVE_COLORS.goldBright,
  },
  filterPillLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  filterPillLabelSelected: {
    color: DRIVE_COLORS.obsidian,
  },
  vibePill: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  vibePillSelected: {
    backgroundColor: DRIVE_COLORS.goldSurface,
    borderColor: DRIVE_COLORS.borderGold,
  },
  vibePillLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: DRIVE_COLORS.textSecondary,
  },
  vibePillLabelSelected: {
    color: DRIVE_COLORS.goldBright,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    gap: 14,
  },
  voiceCard: {
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    padding: 16,
    gap: 10,
  },
  voiceCardActive: {
    borderColor: DRIVE_COLORS.goldPrimary,
    backgroundColor: "#191712",
  },
  voiceCardPreviewing: {
    borderColor: DRIVE_COLORS.goldBright,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  cardIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  voiceAccentDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 5,
  },
  cardTitleGroup: {
    flex: 1,
    gap: 6,
  },
  nameBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  voiceName: {
    fontSize: 19,
    fontWeight: "800",
    color: DRIVE_COLORS.textPrimary,
  },
  activeChip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: DRIVE_COLORS.goldSurface,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderGold,
  },
  activeChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: DRIVE_COLORS.goldBright,
  },
  metaChipRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  providerBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
  },
  providerBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: DRIVE_COLORS.textSecondary,
  },
  vibeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: DRIVE_COLORS.goldSurface,
  },
  vibeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: DRIVE_COLORS.goldBright,
  },
  keyNeededBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: DRIVE_COLORS.slateSurface,
  },
  keyNeededText: {
    fontSize: 11,
    fontWeight: "600",
    color: DRIVE_COLORS.textSecondary,
  },
  starButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  starButtonActive: {
    borderColor: DRIVE_COLORS.borderGold,
    backgroundColor: DRIVE_COLORS.goldSurface,
  },
  voiceTagline: {
    fontSize: 14,
    lineHeight: 20,
    color: DRIVE_COLORS.textSecondary,
  },
  sampleLine: {
    fontSize: 13,
    lineHeight: 19,
    color: DRIVE_COLORS.textMuted,
  },
  cardActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  sampleButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: DRIVE_COLORS.obsidianElevated,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  sampleButtonPlaying: {
    borderColor: DRIVE_COLORS.goldBright,
    backgroundColor: DRIVE_COLORS.goldSurface,
  },
  sampleButtonLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  sampleButtonLabelPlaying: {
    color: DRIVE_COLORS.goldBright,
  },
  useVoiceButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: DRIVE_COLORS.obsidianCardHover,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderGold,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
  },
  useVoiceButtonSelected: {
    backgroundColor: DRIVE_COLORS.goldSurface,
    borderColor: DRIVE_COLORS.goldPrimary,
  },
  useVoiceLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: DRIVE_COLORS.goldBright,
  },
  useVoiceLabelSelected: {
    color: DRIVE_COLORS.goldBright,
  },
  emptyCard: {
    backgroundColor: DRIVE_COLORS.obsidianCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DRIVE_COLORS.borderSubtle,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: DRIVE_COLORS.textPrimary,
  },
  emptyDetail: {
    fontSize: 14,
    color: DRIVE_COLORS.textSecondary,
    textAlign: "center",
  },
  resetButton: {
    marginTop: 6,
    minHeight: 48,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: DRIVE_COLORS.goldPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  resetButtonLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: DRIVE_COLORS.obsidian,
  },
  buttonPressed: {
    opacity: 0.78,
  },
});
