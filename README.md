# body_chrome_attach

Chrome MV3 **Generic Body** with a visible virtual cursor plus a local learned-behavior daemon.

The repository combines the strongest parts of the previous GitHub Body and `learned_body_closed_loop_v3`:

- Chrome CDP execution stays inside a small, auditable Body surface.
- The visible cursor shows USER / CDP / CDP ERROR state.
- USER and Body-generated CDP input are separated before training.
- Real USER mouse trajectories are learned instead of generating a synthetic curved path.
- A daemon stores long-lived datasets and models per extension and per website.
- Multi-extension and multi-tab control are supported.
- Typing and scroll timing sequences are learned from USER demonstrations.
- Habit/strategy learning can choose between alternatives such as Enter vs mouse click based on observed behavior.
- CDP execution remains restricted to `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`.

> Origin labeling and motor learning are for truthful automation/UX testing and reproducible user-behavior modeling. This project does not attempt to conceal automation or defeat bot-detection systems.

## Final architecture

```text
USER mouse / keyboard / wheel / tab switch
            |
            v
visible content observer
            |
            +---- USER/CDP provenance ----> virtual cursor
            |                                 USER / CDP / ERROR
            v
extension service worker
            |
            +---- local aggregate learner
            |
            +---- daemon bridge ws://127.0.0.1:8765
                         |
                         v
                 learned Body daemon
                 - extension registry
                 - multi-tab state
                 - per-site dataset
                 - site + extension-global motor model
                 - habit model
                 - strategy selector
                         |
                         v
                 HUMAN_MOTOR plan
                         |
                         v
                existing CDP gateway
                         |
                 dispatchMouseEvent
                 dispatchKeyEvent
                         |
                         v
                      Chrome
```

## Mouse movement model

Mouse geometry does **not** use a randomized Bezier or a synthetic random correction model.

USER click/drag episodes are normalized relative to the start/target axis and stored as trajectory templates. The daemon groups them by context:

```text
mouse | action | target role | distance bucket | target-size bucket
```

A learned trajectory is mapped to a new target by rotation, scale and learned timing. Template selection is a deterministic cycle through the matching USER bank.

When no learned trajectory exists, bootstrap movement is a visible straight line. The Body does not invent a curved "human-looking" fallback.

## Typing and scrolling

The daemon learns USER timing sequences:

- inter-key intervals;
- key hold durations;
- wheel-event ratios and gaps;
- navigation/function-key actions.

The motor planner keeps the more complete keyboard encoder from the GitHub Body: modifiers, Shift-required uppercase/punctuation and CDP key codes are generated without `Input.insertText`.

Sensitive inputs such as password/payment/autocomplete-secret fields are excluded/redacted by the observation boundary.

## Per-site and global learning

Learning is scoped by:

```text
extensionInstanceId + siteKey
```

Each extension also has an `__global__` fallback model. Website-specific evidence wins when available; otherwise the daemon falls back to that extension's global model. Data from two Chrome extension instances is never mixed accidentally.

Runtime data is stored under:

```text
daemon/profiles/<extension-id>/<site>/
  data/
    human_events.jsonl
    agent_events.jsonl
    human_samples.jsonl
  model/
    behavior_model.json
    habit_model.json
```

`daemon/profiles/` is runtime state and should normally remain uncommitted.

## Habit and strategy learning

The daemon learns sequences such as:

```text
typeText -> Tab
typeText -> click next editable
typeText -> Enter
typeText -> Escape
```

Built-in strategy commands include:

```text
focusnext x y [width height role]
submitchoice x y [width height role]
dismisschoice x y [width height]
```

Strategy selection uses observed per-site habit evidence with extension-global fallback. It is not randomized merely to create variety.

## Visible cursor and provenance

The original visible cursor is retained:

- `USER`
- `CDP`
- `CDP · DOWN / UP`
- `CDP · WHEEL`
- `CDP · KEY ...`
- `CDP · ERROR`

Before CDP dispatch, the extension publishes an expected input marker to the content observer. Matching DOM events are suppressed from USER training. If CDP dispatch fails, the pending marker is removed and the overlay shows `CDP · ERROR`, preventing a later real USER input from being misclassified.

## Single primary CMD/socket transport

Primary control is now the learned daemon:

```text
body.cmd / body_cli.js
        |
        v
ws://127.0.0.1:8765
        |
        v
daemon/server.js
        |
        +-- choose extension
        +-- choose tab
        +-- choose site model / habit
        v
extension daemon bridge
        v
CDP gateway
```

The previous `8766` broker is no longer started by the service worker.

## Semantic Browser UI controls

Browser chrome is a separate execution capability from page motor input:

```text
Brain WHAT
   |-- page action ------> HUMAN_MOTOR ------> CDP Input.dispatchMouseEvent / dispatchKeyEvent
   `-- browser action ---> BROWSER_UI -------> focused Chrome window + Windows SendInput
```

The client sends semantic actions such as `newtab` or `back`; it does not need to know Chrome shortcut keys. The daemon owns the mapping from semantic action to native input.

Supported CMD actions include:

```text
browserback
browserforward
browserreload
browserhardreload
browserstop
browsernewtab
browserclosetab
browserreopentab
browsernexttab
browserprevtab
browsernewwindow
browseraddressbar
browseraddress <url-or-query>
browserfind
browserfindtext <text>
browserdownloads
browserhistory
browserdevtools
browserfullscreen
browserbookmark
browserzoomin
browserzoomout
browserzoomreset
```

The socket equivalent is `BROWSER_COMMAND` with `action` plus optional `value` for `address` and `findtext`.

Browser UI execution first asks the selected extension to focus the exact target tab/window and verifies that focus before native input is allowed. Browser-generated tab activations are marked as `agent`, so they do not pollute HUMAN tab-habit learning.

Execution truth is explicit:

- `delivered=true`: native Browser UI input was issued successfully;
- `verified=true`: an observable browser-state change matched the expected effect;
- `verified=false`: the UI effect cannot be observed reliably from the extension, or no matching state change was seen.

Strong verification is used for tab creation/closure/reopen/switch, window creation, navigation-token changes and navigation epochs. UI-only focus states such as omnibox/find/devtools are intentionally reported as unverified instead of being claimed as successful.

URLs/queries typed through `browseraddress` are not echoed in command results. The extension exposes a one-way navigation token for comparison rather than persisting the raw URL at the Browser UI verification boundary.

The native backend currently uses Windows `SendInput` through `daemon/native/windows_input.py`. Non-Windows platforms fail closed instead of silently falling back to a different automation path.

### Start

Install/build once:

```bat
npm install
npm run verify
```

Load `dist/` from `chrome://extensions` with Developer mode enabled.

Start the daemon:

```bat
daemon.cmd
```

Then use a second CMD window:

```bat
body.cmd "status"
body.cmd "extensions"
body.cmd "tabs"
body.cmd "click 400 250 120 40 button"
body.cmd "type 400 250 hello world"
body.cmd "submitchoice 620 710 120 40 button"
```

Interactive client:

```bat
body.cmd
```

The daemon itself also has an interactive console when launched directly.

## Useful daemon commands

```text
help
extensions
use <extensionId>
status

tabs
tab
switch <tabId>

sites
site [tabId]
dataset [tabId]
model [tabId]
habit [tabId]
globalmodel
train [tabId|global|all]

record on|off
learn on|off
cursor on|off

move x y
click x y [width height role]
doubleclick x y [width height]
hover x y
drag x1 y1 x2 y2
scroll delta
hscroll delta
type x y text
key Enter
combo Control+a
back
forward
reload

browserback
browserforward
browserreload
browserhardreload
browserstop
browsernewtab
browserclosetab
browserreopentab
browsernexttab
browserprevtab
browsernewwindow
browseraddressbar
browseraddress <url-or-query>
browserfind
browserfindtext <text>
browserdownloads
browserhistory
browserdevtools
browserfullscreen
browserbookmark
browserzoomin
browserzoomout
browserzoomreset

focusnext x y [width height role]
submitchoice x y [width height role]
dismisschoice x y [width height]
strategy {JSON}
intent {JSON}
```

## Direct extension runtime API

The existing direct runtime API remains useful for debugging the Body itself:

```js
chrome.runtime.sendMessage({ action: 'body.executeText', text: 'click 400 250' })
chrome.runtime.sendMessage({ action: 'body.profile' })
chrome.runtime.sendMessage({ action: 'body.virtualCursorStatus' })
```

## Verification

```bat
npm run verify
```

Verification includes:

- JavaScript syntax checks;
- original Body runtime contract;
- daemon bridge contract;
- daemon multi-extension/multi-tab/per-site/habit/strategy tests;
- deterministic trajectory selection test;
- linear bootstrap test;
- learned typing + keyboard Shift/punctuation test;
- semantic Browser UI adapter + focus/provenance/verification contract;
- Windows native helper syntax check;
- extension build.

## Branch policy

`main` is the working branch for this repository. Feature branches that have already been merged should be deleted rather than accumulated.
