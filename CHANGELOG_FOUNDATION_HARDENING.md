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
