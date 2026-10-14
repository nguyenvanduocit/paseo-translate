import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { fontSize } from "./typography";

type Colors = Record<string, string>;

const CYCLE_MS = 4200;
// Where the cursor ends up: on the Translate button, up and to the left of where it starts.
const CURSOR_TRAVEL = { x: -22, y: -32 };

/** Value of `progress` over one cycle, given as [position in 0..1, value] keyframes. */
function over(progress: Animated.Value, keyframes: [number, number][]) {
  return progress.interpolate({ inputRange: keyframes.map(([at]) => at), outputRange: keyframes.map(([, value]) => value) });
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { alignItems: "center", gap: 6, paddingVertical: 24 },
    art: { width: 240, maxWidth: "100%", paddingTop: 48, paddingBottom: 18, paddingHorizontal: 18, gap: 10, marginBottom: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
    row: { flexDirection: "row", alignItems: "center", gap: 6 },
    line: { height: 8, borderRadius: 4, backgroundColor: colors.surface2 },
    selection: { width: "28%", height: 14, borderRadius: 3, backgroundColor: colors.accent },
    pill: { position: "absolute", top: 14, left: "30%", flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 },
    pillText: { color: colors.foregroundMuted, fontSize: fontSize.sm },
    cursor: { position: "absolute", top: 62, left: "58%" },
    title: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: "600" },
    hint: { color: colors.foregroundMuted, fontSize: fontSize.base, lineHeight: 20, textAlign: "center", maxWidth: 280 },
  });
}

/** Shown before the first lookup: a sketch of the gesture (select, then click the button) and a hint. */
export function EmptyState({ colors }: { colors: Colors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: Platform.OS !== "web" }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);
  // One cycle: the selection fades in, the Translate button appears, the cursor moves onto it and clicks, then everything fades out.
  const selectionOpacity = over(progress, [[0, 0], [0.08, 0], [0.2, 0.45], [0.9, 0.45], [0.97, 0], [1, 0]]);
  const pillOpacity = over(progress, [[0, 0], [0.2, 0], [0.3, 1], [0.9, 1], [0.97, 0], [1, 0]]);
  const pillScale = over(progress, [[0, 1], [0.55, 1], [0.6, 0.92], [0.67, 1], [1, 1]]);
  const cursorOpacity = over(progress, [[0, 0], [0.2, 0], [0.28, 1], [0.9, 1], [0.97, 0], [1, 0]]);
  const cursorX = over(progress, [[0, 0], [0.3, 0], [0.55, CURSOR_TRAVEL.x], [1, CURSOR_TRAVEL.x]]);
  const cursorY = over(progress, [[0, 0], [0.3, 0], [0.55, CURSOR_TRAVEL.y], [1, CURSOR_TRAVEL.y]]);
  return (
    <View style={styles.wrap}>
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.line, { width: "100%" }]} />
        <View style={styles.row}>
          <View style={[styles.line, { width: "30%" }]} />
          <Animated.View style={[styles.selection, { opacity: selectionOpacity }]} />
          <View style={[styles.line, { flex: 1 }]} />
        </View>
        <View style={[styles.line, { width: "72%" }]} />
        <Animated.View style={[styles.pill, { opacity: pillOpacity, transform: [{ scale: pillScale }] }]}>
          <Icon name="Languages" size={14} color={colors.foregroundMuted} />
          <Text style={styles.pillText}>Translate</Text>
        </Animated.View>
        <Animated.View style={[styles.cursor, { opacity: cursorOpacity, transform: [{ translateX: cursorX }, { translateY: cursorY }] }]}>
          <Icon name="MousePointer2" size={18} color={colors.foreground} />
        </Animated.View>
      </View>
      <Text style={styles.title}>Translate as you read</Text>
      <Text style={styles.hint}>Select a word, a phrase or a paragraph in the chat, then click Translate.</Text>
    </View>
  );
}
