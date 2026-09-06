# Foundation Hardening Changelog

## Mục 1 - Browser BUSY/ACTIVE lifecycle

Trạng thái ban đầu:

- Task execution sử dụng `ExecutionLane` để serialize physical work.
- Browser state `BUSY/ACTIVE` được quản lý ở lớp task execution.
- Có nguy cơ trạng thái Browser quay về ACTIVE trước khi toàn bộ queue trong execution lane kết thúc.

Mục tiêu thay đổi:

- Một Browser chỉ ACTIVE khi không còn execution đang chạy hoặc đang chờ.
- Không để Environment Guardian hiểu nhầm Browser đang rảnh trong lúc BODY còn hoạt động.

Các điểm cần rà soát sau implementation:

1. Task thành công.
2. Task thất bại.
3. Hai Task cùng Browser nhưng khác Tab.
4. Daemon restart trong lúc execution.
5. Browser offline trong lúc queue còn tồn tại.
6. Guardian probe trong thời gian execution.

Các lỗi tiềm ẩn cần kiểm tra:

- deadlock execution lane.
- Browser bị kẹt BUSY sau exception.
- Browser ACTIVE sai khi queue chưa hết.
- ảnh hưởng tới HUMAN_CONTROL.
- ảnh hưởng tới QUARANTINED/ERROR.

## Mục 3 - Debug routing + Browser UI fast path

Thay đổi đã hoàn thành:

- `ExtensionRegistry` có target resolver theo online index, full ID hoặc unique prefix; target mơ hồ bị từ chối.
- Selection sau disconnect được reconcile fail-closed: chỉ auto-select nếu còn đúng một Extension online.
- Thêm debug adapter với `exts`, `use`, `next`, `prev`, `@ref <cmd>`, `--ext=<ref>`, raw JSON và multiline JSON có giới hạn kích thước.
- Debug WebSocket và local console dùng cùng adapter; pairing command vẫn chỉ chạy ở local console.
- `body_cli.js` hỗ trợ paste multiline structured command.
- Browser UI có fast path cho `address/back/forward/reload/hardreload` qua Chrome tabs API.
- Khi fast path không khả dụng/lỗi, Browser UI quay về native keyboard path cũ.
- `address` không phải URL HTTP/HTTPS giữ native address/search behavior.
- Page physical motor không thay đổi và CDP allowlist vẫn chỉ gồm `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.
- Không merge toàn bộ research branch; chỉ đưa phần production cần thiết về nhánh hardening.

Regression gates đã thêm:

- `daemon/debug_routing_contract.js`
- `tests/browser_ui_fast_path_contract.js`
- cả hai được đưa vào `npm run verify`.
- CI code + regression cuối trước tài liệu: workflow #207 — PASS.
