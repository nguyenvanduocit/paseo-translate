# Changelog

## Unreleased

- English feedback: after you send a message in a Claude chat, Claude Haiku checks its English on the host that owns
  the chat. A message with mistakes gets a line under it with each fix marked and a "Why?" list of short
  explanations; a message that is fine shows nothing.
- Setting "Check my English", on by default, per host.

## 0.1.0

- Translate selected text from a Paseo chat. The Explorer panel shows the latest result: the translation, a breakdown
  of words and phrases, grammar notes, sentence patterns and examples. The result renders as the helper streams it.
- Settings for the translation prompt and extra instructions, stored per daemon.
- Command Center item "Open Translate".
