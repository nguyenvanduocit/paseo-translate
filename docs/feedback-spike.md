# English feedback: spike results

Measured on 2026-10-25 against the local daemon 0.13.0 (`paseo --version`) with a throwaway plugin
(`efb-spike`, server hook plus a renderer) and throwaway agents in `/tmp/efb-spike-e2e`, and checked
against the 0.11.2 SDK types in `node_modules/@getpaseo/plugin` and `@getpaseo/client`.
Current docs: https://paseo.sh/docs/plugins/reference.md (fetched the same day).

## S1. Where the hook gets the user's text

`agent.turn_started` carries only `{ agent, turnId }`
(`@getpaseo/plugin/dist/server/lifecycle.d.ts:44-47`). The text comes from
`context.paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit })`
(`@getpaseo/client/dist/index.d.ts:247`). The user message is already in the timeline when the hook
runs: the fetch 2 to 7 ms after `turn_started` returned it as the last entry.

```
13:44:29.830 turn_started {"agent":{"id":"6e25dff0-…","parentAgentId":null,"provider":"claude",…},"turnId":"foreground-turn-1"}
13:44:29.837 tail@start 7 ms window {"minSeq":1,"maxSeq":1,"nextSeq":2} entries [{"item":{"type":"user_message","text":"Reply with exactly: OK. …","messageId":"5c5d1ea9-…"},"seqStart":1,"seqEnd":1,"turnId":"foreground-turn-1",…}]
```

Entries carry `seqStart`, `seqEnd` and `turnId`; the user message's `turnId` equals the event's.
`turnId` is per agent (`foreground-turn-1`, `-2`, …) and the docs say it can repeat after a session
reopens, so it is not a safe row id; the user message's `messageId` is.
`agent.turn_ended.timeline` is deprecated and always empty in current docs, so `turn_ended` is no
better a source. Confidence: HIGH.

## S2. Where the row lands

The projected timeline orders a plugin row by the seq of its first append. Appended 11 ms after
`turn_started`, the row took seq 2, right after the user message (seq 1) and before the assistant's
reply (seq 3). Re-appending the same id 6 s later got seq 4 but kept the position: the fetch shows one
item with `"seqStart":2,"seqEnd":4,"collapsed":["identity"]`.

```
append1 spike-foreground-turn-1 {"seq":2,…} 11 ms
append2 {"seq":4,…} 6198 ms
tail@after ["user_message:Reply with exactly: OK…","plugin(spike-foreground-turn-1)","assistant_message:OK"]
```

When the first append comes after the assistant has started (forced with a 6 s delay), the row lands
after the assistant text:

```
append1 spike-foreground-turn-2 {"seq":13,…} 6008 ms
tail@after [… "user_message:DELAY Write three short sentences…","assistant_message:Cats sleep…","plugin(spike-foreground-turn-2)"]
```

So the plugin must append the checking row before calling the model; the append itself takes 3 to
20 ms. The row survives refetch: the next turn's fetch still returns it in place. The docs state rows
live in the daemon's memory and do not survive a daemon restart. In the runaway run below, helpers
that auto-archived got a new timeline epoch and a re-append after that landed at the end, so a row
re-appended after an epoch reset moves. The plugin only re-appends within the seconds of one check,
so this window is small. App reload was not tested in the UI; the app reads the same projected
timeline. Confidence: HIGH for placement and re-append, MEDIUM for app reload.

Limits: a message steered into a running turn does not start a turn, so it fires no
`turn_started` and is not checked.

## S3. Haiku helper from a hook

`paseo.workspaces.ref(workspaceId).agents.create({ config: { provider: "claude/claude-haiku-5-5",
systemPrompt }, parent, labels, autoArchive: true, outputSchema, prompt })` works from the hook:
create took 92 to 147 ms and the whole check 5.3 to 6.5 s.

```
helper created d5d8c7cd-… 92 ms
helper d5d8c7cd idle "{\"ok\": true}" null 6185 ms
```

The helper does fire this plugin's `agent.turn_started`. The first spike created helpers with
`paseo.agents.create({ cwd })` and no parent: each got `parentAgentId: null`, a new workspace of
its own, and checked itself, which looped (20 helper workspaces in 20 s before the plugin was disabled
and they were archived). With `parent` set, the helper reports `parentAgentId` of the user's agent,
lives in the same workspace (shown as a subagent, not as a sidebar workspace), and the
`parentAgentId === null` rule skips it:

```
turn_started {"agent":{"id":"d5d8c7cd-…","workspaceId":"wks_36e2…","parentAgentId":"6e25dff0-…",…}}
skip: has parent
```

`autoArchive` archived each idle helper (absent from `paseo ls` afterwards). `waitForFinish` can
return before the archive lands (`archivedAt null` at that moment). The user's agent timeline showed
no message from the helper (`paseo logs 6e25dff0`). Confidence: HIGH.

## S4. Two hosts in one app

Not tested with two live hosts. From the 0.13.0 app bundle
(`Paseo.app/…/app-dist/_expo/static/js/web/index-f1a1407f….js`), a plugin row's renderer is
`useInstalledPlugin(serverId, item.pluginId).timelineRenderers.find(kind, version)`: the renderer
comes from the plugin installed on the host that owns the agent, so each row renders once, with that
host's bundle. Each host bundle registers its own renderer, and registering the same kind twice in one
bundle throws `Duplicate timeline renderer`. Because the check runs in the daemon hook, the host that
owns the agent is the only one that checks its messages. The daemon stamps `pluginId` with the
install id, so a row written by `translate-dev` needs `translate-dev` to render. Confidence: MEDIUM.

## S5. No usable Claude on the host

- Unknown provider: `agents.create` throws at once:
  `Error: Provider nosuchprovider is not configured`.
- Unknown model: the helper finishes `idle` with a plain-text error as its last message:
  `"There's an issue with the selected model (claude-nonexistent-9). It may not exist or you may not have access to it. …"`.
  The JSON parse fails on it.

Both become a quiet row and one log line. Confidence: HIGH.

## Outcome

S1 and S2 allow design C: append the checking row at `turn_started`, run Haiku, re-append the same id.

## After the build: latency with the real prompt

With the real prompt, the first end-to-end test measured 13.3 s for a message with three fixes and
6.2 s for a message without fixes, both in an empty directory. A check in a chat in the
`paseo-on-compass` repository timed out: its helper timeline stayed empty for the 20 s it had.

## Helper start-up in a repository (measured 2026-10-25)

The same helper (`claude/claude-haiku-5-5`, prompt "Reply with only the word: ok", `autoArchive`),
created and awaited until idle, 3 at a time:

| Directory | Provider options | Create to idle (s) |
| --- | --- | --- |
| empty `/tmp` directory | none | 6.7, 6.4, 5.0 |
| `paseo-on-compass` repository | none | 35.9, 37.3, 35.1, 34.8, 34.7 |
| `paseo-on-compass` repository | `extraArgs: { "strict-mcp-config": null }` | 4.4, 4.3, 6.4, 8.7, 6.0, 6.4 |
| empty `/tmp` directory | `extraArgs: { "strict-mcp-config": null }` | 4.8, 3.8, 5.6 |

Two runs in the third row replied "Not logged in · Please run /login"; the re-run had none, so that
was a transient account error, not the flag. The extra 30 s comes from the project's MCP
configuration (`compass/supremor/.mcp.json` declares 5 servers; one times out after 30 s). HIGH.

`--strict-mcp-config` is a documented Claude Code CLI flag ("Only use MCP servers from --mcp-config,
ignoring all other MCP configurations", `claude --help`, 2.1.309). Paseo validates `extraArgs` in its
strict Claude provider schema (`providers/claude/options.js`, present in 0.10.1, 0.11.0-beta.5, 0.11.2
and 0.13.0) and spreads the provider options into the Claude SDK options in each of those versions.
The 0.11.2 SDK passes them as `config.options`. The helper's project hooks and `CLAUDE.md` still load.

End to end with the flag, on a separate test daemon with the plugin installed, checks in a chat in
`paseo-on-compass` took 7.6, 6.3, 8.5 and 14.9 s.

## Does `context.paseo` outlive the hook?

A spike scheduled calls 5 s and 40 s after its `agent.turn_started` handler had returned:

```
14:07:14.306 hook start 7c244c7d context keys ["paseo","signal"]
14:07:14.306 hook returns
14:07:19.315 +5s refresh ok true aborted false · append ok {"seq":2} · helper idle "ok"
14:07:54.307 +40s refresh ok true aborted false · append ok {"seq":4} · helper idle "ok"
```

It does on 0.13.0, past the 30 s hook budget, and `context.signal` stays unaborted. The plugin
reference does not promise this: it describes `context.paseo` for the hook invocation, and
`context.signal` aborts on invocation timeout or plugin stop. The server context exposes no
long-lived `paseo` (`["handle","registerProvider","registerUsageSource","registerSettings","on","before"]`).
The check stays inside the hook.
