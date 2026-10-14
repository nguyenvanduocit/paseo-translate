import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { fontSize } from "./typography";

type Colors = Record<string, string>;

function createStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { alignItems: "center", gap: 6, paddingVertical: 24 },
    art: { width: 240, maxWidth: "100%", paddingTop: 48, paddingBottom: 18, paddingHorizontal: 18, gap: 10, marginBottom: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
    row: { flexDirection: "row", alignItems: "center", gap: 6 },
    line: { height: 8, borderRadius: 4, backgroundColor: colors.surface2 },
    selection: { width: "28%", height: 14, borderRadius: 3, backgroundColor: colors.accent, opacity: 0.45 },
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
  return (
    <View style={styles.wrap}>
      <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.line, { width: "100%" }]} />
        <View style={styles.row}>
          <View style={[styles.line, { width: "30%" }]} />
          <View style={styles.selection} />
          <View style={[styles.line, { flex: 1 }]} />
        </View>
        <View style={[styles.line, { width: "72%" }]} />
        <View style={styles.pill}>
          <Icon name="Languages" size={14} color={colors.foregroundMuted} />
          <Text style={styles.pillText}>Translate</Text>
        </View>
        <View style={styles.cursor}>
          <Icon name="MousePointer2" size={18} color={colors.foreground} />
        </View>
      </View>
      <Text style={styles.title}>Translate as you read</Text>
      <Text style={styles.hint}>Select a word, a phrase or a paragraph in the chat, then click Translate.</Text>
    </View>
  );
}
