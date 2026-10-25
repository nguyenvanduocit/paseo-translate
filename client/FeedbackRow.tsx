import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { FeedbackIssue, FeedbackRowData } from "../shared/feedback";
import { wordDiff } from "../shared/word-diff";
import { fontSize } from "./typography";

type Props = PluginTimelineItemProps<FeedbackRowData>;
type Theme = Props["theme"];
type Corrected = Extract<FeedbackRowData, { state: "corrected" }>;

const PULSE_MS = 700;

// Host layout this row is placed against, measured in the Paseo 0.13.0 web client at desktop width and at 390 px
// (dark and light): under the bubble the user's timeline item has its message action row (timestamp, rewind, copy:
// 8 px margin, 24 px tall, 107 to 109 px wide, right-aligned with the bubble; hidden until hover on desktop, always
// shown on a phone), then the host leaves 16 px before the next timeline item, this row. The row moves up over that
// space to sit just under the bubble. Its first line shares the action row's band, so it keeps clear of the action
// row's width; lines below the band use the full width. After a Paseo update, re-measure the bubble's bottom, the
// action row's box and this row's top, and update these numbers.
const hostItemSpacing = 16;
const hostActionRowBand = 8 + 24;
// 109 px measured for "9:59 PM", plus room for a two-digit hour and an 8 px gap.
const actionRowClearance = 128;
const gapUnderBubble = 10;

function createStyles({ colors }: Theme, compact: boolean) {
  const size = compact ? fontSize.sm : fontSize.base - 1;
  return StyleSheet.create({
    // Right-aligned like the user's bubble above it, so it reads as part of the message, not of the reply. The row's
    // own box reaches into the action row's band, so only its children take touches and the buttons stay clickable.
    row: {
      alignSelf: "flex-end",
      maxWidth: "100%",
      marginTop: gapUnderBubble - hostItemSpacing - hostActionRowBand,
      marginHorizontal: compact ? 2 : 4,
      gap: 4,
      pointerEvents: "box-none",
    },
    // The first line sits beside the action row, never under it.
    firstLine: { marginRight: actionRowClearance },
    muted: { color: colors.foregroundMuted, fontSize: size, lineHeight: size + 7 },
    diff: { color: colors.foreground, fontSize: size, lineHeight: size + 7 },
    pen: { color: colors.accent },
    del: { color: colors.statusDanger, textDecorationLine: "line-through" },
    ins: { color: colors.statusSuccess },
    toggle: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 2 },
    toggleText: { color: colors.accent, fontSize: size - 0.5 },
    notes: { gap: compact ? 6 : 8, marginTop: 4 },
    note: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: compact ? 8 : 10, paddingVertical: 1 },
    noteHead: { color: colors.foreground, fontSize: size, lineHeight: size + 6 },
    tag: { color: colors.foregroundMuted, fontSize: fontSize.sm - 2, letterSpacing: 0.5 },
    change: { color: colors.foreground, fontWeight: "600" },
    explanation: { color: colors.foregroundMuted, fontSize: size, lineHeight: size + 6, marginTop: 1 },
  });
}

const useStyles = (theme: Theme, compact: boolean) => useMemo(() => createStyles(theme, compact), [theme, compact]);

const tagColor = (tag: FeedbackIssue["tag"], theme: Theme) =>
  tag === "mistake" ? theme.colors.statusDanger : tag === "unnatural" ? theme.colors.statusWarning : theme.colors.border;

/** The muted line shown while Haiku works, pulsing so it reads as pending. */
function Checking({ theme, compact }: { theme: Theme; compact: boolean }) {
  const styles = useStyles(theme, compact);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const native = Platform.OS !== "web";
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: native }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: native }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);
  return (
    <Animated.View style={[styles.row, { opacity }]} accessibilityRole="progressbar" accessibilityLabel="Checking your English">
      <Text style={[styles.muted, styles.firstLine]}>
        <Text style={styles.pen}>✎ </Text>Checking your English…
      </Text>
    </Animated.View>
  );
}

/** The learner's text with each fix marked, then the reasons one press away. */
function Correction({ data, theme, compact }: { data: Corrected; theme: Theme; compact: boolean }) {
  const styles = useStyles(theme, compact);
  const [open, setOpen] = useState(false);
  const segments = useMemo(() => wordDiff(data.original, data.corrected), [data.original, data.corrected]);
  const count = data.issues.length;
  return (
    <View style={styles.row}>
      <Text style={[styles.diff, styles.firstLine]} selectable>
        <Text style={styles.pen}>✎ </Text>
        {segments.map((segment, index) => (
          <Fragment key={index}>
            <Text style={segment.kind === "del" ? styles.del : segment.kind === "ins" ? styles.ins : undefined}>{segment.text}</Text>
            {/* A thin space keeps "go" and "went" apart; it is drawn only, never part of either text. */}
            {segment.kind === "del" && segments[index + 1]?.kind === "ins" ? "\u2009" : null}
          </Fragment>
        ))}
        {data.truncated ? <Text style={styles.muted}> …</Text> : null}
      </Text>
      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${open ? "Hide" : "Show"} why, ${count} ${count === 1 ? "fix" : "fixes"}`}
          onPress={() => setOpen(value => !value)}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>
            {open ? "▾" : "▸"} Why? · {count} {count === 1 ? "fix" : "fixes"}
          </Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.notes}>
          {data.issues.map((issue, index) => (
            <View key={index} style={[styles.note, issue.tag !== "tip" && { borderLeftColor: tagColor(issue.tag, theme) }]}>
              <Text style={styles.noteHead}>
                <Text style={[styles.tag, issue.tag !== "tip" && { color: tagColor(issue.tag, theme) }]}>{issue.tag.toUpperCase()}  </Text>
                <Text style={styles.change}>
                  {issue.original} → {issue.replacement || "(remove)"}
                </Text>
              </Text>
              <Text style={styles.explanation}>{issue.explanation}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The row under a user message: a pending line, a correction, or nothing when the message is fine or was not checked. */
export function FeedbackRow({ item: { data }, theme, layout }: Props) {
  if (data.state === "checking") return <Checking theme={theme} compact={layout.compact} />;
  if (data.state === "corrected") return <Correction data={data} theme={theme} compact={layout.compact} />;
  return null;
}
