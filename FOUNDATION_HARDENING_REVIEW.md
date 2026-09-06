# Rà soát Foundation Hardening — Mục 1 đến Mục 5

Phạm vi review: toàn bộ thay đổi trên `feat/main-foundation-hardening` so với `main` tại `6070b9425d0a4605aed69788f2f613340586b5b6`.

Nguyên tắc đánh giá:
- Không xem CI xanh là đủ; kiểm tra lại identity scope, lifecycle, provenance, persistence, privacy và đường thực thi.
- Không đánh đồng `delivered`, `observed`, `verified`, `taskSuccess`.
- Không mở thêm page-control capability để giải quyết vấn đề quan sát.

## 1. Browser BUSY / ACTIVE lifecycle

Đã thay đổi:
- `ExecutionLane` sở hữu `busy = active || queued > 0`.
- Browser state theo toàn bộ lane, không theo từng Task wrapper.
- Idle callback không ghi đè `HUMAN_CONTROL`, `QUARANTINED`, `ERROR`, `OFFLINE`.

Đã khóa bằng contract:
1. Hai execution nối tiếp không tạo ACTIVE gap.
2. Work đầu fail nhưng work sau còn chờ => vẫn BUSY.
3. Guardian từ chối probe Browser BUSY.
4. Environment ineligible sau lane => QUARANTINED, không ACTIVE.

Rủi ro còn lại:
- Existing queued physical work chưa có cơ chế cancel riêng khi HUMAN_CONTROL bắt đầu; đây là vấn đề Human Override/lifecycle rộng hơn, không phải regression Mục 1.
- Scope lane vẫn là live `extensionInstanceId`. Với binding hiện tại phù hợp; nếu sau này transport rebind khi Browser vẫn sống, cần thiết kế lại execution scope độc lập với Mục 4 learning scope.

## 2. Extension pairing hardening

Đã thay đổi:
- Extension mới fail-closed; không TOFU.
- Pairing window/mã một lần chỉ được mở ở local daemon console.
- Persistent token chỉ cấp sau pairing thành công và vẫn khóa theo Browser/Runtime/Origin.
- `pair forget` revoke credential và terminate live socket.

Đã khóa bằng contract:
1. Pairing đóng => Extension mới bị từ chối.
2. Code one-use/expiry/replay/rate-limit.
3. Existing persistent token reconnect không bị phá.
4. Re-pair sau forget phải mở window mới.
5. Popup không persist one-time code và không thêm permission.

Rủi ro còn lại:
- Extension chưa pair vẫn có thể reconnect định kỳ và tạo AUTH_ERROR log noise.
- Pairing window RAM-only nên daemon restart sẽ đóng window; đây là fail-closed có chủ đích.
- Threat model không cố chống malware đã có quyền đọc process memory/console của cùng máy.

## 3. Debug routing + Browser UI fast path

Đã thay đổi:
- Multi-Extension debug target resolver theo online index/full ID/unique prefix.
- `exts`, `use`, `next`, `prev`, `@ref`, `--ext`, raw/multiline JSON.
- Selected disconnect chỉ auto-select khi còn đúng một Extension online.
- Browser UI fast path qua Chrome tabs API; native fallback vẫn tồn tại.

Đã khóa bằng contract:
1. Ambiguous target fail-closed.
2. Disconnect với nhiều Extension không tự đoán target.
3. Targeted debug command được serialize và restore selection.
4. `address/back/forward/reload/hardreload` không dùng CDP Input khi fast path có sẵn.
5. Fast path fail => native Browser UI, không rơi sang page motor.
6. CDP allowlist vẫn chỉ `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.

Rủi ro còn lại:
- Debug targeted command vẫn tạm thời thay mutable `selectedId`; adapter serialize debug traffic để tránh race. Nếu có thêm control-plane phụ thuộc global selection, nên chuyển sang explicit context hoàn toàn.
- Browser API availability phụ thuộc Chrome runtime; native fallback là chủ đích tương thích.

## 4. Stable Browser learning identity

Đã thay đổi:
- `ScopedLearningManager` persistent key chuyển sang `browserInstanceId`.
- Layout mới: `profiles/by-browser/<browserInstanceId>/<siteKey>`.
- `extensionInstanceId`/`runtimeExtensionId` chỉ còn provenance của sample/event.
- Runtime resolver ánh xạ live Extension ref về identity chain trước khi mở learning scope.
- `TabHabitModel` schema v2 tách `transitionsByBrowser` và `lastActiveByBrowser`.

Migration đã thiết kế:
- Nếu chỉ có legacy `profiles/<extensionInstanceId>`: move nguyên tử sang Browser scope.
- Nếu Browser destination tồn tại nhưng rỗng: legacy thay thế empty destination.
- Nếu legacy và Browser scope đều có payload: throw `legacy_learning_migration_conflict`, giữ nguyên cả hai; không merge đoán và không xóa.
- Migration check chạy trước cache reuse, nên transport Extension xuất hiện muộn với legacy directory riêng vẫn bị phát hiện.
- Legacy TabHabit v1 global transition không có Browser attribution được giữ trong `legacyUnscopedTransitions` nhưng không dùng làm active learning signal.

Đã khóa bằng `daemon/learning_identity_contract.js`:
1. Legacy data migrate và đọc lại được.
2. Sample mới có Browser identity + Extension provenance.
3. Hai ref cùng Browser dùng chung stable scope.
4. Browser khác không bị trộn.
5. Conflict bảo toàn cả hai payload và fail-closed.
6. Cached stable scope vẫn bắt late legacy conflict.
7. TabHabit v1 unscoped transition không cộng nhầm sang Browser mới.

Đánh giá:
- Mục 4 đạt mục tiêu persistent identity. Runtime ephemeral state như pointer/segmenter/tabSites vẫn key theo live Extension; đây là đúng vai trò transport/session và không cần migrate sang Browser.

Rủi ro còn lại:
- `fs.renameSync` giả định legacy và destination nằm cùng filesystem; trong layout hiện tại cả hai cùng dưới `profiles`, nên điều kiện này được đáp ứng.
- Conflict cần operator quyết định sau này; cố ý không tự merge vì không có bằng chứng attribution đủ mạnh.
- Legacy global TabHabit transitions bị mất giá trị training active, nhưng được bảo toàn để audit; đây là tradeoff tránh cross-Browser contamination.
- LocalIdentity hiện vẫn bind Browser với Extension khá chặt. Mục 4 decouple storage identity chứ không tự thay policy transport rebind.

CI gate Mục 4 cuối sau self-review: workflow #219 — PASS.

## 5. Semantic Observation + Immutable Evidence Store

Đã thay đổi:
- `src/youtube_semantic_observer.js`: observer read-only tối thiểu.
- `src/virtual_cursor_content.js`: chỉ expose `body.semanticObservation` read path.
- `src/daemon_bridge.js`: Human Enter có semantic-before candidate; tab update/complete gửi semantic-after.
- `daemon/src/evidence_assembler.js`: ghép Human trigger thành `youtube.search` evidence.
- `daemon/src/evidence_store.js`: storage riêng, append-only JSONL + SHA-256 chain.
- `daemon/src/daemon_runtime.js`: semantic metadata được tách trước DatasetStore/Segmenter.
- `daemon/server.js`: chỉ nhận `SEMANTIC_OBSERVATION` từ Extension đã authenticated; không thêm remote command control.

Privacy/truth boundary:
- Observer không capture query string value, account identity hoặc arbitrary text content.
- Evidence assembler không tin nguyên object observer; chỉ whitelist page type, query-present boolean, search controls geometry/state, search-result count và viewport.
- Persisted evidence không giữ route path/video/list identifiers cho `youtube.search` MVP.
- Nếu privacy flags báo query/account/text đã capture, assembler fail-closed và không tạo candidate.
- `semanticBefore` bị xóa khỏi training event trước `learning.observeEvent()` và `segmenter.handle()`.
- Agent/CDP event không thể trở thành Human evidence vì assembler yêu cầu `source='human'`, `isTrusted=true`, keydown Enter và semantic search input active.
- `ObservedEffect.navigationObserved` chỉ true khi page type thay đổi, search surface xuất hiện hoặc result count thay đổi; không suy diễn navigation chỉ vì after state là trang search.
- Evidence không tự đặt `taskSuccess`; truth layer vẫn tách.

Evidence integrity:
- Mỗi record có `previousHash` + `recordHash` SHA-256.
- Store verify toàn chain trước mỗi append; external tamper làm append/verify fail.
- Không có API update/delete record.
- Pending candidate có TTL; tab removed/browser offline xóa pending để tránh ghép stale evidence.
- Evidence root tách khỏi `profiles`, không tham gia Motor/Habit training.
- BODY_STATUS chỉ lộ số file/record, không lộ filesystem root path.

Đã khóa bằng contract:
1. Observer read-only và không chứa action DOM methods.
2. Query text không xuất hiện trong observation test.
3. Hash chain đúng và tamper bị phát hiện.
4. Agent event không tạo Human evidence.
5. Một trusted Human Enter + semantic after tạo đúng một `youtube.search` record.
6. Stable Browser identity + Extension provenance có trong evidence.
7. `semanticBefore`/semantic result không lọt vào learning DatasetStore.
8. Pending evidence expiry/tab cleanup hoạt động.
9. Bridge before/after path không mở CDP method mới.
10. CDP allowlist vẫn chỉ đúng hai Input methods cũ.

CI gate Mục 5 cuối sau self-review: workflow #236 — PASS.

Rủi ro còn lại:
- Semantic observer hiện mới chứng minh `youtube.search`; chưa phải ontology đa nền tảng.
- YouTube DOM selector có thể thay đổi. Failure phải biểu hiện bằng unavailable/0 result, không được biến thành action fallback.
- Human Enter semantic-before hiện được lấy qua content observation request sau USER event được chuyển tới service worker. Vì navigation có thể bắt đầu rất nhanh, một số demonstration thực tế có thể bị bỏ lỡ; hệ thống khi đó **bỏ evidence** thay vì tạo evidence suy đoán/sai. Nếu cần coverage cao hơn, bước sau nên snapshot semantic ngay trong capture listener và mang snapshot cùng USER event.
- Evidence append verify toàn file trước mỗi ghi là an toàn cho MVP nhưng O(n) theo số record/file; volume lớn cần checkpoint/index mà vẫn giữ tamper detection.
- SHA chain chống sửa lẻ/tamper tình cờ nhưng không phải external notarization: process có toàn quyền filesystem có thể rewrite toàn chain.
- Không lưu query text giúp privacy nhưng Evidence không thể reconstruct chính xác câu Human đã tìm.

## Rà soát tích hợp toàn bộ Mục 1–5

Không phát hiện blocker sau vòng review cuối.

Các invariant còn giữ:
1. Content script observe/read; không thực hiện page action.
2. HUMAN_MOTOR page physical path vẫn chỉ CDP Input allowlist hai phương thức.
3. Browser UI vẫn là capability riêng, có fast/native path riêng.
4. Browser Manager/Task binding không bị learning identity thay thế.
5. Pairing local-only không bị semantic/evidence protocol mở ra Internet/debug.
6. Persistent learning và Evidence đều scope theo Browser stable identity.
7. Human/Agent provenance vẫn tách.
8. Evidence không trở thành training data một cách ngầm định.
9. `main` chưa bị thay đổi; toàn bộ hardening vẫn ở nhánh phụ/PR mở.

Khuyến nghị trước khi merge sau này:
- Squash PR vì nhánh có nhiều commit nhỏ theo từng gate/review.
- Chạy một smoke test Windows thật với Chrome: pair -> Guardian ACTIVE -> Human YouTube search -> kiểm tra Evidence record -> Browser UI fast path -> pair forget/reconnect.
- Nếu smoke test cho thấy semantic-before bị miss thường xuyên, ưu tiên snapshot semantic ngay tại capture listener; không thêm sleep/polling tùy ý.
