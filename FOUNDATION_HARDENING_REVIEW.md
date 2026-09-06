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
