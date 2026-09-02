# body_chrome_attach

Standalone Chrome MV3 Body extracted from `banupham/extension_agent_v1`.

This repository keeps the browser execution Body separate from semantic Brain logic. It provides CDP mouse/keyboard/wheel execution, local CMD/WebSocket command ingress, observation of user motor behavior, a local motor-profile learner, and an execution-feedback loop.

> Scope note: origin labeling is used to keep self-generated CDP input out of user-training data. It is not an anti-bot or stealth mechanism and does not attempt to hide automation from websites.
