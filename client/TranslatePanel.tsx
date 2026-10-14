import { usePaseo, useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState } from "./EmptyState";
import { FadeIn } from "./FadeIn";
import { LoadingState } from "./LoadingState";
import { ResultView } from "./ResultView";
import { fontSize } from "./typography";
import { useLatestLookup, type Lookup } from "./lookups";
import { buildLookupPrompt } from "../shared/rpc";
import { retryLookup, type TranslatorDeps } from "./translator";

type Theme = PluginWorkspacePanelProps["theme"];


function createStyles(theme: Theme, compact: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: compact ? 12 : 16, gap: compact ? 8 : 12 },
    bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: compact ? 12 : 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    barLabel: { color: theme.colors.foregroundMuted, fontSize: fontSize.base },
    iconButton: { padding: 6, borderRadius: 6 },
    head: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
    thread: { gap: 12, borderLeftWidth: 3, borderLeftColor: theme.colors.accent, paddingLeft: 12, paddingVertical: 2 },
    original: { color: theme.colors.foreground, fontSize: fontSize.lg, fontWeight: "600", lineHeight: 24 },
    word: { color: theme.colors.foreground, fontSize: fontSize.xl, fontWeight: "600" },
    pos: { color: theme.colors.foregroundMuted, fontSize: fontSize.base, fontStyle: "italic" },
    error: { color: theme.colors.statusDanger, fontSize: fontSize.base },
    retry: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.accent },
    retryText: { color: theme.colors.accentForeground, fontSize: fontSize.base },
  });
}

// A word or short phrase shows the word with its pronunciation; anything longer shows its original (up to four lines) above the translation.
const isShort = (text: string) => text.length <= 40 && text.split(/\s+/).length <= 2;

function Result({ lookup, deps, styles, theme }: { lookup: Lookup; deps: TranslatorDeps; styles: ReturnType<typeof createStyles>; theme: Theme }) {
  const { translation } = lookup;
  const short = isShort(lookup.text);
  return (
    <>
      <View style={styles.thread}>
        {short ? (
          <View style={styles.head}>
            <Text style={styles.word}>{lookup.text}</Text>
            {translation?.pronunciation ? <Text style={styles.pos}>{translation.pronunciation}</Text> : null}
          </View>
        ) : (
          <Text numberOfLines={4} style={styles.original}>{lookup.text}</Text>
        )}
      </View>
      {translation ? <FadeIn gap={styles.content.gap}><ResultView result={translation} short={short} theme={theme} /></FadeIn> : null}
      {lookup.status === "loading" ? <LoadingState colors={theme.colors} waiting={!translation} /> : null}
      {lookup.status === "error" ? (
        <FadeIn gap={styles.content.gap}>
          <Text style={styles.error}>{lookup.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Retry translating ${lookup.text}`} onPress={() => retryLookup(deps, lookup.id)} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </FadeIn>
      ) : null}
    </>
  );
}

// On web `testID` becomes `data-testid`, which `web.ts` uses to leave text selected in this panel alone.
export const panelTestId = "translate-panel";

export function TranslatePanel({ theme, layout, onOpenSettings, workspaceId }: PluginWorkspacePanelProps & { onOpenSettings: () => void }) {
  const lookup = useLatestLookup(workspaceId);
  const paseo = usePaseo();
  const requestPrompt = useRpc(buildLookupPrompt);
  const deps = useMemo(() => ({ paseo, requestPrompt }), [paseo, requestPrompt]);
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  return (
    <View testID={panelTestId} style={styles.screen}>
      <View style={styles.bar}>
        <Text style={styles.barLabel}>Translate</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Translate settings" onPress={onOpenSettings} style={styles.iconButton}>
          <Icon name="Settings" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {lookup ? <Result lookup={lookup} deps={deps} styles={styles} theme={theme} /> : <EmptyState colors={theme.colors} />}
      </ScrollView>
    </View>
  );
}
