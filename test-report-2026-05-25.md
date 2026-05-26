# 📋 OctoFinance Full Flow Test Report
**Date**: 2026-05-25  
**Tester**: Playwright MCP (automated)  
**User tested**: phucvh (super_admin), manager1 (manager)

---

## ✅ Những gì hoạt động tốt

### Tabs chính (admin - tất cả người dùng)
| Tab | Status | Ghi chú |
|-----|--------|---------|
| Giám sát | ✅ OK | KPIs, charts, model table đầy đủ |
| Chỉ số sử dụng | ✅ OK | 51 seats, 90.2% utilization, $1,599/mo |
| Yêu cầu cao cấp | ✅ OK | 3,764 tương tác, 15 models, bar chart hiển thị |
| Báo cáo sử dụng | ✅ OK | 30 users, per-user table với IDEs column |
| Trung tâm chi phí | ✅ OK | 41 active seats, user activity table |
| ROI | ✅ OK | 36.6% acceptance rate, 175,588 LOC from Copilot |
| Nhóm người dùng | ✅ OK | Chỉ admin mới thấy tab này |

### Các chỉ số mới trong tab Giám sát
- ✅ KPI row 2: LOC đề xuất (34,280), LOC được thêm (158,546), Top Feature, Top IDE, Agent count, CLI count
- ✅ Section "📊 Phân tích theo tính năng": bar chart + LOC table
- ✅ Section "🖥️ IDE & Ngôn ngữ": Pie chart VSCODE 80% / IntelliJ 20%, top 20 language bar
- ✅ Section "🔀 Pull Requests & CLI": PR stats (all zeros - PR integration chưa enable), CLI stats (187 sessions, 20,656 requests)
- ✅ Per-user table: IDE column + 🤖 Agent / 💬 Chat / 🖥️ CLI / 🏭 Coding Agent flags

### Phân quyền manager
- ✅ Manager KHÔNG thấy tab "Nhóm người dùng"
- ✅ Manager bị buộc lọc theo nhóm được giao (Team Alpha)
- ✅ Group filter dropdown chỉ hiển thị nhóm của manager (Team Alpha)
- ✅ Không có "Tất cả người dùng" option cho manager

### Lifecycle scan
- ✅ Quét tìm 5 inactive users, waste $195/mo
- ✅ CSV export hoạt động

### Audit log
- ✅ Sync thành công: 51 seats, 262 usage users records, 5 datasets
- ✅ 0 errors trong sync

---

## 🔴 Issues tìm thấy

### [HIGH] Issue #1: Group "Team Alpha" có members sai username
- **Mô tả**: Tất cả 4 members của Team Alpha không khớp với bất kỳ GitHub user nào trong dữ liệu usage
- **Configured members**: `@phucvh01`, `@baolq_tinlt`, `@longa]`, `@phuc`
- **Actual GitHub users**: `thinhvp_TinLT`, `vnpt01_TinLT`, `vnpt22_TinLT`, `duynd_TinLT`... (25 users)
- **Impact**: Admin lọc theo Team Alpha → toàn bộ KPIs = 0, charts trống. Manager1 (assigned to Team Alpha) thấy 0 dữ liệu trên tất cả tabs
- **Root cause**: Usernames được cấu hình sai (không phân biệt hoa/thường + có ký tự lạ)
- **Screenshots**: test-08-group-team-alpha.png, test-10-team-alpha-members.png
- **Fix gợi ý**: Cập nhật group members đúng GitHub login (ví dụ: `baolq_TinLT`, `thinhvp_TinLT`)

### [MEDIUM] Issue #2: `longa]` có typo ký tự `]`
- **Mô tả**: Member `@longa]` trong Team Alpha có ký tự `]` ở cuối (data entry error)
- **Impact**: Ngay cả khi user `longa_TinLT` tồn tại, sẽ không bao giờ khớp vì `longa]` ≠ `longa_tinlt`
- **Fix gợi ý**: Thêm validation/sanitization khi nhập username (strip ký tự đặc biệt ở cuối), hoặc cảnh báo user

### [MEDIUM] Issue #3: Không có cảnh báo khi group filter không khớp user nào
- **Mô tả**: Khi chọn group filter (Team Alpha), toàn bộ dữ liệu = 0 nhưng UI không giải thích tại sao
- **Impact**: Người dùng có thể nghĩ "hệ thống bị lỗi" thay vì "nhóm chưa có user thực"
- **Screenshots**: test-08-group-team-alpha.png
- **Fix gợi ý**: Hiển thị warning như "Không tìm thấy usage data cho các user trong nhóm này. Kiểm tra lại username trong cấu hình nhóm."

### [LOW] Issue #4: Manager thấy nút "Tải lên CSV" và "Đồng bộ dữ liệu"
- **Mô tả**: Manager (manager1) có thể thấy 2 nút admin-level trong header
- **Impact**: Tiếc về UX - manager thấy chức năng không phải của họ. Cần kiểm tra xem backend có restrict không
- **Screenshots**: test-20-manager-monitor.png
- **Fix gợi ý**: Ẩn những nút này với manager role

### [LOW] Issue #5: Report period thay đổi khi filter theo group
- **Mô tả**: All users → "28 ngày" (04-27 → 05-24). Filter "ms" group (vnpt22_TinLT only) → "7 ngày" (05-18 → 05-24)
- **Impact**: Dữ liệu so sánh có thể misleading - 301 interactions trong 7 ngày vs 3,764 trong 28 ngày
- **Screenshots**: test-23-ms-group.png
- **Note**: Technically correct (user chỉ có data 7 ngày), nhưng cần label rõ hơn

### [LOW] Issue #6: Group "ms" có member tên `a`
- **Mô tả**: Member `a` trong group "ms" là single-letter username, likely data entry error
- **Impact**: Không khớp bất kỳ user nào

### [INFO] Billing data không khả dụng
- **Mô tả**: PAT thiếu scope `manage_billing:copilot` → không thể xem chi phí billing chi tiết
- **Impact**: Tab Chỉ số sử dụng hiển thị warning. Chi phí tính từ công thức ($39/seat × n) thay vì API
- **Screenshots**: test-13-usage-all-users.png

---

## 📊 Tổng kết số liệu thực tế

| Chỉ số | Giá trị |
|--------|---------|
| Tổng seats | 51 |
| Users hoạt động | 46 (90.2%) |
| Inactive users | 5 |
| Chi phí/tháng | $1,599 |
| Lãng phí/tháng | $195 |
| Acceptance rate (code completion) | 36.6% global / 24.2% code_completion feature |
| LOC đề xuất (28 ngày) | 34,280 |
| LOC được thêm (all sources) | 158,546 |
| Top model | Claude-sonnet-4.6 |
| Users dùng Agent | 26/51 |
| Users dùng CLI | 7/51 |
| CLI sessions | 187 |
| CLI requests | 20,656 |
| CLI prompt tokens | 1.67B |

---

## 🔍 Group filter status

| Group | Members configured | Actual matches | Data returned |
|-------|-------------------|----------------|---------------|
| Team Alpha (4) | 4 users | 0 match | ❌ All zeros |
| Team Beta (1) | duynd_tinlt | 1 match (duynd_TinLT) | ✅ Partial data |
| ms (3) | a, vnpt22_tinlt, phucvh01_tinlt | 1 match (vnpt22_TinLT) | ✅ Partial data |

