import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { translateSettings, type TranslateSettings } from "../shared/settings";
import { defaultPromptTemplate } from "../shared/translate";
import { fontSize } from "./typography";

type Ready = Extract<SettingsState<typeof translateSettings.schema>, { status: "ready" }>;
type Theme = PluginSurfaceProps["theme"];

// The editor shows the built-in template as editable text; storing it unchanged means "use the default".
const toDraft = (values: TranslateSettings): TranslateSettings => ({ ...values, promptTemplate: values.promptTemplate || defaultPromptTemplate });
const toStored = (values: TranslateSettings): TranslateSettings => ({ ...values, promptTemplate: values.promptTemplate.trim() === defaultPromptTemplate ? "" : values.promptTemplate });
const same = (a: TranslateSettings, b: TranslateSettings) =>
  a.promptTemplate === b.promptTemplate && a.extraInstructions === b.extraInstructions;

function Editor({ settings, theme }: { settings: Ready; theme: Theme }) {
  // The draft keeps the revision it started from, so another client's save shows up as a conflict.
  const [draft, setDraft] = useState(() => ({ values: toDraft(settings.values), revision: settings.revision }));
  const justSaved = useRef(false);
  const dirty = !same(toStored(draft.values), settings.values);
  const styles = useMemo(
    () => StyleSheet.create({
      block: { padding: 16, gap: 8 },
      heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
      label: { color: theme.colors.foreground, fontSize: fontSize.content },
      hint: { color: theme.colors.foregroundMuted, fontSize: fontSize.base, lineHeight: 20 },
      input: { color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSize.base, lineHeight: 20, textAlignVertical: "top" },
      link: { color: theme.colors.foregroundMuted, fontSize: fontSize.base },
      footer: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
      save: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.colors.accent },
      saveText: { color: theme.colors.accentForeground, fontSize: fontSize.base, fontWeight: "600" },
      status: { color: theme.colors.foregroundMuted, fontSize: fontSize.base },
      error: { color: theme.colors.statusDanger, fontSize: fontSize.base },
    }),
    [theme],
  );

  // After our own save the next save builds on the new revision.
  useEffect(() => {
    if (!justSaved.current) return;
    justSaved.current = false;
    setDraft(current => ({ ...current, revision: settings.revision }));
  }, [settings.revision]);

  const change = (patch: Partial<TranslateSettings>) => setDraft(current => ({ ...current, values: { ...current.values, ...patch } }));
  const save = async () => {
    justSaved.current = true;
    if (!(await settings.save(toStored(draft.values), draft.revision))) justSaved.current = false;
  };
  const discard = () => setDraft({ values: toDraft(settings.values), revision: settings.revision });
  const canSave = dirty && !settings.saving;

  return (
    <>
      <SettingsSection title="Prompt">
        <SettingsCard>
          <View style={styles.block}>
            <View style={styles.heading}>
              <Text style={styles.label}>Translation prompt</Text>
              {draft.values.promptTemplate !== defaultPromptTemplate ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Restore default prompt" onPress={() => change({ promptTemplate: defaultPromptTemplate })}>
                  <Text style={styles.link}>Restore default</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.hint}>Variables: {"{{text}}"} (the selected text) and {"{{sentence}}"} (the text around it). The target language is part of this prompt. The JSON reply format is always appended.</Text>
            <TextInput
              multiline
              accessibilityLabel="Translation prompt"
              value={draft.values.promptTemplate}
              editable={!settings.saving}
              onChangeText={promptTemplate => change({ promptTemplate })}
              style={[styles.input, { minHeight: 220 }]}
            />
          </View>
          <View style={styles.block}>
            <Text style={styles.label}>Extra instructions</Text>
            <Text style={styles.hint}>Appended to the end of the prompt. For example: "medical context", "prefer common senses".</Text>
            <TextInput
              multiline
              accessibilityLabel="Extra instructions"
              value={draft.values.extraInstructions}
              editable={!settings.saving}
              onChangeText={extraInstructions => change({ extraInstructions })}
              style={[styles.input, { minHeight: 72 }]}
            />
          </View>
        </SettingsCard>
      </SettingsSection>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={save} style={[styles.save, !canSave && { opacity: 0.4 }]}>
          <Text style={styles.saveText}>{settings.saving ? "Saving…" : "Save"}</Text>
        </Pressable>
        {dirty && !settings.saving ? (
          <Pressable accessibilityRole="button" onPress={discard}>
            <Text style={styles.link}>Discard changes</Text>
          </Pressable>
        ) : null}
        {!dirty && !settings.saveError ? <Text style={styles.status}>Saved</Text> : null}
        {settings.saveError ? <Text accessibilityRole="alert" style={styles.error}>{settings.saveError}</Text> : null}
      </View>
    </>
  );
}

export function TranslateSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(translateSettings);
  const message = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  if (settings.status === "loading") return <Text style={message}>Loading settings…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Translate">
        <Text accessibilityRole="alert" style={message}>{settings.error}</Text>
        <SettingsAction label="Settings failed to load" actionLabel="Reload" onPress={settings.reload} />
        {settings.status === "invalid" ? <SettingsAction label="Restore default settings" actionLabel="Reset" onPress={settings.reset} /> : null}
      </SettingsSection>
    );
  }
  return <Editor settings={settings} theme={theme} />;
}
