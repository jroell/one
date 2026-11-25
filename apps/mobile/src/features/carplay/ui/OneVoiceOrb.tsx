import { useGT, useMessages } from "gt-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from "react-native-svg";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { DRIVE_COLORS, DRIVE_STATE_VISUALS, type DriveVoiceState } from "./driveTheme";

export interface OneVoiceOrbProps {
  readonly state: DriveVoiceState;
  /** Normalized RMS amplitude in [0, 1] from live mic or speaker output. */
  readonly level: number;
  readonly size?: number;
  readonly accentColor?: string;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

const DEFAULT_ORB_SIZE = 224;

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Animated One Ring voice orb with ambient breathing, RMS-reactive harmonic ripples,
 * and distinct visual states for listening, thinking, speaking, muted, and connecting.
 */
export function OneVoiceOrb({
  state,
  level,
  size = DEFAULT_ORB_SIZE,
  accentColor,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: OneVoiceOrbProps) {
  const gt = useGT();
  const m = useMessages();
  const reducedMotion = useReducedMotion();
  const visual = DRIVE_STATE_VISUALS[state];
  const primaryColor =
    accentColor && (state === "listening" || state === "speaking")
      ? accentColor
      : visual.ringPrimary;
  const secondaryColor = visual.ringSecondary;
  const normalizedLevel = clampLevel(level);

  const breath = useSharedValue(0);
  const orbit = useSharedValue(0);
  const rms = useSharedValue(normalizedLevel);
  const ripplePulse = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives Reanimated shared values from live audio RMS level
  useEffect(() => {
    const target = state === "muted" || state === "idle" ? 0 : normalizedLevel;
    rms.set(
      withTiming(target, {
        duration: reducedMotion ? 0 : 90,
        easing: Easing.out(Easing.quad),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [normalizedLevel, reducedMotion, rms, state]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- configures ambient breathing, orbit, and harmonic ripple animations for each voice state
  useEffect(() => {
    cancelAnimation(breath);
    cancelAnimation(orbit);
    cancelAnimation(ripplePulse);

    if (reducedMotion || state === "muted" || state === "error") {
      breath.set(0);
      orbit.set(0);
      ripplePulse.set(0);
      return;
    }

    const breathDuration =
      state === "speaking" ? 1100 : state === "listening" ? 2100 : state === "idle" ? 3000 : 1600;
    breath.set(
      withRepeat(
        withTiming(1, {
          duration: breathDuration,
          easing: Easing.inOut(Easing.sin),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        true,
      ),
    );

    if (state === "thinking" || state === "connecting") {
      orbit.set(0);
      orbit.set(
        withRepeat(
          withTiming(1, {
            duration: state === "thinking" ? 1900 : 2600,
            easing: Easing.linear,
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          false,
        ),
      );
    } else {
      orbit.set(0);
    }

    if (state === "speaking" || state === "listening" || state === "interrupted") {
      ripplePulse.set(0);
      ripplePulse.set(
        withRepeat(
          withTiming(1, {
            duration: state === "speaking" ? 1400 : 2200,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          false,
        ),
      );
    } else {
      ripplePulse.set(0);
    }

    return () => {
      cancelAnimation(breath);
      cancelAnimation(orbit);
      cancelAnimation(ripplePulse);
    };
  }, [breath, orbit, reducedMotion, ripplePulse, state]);

  const haloAnimatedStyle = useAnimatedStyle(() => {
    const scale = 1 + breath.value * 0.06 + rms.value * 0.24;
    const opacity = state === "muted" ? 0.22 : 0.42 + breath.value * 0.16 + rms.value * 0.34;
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const outerRippleStyle = useAnimatedStyle(() => {
    const active = state === "speaking" || state === "listening" || state === "interrupted";
    if (!active || reducedMotion) {
      return { opacity: 0, transform: [{ scale: 1 }] };
    }
    const progress = ripplePulse.value;
    const amplitudeBoost = state === "speaking" ? 0.28 + rms.value * 0.26 : 0.14 + rms.value * 0.24;
    const scale = 0.92 + progress * amplitudeBoost;
    const opacity = (1 - progress) * (0.2 + rms.value * 0.55);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const innerRippleStyle = useAnimatedStyle(() => {
    const active = state === "speaking" || state === "listening" || state === "interrupted";
    if (!active || reducedMotion) {
      return { opacity: 0, transform: [{ scale: 1 }] };
    }
    const shifted = (ripplePulse.value + 0.5) % 1;
    const amplitudeBoost = state === "speaking" ? 0.22 + rms.value * 0.2 : 0.1 + rms.value * 0.18;
    const scale = 0.9 + shifted * amplitudeBoost;
    const opacity = (1 - shifted) * (0.16 + rms.value * 0.45);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const ringAnimatedStyle = useAnimatedStyle(() => {
    const scale =
      state === "muted"
        ? 0.96
        : 1 + breath.value * (state === "speaking" ? 0.04 : 0.025) + rms.value * 0.08;
    return {
      transform: [{ scale }],
    };
  });

  const orbitAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${orbit.value * 360}deg` }],
  }));

  const half = size / 2;
  const ringRadius = size * 0.36;
  const strokeWidth = Math.max(8, Math.round(size * 0.065));
  const orbitCircumference = 2 * Math.PI * (ringRadius + strokeWidth * 0.65);
  const showOrbit = state === "thinking" || state === "connecting";

  const orbBody = (
    <View
      testID={testID ?? "one-voice-orb"}
      style={[styles.container, { width: size * 1.28, height: size * 1.28 }]}
    >
      {/* Ambient radial halo */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.centeredLayer,
          haloAnimatedStyle,
          {
            width: size * 1.15,
            height: size * 1.15,
            borderRadius: (size * 1.15) / 2,
            backgroundColor: visual.haloColor,
          },
        ]}
      />

      {/* Harmonic RMS ripple ring 1 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.rippleRing,
          outerRippleStyle,
          {
            width: size * 1.06,
            height: size * 1.06,
            borderRadius: (size * 1.06) / 2,
            borderColor: primaryColor,
          },
        ]}
      />

      {/* Harmonic RMS ripple ring 2 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.rippleRing,
          innerRippleStyle,
          {
            width: size * 0.94,
            height: size * 0.94,
            borderRadius: (size * 0.94) / 2,
            borderColor: secondaryColor,
          },
        ]}
      />

      {/* Orbiting amber/silver sweep arc for Thinking and Connecting states */}
      {showOrbit ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.centeredLayer, orbitAnimatedStyle, { width: size, height: size }]}
        >
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle
              cx={half}
              cy={half}
              r={ringRadius + strokeWidth * 0.65}
              fill="none"
              stroke={primaryColor}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={`${orbitCircumference * 0.24} ${orbitCircumference * 0.76}`}
              opacity={0.95}
            />
          </Svg>
        </Animated.View>
      ) : null}

      {/* Core One Ring metallic torus */}
      <Animated.View
        style={[styles.centeredLayer, ringAnimatedStyle, { width: size, height: size }]}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <RadialGradient id="oneCoreGlow" cx="50%" cy="46%" r="54%">
              <Stop
                offset="0%"
                stopColor={primaryColor}
                stopOpacity={state === "muted" ? 0.14 : 0.34}
              />
              <Stop offset="58%" stopColor={DRIVE_COLORS.obsidianElevated} stopOpacity={0.94} />
              <Stop offset="100%" stopColor={DRIVE_COLORS.obsidian} stopOpacity={1} />
            </RadialGradient>
            <LinearGradient id="oneRingMetal" x1="12%" y1="8%" x2="88%" y2="92%">
              <Stop
                offset="0%"
                stopColor={DRIVE_COLORS.goldBright}
                stopOpacity={state === "muted" ? 0.45 : 1}
              />
              <Stop offset="48%" stopColor={primaryColor} stopOpacity={1} />
              <Stop offset="100%" stopColor={secondaryColor} stopOpacity={1} />
            </LinearGradient>
          </Defs>

          {/* Obsidian core sphere */}
          <Circle cx={half} cy={half} r={ringRadius - strokeWidth * 0.4} fill="url(#oneCoreGlow)" />

          {/* Outer molten ring */}
          <Circle
            cx={half}
            cy={half}
            r={ringRadius}
            fill="none"
            stroke="url(#oneRingMetal)"
            strokeWidth={strokeWidth}
          />

          {/* Subtle inner bevel highlight */}
          <Circle
            cx={half}
            cy={half}
            r={ringRadius - strokeWidth * 0.48}
            fill="none"
            stroke={DRIVE_COLORS.goldBright}
            strokeWidth={1.25}
            opacity={state === "muted" ? 0.15 : 0.45}
          />
        </Svg>

        {/* Center state glyph for unmistakable glanceability */}
        <View pointerEvents="none" style={styles.centerGlyph}>
          {state === "muted" ? (
            <SymbolView name="slash.circle" size={34} tintColor={DRIVE_COLORS.slateMuted} />
          ) : state === "error" ? (
            <SymbolView name="exclamationmark.triangle" size={34} tintColor={DRIVE_COLORS.danger} />
          ) : state === "idle" ? (
            <SymbolView name="mic" size={34} tintColor={DRIVE_COLORS.goldBright} />
          ) : null}
        </View>
      </Animated.View>
    </View>
  );

  if (!onPress) {
    return orbBody;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? gt("One voice ring, {state}", { state: m(visual.label) })
      }
      accessibilityHint={accessibilityHint ?? m(visual.sublabel)}
      accessibilityState={{ busy: state === "connecting" || state === "thinking" }}
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressablePressed]}
    >
      {orbBody}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressablePressed: {
    opacity: 0.88,
  },
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  centeredLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  rippleRing: {
    position: "absolute",
    borderWidth: 2,
  },
  centerGlyph: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});
