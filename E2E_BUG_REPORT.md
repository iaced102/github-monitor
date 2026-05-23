# OctoFinance E2E Bug Report

**Tested at**: 2026-05-23T08:27  
**Tester**: Playwright MCP (automated)  
**App URL**: http://localhost:8000  
**Account**: phucvh  
**Screenshots**: `~/.copilot/session-state/f7e6cace-497d-4dd6-b6b4-635caebef9d3/files/`

---

## 🔴 CRITICAL

### BUG-001: Acceptance Rate hiển thị 19,943% — công thức sai
- **Trang**: Usage Metrics (`/usage`)
- **Mô tả**: Biểu đồ "Acceptance Rate" hiển thị giá trị **19,943%**, không thể > 100%.
- **Nguyên nhân nghi ngờ**: Đang tính `lines_of_code_accepted / lines_of_code_suggested × 100` thay vì `accepted_completions / total_completions × 100`.
- **Screenshot**: `06_usage.png`
- **Fix**: Kiểm tra công thức trong frontend component tính acceptance rate.

---

## 🔴 HIGH

### BUG-002: Dashboard KPI = 0 mặc dù có dữ liệu thực
- **Trang**: Dashboard (`/`)
- **Mô tả**:
  - Sidebar hiển thị: `40 seats / $1,560 cost / $1,560 waste`
  - Dashboard KPI box hiển thị: `0 seats / 0% utilization / $0 cost / $0 waste`
- **Nguyên nhân**: Dashboard KPI đọc từ Usage Metrics API với date-range filter; khi không có data cho ngày đó → về 0. Sidebar đọc từ billing data (không filter ngày).
- **Screenshot**: `03_dashboard.png`
- **Fix**: Dashboard KPI nên fallback về billing/seats data khi metrics API trả về 0.

### BUG-003: AI Chat tools không đọc được data
- **Trang**: Chat (`/chat`)
- **Mô tả**: Gọi `get_cost_overview` → trả về empty. AI phản hồi *"data hasn't been synced yet or you don't have permissions"* mặc dù data đã sync thành công (40 seats visible ở trang Seats).
- **Nguyên nhân nghi ngờ**: Sau khi migrate storage từ JSON → SQLite, các AI tool session chưa được inject `Database` instance. Chat session tạo ra `DataCollector` không có `db` → `load_latest()` trả về None.
- **Screenshot**: `07_chat_after_send.png`
- **Fix**: Đảm bảo `create_session_collector()` trong `sync.py` hoặc `copilot_engine.py` gọi `set_db(db)` khi khởi tạo session collector.

---

## 🟡 MEDIUM

### BUG-004: Billing page thiếu cost data — PAT missing scope
- **Trang**: Billing (`/billing`)
- **Mô tả**: Trang chỉ hiển thị activity metrics (interactions, code suggestions), không có dữ liệu chi phí thực ($/seat, total cost, waste).
- **Banner cảnh báo**: *"Please add `manage_billing:copilot` scope to your PAT to access billing data."*
- **Nguyên nhân**: PAT hiện tại (`longdn02_TinLT`) thiếu scope `manage_billing:copilot`.
- **Screenshot**: `05_billing.png`, `05_billing_scroll.png`
- **Fix**: Thêm scope `manage_billing:copilot` vào PAT trên GitHub Settings → Developer Settings → Personal Access Tokens.

### BUG-005: Sync log misleading — "Starting sync for 0 org(s)"
- **Trang**: Sync console
- **Mô tả**: Log in ra `[INFO] Starting sync for 0 org(s):` mặc dù enterprise `hpt` sync thành công với 40 seats và 259 users.
- **Nguyên nhân**: `hpt` là **enterprise**, không phải **org** — `get_all_org_logins()` trả về 0. Enterprise được sync riêng qua `sync_enterprises()`.
- **Screenshot**: `10_sync.png`, `10_sync_progress.png`
- **Fix**: Cập nhật log message: `Starting sync for {n_orgs} org(s) and {n_enterprises} enterprise(s)`.

---

## 🟢 LOW

### BUG-006: PAT badge hiển thị "0 orgs" khi quản lý enterprise
- **Trang**: Settings modal
- **Mô tả**: PAT card hiển thị `longdn02_TinLT · 0 orgs · hpt` — "0 orgs" gây hiểu nhầm vì thực tế PAT đang quản lý enterprise `hpt` có 40 users.
- **Screenshot**: `09_settings.png`, `09_settings_interactive.png`
- **Fix**: Label nên là `0 orgs, 1 enterprise` hoặc `hpt (enterprise)`.

### BUG-007: Sync console luôn mở — không có nút ẩn/thu gọn
- **Trang**: Toàn bộ app (console hiển thị ở góc dưới)
- **Mô tả**: Console log stream luôn chiếm không gian màn hình, không có nút hide/minimize.
- **Screenshot**: Thấy ở hầu hết các screenshot.
- **Fix**: Thêm nút collapse/hide cho console panel.

---

## ✅ Không có lỗi

| Tính năng | Trạng thái |
|---|---|
| Login / Logout | ✅ OK |
| Seat Management table (40 users) | ✅ OK |
| Usage — User leaderboard | ✅ OK |
| Usage — IDE Distribution | ✅ OK |
| Usage — Daily Active Trend (28-day) | ✅ OK |
| Premium Requests — Model Breakdown (14 models) | ✅ OK |
| Actions / Recommendations panel | ✅ OK (empty, không có pending) |
| Settings modal render | ✅ OK |

---

## Tóm tắt

| Mức độ | Số lượng |
|---|---|
| 🔴 Critical | 1 |
| 🔴 High | 2 |
| 🟡 Medium | 2 |
| 🟢 Low | 2 |
| **Tổng** | **7** |
