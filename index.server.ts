import type { PluginServerContext } from "@getpaseo/plugin/server";
import { buildLookupPrompt } from "./shared/rpc";
import { translateSettings } from "./shared/settings";
import { buildPrompt } from "./shared/translate";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(translateSettings);
  server.handle(buildLookupPrompt, async candidate => {
    const current = await settings.read();
    if (current.status !== "ready") throw new Error(`Translate settings are invalid: ${current.error}`);
    return { prompt: buildPrompt(candidate, current.values) };
  });
  return () => {};
}
