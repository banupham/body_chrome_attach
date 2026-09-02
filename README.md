# body_chrome_attach

Chrome MV3 **Generic Body** with a visible virtual cursor plus a local learned-behavior daemon.

This repository combines the strongest parts of the previous GitHub Body and `learned_body_closed_loop_v3`:

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

Printable key values are not persisted as dataset text. The learning dataset stores character classes/timing; control keys such as Enter/Tab/Escape are retained so habit sequences can be learned. Sensitive inputs such as password/payment/autocomplete-secret fields are redacted.

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

`daemon/profiles/` is runtime state and is ignored by Git.

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

Strategy selection uses observed per-site habit evidence with extension-global fallback. It is deterministic rather than randomized merely to create variety.

## Visible cursor and provenance

The original visible cursor is retained:

- `USER`
- `CDP`
- `CDP · DOWN / UP`
- `CDP · WHEEL`
- `CDP · KEY ...`
- `CDP · ERROR`

Before CDP dispatch, the extension publishes an expected input marker to the content observer. Matching DOM events are suppressed from USER training. If CDP dispatch fails, the pending marker is removed and the overlay shows `CDP · ERROR`, preventing a later real USER input from being misclassified.

The content script also provides read-only target context (`role`, `rect`, `editable`, `sensitive`) to the learning boundary so trajectories can be grouped by target type and size without using DOM actions as the Body.

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

focusnext x y [width height role]
submitchoice x y [width height role]
dismisschoice x y [width height]
strategy {JSON}
intent {JSON}
```

## Direct extension runtime API

The existing direct runtime API remains available for debugging the Body itself:

```js
chrome.runtime.sendMessage({ action: 'body.executeText', text: 'click 400 250' })
chrome.runtime.sendMessage({ action: 'body.profile' })
chrome.runtime.sendMessage({ action: 'body.virtualCursorStatus' })
```

## Verification

```bat
npm run verify
```

Verification includes JavaScript syntax checks, the original Body runtime contract, daemon bridge contract, daemon multi-extension/multi-tab/per-site/habit/strategy tests, deterministic trajectory selection, linear bootstrap, learned typing + Shift/punctuation, and extension build.

## Branch policy

`main` is the working branch for this repository. Do not accumulate feature branches after their changes have been integrated.
