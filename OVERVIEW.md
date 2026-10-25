Translate turns text you select in a Paseo chat into a short English lesson. Select a word, a phrase or a whole paragraph, click the Translate button that appears next to it, and the Explorer panel fills in with the Vietnamese translation, a word-by-word or phrase-by-phrase breakdown, the grammar at work, and sentence patterns you can reuse.

Translate also checks the English of what you write. After you send a message in a Claude chat, a line appears right under it while Claude Haiku reads it. If the message is fine, the line disappears. If something is off, it becomes your message with each fix marked: removed words in red and struck through, added words in green. A "Why?" link opens one short explanation per fix, tagged as a mistake, an unnatural phrasing or a tip.

Each lookup runs on a helper agent that Paseo creates in the same workspace, using the provider and model of your most recent chat there. The helper answers in structured JSON, which the panel renders as sections. The plugin sends it the selected text and up to 400 characters around it, and nothing else from the conversation. Helpers archive themselves after one answer.

The plugin works in the web app and the desktop app. The native mobile app has no text selection hook, so the button does not appear there. Your workspace needs at least one chat so the plugin can read a provider from it.

The English check runs on the daemon that owns the chat, as a helper subagent under it, on that host's own Claude account with the model claude-haiku-5-5. It sends the text of your message (up to its first 1000 characters, cut at a sentence end) to Claude Haiku on that host, and nothing else from the conversation. It checks only your own top-level Claude chats. It skips slash commands, messages under three words, messages that are mostly code, logs or links, and messages that are mostly in another language, such as Vietnamese. If the host has no Claude provider or the model is not available, or the check takes longer than 25 seconds, nothing is shown and the reason goes to the plugin log.

Open the plugin's settings from the gear in the panel, or under Settings, Plugins, Translate. Settings are stored on the daemon and shared by every client of that daemon:

- **Translation prompt** is the instruction sent to the helper, and it holds the target language (Vietnamese by default). Variables `{{text}}` and `{{sentence}}` insert the selection and its surrounding text. The JSON reply format is always appended, so a custom prompt cannot break the result.
- **Extra instructions** are appended to every prompt, for example a subject area to prefer.
- **Check my English** turns the English check on or off. It is on by default and applies to the chats of that host only; with several hosts connected, set it on each one.

Known limits: a lookup takes roughly 10 to 25 seconds because a full agent turn runs for each one. Archived helpers stay in your agent history and in the provider's session list, and Paseo's plugin API has no way to delete them. Helpers are told not to use tools, and that is enforced by instruction only. Selections over 5000 characters are ignored. The English check is chat feedback, not a full proofreader: a message added while the agent is still working is not checked, and the results live in the daemon's memory, so they are gone after a daemon restart.

Translate is free and open source. To support its development, donate via PayPal: https://paypal.me/duocnguyen

Join the community on Discord: https://discord.gg/W2c3TgQXS
