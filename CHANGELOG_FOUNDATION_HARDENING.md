# Foundation Hardening Changelog

## Mục 1 - Browser BUSY/ACTIVE lifecycle
- Browser chỉ ACTIVE khi execution lane thực sự cạn.
- Queue/failure không tạo khoảng ACTIVE giả.
- Guardian không probe Browser BUSY.
- HUMAN_CONTROL / QUARANTINED / ERROR / OFFLINE không bị idle callback ghi đè.

## Mục 2 - Extension pairing hardening
- Bỏ first-connect TOFU.
- Pairing window + one-time code chỉ mở từ local daemon console.
- Persistent token chỉ cấp sau `AUTH_PAIRED` và vẫn bind Browser/Runtime/Origin.
- `pair forget` revoke + terminate live socket.
- Pairing control không đi qua Brain/debug socket; không thêm privileged Chrome permission.

## Mục 3 - Debug routing + Browser UI fast path
- `ExtensionRegistry` có online index, full/unique-prefix resolver và fail-closed selection reconciliation.
- Thêm `exts`, `use`, `next`, `prev`, `@ref <cmd>`, `--ext=<ref>`, raw/multiline JSON.
- Browser UI fast path cho `address/back/forward/reload/hardreload` qua Chrome tabs API, giữ native fallback.
- Page physical motor không thay đổi; CDP allowlist vẫn chỉ `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.
- CI: workflow #207 — PASS.

## Mục 4 - Stable Browser learning identity
- Persistent learning chuyển từ `profiles/<extensionInstanceId>` sang `profiles/by-browser/<browserInstanceId>`.
- Extension identity chỉ giữ làm provenance trên sample/event.
- Legacy learning được move nguyên tử khi an toàn.
- Legacy + stable cùng có payload => fail-closed, giữ nguyên cả hai, không auto-merge.
- Migration check chạy trước cache reuse để bắt late legacy transport scope.
- `TabHabitModel` v2 tách transition/last active theo Browser.
- Legacy transition không có Browser attribution được quarantine khỏi active learning.
- `daemon/learning_identity_contract.js` nằm trong `npm run verify`.
- CI: workflow #219 — PASS.

## Mục 5 - Semantic Observation + Immutable Evidence Store
- Thêm YouTube semantic observer read-only tối thiểu.
- Observer không capture query/account/text; Evidence assembler whitelist schema riêng trước persist.
- Evidence Store tách khỏi DatasetStore/Motor/Habit và dùng stable Browser scope.
- Evidence JSONL append-only có SHA-256 chain; verify chain trước mỗi append.
- Trusted Human Enter trên search input tạo candidate `youtube.search`; Agent không tạo Human evidence.
- Pending evidence có TTL và lifecycle cleanup.
- `semanticBefore` bị loại trước khi training event đi vào DatasetStore/Segmenter.
- ObservedEffect không overclaim navigation khi chưa có semantic effect đủ mạnh.
- Observer/store/runtime/bridge/privacy contracts đều nằm trong `npm run verify`.
- CI code sau self-review: workflow #236 — PASS.

## Final review gate
- Đã so lại Mục 4–5 và cumulative Mục 1–5 so với `main`.
- Không phát hiện blocker trong phạm vi hardening.
- Residual risks được ghi trong `FOUNDATION_HARDENING_REVIEW.md`, không bị che bằng fallback suy đoán.
- `main` chưa thay đổi; PR vẫn open và chưa merge.
