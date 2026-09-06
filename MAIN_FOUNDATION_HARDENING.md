# Kế hoạch củng cố nền tảng main

Nhánh thực hiện: `feat/main-foundation-hardening`

Mục tiêu: củng cố nền `main` theo 5 bước nhỏ, mỗi bước phải có test hồi quy và được rà soát độc lập trước khi chuyển sang bước tiếp theo.

## 1. Sửa vòng đời trạng thái BUSY / ACTIVE của Browser — HOÀN THÀNH

Mục tiêu:
- Browser phải giữ `BUSY` khi còn bất kỳ physical execution nào đang chạy hoặc đang xếp hàng trong `ExecutionLane`.
- Chỉ trở về `ACTIVE` khi lane của Browser/Extension đã thực sự cạn (`active=false`, `queued=0`).
- Không ghi đè `OFFLINE`, `QUARANTINED`, `ERROR`, `HUMAN_CONTROL`.

Kết quả:
- `ExecutionLane` sở hữu lifecycle `busy = active || queued > 0`.
- Không còn khoảng ACTIVE giả giữa hai physical work đang xếp hàng.
- Guardian từ chối probe khi Browser BUSY.
- Regression gates đã PASS.

## 2. Tăng bảo mật ghép nối Extension — HOÀN THÀNH

Mục tiêu:
- Bỏ TOFU ở lần kết nối đầu; pairing phải được Human mở cục bộ.
- Không phá reconnect token của Extension đã ghép nối.

Kết quả:
- Pairing window local-only, mã 8 ký tự dùng một lần, RAM-only, có expiry/rate-limit.
- `pair open/status/list/close/forget` không được đưa vào Brain/debug socket.
- `pair forget` revoke credential và terminate live socket.
- Popup pairing không persist one-time code và không thêm Chrome permission.
- Regression gates đã PASS.

## 3. Đưa debug routing + Browser UI fast path về nền main — HOÀN THÀNH

Mục tiêu:
- Debug nhiều Extension chọn đích rõ ràng và fail-closed khi mơ hồ.
- Browser UI `address/back/forward/reload/hardreload` có fast path, vẫn giữ native fallback.
- Không mở rộng CDP gateway.

Kết quả:
- Hỗ trợ `exts`, `use <index|prefix|full-id>`, `next`, `prev`, `@<ref> <cmd>`, `<cmd> --ext=<ref>`, raw/multiline JSON.
- Disconnect selection chỉ auto-select khi còn đúng một Extension online; nhiều target thì selection bị xóa.
- Fast path dùng `chrome.tabs.update/goBack/goForward/reload`; lỗi/thiếu API quay về native Browser UI.
- Page motor vẫn chỉ dùng `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` qua HUMAN_MOTOR.
- CI code + regression cuối Mục 3: workflow #207 — PASS.

## 4. Chuyển learning khỏi extensionId sang identity ổn định — HOÀN THÀNH

Mục tiêu:
- Không xem `extensionInstanceId` là identity lâu dài của dữ liệu học.
- Migration an toàn sang `browserInstanceId` mà không trộn Browser hay mất dữ liệu.

Kết quả:
- Persistent learning scope chuyển sang `profiles/by-browser/<browserInstanceId>/<siteKey>`.
- `extensionInstanceId`/`runtimeExtensionId` chỉ còn là provenance của từng sample/event, không còn là storage key.
- Runtime vẫn có thể gọi learning bằng live Extension ref; resolver trung tâm ánh xạ sang Browser identity.
- Legacy `profiles/<extensionInstanceId>` được move nguyên tử sang Browser scope khi đích chưa có payload.
- Nếu legacy và Browser scope đều có payload, migration fail-closed với `legacy_learning_migration_conflict`; không tự merge và không xóa bên nào.
- Cache reuse vẫn chạy migration check cho transport identity mới, tránh bỏ sót late legacy directory.
- `TabHabitModel` nâng schema v2, transition/last-active tách theo Browser.
- Legacy transition v1 không có Browser attribution được giữ riêng nhưng không dùng làm training signal để tránh cross-Browser contamination.
- `daemon/learning_identity_contract.js` khóa migration, isolation, conflict và legacy TabHabit behavior.
- CI cuối Mục 4 sau self-review: workflow #219 — PASS.

## 5. Phase 5: Semantic Observation + Immutable Evidence Store — HOÀN THÀNH

Mục tiêu:
- Semantic observer read-only tối thiểu.
- Evidence Store tách khỏi DatasetStore dùng cho Motor/Habit.
- Chuẩn hóa `BeforeState -> Action -> AfterState -> ObservedEffect` với provenance rõ ràng.
- Chứng minh Human demonstration `youtube.search` có evidence truy vết.

Kết quả:
- Thêm YouTube semantic observer read-only: route type, trạng thái search controls, search-result count và viewport; không thao tác DOM.
- Observer không lưu search query, account identity hay text content; Evidence assembler còn whitelist field lần hai trước khi persist.
- `EvidenceStore` nằm riêng dưới `evidence/by-browser/...`, không dùng DatasetStore/Motor/Habit.
- Evidence JSONL append-only có SHA-256 hash chain; chain hiện tại được verify trước mỗi append và tamper bị phát hiện.
- Chỉ trusted Human Enter trên semantic search input mới mở candidate `youtube.search`; Agent event không tạo evidence.
- Pending evidence có TTL và được xóa khi Tab/Browser lifecycle kết thúc để tránh ghép observation cũ.
- Runtime loại `semanticBefore` khỏi event trước khi ghi training DatasetStore/Segmenter.
- Evidence record có stable Browser identity, Extension provenance, Before/Action/After/ObservedEffect; không tự nâng thành `taskSuccess`.
- ObservedEffect chỉ claim navigation khi có semantic effect quan sát được; không suy diễn chỉ vì after page là search.
- Bridge contract chứng minh before/after semantic path không dùng CDP Input; CDP allowlist vẫn đúng 2 phương thức cũ.
- `daemon/evidence_store_contract.js`, `tests/semantic_observer_contract.js`, `tests/semantic_evidence_bridge_contract.js` được đưa vào `npm run verify`.
- CI code + regression cuối Mục 5 sau self-review: workflow #236 — PASS.

## Nguyên tắc chung — GIỮ NGUYÊN

- Không merge toàn bộ nhánh research vào nhánh hardening.
- Content script chỉ đọc/quan sát.
- Page physical action chỉ qua `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.
- Browser UI dùng đường riêng.
- Không nới Policy/Guardian để test dễ hơn.
- Human evidence và Agent evidence tách biệt.
- Persistent learning/evidence dùng stable Browser identity; Extension identity chỉ là transport/provenance.
- `main` chỉ được thay đổi khi có quyết định merge riêng.
