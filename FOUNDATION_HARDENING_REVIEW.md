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

# Rà soát Mục 3 — Debug routing + Browser UI fast path

Phạm vi đã thay đổi:

- `daemon/src/extension_registry.js`
  - thêm online index, `shortId`, exact/unique-prefix resolver và `cycle()`.
  - selection sau disconnect chỉ tự phục hồi khi còn đúng một Extension online.
  - nếu còn nhiều Extension online nhưng không có target duy nhất, `selectedId=null` để lệnh không target fail-closed.
- `daemon/src/debug_command_adapter.js`
  - thêm `exts`, `use`, `next`, `prev`, `@ref`, `--ext`.
  - raw JSON và multiline structured command được normalize/giới hạn kích thước.
  - targeted debug command được serialize và selection cũ được khôi phục nếu vẫn online.
- `daemon/server.js` / `body_cli.js`
  - debug socket, console local và CLI đi qua adapter mới.
  - pairing command vẫn được intercept riêng ở local console, không đi qua debug socket.
- `daemon/src/browser_ui_adapter.js` / `src/daemon_bridge.js`
  - thêm Browser API fast path cho `address/back/forward/reload/hardreload`.
  - API fast path dùng `chrome.tabs.update/goBack/goForward/reload`.
  - fast path lỗi hoặc không khả dụng sẽ fallback về native Browser UI input hiện có.
  - HTTP/HTTPS address được phép fast path; chuỗi address/search khác giữ native path.
- `daemon/src/command_router.js`
  - chuẩn hóa alias trực tiếp `address` và `hardreload`.
- thêm `daemon/debug_routing_contract.js` và `tests/browser_ui_fast_path_contract.js` vào `npm run verify`.

Rủi ro đã kiểm tra bằng contract / CI:

1. Full ID, online index và unique prefix chọn đúng Extension.
2. Prefix mơ hồ và index không tồn tại bị từ chối, không tự đoán target.
3. Selected Extension disconnect + một Extension còn lại => auto-select duy nhất.
4. Selected Extension disconnect + nhiều Extension còn lại => selection bị xóa, lệnh không target fail-closed.
5. `next/prev` chỉ cycle Extension online.
6. `@ref` và `--ext` chạy trên target tạm thời rồi khôi phục selection hợp lệ trước đó.
7. Raw/multiline JSON được parse có giới hạn; duplicate target syntax bị từ chối.
8. Cả 5 Browser UI fast action không đi qua CDP input khi Browser API khả dụng.
9. Fast API unavailable/error quay về native Browser UI path; không rơi vào page HUMAN_MOTOR.
10. `ALLOWED_METHODS` vẫn đúng hai phương thức `Input.dispatchMouseEvent` và `Input.dispatchKeyEvent`; không mở rộng CDP gateway.
11. Không thêm manifest permission mới.
12. Code + regression test cuối của Mục 3 đã PASS workflow #207.

Rủi ro còn phải theo dõi sau CI / runtime thực tế:

- Targeted debug command tạm thời thay `registry.selectedId` trong lúc thực thi. Adapter serialize toàn bộ debug command để các debug request không đè selection lẫn nhau; Brain Task execution vẫn dùng identity/task binding rõ ràng thay vì debug selection. Nếu sau này có thêm control-plane khác phụ thuộc global selection, nên chuyển target thành context explicit thay vì mutable selection.
- `use/next/prev` thay đổi selection debug ngay cả khi Brain đang giữ quyền điều khiển, nhưng chúng không tạo physical action; mọi debug command có tác dụng vật lý vẫn tiếp tục bị `ControllerLease` chặn.
- Browser API fast path phụ thuộc Chrome API thực tế trên phiên bản/runtime đang chạy. Fallback native đã được giữ để tránh biến thiếu API thành failure cứng.
- `address` chỉ fast-path URL HTTP/HTTPS; các scheme khác và chuỗi search đi native path. Đây là lựa chọn tương thích hiện tại, không phải policy cho navigation từ xa.
- `pair forget` vẫn terminate live socket rồi đi qua lifecycle `unregisterSocket -> extensionOffline`; selection reconciliation mới đã có contract để tránh hồi quy Mục 2.
