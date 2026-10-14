# Design

Select text in a Paseo chat, click Translate, and read a lesson in the Explorer panel: translation,
breakdown, grammar, patterns. This doc records the decisions and the reasons for them. The code
answers what each file does.

## Flow

1. `client/web.ts` decides, when the user releases the mouse or a selection key, whether the
   selection is worth offering. It shows the floating button next to the range.
2. A click calls `startLookup`, which makes a loading lookup the workspace's latest and opens the panel with
   `client.openPanel("translate", { workspaceId, location: "explorer" })`.
3. `translator.ts` asks the daemon for the prompt (`translate.prompt` RPC), finds the workspace's
   most recent chat, and creates a helper agent in that workspace with the chat's provider.
4. The helper answers with JSON that streams in as text. `translator.ts` subscribes to the helper's timeline,
   `parsePartialReply` reads what has arrived, and the panel renders it as it grows. When the turn finishes,
   `parseReply` validates the whole reply and replaces the partial view.
5. A parse failure, or a helper that stops outside `idle`, retries once with a new helper, then the
   panel shows the error and a Retry button.

## Decisions

### One helper agent per lookup

`autoArchive` archives an agent after its first terminal turn, so a helper cannot serve a second
lookup. Each lookup creates its own, which also lets lookups run in parallel. The helper is created
with `paseo.workspaces.ref(workspaceId).agents.create`, which places it in the existing workspace.
`paseo.agents.create` makes a fresh workspace for the `cwd`.

The helper's provider and `parent` come from the workspace's most recently updated agent that does
not carry the `paseo-translate` label. A helper stuck on a permission request or a timeout never ends
a turn, so `translator.ts` archives it explicitly.

### The panel renders the reply as it streams

A lookup takes 10 to 25 seconds, and the first text arrives after about 5. The helper's timeline carries the
reply in small `assistant_message` chunks, and the reply's fields stream in schema order, so the translation is
readable within seconds and the breakdown, grammar and patterns follow. `shared/partial-json.ts` closes an
unfinished string, array and object, and drops a trailing key or literal that has not finished, so any prefix of the
reply parses. `parsePartialReply` shows an entry once its first field starts. The streaming view is for display only:
the validated final reply always replaces it, so a misread chunk corrects itself at the end. Subscribing is best
effort; a failed subscription leaves the final reply from `waitForFinish`.

### The daemon builds the prompt

Settings are read with the `useSettings` hook, and the selection handler is plain DOM code outside
React. The daemon holds the settings document, so the client asks it for the finished prompt
through the `translate.prompt` RPC. `index.server.ts` reads the document and calls `buildPrompt`.

### Prompt template, then a fixed reply format

`buildPrompt` joins three parts: the user's template (or the default), the reply format, and the
extra instructions. The template holds the teaching approach and the target language, so changing
either means editing text. The reply format always follows it, so a custom template cannot break
parsing. Placeholders are filled in one pass, so a selection that contains `{{sentence}}` stays literal.

### Structured reply, rendered by the panel

The helper replies with JSON that matches `translationSchema` in `shared/translate.ts`. The same schema
goes to the provider as `outputSchema`. Strings and arrays default to empty so a reply that omits an
empty field still parses. Text fields may contain `**bold**` and `` `code` ``; `shared/rich-text.ts`
parses them and `ResultView` renders them.

### Selection rules

`candidateFromSelection` accepts any selection with at least one letter, up to 5000 characters. The
ceiling guards against a select-all sending a whole page to a model. It is not a product limit.
Selections inside inputs, contenteditable elements and the Translate panel are ignored, so results
cannot be translated again.

A drag that starts or ends inside a word clips it. `wholeWords` in `client/web.ts` widens the text sent to the
helper to whole words with `wordStart` and `wordEnd`. The user's selection and its highlight stay as made. A boundary
already between words stays. A word longer than 40 characters, such as a URL or a hash, stays as selected.

The context sent with a selection is up to 400 characters on each side. A selection longer than 400
characters is its own context.

### The trigger is mouse release

`selectionchange` fires continuously while dragging, so the button would flicker. `web.ts` decides on
`mouseup` and on `keyup` for Shift+Arrow, Shift alone and Cmd/Ctrl+A. `mousedown` outside the button
hides it, and `selectionchange` only hides it when the selection collapses.

### The panel shows the latest result only

`client/lookups.ts` keeps one lookup per workspace and each new lookup replaces it. There is no list
and nothing to delete. The helper's answer to a replaced lookup is dropped, because `updateLookup`
only patches the lookup that is still the latest.

### The workspace id comes from the route

`client.openPanel` requires a `workspaceId`, and a DOM handler has no other source for the current
workspace. `workspaceIdFromLocation` reads `/workspace/<id>` from the page URL and decodes the `b64_`
prefix that the app uses for ids that are not URL-safe. It is the one place that depends on the app's
route shape.

### Styling follows Paseo's theme variables

The floating button is DOM, outside React, so `theme.colors` is not available to it. Paseo's
Unistyles layer publishes every theme color as `--colors-<name>` on the root element and swaps them
with the theme. The button uses the composer pill's tokens: `surface1` background, `border-accent`
border, `foreground-muted` text, `surface2` and `foreground` on hover. CSS system colors are the
fallback on a host that does not publish the variables. The panel and settings screen are React
Native, so colors come from `theme.colors` in props, never from CSS variables.

Type follows Paseo's scale. Unistyles publishes only string values as variables, so sizes have no
variable; `client/typography.ts` copies `FONT_SIZE` from `packages/app/src/styles/theme.ts`. Body text
is `base` (14), the text being studied is `content` (15, the chat's own size), tags and section titles
are `sm` (12). Font family needs nothing: Paseo points every text element under `#root` at its UI font
through one CSS rule, so plugin text matches. The same rule applies the UI font to a `fontFamily:
"monospace"` style, so inline code is marked by a `surface2` background instead.

### Browser APIs live in one file

The project typechecks without the DOM library. `client/web.ts` declares the few globals it uses and
gates the listener on `Platform.OS === "web"`; on native it does nothing.

## Screenshots

`assets/` holds the images the manifest lists as `media`. They are rendered with react-native-web from the
plugin's own components, using Paseo Dark's color values from `packages/app/src/styles/theme.ts`, not
captured from the app. Replace them with captures from the app when you have them, and keep a wide image
first in `media`, because the first image is the card thumbnail.

## Known limits

- Archived helpers remain on disk and in the provider's session list. The plugin API exposes
  `archive()` and no delete.
- The helper is told not to use tools. The prompt enforces this, not the permission mode, because
  mode names differ per provider.
- Each lookup is a full agent turn, roughly 10 to 25 seconds depending on provider and selection size. The result
  streams in from about the fifth second.
- The button appears for any valid selection on a workspace page, not only inside the chat.

## Testing

`npm test` covers `shared/`: selection rules, context extraction, prompt building, reply parsing, partial reply
parsing and inline markup. These are pure functions and need no mocks beyond `defineSettings`.

Before a release:

1. `npm run typecheck`, `npm test`, and the DOM audit in the README.
2. `paseo plugin install "$PWD"`, then `paseo plugin ls` shows `translate` as `running`, and
   `paseo plugin logs translate` ends with `Plugin ready`.
3. In the web app and the desktop app, in a dark and a light theme:
   - Select one word, a phrase and a paragraph. The button appears on release and not while dragging.
   - Select with Shift+Arrow and with Cmd/Ctrl+A. The button appears on key release.
   - Click Translate. The panel opens, the translation appears within a few seconds and the breakdown,
     grammar and patterns fill in below it; a paragraph shows its original above the translation.
   - Select text inside the panel. No button appears.
   - Translate a second selection while the first is loading. Only the second result stays.
   - Open the settings from the gear, change the prompt and the extra instructions, save, and run
     another lookup.
   - Confirm the chat's own timeline gains no entries from lookups.
4. Check the compact layout.
