export interface InfoMetric {
  name: string;
  desc: string;
  example?: string;
}

export interface InfoContent {
  title: string;
  description: string;
  metrics?: InfoMetric[];
  tip?: string;
}

export const INFO: Record<string, InfoContent> = {
  // ─── KPI Cards ───────────────────────────────────────────────────────────
  kpi_seats: {
    title: "Tổng số Seats",
    description: "Tổng số license GitHub Copilot đã được cấp phát cho thành viên trong tổ chức.",
    metrics: [
      { name: "Active Seat", desc: "Người dùng đã dùng Copilot ít nhất 1 lần trong 28 ngày gần nhất.", example: "85 active seats" },
      { name: "Inactive Seat", desc: "Người dùng có license nhưng chưa hoạt động trong 28 ngày.", example: "15 inactive seats" },
    ],
    tip: "Tỷ lệ active/total phản ánh hiệu quả sử dụng. Mục tiêu lý tưởng: ≥ 80%.",
  },
  kpi_utilization: {
    title: "Tỷ lệ Sử dụng (Utilization Rate)",
    description: "Phần trăm số seats đang được sử dụng tích cực so với tổng số seats đã cấp phát.",
    metrics: [
      { name: "Công thức", desc: "(Active Seats / Total Seats) × 100%", example: "70/100 = 70%" },
      { name: "Mức tốt ≥ 80%", desc: "Hiển thị màu xanh — utilization hiệu quả.", example: "85% ✅" },
      { name: "Mức trung bình 50–79%", desc: "Hiển thị màu vàng — có thể tối ưu thêm.", example: "65% ⚠️" },
      { name: "Mức kém < 50%", desc: "Hiển thị màu đỏ — cần thu hồi seats ngay.", example: "35% ❌" },
    ],
    tip: "Nếu utilization < 70%, xem xét thu hồi seats không dùng để tiết kiệm chi phí.",
  },
  kpi_cost: {
    title: "Chi phí Hàng tháng (Monthly Cost)",
    description: "Tổng chi phí license GitHub Copilot phải trả hàng tháng cho tất cả seats đã cấp phát.",
    metrics: [
      { name: "Copilot Business", desc: "$19/user/tháng", example: "100 seats × $19 = $1,900/tháng" },
      { name: "Copilot Enterprise", desc: "$39/user/tháng", example: "50 seats × $39 = $1,950/tháng" },
    ],
    tip: "Chi phí = Total Seats × Đơn giá. Giảm inactive seats để tối ưu ngay lập tức.",
  },
  kpi_waste: {
    title: "Lãng phí Hàng tháng (Monthly Waste)",
    description: "Số tiền bị lãng phí cho các seats không được sử dụng (inactive seats).",
    metrics: [
      { name: "Công thức", desc: "Inactive Seats × Đơn giá/seat", example: "15 inactive × $19 = $285/tháng lãng phí" },
    ],
    tip: "Thu hồi inactive seats (không dùng > 30 ngày) để giảm waste ngay lập tức.",
  },
  kpi_chats: {
    title: "Tổng số Chat",
    description: "Tổng số lần người dùng tương tác với Copilot Chat, bao gồm IDE chat và chat trên github.com.",
    metrics: [
      { name: "IDE Chats", desc: "Chat trong VS Code, JetBrains, Vim, v.v.", example: "1,200 chats trong VS Code" },
      { name: "Dotcom Chats", desc: "Chat trực tiếp trên github.com/copilot", example: "300 chats trên web" },
    ],
    tip: "Số chat cao cho thấy developer dùng Copilot để hỏi đáp, refactor, giải thích code — không chỉ code completion.",
  },
  kpi_pr_summaries: {
    title: "PR Summaries",
    description: "Số lần Copilot tự động tóm tắt nội dung Pull Request giúp reviewer hiểu nhanh thay đổi.",
    metrics: [
      { name: "PR Summary", desc: "Copilot đọc diff và viết mô tả PR thay cho developer.", example: "42 PR được tóm tắt tự động trong tháng" },
    ],
    tip: "Tính năng này tiết kiệm thời gian đáng kể cho reviewer và tác giả PR.",
  },

  // ─── Sections & Charts: Metrics Tab ─────────────────────────────────────
  section_activeUserTrends: {
    title: "Xu hướng Người dùng Hoạt động",
    description: "Theo dõi sự thay đổi số lượng người dùng active theo ngày/tuần/tháng. Giúp nhận biết xu hướng tăng trưởng hoặc giảm sút trong việc sử dụng Copilot.",
    metrics: [
      { name: "DAU", desc: "Daily Active Users — số user dùng Copilot trong đúng 1 ngày đó.", example: "Thứ Hai 2026-05-19: 45 DAU" },
      { name: "WAU", desc: "Weekly Active Users — số user dùng ít nhất 1 lần trong 7 ngày tính đến ngày đó.", example: "Tuần 05/19: 78 WAU" },
      { name: "MAU", desc: "Monthly Active Users — số user dùng ít nhất 1 lần trong 28 ngày tính đến ngày đó.", example: "Tháng 5/2026: 95 MAU" },
      { name: "Chat Users", desc: "Số user dùng Copilot Chat trong ngày đó.", example: "20 chat users/ngày" },
      { name: "Agent Users", desc: "Số user dùng Copilot Agent Mode.", example: "5 agent users/ngày" },
    ],
    tip: "DAU/MAU ratio = mức độ gắn kết. Tỷ lệ > 50% là rất tốt. Nếu thấp → nhiều user chỉ dùng thỉnh thoảng, cần đào tạo thêm.",
  },
  chart_dailyTrend: {
    title: "Biểu đồ DAU / WAU / MAU theo ngày",
    description: "Biểu đồ vùng (Area Chart) hiển thị số người dùng hoạt động theo từng ngày trong khoảng thời gian được chọn.",
    metrics: [
      { name: "Trục X", desc: "Ngày (MM-DD)", example: "05-01, 05-02, ..." },
      { name: "Màu tím — MAU", desc: "Users active trong 28 ngày tính đến ngày đó.", example: "MAU = 95 vào 05-15" },
      { name: "Màu xanh dương — WAU", desc: "Users active trong 7 ngày tính đến ngày đó.", example: "WAU = 60 vào 05-15" },
      { name: "Màu xanh lá — DAU", desc: "Users active đúng ngày đó.", example: "DAU = 42 vào 05-15" },
      { name: "Màu vàng — Chat", desc: "Users dùng Copilot Chat ngày đó.", example: "20 chat users" },
      { name: "Màu đỏ — Agent", desc: "Users dùng Agent Mode ngày đó.", example: "5 agent users" },
    ],
    tip: "Khoảng cách giữa MAU và DAU lớn → nhiều user chỉ dùng thỉnh thoảng. Mục tiêu: DAU/MAU ≥ 40%.",
  },
  section_codeProductivity: {
    title: "Năng suất Code (Code Productivity)",
    description: "Đo lường hiệu quả sử dụng Copilot trong việc gợi ý và chấp nhận code. Đây là chỉ số trực tiếp phản ánh ROI của Copilot.",
    metrics: [
      { name: "LOC Suggested", desc: "Tổng số dòng code Copilot gợi ý trong kỳ.", example: "12,500 lines gợi ý" },
      { name: "LOC Accepted", desc: "Số dòng code developer thực sự chấp nhận.", example: "8,750 lines được chấp nhận" },
      { name: "Acceptance Rate", desc: "LOC Accepted / LOC Suggested × 100%", example: "70% acceptance rate" },
    ],
    tip: "Acceptance Rate > 30% là hiệu quả tốt. Nếu thấp: đào tạo cách viết comment/context để Copilot gợi ý chính xác hơn.",
  },
  chart_locTrend: {
    title: "Xu hướng Lines of Code (LOC) theo ngày",
    description: "Theo dõi số dòng code được gợi ý và chấp nhận theo thời gian. Khoảng cách giữa hai đường phản ánh tỷ lệ từ chối.",
    metrics: [
      { name: "LOC Suggested — xanh dương", desc: "Tổng số dòng Copilot đề xuất mỗi ngày.", example: "500 lines gợi ý/ngày" },
      { name: "LOC Accepted — xanh lá", desc: "Số dòng developer giữ lại mỗi ngày.", example: "350 lines accepted/ngày" },
    ],
    tip: "Xu hướng tăng của cả hai đường = developer đang dùng Copilot nhiều hơn và hiệu quả hơn theo thời gian.",
  },
  chart_acceptRate: {
    title: "Tỷ lệ Chấp nhận Gợi ý (Acceptance Rate) theo ngày",
    description: "Phần trăm các gợi ý code được developer chấp nhận. Hai loại: theo số lượng gợi ý (Code Accept %) và theo số dòng code (LOC Accept %).",
    metrics: [
      { name: "Code Accept % — xanh lá", desc: "Số gợi ý được accept / Tổng số gợi ý × 100%", example: "35% code accept rate" },
      { name: "LOC Accept % — xanh dương", desc: "Số dòng giữ lại / Tổng dòng gợi ý × 100%", example: "70% LOC accept rate" },
    ],
    tip: "LOC Accept % thường cao hơn Code Accept % vì developer hay accept những gợi ý dài (nhiều dòng). Mục tiêu: Code Accept > 30%, LOC Accept > 50%.",
  },
  section_featureUsage: {
    title: "Sử dụng theo Tính năng (Feature Usage)",
    description: "Thống kê mức độ sử dụng từng tính năng của GitHub Copilot: code completion, chat, agent mode, CLI, code review, v.v.",
    metrics: [
      { name: "Feature", desc: "Tên tính năng Copilot", example: "code_completion, chat_panel, copilot_cli, code_review" },
      { name: "Interactions", desc: "Tổng số lần tương tác với tính năng đó trong kỳ", example: "5,200 interactions" },
      { name: "Code Gen", desc: "Số lần Copilot generate code cho tính năng này", example: "4,100 code gen events" },
      { name: "Code Accept", desc: "Số lần code được chấp nhận", example: "2,860 accepted" },
      { name: "Accept %", desc: "Tỷ lệ chấp nhận = Code Accept / Code Gen × 100%", example: "42%" },
      { name: "LOC Suggested / Accepted", desc: "Dòng code gợi ý và được giữ lại", example: "Sugg: 15,000 / Acc: 10,500" },
    ],
    tip: "So sánh acceptance rate giữa các features để biết tính năng nào đang hiệu quả nhất với team của bạn.",
  },
  section_langDist: {
    title: "Phân bố Ngôn ngữ Lập trình",
    description: "Thống kê Copilot được sử dụng nhiều nhất với ngôn ngữ lập trình nào trong tổ chức.",
    metrics: [
      { name: "Code Gen", desc: "Số sự kiện Copilot generate code cho ngôn ngữ này", example: "Python: 3,200 code gen" },
      { name: "Accepted", desc: "Số lần code được chấp nhận", example: "Python: 2,100 accepted" },
    ],
    tip: "Top languages cho thấy stack công nghệ chính. Nếu ngôn ngữ chính không có trong top, kiểm tra extension đã được cài đặt chưa.",
  },
  chart_langCodeGen: {
    title: "Code Generation theo Ngôn ngữ (Top 15)",
    description: "Biểu đồ cột ngang so sánh số lần Copilot generate code và số lần được chấp nhận cho từng ngôn ngữ.",
    metrics: [
      { name: "Cột xanh dương — Code Gen", desc: "Tổng số lần Copilot gợi ý code cho ngôn ngữ này.", example: "TypeScript: 4,500" },
      { name: "Cột xanh lá — Accepted", desc: "Số gợi ý được developer chấp nhận.", example: "TypeScript: 3,200" },
    ],
    tip: "Ngôn ngữ có khoảng cách Code Gen vs Accepted lớn → acceptance rate thấp. Cần đào tạo developer dùng Copilot hiệu quả hơn với ngôn ngữ đó.",
  },
  chart_codeCompletions: {
    title: "Code Completions chi tiết theo Ngôn ngữ",
    description: "Bảng chi tiết thống kê code completion cho từng ngôn ngữ, bao gồm suggestions, acceptances và lines of code.",
    metrics: [
      { name: "Suggestions", desc: "Tổng số gợi ý được hiện ra cho developer.", example: "1,200 suggestions" },
      { name: "Accepted", desc: "Số gợi ý developer nhấn Tab để chấp nhận.", example: "480 accepted" },
      { name: "Accept %", desc: "Accepted / Suggestions × 100%", example: "40%" },
      { name: "Lines Sugg.", desc: "Tổng số dòng code trong tất cả các gợi ý.", example: "3,600 lines" },
      { name: "Lines Acc.", desc: "Số dòng code cuối cùng được giữ lại.", example: "1,440 lines" },
    ],
    tip: "1 suggestion thường gồm nhiều dòng. Lines Accepted > Suggestions × 1 là hoàn toàn bình thường.",
  },
  section_modelPremium: {
    title: "Model AI & Premium Requests",
    description: "Thống kê việc sử dụng các AI model (GPT-4o, Claude Sonnet, Gemini, v.v.) và chi phí Premium Requests vượt quota hàng tháng.",
    metrics: [
      { name: "Premium Request", desc: "Yêu cầu dùng AI model cao cấp, tính ngoài quota miễn phí.", example: "GPT-4o: 120 requests ngoài quota" },
      { name: "Quota miễn phí", desc: "Business: 300 req/user/tháng · Enterprise: 1,000 req/user/tháng", example: "100 users × 300 = 30,000 requests/tháng" },
      { name: "Giá vượt quota", desc: "$0.04 / request vượt quota", example: "50 requests vượt × $0.04 = $2.00" },
    ],
    tip: "Nếu Premium Requests tăng nhanh, thiết lập policy giới hạn model usage (chỉ cho phép model premium với senior developers).",
  },
  chart_modelUsage: {
    title: "Phân bố Sử dụng AI Model",
    description: "Biểu đồ tròn thể hiện tỷ lệ phần trăm mỗi AI model được sử dụng trong tổng số interactions.",
    metrics: [
      { name: "% hiển thị", desc: "Phần trăm interactions sử dụng model đó so với tổng.", example: "GPT-4o mini: 65% · Claude Sonnet: 25% · GPT-4o: 10%" },
    ],
    tip: "GPT-4o mini thường chiếm tỷ lệ lớn nhất (model mặc định, miễn phí trong quota). Claude Sonnet và GPT-4o là premium — theo dõi chặt để kiểm soát chi phí.",
  },
  chart_premiumDetail: {
    title: "Chi tiết Premium Requests theo Model",
    description: "Bảng chi tiết số lượng và chi phí Premium Requests cho từng AI model trong tháng hiện tại.",
    metrics: [
      { name: "Gross Qty", desc: "Tổng số premium requests thực tế đã thực hiện.", example: "450 requests" },
      { name: "Discount", desc: "Số requests nằm trong quota được miễn phí.", example: "300 requests (trong quota)" },
      { name: "Net Qty", desc: "Số requests thực sự bị tính tiền = Gross − Discount.", example: "150 requests tính tiền" },
      { name: "Net Cost", desc: "Chi phí thực tế = Net Qty × $0.04", example: "150 × $0.04 = $6.00" },
    ],
    tip: "Net Qty = 0 → vẫn trong quota, không phát sinh chi phí thêm. Net Qty > 0 → cần theo dõi và kiểm soát.",
  },
  section_ideUsage: {
    title: "Phân bố IDE Sử dụng",
    description: "Thống kê Copilot được dùng trên IDE nào nhiều nhất: VS Code, JetBrains (IntelliJ, PyCharm, GoLand...), Neovim, v.v.",
    metrics: [
      { name: "Interactions", desc: "Số lần tương tác Copilot trong IDE đó", example: "VS Code: 8,500 interactions" },
      { name: "Code Gen", desc: "Số lần Copilot generate code trong IDE đó", example: "VS Code: 6,200 code gen" },
    ],
    tip: "VS Code và JetBrains thường chiếm tỷ lệ lớn nhất. Nếu team dùng IDE ít phổ biến, kiểm tra extension đã được cài đặt và configured chưa.",
  },
  chart_ideChart: {
    title: "So sánh Interactions & Code Gen theo IDE",
    description: "Biểu đồ cột nhóm so sánh tổng interactions và code generation events cho từng IDE.",
    metrics: [
      { name: "Cột vàng — Interactions", desc: "Tổng số sự kiện tương tác trong IDE này.", example: "VS Code: 8,500" },
      { name: "Cột xanh dương — Code Gen", desc: "Số lần Copilot generate code suggestion.", example: "VS Code: 6,200" },
    ],
    tip: "IDE có nhiều Interactions nhưng ít Code Gen → người dùng đang dùng Chat nhiều hơn Code Completion trong IDE đó.",
  },
  chart_ideDetail: {
    title: "Thống kê chi tiết theo IDE",
    description: "Bảng so sánh đầy đủ các chỉ số (interactions, code gen, acceptance rate, LOC) cho từng IDE.",
    metrics: [
      { name: "Accept", desc: "Số code suggestions được chấp nhận trong IDE này", example: "VS Code: 3,100 accepted" },
      { name: "LOC Sugg. / Acc.", desc: "Dòng code được gợi ý và được giữ lại", example: "Sugg: 18,000 / Acc: 12,600" },
    ],
    tip: "So sánh acceptance rate giữa các IDEs để biết IDE nào Copilot hoạt động hiệu quả nhất với team.",
  },
  section_seatMgmt: {
    title: "Quản lý Seats",
    description: "Danh sách toàn bộ seats đã được cấp phát, trạng thái hoạt động, IDE đang dùng và lần cuối active của từng user.",
    metrics: [
      { name: "🟢 Active", desc: "Đã dùng Copilot trong 28 ngày gần nhất.", example: "Last active: 2026-05-20" },
      { name: "🟡 Inactive", desc: "Chưa dùng trong 28 ngày — ứng viên để thu hồi seat.", example: "Last active: Never" },
      { name: "🔴 Cancelling", desc: "Seat đã được lên lịch thu hồi, sẽ xóa cuối chu kỳ thanh toán.", example: "Pending cancellation: 2026-06-01" },
    ],
    tip: "Dùng AI Chat để phân tích và nhờ Copilot AI đề xuất danh sách thu hồi seats tối ưu theo tiêu chí của bạn.",
  },
  section_topUsers: {
    title: "Top Người dùng Hoạt động",
    description: "Bảng xếp hạng người dùng theo mức độ sử dụng Copilot. Giúp nhận biết power users và người dùng cần được hỗ trợ thêm.",
    metrics: [
      { name: "#", desc: "Thứ hạng theo tổng interactions trong kỳ", example: "#1 = user dùng Copilot nhiều nhất" },
      { name: "Interactions", desc: "Tổng số lần tương tác với Copilot (chat + code completion)", example: "1,250 interactions" },
      { name: "Code Gen / Accept", desc: "Số lần Copilot generate code và số lần được accept", example: "Gen: 980, Accept: 650" },
      { name: "Accept %", desc: "Tỷ lệ chấp nhận code = Accept / Gen × 100%", example: "66%" },
      { name: "Days", desc: "Số ngày user có ít nhất 1 interaction với Copilot", example: "18 ngày active trong 28 ngày" },
      { name: "Chat ✓", desc: "User có dùng Copilot Chat hay không", example: "✓ = đã dùng Copilot Chat" },
      { name: "Agent ✓", desc: "User có dùng Agent Mode hay không", example: "✓ = đã dùng Agent Mode" },
    ],
    tip: "Users có Accept % cao (>50%) và nhiều Days là power users. Mời họ chia sẻ tips & tricks với team để nâng cao hiệu quả chung.",
  },

  // ─── CsvDashboard: Premium Tab ───────────────────────────────────────────
  csv_premium_kpi: {
    title: "Tổng quan Premium Requests",
    description: "Các chỉ số tổng hợp về việc sử dụng Premium Requests — yêu cầu AI sử dụng model cao cấp có thể vượt quota miễn phí.",
    metrics: [
      { name: "Total Requests", desc: "Tổng số premium requests đã thực hiện trong kỳ", example: "2,340 requests" },
      { name: "Total Cost", desc: "Tổng chi phí phải trả cho premium requests vượt quota", example: "$16.80" },
      { name: "Unique Users", desc: "Số người dùng đã sử dụng premium requests", example: "28 users" },
      { name: "Unique Orgs", desc: "Số tổ chức có premium request usage", example: "3 orgs" },
    ],
    tip: "Nếu Total Cost tăng đột biến, kiểm tra section breakdown để xác định model hoặc user nào đang sử dụng nhiều nhất.",
  },
  csv_section_premiumTrend: {
    title: "Xu hướng Premium Requests theo Ngày",
    description: "Biểu đồ thể hiện số lượng premium requests và số user active theo từng ngày trong kỳ báo cáo.",
    metrics: [
      { name: "Requests — màu tím", desc: "Số premium requests thực hiện trong ngày đó", example: "05-15: 120 requests" },
      { name: "Active Users — xanh lá", desc: "Số user đã dùng premium requests trong ngày", example: "05-15: 8 users" },
    ],
    tip: "Tìm ngày có spike (tăng đột biến) để điều tra xem có event hay deadline nào dẫn đến tăng cao bất thường.",
  },
  csv_section_premiumBreakdowns: {
    title: "Phân bố Premium Requests theo Model / Org / Cost Center",
    description: "Phân tích chi tiết premium requests theo model AI, tổ chức và cost center để biết nguồn gốc chi phí.",
    metrics: [
      { name: "Model Breakdown", desc: "Model AI nào được dùng nhiều nhất", example: "claude-3.5-sonnet: 45% requests" },
      { name: "Org Breakdown", desc: "Tổ chức nào tiêu thụ nhiều nhất", example: "org-engineering: 1,200 requests" },
      { name: "Cost Center", desc: "Phân bổ theo cost center đã cấu hình", example: "team-backend: $8.40" },
    ],
    tip: "Org hoặc Cost Center dùng nhiều model đắt tiền → xem xét thiết lập policy giới hạn model usage.",
  },
  csv_section_premiumUsers: {
    title: "Chi tiết Người dùng Premium",
    description: "Danh sách từng người dùng với mức độ tiêu thụ premium requests, bao gồm quota usage và các model đã sử dụng.",
    metrics: [
      { name: "Requests", desc: "Tổng số premium requests của user này trong kỳ", example: "180 requests" },
      { name: "Gross Amount", desc: "Tổng chi phí trước khi tính quota miễn phí", example: "$7.20" },
      { name: "Quota", desc: "Quota của user theo plan (Business: 300, Enterprise: 1,000)", example: "300 requests/tháng" },
      { name: "Quota Usage %", desc: "Phần trăm quota đã sử dụng — thanh màu thay đổi theo mức", example: "60% 🟢 · 85% 🟡 · 95% 🔴" },
      { name: "Days Active", desc: "Số ngày user có ít nhất 1 premium request", example: "12 ngày" },
      { name: "Models", desc: "Danh sách models đã dùng kèm số requests", example: "claude-3.5: 80 · gpt-4o: 60" },
    ],
    tip: "User có quota usage > 80% → sắp vượt quota và có thể phát sinh chi phí thêm.",
  },

  // ─── CsvDashboard: Usage Report Tab ──────────────────────────────────────
  csv_usage_kpi: {
    title: "Tổng quan Usage Report",
    description: "Tổng hợp chi phí sử dụng GitHub Copilot từ file usage report xuất từ Azure/GitHub billing portal.",
    metrics: [
      { name: "Total Gross", desc: "Tổng chi phí trước khi áp dụng discount hoặc credit", example: "$245.60" },
      { name: "Total Net", desc: "Chi phí thực sự phải trả sau tất cả discount", example: "$198.40" },
      { name: "Total Discount", desc: "Tổng số tiền được giảm giá (commitment discount, negotiated price...)", example: "$47.20 discount" },
      { name: "Unique Users", desc: "Số người dùng phát sinh chi phí trong kỳ này", example: "52 users" },
      { name: "Unique Orgs", desc: "Số tổ chức có chi phí trong kỳ này", example: "3 orgs" },
    ],
    tip: "Discount thường đến từ Azure commitment discounts hoặc GitHub Enterprise agreements. Tỷ lệ discount = Discount/Gross × 100%.",
  },
  csv_section_usageTrend: {
    title: "Xu hướng Chi phí theo Ngày",
    description: "Biểu đồ so sánh gross amount và net amount theo từng ngày trong kỳ báo cáo billing.",
    metrics: [
      { name: "Gross — xanh dương", desc: "Chi phí thực tế trước khi áp dụng discount", example: "05-15: $12.40" },
      { name: "Net — xanh lá", desc: "Chi phí sau discount — số tiền thực trả", example: "05-15: $9.80" },
    ],
    tip: "Khoảng cách Gross vs Net = tổng discount nhận được. Khoảng cách lớn = đang được discount tốt từ Azure/GitHub agreements.",
  },
  csv_section_usageBreakdowns: {
    title: "Phân bố Chi phí theo Product / SKU / Org / Cost Center",
    description: "Phân tích chi phí theo nhiều chiều để biết chính xác tiền đang chi cho sản phẩm nào và phân bổ cho đơn vị nào.",
    metrics: [
      { name: "Product", desc: "Sản phẩm GitHub Copilot (Business, Enterprise, v.v.)", example: "CopilotForBusiness: $180" },
      { name: "SKU", desc: "Đơn vị tính giá cụ thể (per seat/month, per premium request...)", example: "Copilot:enterprise_seat: $156 · Copilot:premium_request: $2.40" },
      { name: "Org", desc: "Chi phí phân bổ theo tổ chức GitHub", example: "org-frontend: $80 · org-backend: $120" },
      { name: "Cost Center", desc: "Chi phí phân bổ theo cost center đã cấu hình", example: "team-platform: $45" },
    ],
    tip: "SKU breakdown giúp phân biệt chi phí seat cố định (per seat) vs chi phí premium requests biến động (per request).",
  },
  csv_section_usageUsers: {
    title: "Chi tiết Chi phí theo Người dùng",
    description: "Danh sách từng người dùng với chi phí phát sinh, kèm breakdown theo SKU đã sử dụng.",
    metrics: [
      { name: "Gross Amount", desc: "Chi phí trước discount của user này trong kỳ", example: "$4.80" },
      { name: "Net Amount", desc: "Chi phí sau discount — số tiền thực tế phân bổ", example: "$3.90" },
      { name: "Quantity", desc: "Số đơn vị sử dụng (ngày sử dụng seat, số requests...)", example: "28.0000 ngày" },
      { name: "Days Active", desc: "Số ngày xuất hiện trong usage report", example: "28 ngày" },
      { name: "SKUs", desc: "Các SKU đã dùng kèm chi phí tương ứng", example: "enterprise_seat: $3.90 · premium_req: $0.40" },
    ],
    tip: "User có nhiều SKUs đắt tiền → đang dùng nhiều tính năng premium. Bình thường nếu là power user hoặc tech lead.",
  },

  // ─── Cost Centers Tab ─────────────────────────────────────────────────────
  cc_section_costcenters: {
    title: "Danh sách Cost Centers",
    description: "Cost Centers là các nhóm được cấu hình trong GitHub Enterprise để phân bổ chi phí Copilot theo phòng ban, dự án hoặc team. Click vào từng row để xem danh sách members.",
    metrics: [
      { name: "Cost Center", desc: "Tên nhóm/phòng ban đã được cấu hình", example: "team-backend, team-frontend, project-alpha" },
      { name: "State", desc: "active = đang hoạt động; archived = đã lưu trữ (không còn dùng)", example: "active" },
      { name: "Resources", desc: "Org/User/Team được gán vào cost center này", example: "Org: my-org · Team: engineering" },
      { name: "Members ▶", desc: "Tổng số thành viên. Click row để xem danh sách chi tiết.", example: "15 members → click để mở rộng" },
    ],
    tip: "Cost Centers giúp phân bổ chi phí rõ ràng cho từng đơn vị. Cấu hình tại GitHub Enterprise Settings → Billing → Cost Centers.",
  },
  cc_section_usermap: {
    title: "Phân bổ Người dùng vào Cost Centers",
    description: "Bảng tra cứu mỗi người dùng thuộc cost center nào, được phân bổ qua nguồn nào (Org, Team, hay User trực tiếp).",
    metrics: [
      { name: "User", desc: "GitHub username của người dùng Copilot", example: "johndoe" },
      { name: "Cost Centers", desc: "Danh sách cost centers user này thuộc về", example: "team-backend, team-platform" },
      { name: "Source — Org", desc: "User được phân bổ thông qua tư cách thành viên của tổ chức", example: "Org: my-github-org" },
      { name: "Source — Team", desc: "User được phân bổ thông qua team trong org", example: "Team: backend-engineers" },
      { name: "Source — User", desc: "User được thêm trực tiếp vào cost center", example: "User: johndoe" },
    ],
    tip: "User thuộc nhiều cost centers → chi phí của họ sẽ được tính cho tất cả cost centers đó theo tỷ lệ phân bổ.",
  },
  cc_section_seatfallback: {
    title: "Danh sách Seats (Chưa cấu hình Cost Centers)",
    description: "Khi chưa cấu hình Cost Centers trong GitHub Enterprise, đây là danh sách toàn bộ seats Copilot kèm thông tin hoạt động của từng user.",
    metrics: [
      { name: "Last Activity", desc: "Lần cuối user dùng Copilot (accept suggestion)", example: "2026-05-20" },
      { name: "Interactions", desc: "Tổng số tương tác với Copilot trong 28 ngày", example: "420 interactions" },
      { name: "Code Gen / Accept", desc: "Số lần generate code và số lần được chấp nhận", example: "Gen: 380 · Accept: 258" },
      { name: "Accept %", desc: "Tỷ lệ code suggestions được chấp nhận", example: "68%" },
      { name: "Days Active", desc: "Số ngày có ít nhất 1 interaction với Copilot", example: "22 ngày / 28 ngày" },
      { name: "Editor", desc: "IDE người dùng hay sử dụng nhất", example: "vscode, jetbrains-idea" },
    ],
    tip: "Để phân bổ chi phí theo team, hãy cấu hình Cost Centers trong GitHub Enterprise Settings → Billing → Cost Centers.",
  },

  // ─── CSV Dashboard chart-level entries (fallback for chart titles) ──────
  csv_chart_modelBreakdown: {
    title: "Phân bổ theo Model AI",
    description: "Biểu đồ tròn thể hiện tỷ lệ phân bổ số lượng requests giữa các model AI (GPT-4o, Claude, v.v.).",
    metrics: [
      { name: "model", desc: "Tên model AI được dùng", example: "gpt-4o, claude-3.5-sonnet" },
      { name: "requests", desc: "Số lượng premium requests gửi đến model đó", example: "1,200 requests" },
    ],
    tip: "Model chiếm tỷ lệ cao nhất thường là model mặc định. Theo dõi để phát hiện cost tập trung.",
  },
  csv_chart_orgBreakdown: {
    title: "Phân bổ theo Tổ chức (Org)",
    description: "Biểu đồ cột nằm ngang thể hiện phân bổ số lượng requests và số users theo từng tổ chức GitHub.",
    metrics: [
      { name: "org", desc: "Tên tổ chức GitHub", example: "my-company-eng" },
      { name: "requests", desc: "Tổng premium requests từ org đó", example: "3,400 requests" },
      { name: "user_count", desc: "Số người dùng active trong org", example: "45 users" },
    ],
  },
  csv_chart_costCenter: {
    title: "Phân bổ theo Cost Center (Premium)",
    description: "Phân bổ premium requests và số users theo từng Cost Center đã cấu hình trong GitHub Enterprise.",
    metrics: [
      { name: "cost_center", desc: "Tên Cost Center", example: "team-backend" },
      { name: "requests", desc: "Tổng số requests từ members trong cost center", example: "1,100 requests" },
      { name: "user_count", desc: "Số users thuộc cost center đó", example: "12 users" },
    ],
    tip: "Cost Center cần được cấu hình trong GitHub Enterprise trước khi dữ liệu này có ý nghĩa.",
  },
  csv_chart_productBreakdown: {
    title: "Phân bổ theo Sản phẩm (Product)",
    description: "Phân bổ chi phí (gross/net) theo loại sản phẩm GitHub Copilot (Business, Enterprise, v.v.).",
    metrics: [
      { name: "product", desc: "Loại sản phẩm Copilot", example: "Copilot Business, Copilot Enterprise" },
      { name: "gross_amount", desc: "Tổng tiền trước khi áp dụng giảm giá", example: "$240.00" },
      { name: "net_amount", desc: "Số tiền thực tế phải trả sau giảm giá", example: "$192.00" },
    ],
  },
  csv_chart_skuBreakdown: {
    title: "Phân bổ theo SKU",
    description: "Chi tiết chi phí theo từng SKU (Stock Keeping Unit) — phân loại nhỏ hơn theo tính năng hoặc gói.",
    metrics: [
      { name: "sku", desc: "Mã SKU định danh gói/tính năng", example: "copilot_for_business_seat" },
      { name: "gross_amount", desc: "Chi phí trước giảm giá", example: "$19.00" },
      { name: "net_amount", desc: "Chi phí sau giảm giá", example: "$15.20" },
    ],
  },
  csv_chart_orgBreakdown2: {
    title: "Phân bổ theo Org (Usage Report)",
    description: "Phân bổ gross amount theo từng tổ chức trong dữ liệu usage report.",
    metrics: [
      { name: "org", desc: "Tên tổ chức GitHub", example: "my-company-dev" },
      { name: "gross_amount", desc: "Tổng chi phí trước giảm giá từ org đó", example: "$380.00" },
    ],
  },
  csv_chart_costCenter2: {
    title: "Phân bổ Cost Center (Usage Report)",
    description: "Phân bổ chi phí gross/net theo Cost Center trong dữ liệu usage report.",
    metrics: [
      { name: "cost_center", desc: "Tên Cost Center", example: "team-frontend" },
      { name: "gross_amount", desc: "Chi phí trước giảm giá", example: "$145.00" },
      { name: "net_amount", desc: "Chi phí thực tế sau giảm giá", example: "$116.00" },
    ],
  },

  // ─── Usage Monitor ───────────────────────────────────────────────────────
  mon_modelOverview: {
    title: "Tổng quan sử dụng Model AI",
    description: "Thống kê tổng hợp mức độ sử dụng từng model AI (Claude, GPT, Gemini, v.v.) trong toàn bộ tổ chức.",
    metrics: [
      { name: "Interactions", desc: "Số lần người dùng chủ động tương tác (gửi prompt) với model", example: "450 interactions" },
      { name: "Code Gen", desc: "Số lần model sinh ra code suggestion", example: "1,200 code gen" },
      { name: "Code Accept", desc: "Số lần suggestion được người dùng chấp nhận", example: "780 accepted" },
      { name: "LOC Suggested", desc: "Tổng số dòng code được gợi ý", example: "12,400 LOC" },
      { name: "LOC Added", desc: "Tổng số dòng code thực sự được thêm vào repo", example: "9,800 LOC" },
    ],
    tip: "So sánh LOC Suggested vs LOC Added để đánh giá chất lượng gợi ý của từng model.",
  },
  mon_modelShare: {
    title: "Tỷ lệ sử dụng Model (Model Share)",
    description: "Biểu đồ tròn thể hiện phần trăm tổng hoạt động (interaction + code gen) của từng model so với toàn bộ.",
    tip: "Model chiếm tỷ lệ cao nhất thường là model mặc định hoặc được người dùng ưa thích nhất.",
  },
  mon_modelDetail: {
    title: "Bảng chi tiết theo Model",
    description: "Bảng đầy đủ các chỉ số cho từng model: interactions, code gen, accept rate, LOC, và top ngôn ngữ sử dụng.",
    metrics: [
      { name: "Accept Rate %", desc: "(Code Accept / Code Gen) × 100", example: "65.0%" },
      { name: "Top Languages", desc: "Top 3 ngôn ngữ lập trình dùng model đó nhiều nhất", example: "python, typescript, java" },
    ],
  },
  mon_dailyTrend: {
    title: "Xu hướng hàng ngày theo Model",
    description: "Biểu đồ stacked area và stacked bar thể hiện sự biến động số lượng tương tác và sinh code mỗi ngày, phân theo model.",
    tip: "Dùng biểu đồ này để phát hiện ngày cao điểm, model nào được dùng nhiều hơn theo thời gian.",
  },
  mon_dailyModelTrend: {
    title: "Tương tác hàng ngày theo Model",
    description: "Stacked area chart: mỗi màu là một model, trục Y là số user_initiated_interaction_count theo ngày.",
  },
  mon_dailyCodeGenTrend: {
    title: "Sinh code hàng ngày theo Model",
    description: "Stacked bar chart: số lượng code suggestions được tạo ra mỗi ngày, phân theo model AI.",
  },
  mon_featureModel: {
    title: "Ma trận Tính năng × Model",
    description: "Bảng heatmap thể hiện mức độ sử dụng từng tính năng Copilot (Chat, Code Completion, CLI, Agent...) với từng model AI.",
    metrics: [
      { name: "Ô sáng hơn", desc: "Tính năng/model đó được sử dụng nhiều hơn tương đối so với các ô khác trong cùng hàng", example: "chat_panel_agent_mode × claude-4.6-sonnet: 250" },
      { name: "—", desc: "Không có hoạt động nào giữa tính năng và model đó", example: "code_completion × gemini: —" },
    ],
    tip: "Nếu một tính năng chỉ dùng 1 model, đó có thể là model mặc định cho tính năng đó — có thể tùy chỉnh trong Copilot settings.",
  },
  mon_featureModelMatrix: {
    title: "Ma trận Tính năng × Model (chi tiết)",
    description: "Bảng pivot hiển thị tổng số hoạt động (interaction + code gen) cho mỗi cặp (tính năng, model).",
  },
  mon_userModel: {
    title: "Phân tích Model theo User",
    description: "Xem mỗi người dùng đang sử dụng model AI nào, tổng số hoạt động, và so sánh giữa các user.",
    metrics: [
      { name: "Total", desc: "Tổng hoạt động (interaction + code gen) của user đó với tất cả models", example: "380 total" },
      { name: "[Tên model]", desc: "Số hoạt động của user với model cụ thể đó", example: "claude-4.6-sonnet: 220" },
    ],
    tip: "Sort theo tên model để tìm nhanh tất cả user đang dùng một model cụ thể.",
  },
  mon_userModelBreakdown: {
    title: "Bảng User × Model (có thể sắp xếp)",
    description: "Bảng đầy đủ, click vào tiêu đề cột để sắp xếp. Dùng ô tìm kiếm để lọc theo tên user.",
  },
  mon_topUserModelChart: {
    title: "Top 20 User theo Model (stacked bar)",
    description: "Biểu đồ cột nằm ngang: Top 20 user nhiều hoạt động nhất, mỗi màu thể hiện một model AI.",
    tip: "User nào có bar dài nhất là người dùng Copilot tích cực nhất. Màu sắc cho biết họ dùng model nào nhiều nhất.",
  },
  mon_langModel: {
    title: "Ngôn ngữ lập trình × Model",
    description: "Biểu đồ stacked bar: Top 15 ngôn ngữ lập trình được sử dụng, phân theo model AI sinh code.",
    tip: "Giúp hiểu ngôn ngữ nào được hỗ trợ tốt nhất bởi model nào trong môi trường của bạn.",
  },
  mon_langModelChart: {
    title: "Sinh code theo Ngôn ngữ & Model",
    description: "Biểu đồ cột nằm ngang: code_generation_activity_count theo top 15 ngôn ngữ, phân theo model.",
  },
  mon_activeUsers: {
    title: "Active Users (Monitor tab)",
    description: "Số người dùng đã thực hiện ít nhất 1 premium AI request (chat, code gen với model AI) trong kỳ báo cáo.",
    metrics: [
      { name: "Nguồn dữ liệu", desc: "Premium request usage API — chỉ đếm user dùng AI model", example: "27 users" },
      { name: "Khác với sidebar", desc: "Sidebar dùng Seats API (last_activity_at ≤ 30 ngày) → số cao hơn vì đếm cả code completion", example: "Sidebar: 38, Monitor: 27" },
    ],
    tip: "Sự chênh lệch giữa các tab là bình thường vì mỗi tab dùng nguồn dữ liệu khác nhau. Monitor chỉ đếm user dùng premium AI models.",
  },
  kpi_active_seats: {
    title: "Active Seats (Usage Metrics tab)",
    description: "Số seats có hoạt động Copilot trong vòng 28 ngày gần nhất, theo dữ liệu từ GitHub Billing API.",
    metrics: [
      { name: "Nguồn dữ liệu", desc: "Billing API: seat_breakdown.active_this_cycle", example: "38 active / 40 total" },
      { name: "Khác với Monitor", desc: "Monitor dùng premium request data → thấp hơn vì chỉ đếm user dùng AI model", example: "Usage Metrics: 38, Monitor: 27" },
    ],
    tip: "Các tab khác nhau dùng nguồn dữ liệu khác nhau. Số trong Usage Metrics KPI là con số chính xác nhất từ GitHub Billing.",
  },

  // ─── Monitor Tab KPI Cards ───────────────────────────────────────────────
  mon_uniqueModels: {
    title: "Số Model AI khác nhau",
    description: "Số lượng AI model khác biệt được sử dụng trong kỳ báo cáo 28 ngày gần nhất. Mỗi tên model riêng biệt trong dữ liệu GitHub được đếm một lần.",
    metrics: [
      { name: "Nguồn dữ liệu", desc: "Trường 'model' trong totals_by_model_feature của GitHub Usage API", example: "claude-sonnet-4.6, gpt-5.3-codex, ..." },
      { name: "Lưu ý", desc: "GitHub đôi khi trả về cùng một model với tên hơi khác nhau (vd: claude-4.6-sonnet vs claude-sonnet-4.6) — con số có thể hơi cao hơn thực tế.", example: "15 models (bao gồm 'others', 'auto')" },
    ],
    tip: "Nếu con số có vẻ cao, kiểm tra bảng Model Detail bên dưới để xem danh sách đầy đủ các model đang được dùng.",
  },
  mon_topModel: {
    title: "Model AI được dùng nhiều nhất",
    description: "Model AI có tổng số hoạt động (Interactions + Code Gen) cao nhất trong 28 ngày gần nhất.",
    metrics: [
      { name: "Cách tính", desc: "Model có (interactions + code_gen) cao nhất tổng cộng 28 ngày", example: "claude-sonnet-4.6: 1,965 hoạt động" },
      { name: "Interactions", desc: "Số lần người dùng gửi prompt/chat với model đó", example: "526 interactions" },
      { name: "Code Gen", desc: "Số lần model sinh code suggestion (inline completion)", example: "1,439 code gen" },
    ],
    tip: "Model phổ biến nhất thường là model mặc định cho chat. Nếu đó là model premium (Claude Opus, GPT-5.5), cần theo dõi chi phí Premium Requests.",
  },
  mon_totalInteractions: {
    title: "Tổng số Interactions (28 ngày)",
    description: "Tổng số lần người dùng chủ động gửi yêu cầu tới Copilot AI (chat, prompt, agent) trong 28 ngày gần nhất. Được tổng hợp từ tất cả models và tất cả orgs.",
    metrics: [
      { name: "user_initiated_interaction_count", desc: "Số lần người dùng bấm gửi/submit 1 yêu cầu cho Copilot", example: "3,674 interactions" },
      { name: "Khác Code Gen", desc: "Interactions là hành động chủ động (chat, agent); Code Gen là số lần Copilot tự đề xuất inline code", example: "Interactions: 3,674 · Code Gen: 3,764" },
      { name: "Kỳ báo cáo", desc: "Tổng cộng 28 ngày gần nhất (enterprise-level usage report)", example: "2026-04-26 → 2026-05-24" },
    ],
    tip: "Interactions cao = team đang dùng Copilot Chat/Agent tích cực. Code Gen cao = team đang dùng inline completion nhiều. Cả hai đều tốt nhưng phản ánh kiểu sử dụng khác nhau.",
  },
  mon_totalCodeGen: {
    title: "Tổng số Code Generations (28 ngày)",
    description: "Tổng số lần Copilot tạo ra code suggestion (inline completion, code block) trong 28 ngày gần nhất, tính trên tất cả models.",
    metrics: [
      { name: "code_generation_activity_count", desc: "Số event Copilot sinh code — mỗi lần popup gợi ý hiện lên là 1 event", example: "3,764 code gen events" },
      { name: "Khác với Accepted", desc: "Code Gen là số lần Copilot ĐỀ XUẤT; Code Accept là số lần developer CHẤP NHẬN (nhấn Tab)", example: "Gen: 3,764 → Accept: 1,497 (≈ 40%)" },
      { name: "Kỳ báo cáo", desc: "28 ngày từ dữ liệu enterprise-level", example: "Tổng 28 ngày, không phải ngày hôm nay" },
    ],
    tip: "Accept Rate = Code Accept / Code Gen. Nếu Accept Rate thấp (< 25%), developer có thể đang dismiss gợi ý vì không phù hợp — cần cải thiện context (comment, tên biến rõ ràng hơn).",
  },
};
