# OctoFinance - Báo cáo E2E Test (Playwright MCP)
**Ngày test**: 2026-05-25  
**Tester**: GitHub Copilot (Playwright MCP)  
**Môi trường**: http://localhost:8000  
**Tài khoản test**: phucvh / Super Admin

---

## Tổng quan

| Hạng mục | Kết quả |
|---|---|
| Tổng flows đã test | 15 |
| Flows hoạt động đúng | 11 |
| Issues phát hiện | 4 |
| Screenshots chụp | 35 |
| Console errors | 0 |
| Network errors (4xx/5xx) | 0 |

---

## Flows đã test

| # | Flow | Kết quả | Screenshot |
|---|---|---|---|
| 1 | Login với credentials hợp lệ | ✅ PASS | `02-after-login.png` |
| 2 | Dashboard - Tab Chỉ số sử dụng | ⚠️ WARN | `03-tab-chi-so-su-dung.png` |
| 3 | Dashboard - Tab Yêu cầu cao cấp | ✅ PASS | `04-tab-yeu-cau-cao-cap.png` |
| 4 | Dashboard - Tab Báo cáo sử dụng | ✅ PASS | `05-tab-bao-cao-su-dung.png` |
| 5 | Dashboard - Tab Trung tâm chi phí | ✅ PASS | `06-tab-trung-tam-chi-phi.png` |
| 6 | Dashboard - Tab Giám sát | ⚠️ UI | `07-tab-giam-sat.png` |
| 7 | Dashboard - Tab ROI | ✅ PASS | `08-tab-roi.png` |
| 8 | Dashboard - Tab Nhóm người dùng | ✅ PASS | `09-tab-nhom-nguoi-dung.png` |
| 9 | Chat - Tạo session mới | ✅ PASS | `16-new-chat-session.png` |
| 10 | Chat - Gửi tin nhắn & nhận phản hồi AI | ✅ PASS | `18-chat-response.png` |
| 11 | Nhật ký - Mở / thu gọn panel | ✅ PASS | `12-13-audit-log-*.png` |
| 12 | Nhật ký - Expand entry chi tiết | ✅ PASS | `19-audit-log-entry-expanded.png` |
| 13 | Đồng bộ dữ liệu | ⚠️ WARN | `20-sync-data-started.png` |
| 14 | Quét Vòng Đời (Lifecycle Scan) | ✅ PASS | `21-lifecycle-scan.png` |
| 15 | Cảnh báo - Config | ⚠️ UX | `26-alert-config-open.png` |
| 16 | Light/Dark mode toggle | ✅ PASS | `24-light-mode.png` |
| 17 | Language toggle (VI/EN/ZH) | ✅ PASS | `27-28-language-*.png` |
| 18 | User Management (Quản lý / Tất cả NSD) | ✅ PASS | `31-32-user-mgmt.png` |
| 19 | Upload CSV (file chooser mở) | ✅ PASS | `34-csv-upload.png` |
| 20 | Logout | ✅ PASS | `35-logout.png` |

---

## Chi tiết Issues

---

### 🔴 ISSUE #1 - Billing data không khả dụng
**Severity**: Medium  
**Tab**: Chỉ số sử dụng (và có thể các tab khác)  
**Screenshot**: `e2e-screenshots/03-tab-chi-so-su-dung.png`

**Mô tả**:  
Trên tab "Chỉ số sử dụng", hiển thị cảnh báo màu vàng:
> "⚠️ Dữ liệu billing không khả dụng — token của bạn cần quyền manage_billing:copilot. Vào GitHub → Settings → Developer Settings → Personal Access Tokens và thêm scope này."

**Nguyên nhân**: GitHub PAT được cấu hình trong hệ thống chưa có scope `manage_billing:copilot`.

**Ảnh hưởng**:
- Không hiển thị được chi phí chính xác từ GitHub Billing API
- Các chỉ số `$195 lãng phí tháng` và `$1,599 chi phí tháng` được tính toán từ dữ liệu local, không từ GitHub Billing API
- Tab "Báo cáo sử dụng" cũng hiển thị info: "Upload CSV Báo cáo sử dụng để xem chi tiết thanh toán."

**Khuyến nghị**: Thêm scope `manage_billing:copilot` vào PAT trong GitHub Settings.

---

### 🟡 ISSUE #2 - Pie chart labels bị overlap (Giám sát tab)
**Severity**: Low-Medium (UI/Visual)  
**Tab**: Giám sát (AI Model Monitoring)  
**Screenshot**: `e2e-screenshots/07-tab-giam-sat.png`

**Mô tả**:  
Trên tab "Giám sát", biểu đồ tròn "Tỷ lệ sử dụng Model" hiển thị labels bị chồng lấp nhau khi có nhiều model với tỷ lệ nhỏ. Cụ thể các nhãn sau bị overlap:
- `Claude-opus-4.6` 
- `GPT-5.4 3%`
- `Claude-opus-` (bị cắt)
- `Claude-4.6-sonnet`

**Root cause**: Không có logic ẩn nhãn khi các slice quá nhỏ hoặc quá gần nhau. Với 14+ models, không gian hiển thị không đủ.

**Khuyến nghị**:
- Ẩn nhãn cho các slice < 3% và hiển thị trong legend riêng
- Hoặc dùng tooltip thay vì labels trực tiếp trên chart
- Hoặc group các model nhỏ vào "Others"

---

### 🟡 ISSUE #3 - Alert Config panel không auto-scroll vào view
**Severity**: Low-Medium (UX)  
**Vị trí**: Sidebar → Cảnh báo → ⚙ Cấu hình  
**Screenshot**: `e2e-screenshots/26-alert-config-open.png`

**Mô tả**:  
Khi nhấn nút "⚙ Cấu hình" trong section "Cảnh báo" ở sidebar:
- Panel cấu hình **được mở thành công** (confirmed qua JS: `display: flex`)
- Tuy nhiên sidebar **không tự cuộn** xuống để hiển thị nội dung vừa mở
- Người dùng phải **manually scroll** sidebar để thấy form cấu hình

**Steps to reproduce**:
1. Đăng nhập
2. Trong sidebar, tìm section "Cảnh báo"  
3. Click "⚙ Cấu hình"
4. Panel mở nhưng không thấy gì vì không có auto-scroll

**Khuyến nghị**:
```tsx
// Sau khi setConfigOpen(true), scroll panel vào view:
configRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
```
Hoặc render panel config dưới dạng modal/overlay thay vì inline trong sidebar.

---

### 🟡 ISSUE #4 - "Sync already in progress" khi bấm Đồng bộ thủ công
**Severity**: Low (informational)  
**Vị trí**: Header → "Đồng bộ dữ liệu" button  
**Screenshot**: `e2e-screenshots/20-sync-data-started.png`

**Mô tả**:  
Khi bấm "Đồng bộ dữ liệu" trong khi cron job 5 phút đang chạy, audit log hiển thị:
```
13:00:22 [SYNC] [WARN] Sync already in progress, skipping
```
Hệ thống xử lý gracefully (không crash), nhưng người dùng không nhận được feedback trực tiếp trên UI - button không disable trong khi sync đang chạy.

**Ảnh hưởng**: Người dùng có thể bấm sync nhiều lần và không biết sync đã đang chạy.

**Khuyến nghị**:
- Disable "Đồng bộ dữ liệu" button khi sync đang in-progress
- Hiển thị loading spinner / "Đang đồng bộ..." text trên button
- Có thể thêm indicator ở header bar khi sync đang chạy

---

## Observations (Không phải Bug, nhưng đáng lưu ý)

### OBS #1 - Audit Log (Nhật ký) là hybrid log
**Mô tả**: Panel "Nhật ký" bao gồm cả:
- `[SYNC]` events: cron sync, manual sync, data sync progress
- `[USER]`, `[USAGE]`, `[TOOL]`, `[RESULT]` events: AI chat processing cho session hiện tại

Khi mở session chat mới, panel ban đầu hiển thị 0 entries và message "Chưa có nhật ký. Gửi tin nhắn để xem chi tiết xử lý AI." Sau khi gửi tin và sync chạy, số lượng tăng lên (ví dụ: 10 → 25 → 39 → 53 entries).

**Đánh giá**: Hành vi đúng, log đầy đủ. Tuy nhiên có thể cân nhắc thêm filter theo loại event.

### OBS #2 - Language toggle: VI → EN → ZH → VI
**Mô tả**: App hỗ trợ 3 ngôn ngữ (Tiếng Việt, English, 中文). Nút toggle hiển thị ngôn ngữ HIỆN TẠI, khi click sẽ chuyển sang ngôn ngữ tiếp theo theo vòng.

**Đánh giá**: Đây là thiết kế có chủ đích. UX có thể cải thiện bằng dropdown thay vì cycle button.

### OBS #3 - Pie chart label "Claude-opus-4.6" bị truncated thành "Claude-opus-"
**Mô tả**: Một số model names bị cắt ngắn trong pie chart labels (visible trong screenshot 07).

### OBS #4 - Cost "1" trong audit log [USAGE] entry
**Mô tả**: Khi expand [USAGE] entry trong audit log, hiển thị `"cost": 1` cùng với `"input_tokens": 21891`. Không rõ đơn vị là gì (cents? AIC units?). Cần documentation để tránh nhầm lẫn.

### OBS #5 - Sidebar lifecycle scan results không visible mặc định
**Mô tả**: Sau khi "Quét Vòng Đời", kết quả (5 inactive, $195/mo waste) hiển thị ngay dưới scan controls trong sidebar. Tuy nhiên danh sách user cụ thể không visible vì sidebar bị scroll xuống dưới vùng nhìn thấy.

---

## Audit Log Details

### Các entries ghi nhận trong test session

```
[SYNC] Cron triggered sync (Every 5 minutes)
[SYNC] Data sync started  
[SYNC] [INFO] Starting sync for 0 org(s) and 1 enterprise(s) [enterprises: hpt]
[SYNC] [INFO] Enterprises synced: ['hpt']
[SYNC] [INFO] Syncing enterprise: hpt...
[SYNC] [INFO] hpt: 0 cost centers, expanding members...
[SYNC] [INFO] hpt: cost centers synced (0 centers)
[SYNC] [INFO] hpt: seats synced (41 total)
[SYNC] [INFO] hpt: usage report synced (1 records)
[SYNC] [INFO] hpt: usage users report synced (262 records)
[SYNC] [INFO] Sync complete: 5 datasets synced, 0 errors
[SYNC] Data sync completed successfully
[SYNC] [WARN] Sync already in progress, skipping  ← manual sync triggered during cron

[USER] Tìm tất cả người dùng chưa sử dụng Copilot trong 30 ngày qua...
[USAGE] Model: claude-sonnet-4.6
[TOOL] Tool: report_intent
[TOOL] Tool: find_inactive_users  
[TOOL] Tool: get_cost_overview
[RESULT] report_intent: Intent logged
[RESULT] get_cost_overview: {"organizations": [{"org": "hpt", "plan_type": "business"...}]}
[RESULT] find_inactive_users: {"inactive_users": [...]}
[USAGE] Model: claude-sonnet-4.6 (2nd turn)
[AI] Assistant response (914 chars)
```

### AI Tool Execution (chat session)

```json
// [USAGE] Expanded entry:
{
  "input_tokens": 21891,
  "output_tokens": 177,
  "cost": 1,
  "duration": 4405
}
```

---

## Screenshots Index

| File | Nội dung |
|---|---|
| `01-homepage.png` | Login page |
| `02-after-login.png` | Dashboard sau khi đăng nhập |
| `03-tab-chi-so-su-dung.png` | Tab Chỉ số sử dụng (có billing warning) |
| `04-tab-yeu-cau-cao-cap.png` | Tab Yêu cầu cao cấp |
| `05-tab-bao-cao-su-dung.png` | Tab Báo cáo sử dụng |
| `06-tab-trung-tam-chi-phi.png` | Tab Trung tâm chi phí |
| `07-tab-giam-sat.png` | Tab Giám sát (pie chart label overlap) |
| `08-tab-roi.png` | Tab ROI |
| `09-tab-nhom-nguoi-dung.png` | Tab Nhóm người dùng |
| `10-nhom-team-alpha-members.png` | Modal Thành viên Team Alpha |
| `11-audit-log-main.png` | Audit log panel (full page) |
| `12-audit-log-panel.png` | Audit log panel visible |
| `13-audit-log-expanded.png` | Audit log thu gọn |
| `14-chat-view.png` | Chat view |
| `15-chat-full-session.png` | Chat session existing |
| `16-new-chat-session.png` | New chat session (0 audit entries) |
| `17-chat-sending-message.png` | AI đang xử lý (tool calls visible) |
| `18-chat-response.png` | AI phản hồi hoàn tất |
| `19-audit-log-entry-expanded.png` | Audit log entry expanded (USAGE detail) |
| `20-sync-data-started.png` | Sync triggered - WARN overlap |
| `21-lifecycle-scan.png` | Lifecycle scan result (5 inactive) |
| `22-lifecycle-scan-results.png` | Lifecycle scan results in sidebar |
| `23-lifecycle-scan-sidebar.png` | Sidebar với scan summary |
| `24-light-mode.png` | Light mode active |
| `25-alert-config.png` | Alert config (button visible) |
| `25b-alert-config-clicked.png` | After click config (panel hidden below fold) |
| `26-alert-config-open.png` | Alert config panel open (after scroll) |
| `27-language-en.png` | Language EN |
| `28-language-bug-chinese.png` | Language ZH (3rd toggle state) |
| `29-dashboard-after-return.png` | Dashboard sau khi back |
| `30-sidebar-scrolled.png` | Sidebar scrolled |
| `31-quan-ly-tab.png` | Tab Quản lý |
| `32-tat-ca-nguoi-dung.png` | Tab Tất cả người dùng |
| `33-audit-log-final-full.png` | Audit log final full page (53 entries) |
| `34-csv-upload-cancelled.png` | Upload CSV (file chooser opened) |
| `35-logout.png` | Logout → redirect to login |

---

## Kết luận

Ứng dụng OctoFinance hoạt động **ổn định** với toàn bộ các luồng chính. Không có lỗi JavaScript hay network errors trong suốt quá trình test. Các tính năng core (Dashboard, Chat AI, Audit Log, Lifecycle Scan, User Management, Light/Dark mode, Multilanguage) đều hoạt động đúng.

4 issues phát hiện chủ yếu là **UX/Visual** và 1 **configuration issue** (billing scope). Không có lỗi nghiêm trọng nào (critical bug, data loss, security issue) được phát hiện.

### Priority Fix List

| # | Issue | Priority | Effort |
|---|---|---|---|
| 1 | Billing scope cho PAT | High | Low (config) |
| 2 | Alert config auto-scroll | Medium | Low |
| 3 | Pie chart label overlap | Medium | Medium |
| 4 | Sync button disable khi busy | Low | Low |
