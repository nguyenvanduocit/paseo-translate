import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createFeedbackChecks } from "./server/feedback";
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
  // The checks run here, on the host that owns the chat, so they run once per message however many hosts the app connects to.
  const feedback = createFeedbackChecks(async () => {
    const current = await settings.read();
    return current.status === "ready" && current.values.feedbackEnabled;
  });
  server.on("agent.turn_started", (event, context) => feedback.turnStarted(event, context));
  server.on("agent.turn_ended", (event, context) => feedback.turnEnded(event, context));
  server.on("agent.closed", ({ agent }) => feedback.forget(agent.id));
  server.on("agent.archived", ({ agent }) => feedback.forget(agent.id));
  return () => feedback.stop();
}
