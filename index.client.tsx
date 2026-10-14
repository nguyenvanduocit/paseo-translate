import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TranslatePanel, panelTestId } from "./client/TranslatePanel";
import { TranslateSettingsScreen } from "./client/TranslateSettingsScreen";
import { startSelectionListener } from "./client/web";
import type { Candidate } from "./shared/translate";
import { startLookup } from "./client/translator";
import { buildLookupPrompt } from "./shared/rpc";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "translate", title: "Translate", icon: "Languages", context: "workspace", locations: ["explorer"],
    Component: props => <TranslatePanel {...props} onOpenSettings={() => client.openSettings("settings")} />,
  });
  client.addCommandCenterItem({
    id: "open-translate", title: "Open Translate", icon: "Languages", context: "workspace",
    onSelect({ openPanel }) { openPanel("translate", { location: "explorer" }); },
  });
  client.addSettingsScreen({ id: "settings", title: "Translate", icon: "Languages", Component: TranslateSettingsScreen });
  const deps = { paseo: client.paseo, requestPrompt: (candidate: Candidate) => client.rpc(buildLookupPrompt, candidate) };
  return startSelectionListener(request => {
    startLookup(deps, request);
    client.openPanel("translate", { workspaceId: request.workspaceId, location: "explorer" });
  }, { ignoreTestId: panelTestId });
}
