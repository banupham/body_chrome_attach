# Rà soát Mục 1 — BUSY / ACTIVE lifecycle

Phạm vi đã thay đổi:

- `daemon/src/execution_lane.js`
  - thêm `busy = active || queued > 0` vào snapshot.
  - phát `onStateChange` khi enqueue, bắt đầu và kết thúc execution.
  - observer lỗi không làm hỏng execution; lỗi observer được ghi vào trạng thái lane.
- `daemon/src/daemon_runtime.js`
  - Browser BUSY/ACTIVE được đồng bộ từ ExecutionLane.
  - bỏ việc `withTask()` tự bật BUSY rồi tự trả ACTIVE.
  - không ghi đè `HUMAN_CONTROL`, `QUARANTINED`, `ERROR`, `OFFLINE` khi lane cạn.
  - nếu môi trường trở thành không hợp lệ trong lúc BUSY, lane cạn sẽ đưa Browser về `QUARANTINED`, không `ACTIVE`.
- thêm regression contracts cho queue, failure, Browser state và Guardian.

Rủi ro đã kiểm tra bằng contract:

1. Hai execution cùng Browser không tạo khoảng ACTIVE giả giữa hai lệnh.
2. Execution đầu thất bại nhưng execution sau còn chờ thì Browser vẫn BUSY.
3. Lane cạn mới được ACTIVE.
4. HUMAN_CONTROL / QUARANTINED / ERROR / OFFLINE không bị callback idle ghi đè.
5. Guardian từ chối probe khi Browser BUSY.
6. Môi trường bị đánh dấu không hợp lệ trong lúc execution thì không được tái kích hoạt.

Rủi ro còn phải theo dõi sau CI / runtime thực tế:

- Debug low-level được gọi khi Browser đang `ENV_CHECK` hoặc `QUARANTINED` không bị ép sang BUSY; đây là hành vi cố ý để không ghi đè trạng thái Guardian, nhưng diagnostic path vẫn phải được dùng có kiểm soát.
- `onStateChange` là callback đồng bộ. Nếu observer phát sinh lỗi, execution vẫn tiếp tục và `observerErrors` tăng; cần theo dõi status để không che lỗi wiring lâu dài.
- Scope của ExecutionLane hiện là `extensionInstanceId`. Với kiến trúc hiện tại một Browser đang bind một Extension nên phù hợp; khi Mục 4 thay identity learning hoặc sau này thay transport binding, cần rà lại scope execution riêng.

# Rà soát Mục 2 — Extension pairing hardening

Phạm vi đã thay đổi:

- `daemon/src/local_auth.js`
  - Extension mới bị từ chối mặc định nếu chưa có pairing window.
  - pairing code 8 ký tự, dùng một lần, chỉ tồn tại trong RAM.
  - cửa sổ mặc định 120 giây, giới hạn 30–300 giây.
  - giới hạn số mã sai khác nhau; websocket retry cùng một mã sai không làm cạn quota nhiều lần.
  - Extension đã paired tiếp tục xác thực bằng persistent token như cũ.
  - binding `extensionInstanceId + browserInstanceId + runtimeExtensionId + Origin` vẫn được kiểm tra.
- `daemon/src/local_pairing_console.js`
  - chỉ console local có `pair open/status/list/close/forget`.
  - không đưa pairing control vào debug socket hoặc Brain protocol.
  - `pair forget` xóa credential phía daemon và yêu cầu ngắt ngay live WebSocket của Extension đang bị revoke.
- `src/service_worker_entry.js` + popup Extension
  - popup nhận mã pairing và chỉ dùng mã đó tạm thời cho lần HELLO tiếp theo.
  - mã pairing không được ghi vào `chrome.storage.local`.
  - persistent token chỉ được ghi sau `AUTH_PAIRED` từ daemon.
  - có recovery chủ đích `body.pairReset` để xóa token cục bộ sau khi daemon đã revoke/forget, rồi re-pair bằng window mới.
- `manifest.json` không thêm permission đặc quyền mới.
- thêm contract riêng cho pairing auth, expiry, replay, binding, console, revocation và popup wiring.

Rủi ro đã kiểm tra / chủ động xử lý:

1. New Extension không còn TOFU auto-pair.
2. Pairing code không thể dùng cho Extension thứ hai sau khi pair thành công.
3. Sai cùng một code lặp lại do reconnect không tự lock người dùng ra ngoài.
4. Pairing window hết hạn thì code cũ không còn hiệu lực.
5. Existing token vẫn bị khóa theo Runtime/Browser binding.
6. `pair status/list` không lộ token hash hoặc token thật.
7. Popup không yêu cầu thêm Chrome permission.
8. Contract identity cũ đã được cập nhật để re-pair sau `forget` cũng phải mở pairing window mới.
9. `pair forget` làm old persistent token mất hiệu lực và ngắt live connection thay vì chờ reconnect tự nhiên.
10. Extension có đường phục hồi rõ ràng để xóa token cục bộ cũ trước khi re-pair; thao tác này cần Human bấm xác nhận trong popup.

Rủi ro còn phải theo dõi sau CI / runtime thực tế:

- Extension chưa paired vẫn reconnect định kỳ và có thể tạo log `AUTH_ERROR` trong lúc pairing window đóng. Đây là noise vận hành, không làm mở quyền; có thể tối ưu backoff ở một bước sau nếu cần.
- Pairing window là state trong RAM, nên daemon restart sẽ đóng window ngay. Đây là hành vi fail-closed có chủ đích.
- Nếu pairing auth thành công nhưng bước đăng ký identity sau đó thất bại, server xóa record vừa pair; người dùng phải mở window mới. Không tự khôi phục code cũ để tránh replay.
- `pair forget` revoke credential ngay nhưng cleanup trạng thái Browser vẫn đi qua cùng WebSocket close lifecycle hiện hữu; cần giữ contract disconnect/reconcile khi sau này sửa ExtensionRegistry ở Mục 3.
- Threat model không cố chống malware đã có quyền đọc process memory/console của cùng máy; mục tiêu của Mục 2 là ngăn Extension/process local khác tự TOFU-pair chỉ nhờ biết port/protocol.
