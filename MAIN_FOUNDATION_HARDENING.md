# Kế hoạch củng cố nền tảng main

Nhánh thực hiện: `feat/main-foundation-hardening`

Mục tiêu: củng cố nền `main` theo 5 bước nhỏ, mỗi bước phải có test hồi quy và được rà soát độc lập trước khi chuyển sang bước tiếp theo.

## 1. Sửa vòng đời trạng thái BUSY / ACTIVE của Browser — HOÀN THÀNH

Mục tiêu:
- Browser phải giữ `BUSY` khi còn bất kỳ physical execution nào đang chạy hoặc đang xếp hàng trong `ExecutionLane`.
- Chỉ trở về `ACTIVE` khi lane của Browser/Extension đã thực sự cạn (`active=false`, `queued=0`).
- Không ghi đè các trạng thái mạnh hơn như `OFFLINE`, `QUARANTINED`, `ERROR`, `HUMAN_CONTROL`.
- Environment Guardian không được nhìn thấy Browser là `ACTIVE` trong lúc vẫn còn BODY work đang chờ/chạy.

Kết quả:
- `ExecutionLane` có snapshot `busy = active || queued > 0` và phát lifecycle callback khi enqueue/start/finish.
- Browser state được đồng bộ từ execution queue thay vì từng Task tự bật/tắt BUSY.
- Hai physical work cùng Browser không còn khoảng ACTIVE giả giữa hai lệnh.
- Failure path vẫn giữ BUSY nếu còn work chờ.
- Guardian từ chối probe khi Browser BUSY.
- HUMAN_CONTROL / QUARANTINED / ERROR / OFFLINE không bị idle callback ghi đè.
- Regression contracts đã được thêm vào `npm run verify` và PR CI đã PASS trước bước cập nhật trạng thái tài liệu này.

## 2. Tăng bảo mật ghép nối Extension — HOÀN THÀNH

Mục tiêu:
- Bỏ cơ chế tự tin cậy hoàn toàn ở lần kết nối đầu.
- Thêm pairing window / one-time nonce hoặc cơ chế xác nhận tương đương.
- Giữ local-first, không cần cloud.
- Không phá token authentication của Extension đã ghép nối.

Kết quả:
- Extension mới fail-closed; không còn TOFU tự tạo token khi chỉ biết localhost port/protocol.
- Pairing window chỉ được mở từ console daemon cục bộ bằng `pair open [30-300 seconds]`.
- Mã pairing 8 ký tự dùng một lần, chỉ nằm trong RAM, mặc định hết hạn sau 120 giây và có giới hạn mã sai khác nhau.
- Pairing control không được đưa vào Brain protocol hoặc debug socket.
- Popup Extension cho Human nhập mã; mã pairing không được persist vào Chrome storage.
- Persistent token chỉ được lưu sau khi daemon trả `AUTH_PAIRED`; Extension đã paired tiếp tục reconnect bằng token cũ.
- Binding `extensionInstanceId + browserInstanceId + runtimeExtensionId + Origin` vẫn được giữ.
- `pair forget <extensionId>` revoke credential và terminate live socket; old token không thể reconnect.
- Popup có recovery có xác nhận để xóa token cục bộ rồi re-pair bằng pairing window mới.
- Không thêm Chrome privileged permission mới.
- Regression contracts cho closed/open/expiry/replay/wrong-code/binding/forget/re-pair/popup/build đã được đưa vào `npm run verify`; CI runtime cuối của Mục 2 đã PASS trước commit tài liệu này.

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
