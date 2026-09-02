# body_chrome_attach

Standalone Chrome MV3 Body extracted and adapted from `banupham/extension_agent_v1`.

This repository keeps browser execution separate from semantic Brain logic. The Body observes real user motor behavior, learns a local motor profile, accepts text commands through CMD/WebSocket, compiles them into mouse/keyboard CDP actions, renders a visible virtual cursor, and keeps CDP-generated events out of USER training data.

## Closed loop

```text
USER mouse/keyboard
  -> content observer
  -> USER/CDP provenance classifier
  -> persistent motor learner
  -> learned motor profile
  -> CMD/socket text command
  -> motor plan compiler
  -> CDP input gateway
  -> visible virtual cursor
  -> browser
```

CDP execution is not fed back into the USER learner. The learner only fits events classified as `USER`.

## Visible virtual cursor

The content script draws a cursor above the page so the operator can watch actions directly.

- `USER`: real observed mouse/keyboard event with no matching pre-announced CDP event.
- `CDP`: event issued through the Body CDP input gateway.
- Clicks show DOWN/UP and a click ring.
- Wheel and keyboard activity are shown in the label.
- Failed CDP dispatch shows `CDP · ERROR` and removes the pending provenance expectation.
- The last cursor position is retained in `sessionStorage` when available.

Before every approved CDP input command, the gateway publishes an expected event to the content script. The content script matches the resulting DOM event by type/time/position and suppresses the matched event from USER learning.

This is a provenance mechanism for truthful training data and operator visibility. It is not a stealth or anti-bot mechanism.

## What is learned

The persisted profile currently contains generic motor statistics only:

- mouse movement speed;
- path/direct-distance ratio;
- pause before click;
- turn/correction tendency;
- mean keyboard interval;
- p90 keyboard interval;
- backspace rate;
- submit preference: click vs Enter.

Raw recent USER events are kept only in the service-worker in-memory buffer; the aggregate profile is persisted in `chrome.storage.local`.

For submit learning, the content script records only generic form context (`tag`, `role`, `inputType`, `formContext`, `isSubmitControl`). It does not persist form values or typed text into the learned profile.

## Human-motor CDP allowlist

Only these methods are accepted by `CdpInputGateway`:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
```

No JavaScript/DOM click, form submit, `Input.insertText`, or Page navigation shortcut is used as a human-motor fallback.

## Build and verify

```bash
npm install
npm run verify
```

`npm run verify` runs syntax checks, the Body runtime contract, and the extension build.

Load `dist/` as an unpacked extension in `chrome://extensions`.

## CMD + WebSocket transport

The transport is intentionally one path:

```text
body.cmd / body_cli.js
       |
       v
ws://127.0.0.1:8766
       |
       v
text-only command ingress
       |
       v
Body executor
```

The extension reconnects to the local socket automatically. Both runtime messages and the socket use the same command runner.

One-shot Windows examples:

```bat
body.cmd "move 400 250"
body.cmd "click 400 250"
body.cmd "type hello world"
body.cmd "press Enter"
body.cmd "combo Control+a"
body.cmd "scroll 500"
body.cmd "submit 620 710"
body.cmd "profile"
body.cmd "status"
```

Interactive mode:

```bat
body.cmd
```

Supported commands:

```text
move <x> <y>
click <x> <y>
doubleclick <x> <y>
type <text>
press <key>
combo <Modifier+Key>
scroll <deltaY> [x y]
submit [x y]
profile
events [limit]
status
attach
detach
help
```

## Submit behavior

`submit` demonstrates the learned task-style choice requested for the Body.

If a grounded submit point is supplied:

```text
submit 620 710
```

Body samples the learned `clickProbability` / `enterProbability` and may either move/click the supplied point or press Enter.

If no coordinates are supplied, Body does not invent a location and falls back to Enter:

```text
submit
```

This keeps target grounding outside the Body while still letting the Body learn HOW the user typically submits.

## Development runtime messages

Direct text command:

```js
chrome.runtime.sendMessage({ action: 'body.executeText', text: 'click 400 250' })
```

Direct approved CDP input for debugging:

```js
chrome.runtime.sendMessage({
  action: 'body.cdpInput',
  method: 'Input.dispatchMouseEvent',
  params: { type: 'mouseMoved', x: 400, y: 250, button: 'none' }
})
```

Inspect profile/cursor/runtime:

```js
chrome.runtime.sendMessage({ action: 'body.profile' })
chrome.runtime.sendMessage({ action: 'body.virtualCursorStatus' })
chrome.runtime.sendMessage({ action: 'body.getObservedUserMotor', limit: 250 })
```

## Execution truth

`delivered=true` means all CDP motor steps were delivered successfully. It does **not** claim the semantic task succeeded. Browser-effect verification belongs above the generic Body.
