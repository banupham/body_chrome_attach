# Kế hoạch củng cố nền tảng main

Nhánh thực hiện: `feat/main-foundation-hardening`

Mục tiêu: củng cố nền `main` theo 5 bước nhỏ, mỗi bước phải có test hồi quy và được rà soát độc lập trước khi chuyển sang bước tiếp theo.

## 1. Sửa vòng đời trạng thái BUSY / ACTIVE của Browser — HOÀN THÀNH

- `ExecutionLane` sở hữu lifecycle `busy = active || queued > 0`.
- Không còn khoảng ACTIVE giả giữa physical work đang xếp hàng.
- Guardian từ chối probe khi Browser BUSY.
- Không ghi đè `HUMAN_CONTROL`, `QUARANTINED`, `ERROR`, `OFFLINE`.

## 2. Tăng bảo mật ghép nối Extension — HOÀN THÀNH

- Bỏ TOFU first-connect.
- Pairing window/mã một lần chỉ mở từ local daemon console.
- Existing persistent token reconnect vẫn giữ Browser/Runtime/Origin binding.
- `pair forget` revoke + terminate live socket.
- Không thêm Chrome privileged permission.

## 3. Đưa debug routing + Browser UI fast path về nền main — HOÀN THÀNH

- Debug routing: `exts`, `use <index|prefix|full-id>`, `next`, `prev`, `@<ref> <cmd>`, `<cmd> --ext=<ref>`, raw/multiline JSON.
- Target mơ hồ fail-closed; disconnect chỉ auto-select khi còn đúng một Extension online.
- `address/back/forward/reload/hardreload` có Chrome tabs API fast path và native fallback.
- Page motor vẫn chỉ `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` qua HUMAN_MOTOR.
- CI Mục 3: workflow #207 — PASS.

## 4. Chuyển learning khỏi extensionId sang identity ổn định — HOÀN THÀNH

- Persistent learning scope chuyển sang `profiles/by-browser/<browserInstanceId>/<siteKey>`.
- `extensionInstanceId`/`runtimeExtensionId` chỉ còn provenance, không còn là storage key.
- Legacy `profiles/<extensionInstanceId>` được move nguyên tử khi đích chưa có payload.
- Legacy + stable cùng có payload => `legacy_learning_migration_conflict`, giữ nguyên hai phía, không auto-merge.
- Migration check chạy trước cache reuse để bắt late legacy transport directory.
- `TabHabitModel` v2 tách transition/last-active theo Browser.
- Legacy transition không có Browser attribution được giữ để audit nhưng không dùng active training.
- `daemon/learning_identity_contract.js` khóa migration/isolation/conflict behavior.
- CI cuối Mục 4: workflow #219 — PASS.

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
- Regression: observer/store/runtime/bridge/privacy/CDP invariants đều nằm trong `npm run verify`.
- CI code cuối Mục 5 sau self-review: workflow #236 — PASS.

## Kết quả rà soát cuối — HOÀN THÀNH

- Đã so lại delta Mục 4–5 và toàn bộ Mục 1–5 so với `main`.
- Không phát hiện blocker còn lại trong phạm vi hardening.
- `FOUNDATION_HARDENING_REVIEW.md` ghi riêng các rủi ro vận hành còn lại: semantic-before có thể bị miss khi navigation quá nhanh, YouTube selector drift, hash-chain local không phải external notarization, Evidence append verify O(n), migration conflict cần operator xử lý.
- Các rủi ro này không được che bằng fallback suy đoán: khi thiếu bằng chứng, hệ thống bỏ evidence/fail-closed thay vì tự nhận thành công.

## Nguyên tắc chung — GIỮ NGUYÊN

- Không merge toàn bộ research branch.
- Content script chỉ đọc/quan sát.
- Page physical action chỉ qua CDP Input allowlist hai phương thức.
- Browser UI dùng đường riêng.
- Không nới Policy/Guardian để test dễ hơn.
- Human/Agent provenance tách biệt.
- Persistent learning/evidence scope theo stable Browser identity.
- `main` chỉ thay đổi khi có quyết định merge riêng.
