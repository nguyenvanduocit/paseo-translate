import type { PluginServerContext } from "@getpaseo/plugin/server";
import { checkTurn } from "./server/feedback";
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
  // The check runs here, on the host that owns the chat, so it runs once per message however many hosts the app connects to.
  server.on("agent.turn_started", (event, context) =>
    checkTurn(event, context, async () => {
      const current = await settings.read();
      return current.status === "ready" && current.values.feedbackEnabled;
    }),
  );
  return () => {};
}
