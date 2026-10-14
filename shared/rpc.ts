import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The daemon holds the host's settings, so it assembles the prompt for a lookup.
export const buildLookupPrompt = defineRpc({
  name: "translate.prompt",
  input: z.object({ text: z.string().min(1), sentence: z.string().min(1) }),
  output: z.object({ prompt: z.string() }),
});
