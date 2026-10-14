import { usePaseo, useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ResultView } from "./ResultView";
import { fontSize } from "./typography";
import { clearLookups, removeLookup, useLookups, type Lookup } from "./lookups";
import { buildLookupPrompt } from "../shared/rpc";
import { retryLookup, type TranslatorDeps } from "./translator";

type Theme = PluginWorkspacePanelProps["theme"];


function createStyles(theme: Theme, compact: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: compact ? 12 : 16, gap: compact ? 8 : 12 },
    empty: { color: theme.colors.foregroundMuted, fontSize: fontSize.base },
    card: { padding: compact ? 12 : 14, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
    bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: compact ? 12 : 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    barLabel: { color: theme.colors.foregroundMuted, fontSize: fontSize.base },
    barActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    iconButton: { padding: 6, borderRadius: 6 },
    link: { color: theme.colors.foregroundMuted, fontSize: fontSize.base, paddingVertical: 4, paddingHorizontal: 8 },
    top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
    head: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
    original: { color: theme.colors.foreground, fontSize: fontSize.content, lineHeight: 22, flex: 1 },
    word: { color: theme.colors.foreground, fontSize: fontSize.xl, fontWeight: "600" },
    pos: { color: theme.colors.foregroundMuted, fontSize: fontSize.base, fontStyle: "italic" },
    error: { color: theme.colors.statusDanger, fontSize: fontSize.base },
    retry: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.accent },
    retryText: { color: theme.colors.accentForeground, fontSize: fontSize.base },
  });
}

// A word or short phrase gets a dictionary card; anything longer shows its original (up to four lines) above the translation.
const isShort = (text: string) => text.length <= 40 && text.split(/\s+/).length <= 2;

function Card({ lookup, deps, styles, theme }: { lookup: Lookup; deps: TranslatorDeps; styles: ReturnType<typeof createStyles>; theme: Theme }) {
  const { translation } = lookup;
  const short = isShort(lookup.text);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {short ? (
          <View style={styles.head}>
            <Text style={styles.word}>{lookup.text}</Text>
            {translation?.pronunciation ? <Text style={styles.pos}>{translation.pronunciation}</Text> : null}
          </View>
        ) : (
          <Text numberOfLines={4} style={styles.original}>{lookup.text}</Text>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${lookup.text}`} onPress={() => removeLookup(lookup.id)} hitSlop={8}>
          <Text style={styles.link}>✕</Text>
        </Pressable>
      </View>
      {lookup.status === "loading" ? <ActivityIndicator color={theme.colors.foregroundMuted} style={{ alignSelf: "flex-start" }} /> : null}
      {translation ? <ResultView result={translation} short={short} theme={theme} /> : null}
      {lookup.status === "error" ? (
        <>
          <Text style={styles.error}>{lookup.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Retry translating ${lookup.text}`} onPress={() => retryLookup(deps, lookup.id)} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

// On web `testID` becomes `data-testid`, which `web.ts` uses to leave text selected in this panel alone.
export const panelTestId = "translate-panel";

export function TranslatePanel({ theme, layout, workspaceId, onOpenSettings }: PluginWorkspacePanelProps & { onOpenSettings: () => void }) {
  const lookups = useLookups();
  const paseo = usePaseo();
  const requestPrompt = useRpc(buildLookupPrompt);
  const deps = useMemo(() => ({ paseo, requestPrompt }), [paseo, requestPrompt]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const visible = useMemo(() => lookups.filter(lookup => lookup.workspaceId === workspaceId), [lookups, workspaceId]);
  const barLabel = visible.length === 0 ? "Translate" : `${visible.length} ${visible.length === 1 ? "word" : "words"}`;
  return (
    <View testID={panelTestId} style={styles.screen}>
      <View style={styles.bar}>
        <Text style={styles.barLabel}>{barLabel}</Text>
        <View style={styles.barActions}>
          {visible.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear all" onPress={() => clearLookups(workspaceId)} style={styles.iconButton}>
              <Icon name="Trash2" size={16} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Translate settings" onPress={onOpenSettings} style={styles.iconButton}>
            <Icon name="Settings" size={16} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {visible.length === 0 ? <Text style={styles.empty}>Select one or two words in the chat, then click Translate.</Text> : null}
        {visible.map(lookup => <Card key={lookup.id} lookup={lookup} deps={deps} styles={styles} theme={theme} />)}
      </ScrollView>
    </View>
  );
}
