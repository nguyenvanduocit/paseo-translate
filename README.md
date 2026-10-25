# Paseo Translate

A [Paseo](https://paseo.sh) plugin that turns selected text into a short English lesson. Select a
word, a phrase or a paragraph in a chat, click **Translate**, and the Explorer panel shows:

- the translation (Vietnamese by default),
- a word-by-word or phrase-by-phrase breakdown with part of speech and notes,
- the grammar at work, explained,
- reusable sentence patterns with examples.

![A sentence result: translation, words and phrases, grammar, patterns](assets/screenshot-sentence.png)

It also checks the English you write. After you send a message in a Claude chat, Claude Haiku reads
it and, if something is off, a line under the message shows your text with each fix marked and a
**Why?** list that explains each one.

`OVERVIEW.md` is the page Paseo shows when you browse plugins. This file covers installing, using and
developing it.

## Requirements

- Paseo daemon and app `0.11.2` or later.
- Plugins enabled on the daemon (`pluginsEnabled` in `config.json`, or **Settings → Plugins → Enable plugins**).
- Web app or desktop app. The native mobile app has no text selection hook, so the button never appears there.
- At least one chat in the workspace. The plugin reads the provider and model from it.

## Install

```bash
paseo plugin install github:nguyenvanduocit/paseo-translate
paseo plugin ls   # translate should be "running"
```

Paste `github:nguyenvanduocit/paseo-translate` into **Settings → Plugins → Plugin source** to install
from the app instead. Update with `paseo plugin update translate`.

## Use

1. Select text in a chat. The button appears when you release the mouse, or the key after a
   Shift+Arrow or Cmd/Ctrl+A selection.
2. Click **Translate**. The Explorer panel opens and fills in as the helper writes: the translation first, then the breakdown, grammar and patterns.
3. The panel shows the latest result for the workspace; the next lookup replaces it. The gear opens the settings.

The result lives in memory and is gone after an app reload. A failed lookup shows its error and a Retry button.

### English feedback

Send a message in a Claude chat as usual. A muted "Checking your English…" line appears under it for
a few seconds. Then:

- the message is fine: the line disappears;
- something is off: the line shows your message with removed words struck through in red and added
  words in green; **Why? · N fixes** opens one explanation per fix, tagged `mistake`, `unnatural` or `tip`;
- the check could not run: the line disappears and the reason goes to `paseo plugin logs translate`.

Checked: top-level Claude chats only. Skipped: subagents and helper agents, chats on other providers,
slash commands, messages under three words, messages that are mostly code, logs or links, and
messages that are mostly not English (Vietnamese, Japanese, and so on). Only the first 1000
characters of a long message are checked, cut at a sentence end.

## Settings

Open **Settings → Plugins → Translate**, or the gear in the panel. The values are stored on the
daemon, so every client of that daemon shares them.

| Setting | What it does |
| --- | --- |
| Translation prompt | The instruction sent to the helper agent. It names the target language. `{{text}}` is the selection and `{{sentence}}` is the text around it. Empty or unchanged means the built-in prompt. |
| Extra instructions | Appended to the end of every prompt, for example "medical context". |
| Check my English | Turns English feedback on or off for the chats of this daemon. On by default. With several hosts, set it on each one. |

The JSON reply format is appended after your prompt on every lookup, so a custom prompt cannot break
the result. To translate into another language, edit the language in the prompt.

## How it works

Each lookup creates a short-lived helper agent in the workspace you selected in. The helper uses the
provider and model of the workspace's most recent chat, receives the selection and up to 400
characters around it, and replies with JSON that the panel renders. Paseo archives the helper after
its first answer. See [docs/design.md](docs/design.md) for the decisions behind this.

English feedback runs in the daemon, not the app, so it fires once per message on the host that owns
the chat however many hosts the app is connected to. On `agent.turn_started` the plugin reads the
user's message from the timeline, writes a `checking` row (kind `english-feedback`, version 1) right
under it, and asks a helper subagent on `claude/claude-haiku-5-5` for JSON: `{ ok, corrected, issues }`.
It then replaces the row, keyed by the message id, with `fine`, `corrected` or `unchecked`. The app
diffs the original against the corrected text word by word; the model never writes the markup. The
helper starts with `--strict-mcp-config` (the Claude provider option `extraArgs`), so it skips the
project's MCP servers, which can hold a session for 30 seconds before its first turn. It has 25
seconds, inside Paseo's 30 second hook limit, and is archived when it finishes or
times out. The spike behind this design is in [docs/feedback-spike.md](docs/feedback-spike.md).

## Known limits

- A lookup takes roughly 10 to 25 seconds, because each one is a full agent turn. The result starts to appear after about 5.
- Archived helpers stay in `~/.paseo/agents` and in the provider's session list. The plugin API has
  no delete call. `paseo ls -a -g --label paseo-translate=1` lists them and `paseo delete <id>` removes one.
- Helpers are told not to use tools. That is an instruction, not an enforced restriction.
- Selections over 5000 characters are ignored.
- English feedback sends the message text to Claude Haiku on the host that owns the chat.
- A message steered into a turn that is still running starts no new turn, so it is not checked.
- Feedback rows live in the daemon's memory and are gone after a daemon restart or an agent reload
  (`paseo agent reload`); the message is not checked again. If the plugin is removed, or the host
  goes back to a version without English feedback, earlier rows show Paseo's "Plugin timeline item
  unavailable" placeholder.
- The helper runs in the chat's directory, so it loads that project's Claude Code hooks and
  `CLAUDE.md`, but not its MCP servers (`--strict-mcp-config`). A project whose hooks take most of the
  25 second budget leaves too little time for the check; that message then gets no feedback.
- The workspace id comes from the app's route (`/workspace/<id>`). A route change in Paseo breaks the
  button until `workspaceIdFromLocation` in `client/web.ts` is updated.

## Development

```bash
git clone https://github.com/nguyenvanduocit/paseo-translate.git
cd paseo-translate
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"      # install from the working copy
paseo plugin reload translate    # after each source edit; never restart the daemon
paseo plugin logs translate
```

`npm test` runs the pure logic in `shared/` (selection rules, prompt building, reply parsing, inline
markup, which messages get English feedback, the feedback prompt and reply parser, and the word diff)
with Node's test runner. The UI is checked by hand; the checklist is in
[docs/design.md](docs/design.md#testing).

| Path | Runs in | Contents |
| --- | --- | --- |
| `index.client.tsx` | App | Registers the panel, settings screen, Command Center item and selection listener. |
| `index.server.ts` | Daemon | Registers the settings document, the `translate.prompt` RPC and the English feedback hook. |
| `server/feedback.ts` | Daemon | Reads the new message, runs the Haiku helper and writes the feedback row. |
| `client/FeedbackRow.tsx` | App | Renders the feedback row under a message. |
| `client/web.ts` | App (web only) | Selection listener and floating button. The only file that touches browser APIs. |
| `client/translator.ts` | App | Creates the helper agent and settles a lookup. |
| `client/TranslatePanel.tsx`, `client/ResultView.tsx`, `client/EmptyState.tsx` | App | The panel with its donate, Discord and settings buttons, the result renderer, and the empty-state illustration. |
| `client/TranslateSettingsScreen.tsx` | App | Settings screen. |
| `client/links.ts`, `client/DiscordIcon.tsx` | App | The donate and Discord URLs, and the Discord logo as an SVG image. |
| `client/lookups.ts` | App | In-memory store of the latest lookup per workspace. |
| `shared/translate.ts` | Both | Selection rules, prompt, reply schema and parser. |
| `shared/settings.ts`, `shared/rpc.ts`, `shared/rich-text.ts` | Both | Settings document, RPC contract, `**bold**` and `` `code` `` parser. |
| `shared/feedback-rules.ts`, `shared/feedback.ts`, `shared/word-diff.ts` | Both | Which messages are checked, the feedback prompt, reply and row schemas, and the word diff. |

Run this audit before a change that touches `client/`. A hit outside `client/web.ts` is a bug; the
three hits that are TypeScript generics such as `ReturnType<typeof …>` are not HTML.

```bash
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

## Support and community

Translate is free and open source. If it helps your learning, you can [donate via PayPal](https://paypal.me/duocnguyen). To ask questions, report problems or share ideas, [join the Discord](https://discord.gg/W2c3TgQXS). Both links are also in the panel's top bar and the plugin's settings screen.

## License

[MIT](LICENSE)
