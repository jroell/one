import { msg } from "gt-react-native";

export type DriveVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "interrupted"
  | "error";

export const DASH_TOUCH_TARGET_MIN = 64;
export const DASH_PRIMARY_CTA_HEIGHT = 76;

/** The One family palette: black and gold, shared with the web app and One Platform. */
export const DRIVE_COLORS = {
  obsidian: "#000000",
  obsidianElevated: "#0A0906",
  obsidianCard: "#12100B",
  obsidianCardHover: "#1B1810",
  obsidianPill: "#100E09",
  borderSubtle: "rgba(255, 228, 164, 0.10)",
  borderStrong: "rgba(255, 228, 164, 0.20)",
  borderGold: "rgba(217, 180, 80, 0.38)",
  goldBright: "#F6E2A6",
  goldPrimary: "#D9B450",
  goldDeep: "#9C781F",
  goldSurface: "rgba(217, 180, 80, 0.16)",
  amberOrbit: "#E8C96F",
  amberSurface: "rgba(232, 201, 111, 0.18)",
  slateMuted: "#8F8671",
  slateSurface: "rgba(143, 134, 113, 0.18)",
  connectingSweep: "#F6F1E4",
  danger: "#EF4444",
  dangerSurface: "rgba(239, 68, 68, 0.2)",
  dangerBorder: "rgba(239, 68, 68, 0.44)",
  success: "#22C55E",
  successSurface: "rgba(34, 197, 94, 0.18)",
  successBorder: "rgba(34, 197, 94, 0.36)",
  textPrimary: "#F6F1E4",
  textSecondary: "#BCB29B",
  textMuted: "#8F8671",
  carPlayBezel: "#000000",
  carPlaySidebar: "#0A0906",
} as const;

export interface DriveStateVisual {
  readonly label: string;
  readonly sublabel: string;
  readonly ringPrimary: string;
  readonly ringSecondary: string;
  readonly haloColor: string;
  readonly badgeBg: string;
  readonly badgeBorder: string;
  readonly badgeText: string;
}

export const DRIVE_STATE_VISUALS: Readonly<Record<DriveVoiceState, DriveStateVisual>> = {
  idle: {
    label: msg("Ready to drive"),
    sublabel: msg("Tap the ring or Start to talk hands-free"),
    ringPrimary: DRIVE_COLORS.goldPrimary,
    ringSecondary: DRIVE_COLORS.goldDeep,
    haloColor: "rgba(217, 180, 80, 0.2)",
    badgeBg: DRIVE_COLORS.obsidianPill,
    badgeBorder: DRIVE_COLORS.borderSubtle,
    badgeText: DRIVE_COLORS.textSecondary,
  },
  connecting: {
    label: msg("Connecting"),
    sublabel: msg("Opening full-duplex audio channel"),
    ringPrimary: DRIVE_COLORS.connectingSweep,
    ringSecondary: DRIVE_COLORS.goldPrimary,
    haloColor: "rgba(246, 241, 228, 0.22)",
    badgeBg: "rgba(188, 178, 155, 0.16)",
    badgeBorder: "rgba(246, 241, 228, 0.34)",
    badgeText: DRIVE_COLORS.connectingSweep,
  },
  listening: {
    label: msg("Listening"),
    sublabel: msg("Speak naturally, hands-free"),
    ringPrimary: DRIVE_COLORS.goldPrimary,
    ringSecondary: DRIVE_COLORS.goldDeep,
    haloColor: "rgba(217, 180, 80, 0.3)",
    badgeBg: DRIVE_COLORS.goldSurface,
    badgeBorder: DRIVE_COLORS.borderGold,
    badgeText: DRIVE_COLORS.goldBright,
  },
  thinking: {
    label: msg("Thinking"),
    sublabel: msg("Working on your answer"),
    ringPrimary: DRIVE_COLORS.amberOrbit,
    ringSecondary: DRIVE_COLORS.goldDeep,
    haloColor: "rgba(232, 201, 111, 0.28)",
    badgeBg: DRIVE_COLORS.amberSurface,
    badgeBorder: "rgba(232, 201, 111, 0.44)",
    badgeText: "#FCD34D",
  },
  speaking: {
    label: msg("Speaking"),
    sublabel: msg("Talk anytime or tap to interrupt"),
    ringPrimary: DRIVE_COLORS.goldBright,
    ringSecondary: DRIVE_COLORS.goldPrimary,
    haloColor: "rgba(255, 214, 107, 0.36)",
    badgeBg: "rgba(255, 214, 107, 0.2)",
    badgeBorder: "rgba(255, 214, 107, 0.55)",
    badgeText: DRIVE_COLORS.goldBright,
  },
  muted: {
    label: msg("Muted"),
    sublabel: msg("Microphone paused. Tap Unmute to continue"),
    ringPrimary: DRIVE_COLORS.slateMuted,
    ringSecondary: "#334155",
    haloColor: "rgba(143, 134, 113, 0.18)",
    badgeBg: DRIVE_COLORS.slateSurface,
    badgeBorder: "rgba(143, 134, 113, 0.4)",
    badgeText: "#F6F1E4",
  },
  interrupted: {
    label: msg("Listening"),
    sublabel: msg("Interrupted. Go ahead"),
    ringPrimary: DRIVE_COLORS.goldBright,
    ringSecondary: DRIVE_COLORS.amberOrbit,
    haloColor: "rgba(255, 214, 107, 0.32)",
    badgeBg: DRIVE_COLORS.goldSurface,
    badgeBorder: DRIVE_COLORS.borderGold,
    badgeText: DRIVE_COLORS.goldBright,
  },
  error: {
    label: msg("Connection issue"),
    sublabel: msg("Tap Retry or switch to on-device voice"),
    ringPrimary: DRIVE_COLORS.danger,
    ringSecondary: "#991B1B",
    haloColor: "rgba(239, 68, 68, 0.26)",
    badgeBg: DRIVE_COLORS.dangerSurface,
    badgeBorder: DRIVE_COLORS.dangerBorder,
    badgeText: "#FCA5A5",
  },
};

export const SPOKEN_SPEED_OPTIONS = [
  { value: 0.85, label: "0.85x" },
  { value: 1.0, label: "1.0x" },
  { value: 1.15, label: "1.15x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.4, label: "1.4x" },
] as const;
