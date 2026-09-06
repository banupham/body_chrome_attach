# Kế hoạch củng cố nền tảng main

Nhánh thực hiện: `feat/main-foundation-hardening`

Mục tiêu: củng cố nền `main` theo 5 bước nhỏ, mỗi bước phải có test hồi quy và được rà soát độc lập trước khi chuyển sang bước tiếp theo.

## 1. Sửa vòng đời trạng thái BUSY / ACTIVE của Browser — ĐANG THỰC HIỆN

Mục tiêu:
- Browser phải giữ `BUSY` khi còn bất kỳ physical execution nào đang chạy hoặc đang xếp hàng trong `ExecutionLane`.
- Chỉ trở về `ACTIVE` khi lane của Browser/Extension đã thực sự cạn (`active=false`, `queued=0`).
- Không ghi đè các trạng thái mạnh hơn như `OFFLINE`, `QUARANTINED`, `ERROR`, `HUMAN_CONTROL`.
- Environment Guardian không được nhìn thấy Browser là `ACTIVE` trong lúc vẫn còn BODY work đang chờ/chạy.

Điều kiện hoàn thành:
- Có regression test với ít nhất 2 Task/physical work cùng Browser.
- Kiểm tra cả success và failure path.
- `npm run verify` và CI PASS.

## 2. Tăng bảo mật ghép nối Extension — CHƯA THỰC HIỆN

Mục tiêu:
- Bỏ cơ chế tự tin cậy hoàn toàn ở lần kết nối đầu.
- Thêm pairing window / one-time nonce hoặc cơ chế xác nhận tương đương.
- Giữ local-first, không cần cloud.
- Không phá token authentication của Extension đã ghép nối.

## 3. Đưa debug routing + Browser UI fast path về nền main — CHƯA THỰC HIỆN

Mục tiêu:
- Debug nhiều Extension phải chọn đích rõ ràng, fail-closed khi mơ hồ.
- Khi Extension đang chọn mất kết nối: chỉ tự chọn nếu còn đúng một Extension online.
- Đưa Browser UI fast path cho `address/back/forward/reload/hardreload` về main nhưng giữ native fallback.
- Không mở rộng CDP gateway; page action vẫn chỉ dùng HUMAN_MOTOR allowlist.

## 4. Chuyển learning khỏi extensionId sang identity ổn định — CHƯA THỰC HIỆN

Mục tiêu:
- Không xem `extensionInstanceId` là identity lâu dài của dữ liệu học.
- Thiết kế migration an toàn sang `browserInstanceId` và/hoặc scope Human/device/platform phù hợp.
- Không làm mất model/dataset hiện có và không trộn dữ liệu giữa Browser khác nhau.

## 5. Phase 5: Semantic Observation + Immutable Evidence Store — CHƯA THỰC HIỆN

Mục tiêu:
- Đưa semantic observer read-only tối thiểu vào main.
- Tạo Evidence Store tách khỏi DatasetStore dùng cho Motor/Habit.
- Chuẩn hóa chuỗi `BeforeState -> Action -> AfterState -> ObservedEffect` với provenance rõ ràng.
- Chứng minh một Human demonstration `youtube.search` có thể tạo evidence có thể truy vết.

## Nguyên tắc chung

- Mỗi mục là một thay đổi độc lập, không làm trước việc của mục sau.
- Không merge toàn bộ nhánh research vào main.
- Content script chỉ đọc/quan sát.
- Page physical action chỉ qua `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.
- Browser UI dùng đường riêng.
- Không nới Policy/Guardian chỉ để test dễ hơn.
- Human evidence và Agent evidence luôn tách biệt.
