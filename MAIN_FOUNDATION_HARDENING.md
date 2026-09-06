# Kế hoạch củng cố nền tảng main

Nhánh thực hiện: `feat/main-foundation-hardening`

Mục tiêu: củng cố nền `main` theo 5 bước nhỏ, mỗi bước phải có test hồi quy và được rà soát độc lập trước khi chuyển sang bước tiếp theo.

## 1. Sửa vòng đời trạng thái BUSY / ACTIVE của Browser — HOÀN THÀNH

- `ExecutionLane` sở hữu lifecycle `busy = active || queued > 0`.
- Không còn khoảng ACTIVE giả giữa physical work đang xếp hàng.
- Guardian từ chối probe khi Browser BUSY.
- Không ghi đè `HUMAN_CONTROL`, `QUARANTINED`, `ERROR`, `OFFLINE`.

## 2. Xác thực Extension cục bộ tự động — HOÀN THÀNH

- Theo yêu cầu vận hành hiện tại, bỏ manual pairing window / one-time code / `pair open`.
- Extension hợp lệ tự kết nối localhost; daemon tự cấp persistent token ở lần kết nối đầu.
- Token vẫn bind chặt `extensionInstanceId + browserInstanceId + runtimeExtensionId + chrome-extension Origin`.
- Token local mất/stale chỉ được auto-rotate khi toàn bộ binding vẫn khớp; runtime/browser/origin mismatch fail-closed.
- `pair forget` revoke + terminate live socket; reconnect hợp lệ tự nhận token mới.
- Popup chỉ hiển thị trạng thái, không có ô nhập mã.
- Không thêm Chrome privileged permission.

## 2b. Tự động phát hiện daemon port — HOÀN THÀNH

- Bỏ hard-coded WebSocket port `8765` khỏi daemon, `body.cmd` và Extension bridge.
- Daemon bind `127.0.0.1:0`; OS tự chọn TCP port đang trống.
- Endpoint thực tế publish tại `daemon/state/runtime-endpoint.json` và `dist/runtime-endpoint.json`.
- `body.cmd` đọc endpoint state; Extension đọc resource endpoint và resolve lại mỗi reconnect.
- Endpoint client chỉ chấp nhận `127.0.0.1` và tự dựng WebSocket URL từ port đã validate.
- `runtime.lock` dùng exclusive create + PID ownership để giữ invariant one Company Runtime per Device ngay cả khi port là động.
- Regression `tests/runtime_endpoint_contract.js` khóa no-hardcoded-port, localhost-only, endpoint ownership và discovery behavior.
- CI cuối thay đổi: workflow #272 — `verify` PASS + `windows-native-input` PASS.

## 3. Đưa debug routing + Browser UI fast path về nền main — HOÀN THÀNH

- Debug routing: `exts`, `use <index|prefix|full-id>`, `next`, `prev`, `@<ref> <cmd>`, `<cmd> --ext=<ref>`, raw/multiline JSON.
- Target mơ hồ fail-closed; disconnect chỉ auto-select khi còn đúng một Extension online.
- `address/back/forward/reload/hardreload` có Chrome tabs API fast path và native fallback.
- Win32 `SendInput` ABI đã được sửa để không còn `WinError 87`; CI có job Windows kiểm tra INPUT ABI.
- Page motor vẫn chỉ `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` qua HUMAN_MOTOR.

## 4. Chuyển learning khỏi extensionId sang identity ổn định — HOÀN THÀNH

- Persistent learning scope chuyển sang `profiles/by-browser/<browserInstanceId>/<siteKey>`.
- `extensionInstanceId`/`runtimeExtensionId` chỉ còn provenance, không còn là storage key.
- Legacy `profiles/<extensionInstanceId>` được move nguyên tử khi đích chưa có payload.
- Legacy + stable cùng có payload => `legacy_learning_migration_conflict`, giữ nguyên hai phía, không auto-merge.
- Migration check chạy trước cache reuse để bắt late legacy transport directory.
- `TabHabitModel` v2 tách transition/last-active theo Browser.
- Legacy transition không có Browser attribution được giữ để audit nhưng không dùng active training.
- `daemon/learning_identity_contract.js` khóa migration/isolation/conflict behavior.

## 5. Phase 5: Semantic Observation + Immutable Evidence Store — HOÀN THÀNH

- YouTube semantic observer read-only tối thiểu: page type, search-control state, search-result count, viewport.
- Không capture search query value/account identity/arbitrary text; assembler whitelist field trước persist.
- Evidence tách khỏi DatasetStore/Motor/Habit tại `evidence/by-browser/...`.
- JSONL append-only có SHA-256 hash chain và verify chain trước mỗi append.
- Chỉ trusted Human Enter trên semantic search input mới mở `youtube.search` candidate; Agent event không tạo Human evidence.
- Candidate có TTL và lifecycle cleanup khi Tab/Browser mất đi.
- Runtime loại `semanticBefore` trước khi ghi training DatasetStore/Segmenter.
- `BeforeState -> Action -> AfterState -> ObservedEffect` giữ stable Browser identity + Extension provenance và không tự nâng thành `taskSuccess`.
- ObservedEffect chỉ claim navigation khi có effect semantic quan sát được.
- Regression observer/store/runtime/bridge/privacy/CDP invariants đều nằm trong `npm run verify`.

## Kết quả rà soát cuối — HOÀN THÀNH

- Đã so lại delta Mục 1–5 và các thay đổi vận hành sau hardening: automatic auth, dynamic daemon endpoint, Win32 INPUT ABI.
- Không phát hiện blocker còn lại trong phạm vi hiện tại.
- Khi thiếu bằng chứng semantic, hệ thống bỏ evidence/fail-closed thay vì tự nhận thành công.
- Dynamic endpoint không mở daemon ra ngoài localhost và không cho chạy hai Company Runtime đồng thời.

## Nguyên tắc chung — GIỮ NGUYÊN

- Không merge toàn bộ research branch.
- Content script chỉ đọc/quan sát.
- Page physical action chỉ qua CDP Input allowlist hai phương thức.
- Browser UI dùng đường riêng.
- Không nới Policy/Guardian để test dễ hơn.
- Human/Agent provenance tách biệt.
- Persistent learning/evidence scope theo stable Browser identity.
- `main` chỉ thay đổi khi có quyết định merge riêng.
