import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { parseInline } from "../shared/rich-text";
import type { Translation } from "../shared/translate";

type Theme = { colors: Record<string, string> };

/** Text with `**bold**` and `` `code` `` rendered. */
function Rich({ children, style, codeStyle }: { children: string; style: TextStyle; codeStyle: TextStyle }) {
  return (
    <Text selectable style={style}>
      {parseInline(children).map((span, index) => (
        <Text key={index} style={span.code ? codeStyle : span.bold ? { fontWeight: "700" } : undefined}>{span.text}</Text>
      ))}
    </Text>
  );
}

function Section({ title, styles, children }: { title: string; styles: ReturnType<typeof createStyles>; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function createStyles(theme: Theme, short: boolean) {
  const c = theme.colors;
  return StyleSheet.create({
    translation: short
      ? { color: c.foreground, fontSize: 16, fontWeight: "600" }
      : { color: c.foreground, fontSize: 15, lineHeight: 22 },
    section: { gap: 8, paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: c.border },
    sectionTitle: { color: c.foregroundMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
    item: { gap: 2 },
    line: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
    term: { color: c.foreground, fontSize: 14, fontWeight: "600" },
    tag: { color: c.foregroundMuted, fontSize: 12, fontStyle: "italic" },
    body: { color: c.foreground, fontSize: 14, lineHeight: 20 },
    muted: { color: c.foregroundMuted, fontSize: 13, lineHeight: 19 },
    example: { color: c.foregroundMuted, fontSize: 13, lineHeight: 19, fontStyle: "italic" },
    code: { backgroundColor: c.surface2, color: c.foreground, fontFamily: "monospace", fontSize: 13 },
    pattern: { alignSelf: "flex-start", backgroundColor: c.surface2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    patternText: { color: c.foreground, fontFamily: "monospace", fontSize: 13 },
  });
}

/** The parts of a lookup result below the card header: translation, then each non-empty teaching section. */
export function ResultView({ result, short, theme }: { result: Translation; short: boolean; theme: Theme }) {
  const styles = useMemo(() => createStyles(theme, short), [theme, short]);
  const rich = (value: string, style: TextStyle) => <Rich style={style} codeStyle={styles.code}>{value}</Rich>;
  return (
    <>
      {rich(result.translation, styles.translation)}
      {result.breakdown.length > 0 ? (
        <Section title="Words & phrases" styles={styles}>
          {result.breakdown.map((item, index) => (
            <View key={index} style={styles.item}>
              <View style={styles.line}>
                <Text selectable style={styles.term}>{item.term}</Text>
                {item.partOfSpeech ? <Text style={styles.tag}>{item.partOfSpeech}</Text> : null}
              </View>
              {rich(item.meaning, styles.body)}
              {item.note ? rich(item.note, styles.muted) : null}
            </View>
          ))}
        </Section>
      ) : null}
      {result.grammar.length > 0 ? (
        <Section title="Grammar" styles={styles}>
          {result.grammar.map((item, index) => (
            <View key={index} style={styles.item}>
              <Text selectable style={styles.term}>{item.point}</Text>
              {rich(item.explanation, styles.body)}
            </View>
          ))}
        </Section>
      ) : null}
      {result.patterns.length > 0 ? (
        <Section title="Patterns" styles={styles}>
          {result.patterns.map((item, index) => (
            <View key={index} style={styles.item}>
              <View style={styles.pattern}><Text selectable style={styles.patternText}>{item.pattern}</Text></View>
              {item.meaning ? rich(item.meaning, styles.body) : null}
              {item.example ? rich(item.example, styles.example) : null}
            </View>
          ))}
        </Section>
      ) : null}
      {result.examples.length > 0 ? (
        <Section title="Examples" styles={styles}>
          {result.examples.map((example, index) => <View key={index}>{rich(example, styles.example)}</View>)}
        </Section>
      ) : null}
    </>
  );
}
