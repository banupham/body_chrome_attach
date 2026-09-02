# body_chrome_attach

Standalone Chrome MV3 Body extracted from `banupham/extension_agent_v1`.

This repository keeps the browser execution Body separate from semantic Brain logic. The current branch adds the first usable Body surface: a visible virtual cursor, CDP mouse/keyboard input gateway, and USER/CDP provenance separation.

## Visible virtual cursor

The content script draws a cursor above the page so the operator can watch actions with their eyes.

- `USER` label: movement/keyboard observed from the page with no matching pre-announced CDP event.
- `CDP` label: movement/keyboard issued through the Body CDP input gateway.
- Clicks show a ring and DOWN/UP state.
- Wheel and keyboard activity are shown in the cursor label.
- The last cursor position is retained in `sessionStorage` across same-tab document reloads when available.

The CDP gateway publishes an expected input event to the content script **before** `chrome.debugger.sendCommand`. The content script temporarily matches DOM events by type/time/position and suppresses matched events from USER training data. This provenance mechanism exists to keep learning data truthful; it is not a stealth or anti-bot mechanism.

## Human-motor CDP allowlist

Only these execution methods are accepted by `CdpInputGateway`:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
```

No JavaScript/DOM click or text shortcut is used as a human-motor fallback.

## Build

```bash
npm install
npm run check
npm run build
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

## Runtime messages for development

Attach the active tab:

```js
chrome.runtime.sendMessage({ action: 'body.attachActiveTab' })
```

Dispatch an approved CDP input event:

```js
chrome.runtime.sendMessage({
  action: 'body.cdpInput',
  method: 'Input.dispatchMouseEvent',
  params: { type: 'mouseMoved', x: 400, y: 250, button: 'none' }
})
```

Inspect cursor/gateway state:

```js
chrome.runtime.sendMessage({ action: 'body.virtualCursorStatus' })
```

Read recently observed USER motor events:

```js
chrome.runtime.sendMessage({ action: 'body.getObservedUserMotor', limit: 250 })
```

## Next Body layers

The next implementation stages are the CMD/WebSocket command ingress, persistent motor-profile learning, reusable mouse/typing/scroll plan compilation, and execution feedback loop.

> Scope note: origin labeling is used to keep self-generated CDP input out of user-training data. It does not attempt to hide automation from websites.
