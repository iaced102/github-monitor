# OctoFinance — Hướng dẫn Triển khai & Sử dụng

## Phần 1: Hướng dẫn dành cho Admin (Triển khai & Cấu hình)

### 1.1 Tổng quan kiến trúc xác thực

OctoFinance hỗ trợ 2 phương thức xác thực với GitHub API, có thể dùng đồng thời:

| Phương thức | Mục đích | Bảo mật | Dữ liệu lấy được |
|-------------|----------|---------|-------------------|
| GitHub App (.pem) | Activity metrics, teams, usage reports | Cao (IP allowlist, auto-rotate) | Hoạt động sử dụng Copilot |
| Classic PAT (`read:enterprise`) | Seats/licenses | Trung bình (read-only, lộ chỉ đọc được thông tin) | Danh sách license chính xác |
| Classic PAT (`manage_billing:enterprise`) | Seats + AI Credits | Thấp (có thể sửa budget nếu lộ) | Toàn bộ: license + chi phí AI Credits thực |

---

### 1.2 Hướng 1: GitHub App (Khuyến nghị cho Activity Data)

#### Ưu điểm
- Token tự động rotate mỗi giờ — không cần quản lý thủ công
- Hỗ trợ IP allowlist — giới hạn server nào được gọi API
- Không có khả năng write data lên GitHub (chỉ read)
- Nếu file `.pem` bị lộ, attacker vẫn bị chặn bởi IP allowlist

#### Cách thiết lập
1. Tạo GitHub App tại enterprise settings
2. Cấp permissions: `Organization → Copilot Metrics: Read`
3. Install app ở enterprise level
4. Cấu hình trong `.env`:
```env
GITHUB_APP_ID=3939772
GITHUB_INSTALLATION_ID=137441159
GITHUB_PRIVATE_KEY_BASE64=<base64 .pem content>
ENTERPRISE_SLUG=hpt
```

#### Dữ liệu có thể lấy
- Usage reports per-day (enterprise-1-day, users-1-day, user-teams-1-day)
- Enterprise teams & members
- Cost centers

#### Dữ liệu KHÔNG lấy được
- Danh sách seats/licenses thực tế
- AI Credits usage (billing data)
- Budget/spending information

---

### 1.3 Hướng 2: Classic PAT — Read-only (`read:enterprise`)

#### Ưu điểm
- Lấy được danh sách seats/licenses chính xác (số lượng real từ GitHub)
- Token read-only — nếu lộ, **không có khả năng thay đổi bất kỳ thông tin gì** trên GitHub
- Không thể: xóa member, thay đổi policy, sửa billing, push code

#### Rủi ro khi lộ token
- Attacker chỉ có thể **đọc** thông tin enterprise (members, teams, seats)
- Không thể write/modify bất kỳ thứ gì
- Mức độ nghiêm trọng: **Thấp** (information disclosure only)

#### Cách thiết lập
1. Tạo Classic PAT từ account enterprise admin/billing manager
2. Chọn scope: `read:enterprise` (chỉ mục này)
3. Thêm vào `.env`:
```env
GITHUB_BILLING_PAT=ghp_your_token_here
```

#### Dữ liệu lấy được
- Danh sách seats Copilot (`/enterprises/{ent}/copilot/billing/seats`)
- Thông tin plan type per user (Business vs Enterprise)
- Số total seats chính xác

#### Dữ liệu KHÔNG lấy được
- AI Credits usage (cần `manage_billing:enterprise`)
- Budget/spending information

---

### 1.4 Hướng 3: Classic PAT — Billing Manager (`manage_billing:enterprise`)

#### Ưu điểm
- Lấy được **toàn bộ** billing data: seats + AI Credits per user + cost breakdown
- Cho phép dashboard hiển thị chi phí thực, quota usage, pool utilization

#### Rủi ro khi lộ token
- Attacker có thể **đọc VÀ SỬA** billing settings:
  - Tăng/giảm spending limits
  - Thay đổi budget caps
  - Sửa cost center assignments
- Mức độ nghiêm trọng: **Cao** — có thể gây phát sinh chi phí không kiểm soát

#### Khuyến nghị bảo mật
- Sử dụng kèm dịch vụ secret management:
  - AWS Secrets Manager
  - Azure Key Vault
  - HashiCorp Vault
  - GCP Secret Manager
- Hoặc bảo mật ở tầng infrastructure:
  - Giới hạn access vào VM chạy OctoFinance (firewall, VPN, bastion host)
  - Mã hóa disk chứa `.env` (encrypted volume)
  - Phân quyền file `.env` chỉ cho service user (`chmod 600`)
  - Network isolation — VM không expose ra internet
- Rotate token định kỳ (30-90 ngày)
- Monitor audit log để phát hiện access bất thường
- Cân nhắc: chỉ dùng token này khi thực sự cần AI Credits data

#### Cách thiết lập
```env
GITHUB_BILLING_PAT=ghp_your_billing_token_here
```

---

### 1.5 Tổng kết khuyến nghị triển khai

| Nhu cầu | Cấu hình tối thiểu |
|---------|-------------------|
| Chỉ monitor hoạt động (interactions, code gen, models) | GitHub App only |
| Monitor + biết chính xác số license | GitHub App + PAT `read:enterprise` |
| Monitor + license + chi phí AI Credits | GitHub App + PAT `manage_billing:enterprise` |

**Phương án khuyến nghị cho production**: GitHub App + PAT `read:enterprise`. Nếu cần AI Credits, thêm `manage_billing:enterprise` với secret management.

---

## Phần 2: Hướng dẫn dành cho User (Sử dụng Dashboard)

### 2.1 Hệ thống phân quyền (Role)

OctoFinance có 2 role:

| Role | Quyền | Phạm vi dữ liệu |
|------|-------|-----------------|
| **Super Admin** | Toàn quyền: quản lý users, tạo manager, assign teams, xem tất cả | Tất cả teams, tất cả users |
| **Manager** | Chỉ xem — không thể tạo/xóa user hay team | Chỉ teams được assign |

#### Super Admin có thể:
- Tạo/xóa manager accounts
- Assign teams cho manager
- Sync teams từ GitHub
- Xem toàn bộ enterprise data
- Trigger sync, upload CSV
- Filter theo bất kỳ team nào

#### Manager có thể:
- Xem dashboard cho teams mình quản lý
- Filter theo teams được assign (không thể xem team khác)
- Xuất CSV báo cáo cho teams mình

---

### 2.2 Cơ chế phân Team (Sync từ GitHub Enterprise Teams)

Teams trong OctoFinance được **đồng bộ tự động** từ GitHub Enterprise Teams:

```
GitHub Enterprise (hpt)
├── Team: HTTT (5 members)
├── Team: MSHN (9 members)
└── Team: VNPT Account (26 members)
        ↓ Sync tự động
OctoFinance Groups
├── hpt/HTTT (5 thành viên)
├── hpt/MSHN (9 thành viên)
└── hpt/VNPT Account (26 thành viên)
```

#### Cách hoạt động:
1. Admin nhấn "Đồng bộ từ GitHub Teams" hoặc hệ thống tự sync theo lịch (SYNC_CRON)
2. App lấy danh sách enterprise teams + members từ GitHub API
3. Tạo/cập nhật groups trong OctoFinance với danh sách members tương ứng
4. Admin assign group cho manager → manager chỉ xem được data của members trong group đó

#### Ứng dụng thực tế:
- **Mỗi phòng ban/đơn vị** có 1 team trên GitHub Enterprise
- **Trưởng phòng** được tạo account manager, assign team tương ứng
- Trưởng phòng đăng nhập → tự động thấy data team mình, không thấy team khác
- Data tự động filter: KPI, charts, bảng users chỉ hiển thị members trong team

---

### 2.3 Tổng quan các Tab

| Tab | Mục đích chính | Dữ liệu theo |
|-----|---------------|--------------|
| Chỉ số sử dụng | Dashboard tổng quan hoạt động Copilot | Chu kỳ billing (1 → hôm nay) |
| Yêu cầu cao cấp | Phân tích model AI usage & chi phí | Chu kỳ billing |
| Báo cáo sử dụng | Danh sách chi tiết per-user usage | Chu kỳ billing |
| Trung tâm chi phí | Phân bổ chi phí theo đơn vị/team | Chu kỳ billing |
| Giám sát | Deep-dive model, feature, user analytics | Chu kỳ billing |
| ROI | Đánh giá hiệu quả đầu tư Copilot | Chu kỳ billing |
| Nhóm người dùng | Quản lý teams, managers (admin only) | — |

---

### 2.4 Chi tiết từng Tab

#### Tab "Chỉ số sử dụng" — Tổng quan nhanh

**KPI Cards:**
| Chỉ số | Ý nghĩa | Cách sử dụng |
|--------|---------|-------------|
| Users có license | Tổng seats Copilot đang trả tiền | Baseline để tính utilization |
| Tỷ lệ sử dụng | Active / Total × 100% | < 70% → cần review và thu hồi license thừa |
| Chi phí tháng | Total seats × đơn giá plan | Track budget |
| Lãng phí tháng | Inactive seats × đơn giá | Số tiền tiết kiệm được nếu thu hồi |
| Acceptance Rate (7d) | Code accept / Code gen trong 7 ngày | > 30% = Copilot hữu ích; < 15% = cần training |
| Avg DAU (7d) | Users dùng Copilot trung bình/ngày | Đo engagement hàng ngày |

**Charts & Tables:**
| Chart | Thông tin | Ứng dụng thực tế |
|-------|-----------|-----------------|
| Xu hướng hoạt động | DAU/WAU/MAU theo ngày | Phát hiện xu hướng giảm engagement |
| Năng suất mã (LOC) | Lines suggested vs accepted | Đánh giá chất lượng gợi ý code |
| Tỷ lệ chấp nhận | Accept rate theo ngày | Xu hướng team adapt Copilot |
| Sử dụng tính năng | Chat, Agent, Code Completions | Biết team dùng feature nào nhiều nhất |
| Phân bố ngôn ngữ | Top languages used | Xác nhận tech stack & Copilot coverage |
| Mô hình AI | Model usage distribution | Biết team dùng model nào (cost implication) |
| Phân bố IDE | VS Code, JetBrains, etc. | Đảm bảo extension được cài đủ |
| Người dùng hoạt động nhất | Top users + inactive list | Identify power users & candidates for license reclaim |

---

#### Tab "Yêu cầu cao cấp" — Model & Cost Analysis

| Section | Thông tin | Ứng dụng |
|---------|-----------|----------|
| KPI tổng hợp | Total interactions, code gen, models used | Quick overview model diversity |
| Phân tích mô hình | Activity per model (bar chart) | Xem model nào tốn quota nhiều nhất |
| Model share (pie) | % phân bổ theo model | Identify model dominance |

**Cách vận dụng:**
- Model đắt (Claude Opus, GPT-5.5) chiếm tỷ lệ cao → cảnh báo cost overrun
- Có thể set policy giới hạn model premium cho specific teams/users

---

#### Tab "Báo cáo sử dụng" — Per-user Detail

| Section | Thông tin | Ứng dụng |
|---------|-----------|----------|
| User list | Tất cả licensed users + activity metrics | Full visibility per-person |
| Acceptance rate per user | Ai đang dùng hiệu quả | Identify users cần training |
| Days active | Số ngày user dùng Copilot trong chu kỳ | Phát hiện users bỏ dùng |
| IDE breakdown | User dùng IDE nào | Troubleshoot extension issues |

**Cách vận dụng:**
- User có license nhưng 0 activity trong 7+ ngày → candidate thu hồi
- User có activity nhưng accept rate < 10% → cần hướng dẫn sử dụng

---

#### Tab "Trung tâm chi phí" — Cost Allocation

| Section | Thông tin | Ứng dụng |
|---------|-----------|----------|
| KPI | Total seats, active users | Quick compare teams |
| Seat fallback table | All users + activity + plan type | Phân bổ cost theo team/phòng ban |

**Cách vận dụng:**
- Phân bổ chi phí Copilot theo đơn vị (charge-back model)
- Identify team nào ROI cao, team nào cần optimization

---

#### Tab "Giám sát" — Deep Analytics

| Section | Thông tin | Ứng dụng |
|---------|-----------|----------|
| Model Overview | Interactions + code gen per model | Trend analysis |
| Daily Model Trend | Stacked area chart theo ngày | Phát hiện shift trong model preference |
| Feature × Model matrix | Heatmap tính năng vs model | Biết feature nào dùng model nào |
| User × Model | Per-user model breakdown | Identify heavy premium model users |
| Language × Model | Code gen by language + model | Biết model nào tốt cho language nào |

**Cách vận dụng:**
- Phát hiện user đang dùng model đắt tiền quá nhiều
- Trend model mới (Claude Opus tăng đột biến) → cần policy
- So sánh productivity giữa models

---

#### Tab "ROI" — Return on Investment

| Section | Thông tin | Ứng dụng |
|---------|-----------|----------|
| Acceptance Rate | Code được chấp nhận / đề xuất | Chất lượng output Copilot |
| LOC từ Copilot | Tổng dòng code Copilot đóng góp | Quantify productivity gain |
| Chi phí / Người dùng | Monthly cost ÷ active users | Unit economics |
| Trend chart | Daily acceptance rate + activity | Xu hướng adoption |
| Top users by acceptance | Users hiệu quả nhất | Best practices sharing |

**Cách vận dụng:**
- Cost per active user > $100 → utilization thấp, cần thu hồi license
- Acceptance rate tăng theo thời gian → team đang adapt tốt
- LOC từ Copilot so với team size → ước tính productivity boost

---

### 2.5 Use Cases — Trả lời câu hỏi quản lý bằng dashboard

---

#### UC1: "Tháng này lãng phí bao nhiêu tiền? Nên thu hồi license của ai?"

**Bước 1**: Tab **Chỉ số sử dụng** → KPI card "Lãng phí tháng"
- Xem con số tổng waste (VD: $312/tháng)

**Bước 2**: Tab **Chỉ số sử dụng** → Bảng "Người dùng hoạt động nhất"
- Sort theo cột "Days" → users có Days = 0 là inactive hoàn toàn
- Xem cột "Interactions" = 0 AND "Code Gen" = 0 → đây là candidates thu hồi

**Bước 3**: Tab **Báo cáo sử dụng** → Bảng per-user
- Xem cột "Ngày hoạt động" = 0 → user chưa bao giờ dùng trong chu kỳ
- Cross-check với cột "Hoạt động cuối" → nếu > 30 ngày hoặc "never" → chắc chắn thu hồi

**Kết luận**: Xuất CSV → gửi danh sách cho enterprise admin → thu hồi license → tiết kiệm ngay tháng sau.

---

#### UC2: "Copilot có đang mang lại giá trị cho team không?"

**Bước 1**: Tab **ROI** → KPI "Tỷ lệ chấp nhận"
- ≥ 30%: Copilot đang gợi ý code phù hợp, team accept thường xuyên
- < 15%: Copilot không hữu ích hoặc team chưa biết cách dùng

**Bước 2**: Tab **ROI** → KPI "LOC từ Copilot"
- Con số tuyệt đối: bao nhiêu dòng code Copilot đóng góp trong tháng
- So với team size: VD 1,600 LOC / 9 active users = ~178 LOC/user/tháng

**Bước 3**: Tab **ROI** → Chart "Xu hướng tỷ lệ chấp nhận"
- Trend đi lên → team đang adapt tốt hơn theo thời gian
- Trend đi xuống → có vấn đề (extension outdated, context không đủ, codebase phức tạp)

**Bước 4**: Tab **ROI** → "Chi phí / Người dùng"
- < $50/user/tháng: ROI tốt (mỗi user tiết kiệm > 1 giờ/tháng là đã hồi vốn)
- > $100/user/tháng: utilization thấp, nhiều license không dùng

---

#### UC3: "Phòng A dùng Copilot thế nào so với phòng B?"

**Bước 1**: Dropdown "Phạm vi" → chọn Team A (VD: hpt/HTTT)
- Ghi nhận KPIs: utilization %, acceptance rate, DAU

**Bước 2**: Dropdown "Phạm vi" → chọn Team B (VD: hpt/VNPT Account)
- Ghi nhận cùng KPIs

**Bước 3**: So sánh:

| Chỉ số | Team A | Team B | Đánh giá |
|--------|--------|--------|----------|
| Tỷ lệ sử dụng | 60% | 85% | B tốt hơn |
| Acceptance Rate | 40% | 15% | A hiệu quả hơn |
| Avg DAU | 2.1 | 5.3 | B dùng thường xuyên hơn |

**Bước 4**: Tab **Giám sát** → Filter theo team → "User × Model"
- Xem team nào dùng model đắt hơn (Opus vs Sonnet)
- Team A dùng Opus nhiều → accept rate cao nhưng cost cao hơn

---

#### UC4: "User nào đang tiêu tốn nhiều AI Credits nhất?"

**Bước 1**: Tab **Giám sát** → Bảng "User × Model"
- Sort theo tổng activity → user có bar dài nhất = dùng nhiều nhất
- Xem màu sắc → nhiều Opus/GPT-5.5 = model đắt

**Bước 2**: Tab **Yêu cầu cao cấp** → Bảng "Phân tích mô hình"
- Xem model nào chiếm phần lớn activity
- Claude Opus tốn ~5× so với Sonnet → cùng số interactions nhưng cost gấp 5

**Bước 3**: Tab **Chỉ số sử dụng** → Bảng "Người dùng hoạt động nhất"
- Click user nghi vấn → xem detail breakdown
- Cột "Agent ✓" → user dùng Agent Mode → tiêu credits rất nhanh (nhiều round-trip)

**Hành động**: Nếu 1 user chiếm > 30% pool → cần set user-level budget trên GitHub hoặc policy giới hạn model.

---

#### UC5: "Nên gia hạn Copilot hay cancel?"

**Bước 1**: Tab **ROI** → Tổng quan
- Acceptance Rate ≥ 25% → Copilot đang tạo value
- LOC từ Copilot > 0 → team đang dùng code suggestions
- Active users / Total seats ≥ 70% → adoption tốt

**Bước 2**: Tab **Chỉ số sử dụng** → Chart "Xu hướng hoạt động"
- DAU trending up → adoption đang tăng, nên giữ
- DAU trending down → team đang bỏ dùng, cần investigation trước khi quyết định

**Bước 3**: Tab **Chỉ số sử dụng** → KPI cards
- Chi phí tháng vs Lãng phí tháng
- Nếu Lãng phí > 50% Chi phí → thu hồi license inactive trước, sau đó đánh giá lại

**Bước 4**: Tab **ROI** → Chart "Top users by acceptance"
- Có bao nhiêu "power users" (accept > 40%, days > 15)?
- Nếu > 5 power users → Copilot đang tạo real value cho nhóm core developers

**Quyết định**:
- Gia hạn nếu: utilization > 60% VÀ acceptance > 25% VÀ DAU stable/tăng
- Cancel nếu: utilization < 30% SAU 3 tháng VÀ acceptance < 10%
- Thu hồi 1 phần: giữ license cho power users, thu hồi inactive → tiết kiệm mà vẫn có value

---

#### UC6: "Team vừa onboard Copilot 2 tuần — đánh giá adoption thế nào?"

**Bước 1**: Tab **Chỉ số sử dụng** → Chart "Xu hướng hoạt động"
- DAU tăng dần từ ngày onboard → tốt
- DAU peak ngày đầu rồi giảm → novelty effect, cần follow-up training

**Bước 2**: Tab **Chỉ số sử dụng** → Bảng "Sử dụng tính năng"
- Team mới thường bắt đầu với Code Completions
- Sau 1-2 tuần xuất hiện Chat → team đang explore thêm
- Có Agent Mode → advanced adoption

**Bước 3**: Tab **Chỉ số sử dụng** → Bảng "Người dùng hoạt động nhất"
- Bao nhiêu % team đã dùng ít nhất 1 lần? (có Days > 0)
- Nếu < 50% team chưa dùng sau 2 tuần → cần session hướng dẫn

**Bước 4**: Tab **Giám sát** → "Phân bố IDE"
- Nếu team dùng JetBrains nhưng chỉ thấy VS Code → extension chưa install đúng

---

#### UC7: "Cần report hàng tháng cho management — lấy số liệu ở đâu?"

| Nội dung report | Tab | Chart/KPI |
|----------------|-----|-----------|
| Tổng chi phí | Chỉ số sử dụng | KPI "Chi phí tháng" |
| Tiết kiệm được | Chỉ số sử dụng | KPI "Lãng phí" (so với tháng trước) |
| Utilization | Chỉ số sử dụng | KPI "Tỷ lệ sử dụng" |
| Active users | Chỉ số sử dụng | KPI "Hoạt động (chu kỳ)" |
| Productivity gain | ROI | "LOC từ Copilot" + "Acceptance Rate" |
| Cost efficiency | ROI | "Chi phí / Người dùng" |
| Model distribution | Giám sát | "Phân bố mô hình" pie chart |
| Per-department breakdown | Trung tâm chi phí | Filter theo cost center |
| Trend (vs last month) | Chỉ số sử dụng | Chart xu hướng + KPI delta (▲▼) |
| Risk/action items | Báo cáo sử dụng | Danh sách users inactive |

**Tip**: Dùng nút "⬇ CSV" trên mỗi bảng để export data cho slide/spreadsheet.

---

#### UC8: "AI Credits pool sắp hết chưa? Cần mua thêm không?"

**Bước 1**: Tab **Yêu cầu cao cấp** → KPI tổng hợp
- Xem gross credits used trong tháng
- So với pool (seats × 3,000 promo hoặc × 1,900 standard)

**Bước 2**: Ước tính burn rate
- Credits dùng ÷ số ngày đã qua = credits/ngày
- Credits/ngày × số ngày còn lại = projected usage cuối tháng
- Nếu projected > pool → sẽ bị block hoặc tính tiền thêm

**Bước 3**: Tab **Giám sát** → "User × Model"
- Identify user tiêu nhiều nhất → set user-level budget trên GitHub
- Identify model đắt → khuyến nghị team chuyển sang model rẻ hơn (Sonnet thay Opus)

**Hành động**:
- Projected < 80% pool → an toàn, không cần làm gì
- Projected 80-100% → cảnh báo team, khuyến nghị dùng model nhẹ
- Projected > 100% → set budget limit trên GitHub Settings ngay

---

### 2.6 Workflow khuyến nghị

#### Hàng ngày (2 phút):
- Check KPI cards tab Chỉ số sử dụng (utilization, DAU)
- Phát hiện anomaly: DAU đột ngột giảm, utilization drop

#### Hàng tuần (10 phút):
- Tab ROI → acceptance rate trend đi lên/xuống?
- Tab Giám sát → model usage có shift bất thường?

#### Hàng tháng (30 phút):
- Tab Báo cáo sử dụng → xuất CSV inactive users → gửi recommend thu hồi
- Tab Trung tâm chi phí → tổng hợp charge-back per department
- Tab ROI → so sánh cost/user với tháng trước
- Tổng hợp report cho management (dùng UC7)

#### Hàng quý (1 giờ):
- Tổng hợp 3 tháng ROI data
- Present: cost savings (license optimization) + productivity gain (LOC, time saved)
- Quyết định: gia hạn/mở rộng/thu hẹp Copilot license pool

---

### 2.7 Tham khảo — Links tài liệu GitHub chính thức

#### Billing & Pricing
- [Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises)
- [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [Budgets for usage-based billing](https://docs.github.com/en/copilot/concepts/billing/budgets-for-usage-based-billing)
- [What changed with billing (legacy → usage-based)](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing)
- [Billing cycle](https://docs.github.com/en/copilot/reference/copilot-billing/billing-cycle)
- [Usage limits](https://docs.github.com/en/copilot/concepts/usage-limits)

#### REST API — Billing
- [Get billing AI credit usage report for an enterprise](https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage#get-billing-ai-credit-usage-report-for-an-enterprise)
- [Get billing AI credit usage report for an organization](https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage#get-billing-ai-credit-usage-report-for-an-organization)

#### REST API — Copilot Seats & Management
- [List all Copilot seat assignments for an enterprise](https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-user-management#list-all-copilot-seat-assignments-for-an-enterprise)
- [Get Copilot seat assignment details for a user](https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-user-management#get-copilot-seat-assignment-details-for-an-enterprise-user)

#### REST API — Usage Metrics
- [Copilot usage metrics endpoints](https://docs.github.com/en/enterprise-cloud@latest/rest/copilot/copilot-usage-metrics)
- [Get Copilot users usage metrics for a specific day](https://docs.github.com/en/rest/copilot/copilot-usage-metrics#get-copilot-users-usage-metrics-for-a-specific-day)

#### Quản lý & Giám sát
- [Managing your Copilot usage and spending](https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/manage-company-spending)
- [Getting started with budget controls](https://docs.github.com/en/copilot/tutorials/budgets/getting-started-with-budget-controls)
- [Configure access to AI models](https://docs.github.com/en/copilot/how-tos/set-up-copilot/set-up-for-enterprise#configure-access-to-ai-models)

#### GitHub App & Authentication
- [Creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps)
- [Scopes for OAuth apps (classic PAT)](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

#### Bảo mật theo hướng triển khai

**Hướng 1 — GitHub App:**
- [About GitHub Apps — security best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- [Securing your GitHub App private key](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- [IP allow list for GitHub Apps](https://docs.github.com/en/enterprise-cloud@latest/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/managing-allowed-ip-addresses-for-your-organization)
- [GitHub App permissions reference](https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens)

**Hướng 2 — Classic PAT read-only (`read:enterprise`):**
- [Keeping your account secure — token best practices](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github)
- [Setting an expiration for personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)
- [Reviewing and revoking authorization](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/reviewing-your-authorized-applications-oauth)
- [Enterprise audit log — monitoring token usage](https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise)

**Hướng 3 — Classic PAT billing (`manage_billing:enterprise`):**
- [Enterprise security best practices](https://docs.github.com/en/enterprise-cloud@latest/admin/overview/best-practices-for-enterprises)
- [Restricting personal access tokens in your enterprise](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-personal-access-tokens-in-your-enterprise)
- [SAML SSO — authorizing a PAT for use with SAML](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-saml-single-sign-on/authorizing-a-personal-access-token-for-use-with-saml-single-sign-on)
- Secret management services:
  - [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
  - [Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/overview)
  - [HashiCorp Vault](https://developer.hashicorp.com/vault/docs)
  - [GCP Secret Manager](https://cloud.google.com/secret-manager/docs/overview)

---

### 2.6 Lưu ý quan trọng

- **Chu kỳ billing**: Tất cả data tính từ ngày 1 đầu tháng → hôm nay. Đầu tháng (ngày 1-7) các chỉ số sẽ tự nhiên thấp.
- **Data delay**: GitHub reports có độ trễ ~24h. Data hôm nay sẽ available ngày mai.
- **Code completions miễn phí**: Không tính vào AI Credits. Chỉ Chat, Agent, CLI mới tiêu credits.
- **Pool chung**: AI Credits được pool ở enterprise level (không cố định per-user). Power users có thể dùng nhiều hơn average.
