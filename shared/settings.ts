import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const maxPromptTemplateLength = 4000;
export const maxExtraInstructionsLength = 2000;

export const translateSettingsSchema = z.object({
  // Empty means the built-in template.
  promptTemplate: z.string().max(maxPromptTemplateLength).default(""),
  extraInstructions: z.string().max(maxExtraInstructionsLength).default(""),
});
export type TranslateSettings = z.infer<typeof translateSettingsSchema>;

export const defaultSettings: TranslateSettings = translateSettingsSchema.parse({});

export const translateSettings = defineSettings({
  id: "translate",
  scope: "host",
  version: 1,
  schema: translateSettingsSchema,
});
