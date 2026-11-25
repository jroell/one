import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    reducedMotion: false,
    appState: "active" as string,
    appStateListeners: new Set<() => void>(),
    activateKeepAwakeAsync: vi.fn(() => Promise.resolve()),
    deactivateKeepAwake: vi.fn(() => Promise.resolve()),
    impactAsync: vi.fn(() => Promise.resolve()),
    selectionAsync: vi.fn(() => Promise.resolve()),
    withRepeat: vi.fn((animation: unknown) => animation),
    withTiming: vi.fn((toValue: unknown) => toValue),
    cancelAnimation: vi.fn(),
  },
}));

vi.mock("react-native", () => {
  const flatten = (style: unknown): Record<string, unknown> => {
    if (!style) return {};
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map(flatten));
    }
    return typeof style === "object" ? (style as Record<string, unknown>) : {};
  };

  const View = ({
    children,
    testID,
    style,
  }: {
    children?: ReactNode;
    testID?: string;
    style?: unknown;
  }) => (
    <div data-testid={testID} style={flatten(style) as React.CSSProperties}>
      {children}
    </div>
  );

  const ScrollView = ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  );

  const Modal = ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
    visible ? <div data-modal="true">{children}</div> : null;

  const Pressable = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    testID,
    style,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
    style?: unknown;
  }) => {
    const resolvedStyle =
      typeof style === "function" ? flatten(style({ pressed: false })) : flatten(style);
    return (
      <button
        type="button"
        data-testid={testID}
        aria-label={accessibilityLabel}
        disabled={disabled}
        onClick={onPress}
        style={resolvedStyle as React.CSSProperties}
      >
        {children}
      </button>
    );
  };

  const TextInput = ({
    value,
    onChangeText,
    placeholder,
    accessibilityLabel,
    secureTextEntry,
  }: {
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    accessibilityLabel?: string;
    secureTextEntry?: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      placeholder={placeholder}
      type={secureTextEntry ? "password" : "text"}
      value={value ?? ""}
      onChange={(event) => onChangeText?.(event.target.value)}
    />
  );

  return {
    Platform: { OS: "ios" },
    AppState: {
      get currentState() {
        return mocks.appState;
      },
      addEventListener: (_event: "change", listener: () => void) => {
        mocks.appStateListeners.add(listener);
        return { remove: () => mocks.appStateListeners.delete(listener) };
      },
    },
    StyleSheet: {
      create: <T,>(styles: T): T => styles,
      flatten,
    },
    View,
    ScrollView,
    Modal,
    Pressable,
    StatusBar: () => null,
    TextInput,
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: vi.fn() }),
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  impactAsync: mocks.impactAsync,
  selectionAsync: mocks.selectionAsync,
}));

vi.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: mocks.activateKeepAwakeAsync,
  deactivateKeepAwake: mocks.deactivateKeepAwake,
}));

vi.mock("react-native-reanimated", () => {
  const AnimatedView = ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  );
  return {
    default: { View: AnimatedView },
    Easing: {
      linear: (t: number) => t,
      sin: (t: number) => t,
      quad: (t: number) => t,
      cubic: (t: number) => t,
      out: (fn: (t: number) => number) => fn,
      inOut: (fn: (t: number) => number) => fn,
    },
    ReduceMotion: { System: "system" },
    useReducedMotion: () => mocks.reducedMotion,
    useSharedValue: <T,>(initial: T) => {
      const box = {
        value: initial,
        set(next: T) {
          box.value = next;
        },
      };
      return box;
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: mocks.withTiming,
    withRepeat: mocks.withRepeat,
    cancelAnimation: mocks.cancelAnimation,
  };
});

vi.mock("react-native-svg", () => {
  const Svg = ({ children }: { children?: ReactNode }) => <svg>{children}</svg>;
  const PassThrough = ({ children }: { children?: ReactNode }) => <g>{children}</g>;
  return {
    default: Svg,
    Svg,
    Circle: () => <circle />,
    Defs: PassThrough,
    LinearGradient: PassThrough,
    RadialGradient: PassThrough,
    Stop: () => null,
  };
});

vi.mock("../../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../components/ui/AppSymbol", () => ({
  SymbolView: ({ name }: { name: string }) => <span data-symbol={name} />,
}));

vi.mock("../../../components/ui/ThemedSwitch", () => ({
  ThemedSwitch: ({
    value,
    onValueChange,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: (next: boolean) => void;
    accessibilityLabel?: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-label={accessibilityLabel}
      aria-checked={value}
      onClick={() => onValueChange(!value)}
    >
      {value ? "On" : "Off"}
    </button>
  ),
}));

vi.mock("../engine/index", () => ({
  VOICE_CATALOG: [],
  DRIVING_PERSONAS: [],
  useDriveController: () => {
    throw new Error("DriveStageScreen hook is not called in DriveStageView unit tests");
  },
}));

import { CarPlayPreviewPanel } from "./CarPlayPreviewPanel";
import { DriveStageView } from "./DriveStageScreen";
import { DASH_PRIMARY_CTA_HEIGHT, DASH_TOUCH_TARGET_MIN } from "./driveTheme";
import type {
  DriveSnapshotView,
  DrivingPersonaView,
  PendingConfirmationView,
  VoiceProfileView,
} from "./driveUiTypes";
import { OneVoiceOrb } from "./OneVoiceOrb";
import { PROPOSAL_SEND_GUARD_MS } from "./proposalSendGuard";
import { VoiceStudioSheet } from "./VoiceStudioSheet";

const TEST_VOICES: readonly VoiceProfileView[] = [
  {
    id: "openai:marin",
    provider: "openai-realtime",
    providerVoiceId: "marin",
    displayName: "Marin",
    tagline: "Warm, grounded co-pilot voice built for long highway drives.",
    vibe: "warm",
    accentColor: "#D9B450",
    sampleLine: "Hey, roads look clear. What are we thinking through today?",
    defaultSpeed: 1.0,
    supportsRealtime: true,
  },
  {
    id: "gemini:Puck",
    provider: "gemini-live",
    providerVoiceId: "Puck",
    displayName: "Puck",
    tagline: "Quick, playful energy for brainstorming on the move.",
    vibe: "energetic",
    accentColor: "#38BDF8",
    sampleLine: "Hit me with your wildest idea, I am listening.",
    defaultSpeed: 1.05,
    supportsRealtime: true,
  },
  {
    id: "elevenlabs:adam",
    provider: "elevenlabs",
    providerVoiceId: "adam",
    displayName: "Adam",
    tagline: "Deep resonant baritone for calm briefings.",
    vibe: "deep",
    accentColor: "#F97316",
    sampleLine: "Two builds are green and one pull request needs your call.",
    defaultSpeed: 1.0,
    supportsRealtime: false,
  },
  {
    id: "on-device:default",
    provider: "on-device",
    providerVoiceId: "default",
    displayName: "System Voice",
    tagline: "Zero-key local speech right on your phone.",
    vibe: "crisp",
    accentColor: "#94A3B8",
    sampleLine: "Ready hands-free with zero cloud keys required.",
    defaultSpeed: 1.0,
    supportsRealtime: false,
  },
];

const TEST_PERSONAS: readonly DrivingPersonaView[] = [
  {
    id: "copilot",
    name: "Road Co-Pilot",
    shortName: "Co-Pilot",
    tagline: "Conversational partner for any topic on the road.",
    iconName: "car",
    accentColor: "#D9B450",
    systemPrompt: "Be concise.",
    defaultToolsEnabled: true,
    maxSpokenSentences: 3,
  },
  {
    id: "agent-bridge",
    name: "One Agent Commander",
    shortName: "Commander",
    tagline: "Briefs and steers live One coding threads hands-free.",
    iconName: "terminal",
    accentColor: "#38BDF8",
    systemPrompt: "Summarize threads concisely.",
    defaultToolsEnabled: true,
    maxSpokenSentences: 3,
  },
];

function makeSnapshot(overrides: Partial<DriveSnapshotView> = {}): DriveSnapshotView {
  return {
    sessionState: "idle",
    isActive: false,
    isMuted: false,
    carPlayConnected: false,
    activeTransport: null,
    activeVoice: TEST_VOICES[0]!,
    activePersona: TEST_PERSONAS[0]!,
    inputLevel: 0,
    outputLevel: 0,
    activeCaption: "",
    activeCaptionRole: "system",
    transcript: [],
    previewingVoiceId: null,
    errorMessage: null,
    reconnectAttempt: 0,
    activeThreadId: null,
    activeThreadEnvironmentId: null,
    activeThreadTitle: null,
    voiceInputUnavailableMessage: null,
    threads: [
      {
        environmentId: "env-1",
        threadId: "thread-1",
        title: "Fix CarPlay audio buffer",
        status: "needs_approval",
        pendingApprovalCount: 1,
        lastActivityLabel: "2m ago",
        branch: "custom/main",
      },
    ],
    pendingConfirmation: null,
    settings: {
      selectedVoiceId: "openai:marin",
      selectedPersonaId: "copilot",
      favoriteVoiceIds: ["openai:marin"],
      bargeInEnabled: true,
      bargeInSensitivity: "balanced",
      vadMode: "semantic_vad",
      autoStartOnCarPlay: false,
      agentBridgeEnabled: true,
      spokenSpeed: 1.0,
      openaiModel: "gpt-realtime",
      geminiModel: "gemini-2.5-flash-native-audio-preview",
      elevenLabsCustomVoiceId: "",
    },
    apiKeysConfigured: {
      openai: true,
      gemini: false,
      elevenlabs: false,
    },
    ...overrides,
  };
}

const PROPOSAL_A: PendingConfirmationView = {
  id: "confirm-1",
  toolName: "send_message_to_thread",
  summary: 'Send "Run the deploy check" to Fix CarPlay audio buffer',
  environmentId: "env-1",
  threadId: "thread-1",
  threadTitle: "Fix CarPlay audio buffer",
  message: "Run the deploy check",
  expiresAt: 1_700_000_030_000,
};

const PROPOSAL_B: PendingConfirmationView = {
  ...PROPOSAL_A,
  id: "confirm-2",
  summary: 'Send "Delete the staging branch" to Fix CarPlay audio buffer',
  message: "Delete the staging branch",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.reducedMotion = false;
  mocks.appState = "active";
  mocks.appStateListeners.clear();
  mocks.activateKeepAwakeAsync.mockClear();
  mocks.deactivateKeepAwake.mockClear();
  mocks.impactAsync.mockClear();
  mocks.selectionAsync.mockClear();
  mocks.withRepeat.mockClear();
  mocks.withTiming.mockClear();
  mocks.cancelAnimation.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  container.remove();
});

function buttonByLabel(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (el) => el.getAttribute("aria-label") === label || el.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

describe("OneVoiceOrb", () => {
  it("runs ambient and ripple animations when motion is enabled and disables loops under reduced motion", () => {
    act(() => {
      root.render(<OneVoiceOrb state="speaking" level={0.65} />);
    });
    expect(mocks.withRepeat).toHaveBeenCalled();

    mocks.withRepeat.mockClear();
    mocks.reducedMotion = true;
    act(() => {
      root.render(<OneVoiceOrb state="thinking" level={0.4} />);
    });
    expect(mocks.withRepeat).not.toHaveBeenCalled();
  });

  it("renders distinct states and forwards press events", () => {
    const onPress = vi.fn();
    act(() => {
      root.render(<OneVoiceOrb state="muted" level={0.9} onPress={onPress} />);
    });
    expect(container.querySelector('[data-symbol="slash.circle"]')).not.toBeNull();
    act(() => {
      buttonByLabel("One voice ring, Muted").click();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceStudioSheet", () => {
  it("filters voices by provider and vibe, toggles favorites, auditions samples, and selects live", () => {
    const onSelectVoice = vi.fn();
    const onToggleFavorite = vi.fn();
    const onPreviewVoice = vi.fn();
    const onStopPreview = vi.fn();

    act(() => {
      root.render(
        <VoiceStudioSheet
          visible
          onClose={vi.fn()}
          voices={TEST_VOICES}
          activeVoiceId="openai:marin"
          favoriteVoiceIds={["openai:marin"]}
          previewingVoiceId={null}
          apiKeysConfigured={{ openai: true, gemini: false, elevenlabs: false }}
          sessionActive
          onSelectVoice={onSelectVoice}
          onToggleFavorite={onToggleFavorite}
          onPreviewVoice={onPreviewVoice}
          onStopPreview={onStopPreview}
        />,
      );
    });

    expect(container.querySelectorAll('[data-testid^="voice-card-"]')).toHaveLength(4);

    // Filter by Gemini Live
    act(() => {
      buttonByLabel("Filter provider Gemini Live").click();
    });
    expect(container.querySelectorAll('[data-testid^="voice-card-"]')).toHaveLength(1);
    expect(container.textContent).toContain("Puck");

    // Audition Puck and select live
    act(() => {
      buttonByLabel("Play sample for Puck").click();
      buttonByLabel("Use Puck").click();
      buttonByLabel("Pin Puck to CarPlay favorites").click();
    });
    expect(onPreviewVoice).toHaveBeenCalledWith("gemini:Puck");
    expect(onSelectVoice).toHaveBeenCalledWith("gemini:Puck");
    expect(onToggleFavorite).toHaveBeenCalledWith("gemini:Puck");

    // Reset via All + filter by vibe Deep
    act(() => {
      buttonByLabel("Filter provider All").click();
      buttonByLabel("Filter vibe Deep").click();
    });
    expect(container.querySelectorAll('[data-testid^="voice-card-"]')).toHaveLength(1);
    expect(container.textContent).toContain("Adam");
  });
});

describe("CarPlayPreviewPanel", () => {
  it("switches all four CarPlay simulator tabs, toggles settings, and saves secure API keys", async () => {
    const onStartSession = vi.fn();
    const onSelectVoice = vi.fn();
    const onSelectPersona = vi.fn();
    const onSelectThread = vi.fn();
    const onUpdateSettings = vi.fn();
    const onSaveApiKey = vi.fn();
    const onClearApiKey = vi.fn();

    act(() => {
      root.render(
        <CarPlayPreviewPanel
          visible
          onClose={vi.fn()}
          snapshot={makeSnapshot()}
          voices={TEST_VOICES}
          personas={TEST_PERSONAS}
          onStartSession={onStartSession}
          onEndSession={vi.fn()}
          onToggleMute={vi.fn()}
          onInterrupt={vi.fn()}
          onSelectVoice={onSelectVoice}
          onSelectPersona={onSelectPersona}
          onSelectThread={onSelectThread}
          onUpdateSettings={onUpdateSettings}
          onSaveApiKey={onSaveApiKey}
          onClearApiKey={onClearApiKey}
        />,
      );
    });

    // Talk tab start action
    act(() => {
      buttonByLabel("CarPlay start talking").click();
    });
    expect(onStartSession).toHaveBeenCalledTimes(1);

    // Voices tab
    act(() => {
      buttonByLabel("CarPlay Voices tab").click();
    });
    act(() => {
      buttonByLabel("CarPlay select voice Puck").click();
    });
    expect(onSelectVoice).toHaveBeenCalledWith("gemini:Puck");

    // Modes tab
    act(() => {
      buttonByLabel("CarPlay Modes tab").click();
    });
    act(() => {
      buttonByLabel("CarPlay select mode One Agent Commander").click();
    });
    expect(onSelectPersona).toHaveBeenCalledWith("agent-bridge");

    // Threads tab
    act(() => {
      buttonByLabel("CarPlay Threads tab").click();
    });
    expect(container.textContent).toContain("Needs approval");
    act(() => {
      buttonByLabel("CarPlay focus thread Fix CarPlay audio buffer").click();
    });
    expect(onSelectThread).toHaveBeenCalledWith({
      environmentId: "env-1",
      threadId: "thread-1",
    });

    // Toggle Barge-in & Spoken Speed
    act(() => {
      buttonByLabel("Hands-free barge-in").click();
      buttonByLabel("Spoken speed 1.25x").click();
    });
    expect(onUpdateSettings).toHaveBeenCalledWith({ bargeInEnabled: false });
    expect(onUpdateSettings).toHaveBeenCalledWith({ spokenSpeed: 1.25 });

    // Save Gemini API key & Clear OpenAI API key
    const geminiInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gemini Live API key"]',
    );
    expect(geminiInput).not.toBeNull();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      nativeInputValueSetter?.call(geminiInput, "AIza-test-key");
      geminiInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonByLabel("Save Gemini Live API key").click();
      buttonByLabel("Clear OpenAI Realtime API key").click();
    });
    expect(onSaveApiKey).toHaveBeenCalledWith("gemini", "AIza-test-key");
    expect(onClearApiKey).toHaveBeenCalledWith("openai");
  });
});

describe("DriveStageView", () => {
  it("keeps screen awake during active driving sessions and exposes dash-safe controls", () => {
    const callbacks = {
      onClose: vi.fn(),
      onStartSession: vi.fn(),
      onEndSession: vi.fn(),
      onToggleMute: vi.fn(),
      onInterrupt: vi.fn(),
      onSelectVoice: vi.fn(),
      onSelectPersona: vi.fn(),
      onSelectThread: vi.fn(),
      onToggleFavoriteVoice: vi.fn(),
      onPreviewVoice: vi.fn(),
      onStopPreview: vi.fn(),
      onUpdateSettings: vi.fn(),
      onSaveApiKey: vi.fn(),
      onClearApiKey: vi.fn(),
      onSendTextPrompt: vi.fn(),
      onConfirmPendingAction: vi.fn(),
      onDismissPendingAction: vi.fn(),
    };

    vi.useFakeTimers();

    // Idle state shows Start CTA with >= 76px dash-safe height and does not lock keep-awake
    act(() => {
      root.render(
        <DriveStageView
          snapshot={makeSnapshot({ sessionState: "idle", isActive: false })}
          voices={TEST_VOICES}
          personas={TEST_PERSONAS}
          {...callbacks}
        />,
      );
    });
    const startBtn = buttonByLabel("Start hands-free chat");
    expect(Number.parseInt(startBtn.style.minHeight, 10)).toBeGreaterThanOrEqual(
      DASH_PRIMARY_CTA_HEIGHT,
    );
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();

    // Active speaking state activates keep-awake and shows 4 giant dock buttons (>= 64px)
    act(() => {
      root.render(
        <DriveStageView
          snapshot={makeSnapshot({
            sessionState: "speaking",
            isActive: true,
            carPlayConnected: true,
            outputLevel: 0.72,
            activeCaption: "Your tests are green on custom main.",
            activeCaptionRole: "assistant",
            pendingConfirmation: PROPOSAL_A,
          })}
          voices={TEST_VOICES}
          personas={TEST_PERSONAS}
          {...callbacks}
        />,
      );
    });

    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledWith("one-drive-mode");
    expect(container.textContent).toContain("CarPlay connected");
    expect(container.textContent).toContain("Your tests are green on custom main.");

    const muteBtn = buttonByLabel("Mute microphone");
    const interruptBtn = buttonByLabel("Interrupt response");
    const endBtn = buttonByLabel("End call");
    expect(Number.parseInt(muteBtn.style.minHeight, 10)).toBeGreaterThanOrEqual(
      DASH_TOUCH_TARGET_MIN,
    );
    expect(Number.parseInt(interruptBtn.style.minHeight, 10)).toBeGreaterThanOrEqual(
      DASH_TOUCH_TARGET_MIN,
    );
    expect(Number.parseInt(endBtn.style.minHeight, 10)).toBeGreaterThanOrEqual(
      DASH_TOUCH_TARGET_MIN,
    );

    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS);
    });
    act(() => {
      buttonByLabel("Mute microphone").click();
      buttonByLabel("Interrupt response").click();
      buttonByLabel("Send pending message").click();
      buttonByLabel("End call").click();
    });
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(1);
    expect(callbacks.onInterrupt).toHaveBeenCalledTimes(1);
    // The tap carries the id of the card the driver saw, so a replaced card cannot be confirmed.
    expect(callbacks.onConfirmPendingAction).toHaveBeenCalledWith("confirm-1");
    expect(callbacks.onEndSession).toHaveBeenCalledTimes(1);
  });

  function makeCallbacks() {
    return {
      onClose: vi.fn(),
      onStartSession: vi.fn(),
      onEndSession: vi.fn(),
      onToggleMute: vi.fn(),
      onInterrupt: vi.fn(),
      onSelectVoice: vi.fn(),
      onSelectPersona: vi.fn(),
      onSelectThread: vi.fn(),
      onToggleFavoriteVoice: vi.fn(),
      onPreviewVoice: vi.fn(),
      onStopPreview: vi.fn(),
      onUpdateSettings: vi.fn(),
      onSaveApiKey: vi.fn(),
      onClearApiKey: vi.fn(),
      onSendTextPrompt: vi.fn(),
      onConfirmPendingAction: vi.fn(),
      onDismissPendingAction: vi.fn(),
    };
  }

  function renderStage(
    callbacks: ReturnType<typeof makeCallbacks>,
    overrides: Partial<DriveSnapshotView>,
  ) {
    act(() => {
      root.render(
        <DriveStageView
          snapshot={makeSnapshot({ isActive: true, sessionState: "listening", ...overrides })}
          voices={TEST_VOICES}
          personas={TEST_PERSONAS}
          {...callbacks}
        />,
      );
    });
  }

  it("cannot send a replacement proposal from a press aimed at the proposal it replaced", () => {
    vi.useFakeTimers();
    const callbacks = makeCallbacks();

    renderStage(callbacks, { pendingConfirmation: PROPOSAL_A });
    const sendOnA = buttonByLabel("Send pending message");
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS);
    });
    expect(sendOnA.disabled).toBe(false);

    // The assistant replaces the proposal while the driver's finger is coming down.
    renderStage(callbacks, { pendingConfirmation: PROPOSAL_B });
    expect(container.textContent).toContain("Delete the staging branch");
    expect(sendOnA.isConnected).toBe(false);
    act(() => {
      sendOnA.click();
    });
    expect(callbacks.onConfirmPendingAction).not.toHaveBeenCalled();

    // A tap on the new card inside the guard is ignored and the button looks pending.
    const sendOnB = buttonByLabel("Send pending message");
    expect(sendOnB.disabled).toBe(true);
    expect(Number.parseFloat(sendOnB.style.opacity)).toBeLessThan(1);
    act(() => {
      sendOnB.click();
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS - 1);
      sendOnB.click();
    });
    expect(callbacks.onConfirmPendingAction).not.toHaveBeenCalled();

    // Once the guard passes, Send confirms the proposal on this card and nothing else.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(false);
    act(() => {
      buttonByLabel("Send pending message").click();
    });
    expect(callbacks.onConfirmPendingAction).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirmPendingAction).toHaveBeenCalledWith("confirm-2");
  });

  function setAppState(state: string) {
    act(() => {
      mocks.appState = state;
      for (const listener of mocks.appStateListeners) listener();
    });
  }

  it("keeps Send inert until 700 ms after a sheet that was open when the proposal arrived closes", () => {
    vi.useFakeTimers();
    const callbacks = makeCallbacks();

    renderStage(callbacks, { pendingConfirmation: null });
    act(() => {
      buttonByLabel("Switch voice").click();
    });
    expect(container.querySelector('[aria-label="Close Voice studio"]')).not.toBeNull();

    // The proposal arrives behind the sheet and the whole guard elapses while it is hidden.
    renderStage(callbacks, { pendingConfirmation: PROPOSAL_A });
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS * 3);
    });
    act(() => {
      buttonByLabel("Close Voice studio").click();
    });

    // First frame the driver sees: Send is not armed.
    const send = buttonByLabel("Send pending message");
    expect(send.disabled).toBe(true);
    act(() => {
      send.click();
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS - 1);
      send.click();
    });
    expect(callbacks.onConfirmPendingAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(false);
    act(() => {
      buttonByLabel("Send pending message").click();
    });
    expect(callbacks.onConfirmPendingAction).toHaveBeenCalledWith("confirm-1");
  });

  it("disarms Send when a sheet opens over an armed card and restarts the full guard after it closes", () => {
    vi.useFakeTimers();
    const callbacks = makeCallbacks();

    renderStage(callbacks, { pendingConfirmation: PROPOSAL_A });
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(false);

    act(() => {
      buttonByLabel("Switch voice").click();
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(true);
    act(() => {
      buttonByLabel("Close Voice studio").click();
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(false);
  });

  it("keeps Send inert after the app returns from 5 s in the background until 700 ms after the return", () => {
    vi.useFakeTimers();
    const callbacks = makeCallbacks();

    renderStage(callbacks, { pendingConfirmation: PROPOSAL_A });
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(false);

    setAppState("background");
    expect(buttonByLabel("Send pending message").disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    setAppState("active");

    const send = buttonByLabel("Send pending message");
    expect(send.disabled).toBe(true);
    act(() => {
      send.click();
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS - 1);
      send.click();
    });
    expect(callbacks.onConfirmPendingAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    act(() => {
      buttonByLabel("Send pending message").click();
    });
    expect(callbacks.onConfirmPendingAction).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirmPendingAction).toHaveBeenCalledWith("confirm-1");
  });

  it("does not arm a proposal that arrives while the app is in the background until 700 ms after it returns", () => {
    vi.useFakeTimers();
    const callbacks = makeCallbacks();

    setAppState("inactive");
    renderStage(callbacks, { pendingConfirmation: PROPOSAL_A });
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS * 2);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(true);

    setAppState("active");
    act(() => {
      vi.advanceTimersByTime(PROPOSAL_SEND_GUARD_MS - 1);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(buttonByLabel("Send pending message").disabled).toBe(false);
  });

  it("states an idle session once and keeps the caption card for speech", () => {
    const callbacks = makeCallbacks();

    renderStage(callbacks, {
      isActive: false,
      sessionState: "idle",
      activeCaption: "Ready for hands-free voice chat.",
      activeCaptionRole: "system",
    });
    expect(container.textContent).toContain("Ready to drive");
    expect(container.textContent).not.toContain("Ready for hands-free voice chat");
    expect(container.textContent).not.toContain("Tap the ring");
    expect(container.textContent).not.toMatch(/status/i);
    expect(container.querySelector('[data-testid="caption-ticker"]')).toBeNull();

    renderStage(callbacks, {
      sessionState: "speaking",
      activeCaption: "Your tests are green.",
      activeCaptionRole: "assistant",
    });
    expect(container.querySelector('[data-testid="caption-ticker"]')?.textContent).toContain(
      "Your tests are green.",
    );
  });
});
