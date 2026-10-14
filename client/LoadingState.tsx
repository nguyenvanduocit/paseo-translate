import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { fontSize } from "./typography";

type Colors = Record<string, string>;

const CYCLE_MS = 1600;
// A lookup is a full agent turn and often takes 10 to 25 seconds; after this long the status line says so.
const SLOW_AFTER_MS = 6000;
// Each bar brightens for half a cycle, `PHASE_STEP` after the bar above it, so a wave runs down the skeleton.
const PHASE_STEP = 0.07;

// The skeleton mirrors a result: translation, then a section title and two items. Widths are percentages of the panel.
const BARS: { width: `${number}%`; height: number; gap?: number }[] = [
  { width: "92%", height: 14 },
  { width: "64%", height: 14 },
  { width: "26%", height: 9, gap: 14 },
  { width: "38%", height: 11 },
  { width: "84%", height: 9 },
  { width: "30%", height: 11, gap: 6 },
  { width: "70%", height: 9 },
];

function createStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { gap: 10, paddingTop: 4 },
    status: { flexDirection: "row", alignItems: "center", gap: 8 },
    statusText: { color: colors.foregroundMuted, fontSize: fontSize.base },
    bar: { borderRadius: 4, backgroundColor: colors.surface2 },
  });
}

function Wave({ progress, phase, style, children }: { progress: Animated.Value; phase: number; style?: object; children?: ReactNode }) {
  const opacity = progress.interpolate({
    inputRange: [0, phase, phase + 0.25, phase + 0.5, 1],
    outputRange: [0.3, 0.3, 1, 0.3, 0.3],
  });
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

/** Shown while a lookup is pending: a skeleton shaped like the result, pulsing in a wave, under a "Translating" line. */
export function LoadingState({ colors }: { colors: Colors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progress = useRef(new Animated.Value(0)).current;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel="Translating">
      <View style={styles.status}>
        <Wave progress={progress} phase={0}>
          <Icon name="Languages" size={16} color={colors.foregroundMuted} />
        </Wave>
        <Text style={styles.statusText}>{slow ? "Still translating, this can take up to 30 seconds…" : "Translating…"}</Text>
      </View>
      {BARS.map((bar, index) => (
        <Wave
          key={index}
          progress={progress}
          phase={PHASE_STEP * (index + 1)}
          style={[styles.bar, { width: bar.width, height: bar.height, marginTop: bar.gap ?? 0 }]}
        />
      ))}
    </View>
  );
}
