import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { fontSize } from "./typography";

type Colors = Record<string, string>;

const CYCLE_MS = 2600;
// A lookup is a full agent turn and often takes 10 to 25 seconds; after this long the status line says so.
const SLOW_AFTER_MS = 6000;
const BADGE = 28;

/** Value of `progress` over one cycle, given as [position in 0..1, value] keyframes. */
function over(progress: Animated.Value, keyframes: [number, number][]) {
  return progress.interpolate({ inputRange: keyframes.map(([at]) => at), outputRange: keyframes.map(([, value]) => value) });
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", gap: 10 },
    badgeSlot: { width: BADGE, height: BADGE, alignItems: "center", justifyContent: "center" },
    ring: { position: "absolute", width: BADGE, height: BADGE, borderRadius: BADGE / 2, borderWidth: 1.5, borderColor: colors.accent },
    badge: { width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
    status: { flex: 1, color: colors.foregroundMuted, fontSize: fontSize.base },
  });
}

/**
 * Shown while a lookup is pending, below whatever has streamed in so far: a badge sending out ripples beside a status
 * line. `waiting` is true until the first of the reply arrives; only then does the line say how long this can take.
 */
export function LoadingState({ colors, waiting }: { colors: Colors; waiting: boolean }) {
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

  // Two ripples half a cycle apart: the second starts mid-way through its growth and wraps around once.
  const ringA = { opacity: over(progress, [[0, 0.5], [1, 0]]), transform: [{ scale: over(progress, [[0, 1], [1, 1.8]]) }] };
  const ringB = {
    opacity: over(progress, [[0, 0.25], [0.5, 0], [0.5001, 0.5], [1, 0.25]]),
    transform: [{ scale: over(progress, [[0, 1.4], [0.5, 1.8], [0.5001, 1], [1, 1.4]]) }],
  };
  const badgeScale = over(progress, [[0, 1], [0.25, 1.08], [0.5, 1], [0.75, 1.08], [1, 1]]);

  return (
    <View style={styles.header} accessibilityRole="progressbar" accessibilityLabel="Translating">
      <View style={styles.badgeSlot}>
        <Animated.View style={[styles.ring, ringA]} />
        <Animated.View style={[styles.ring, ringB]} />
        <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }] }]}>
          <Icon name="Languages" size={16} color={colors.foreground} />
        </Animated.View>
      </View>
      <Text style={styles.status}>{slow && waiting ? "Still translating, this can take up to 30 seconds…" : "Translating…"}</Text>
    </View>
  );
}
