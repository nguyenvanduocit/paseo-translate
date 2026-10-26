# Changelog

## 0.2.1

- English feedback: a one-line message that mentions an error name or a timestamp is checked, not skipped as code.
- A very long message with no spaces (a pasted hash, a long unspaced paragraph) no longer stalls the plugin for seconds before its check.
- A failed lookup of a chat's details is asked again on the next turn, so one daemon error no longer switches feedback off for that chat.
- Translate takes its provider and parent from your chat, never from an English-check helper that is still running.
- A translation that fails shows only the error, not a half-finished translation above it.

## 0.2.0

- English feedback: after you send a message in a Claude chat, Claude Haiku checks its English on the host that owns
  the chat. A message with mistakes gets a line under it with each fix marked; clicking the line opens a list of
  short explanations. A message that is fine shows nothing.
- Setting "Check my English", on by default, per host.
- Messages sent while the agent is still working get feedback too, under the message; a message missed
  then is checked when the turn ends, with a late row that quotes it. Each message is checked once and
  at most two checks run per chat at a time.
- The translation renders as the helper streams it.
- A selection that starts or ends inside a word is widened to the whole word.
- Donate and Discord links in the Translate panel and settings.
- Two-word messages are checked; images sent without text are skipped.
- The check's helper starts without the project's MCP servers, so it finishes in about 4 to 15 seconds in a
  repository with a `.mcp.json` as well as in a bare directory.

## 0.1.0

- Translate selected text from a Paseo chat. The Explorer panel shows the latest result: the translation, a breakdown
  of words and phrases, grammar notes, sentence patterns and examples.
- Settings for the translation prompt and extra instructions, stored per daemon.
- Command Center item "Open Translate".
