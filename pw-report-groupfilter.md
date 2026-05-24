# Playwright E2E Test Report — Group Filter
Date: 2026-05-24

## Summary
- PASS: 24
- FAIL: 6
- BLOCKED: 1
- UX / Anomalies: 4
- INFO: 1

## Test Results

### Phase 1: Login
- [PASS] Login page loads: Username, password, login button, and language switcher rendered correctly.
- [PASS] Admin login works: Admin credentials reached the dashboard successfully.
- [FAIL] Default scope incorrect after admin login: Dashboard initially loaded with `Team Alpha (3)` selected instead of `All Users`.
- [FAIL] Console/auth noise: Repeated 401 errors appeared for `/api/health` before login and `/api/auth/me` after login.

### Phase 2: Group Filter — Usage Metrics
- [PASS] Scope dropdown visible at top right.
- [PASS] `All Users` state rendered populated KPIs/charts.
- [PASS] Selecting `Team Alpha` showed the scope banner for `Team Alpha (3)`.
- [PASS] Filtered state switched content to a no-data empty state.
- [PASS] Clearing back to `All Users` restored populated data.
- [FAIL] Banner/pill wording is confusing: one state showed generic `Filtered` rather than the group name.

### Phase 3: Group Filter — Monitor
- [PASS] Scope dropdown remained visible on Monitor.
- [PASS] Selecting `Team Beta` showed the scope banner for `Team Beta (3)`.
- [PASS] Monitor KPI cards/charts stayed populated while filtered.
- [FAIL] Filter pill is generic (`Filtered`) instead of identifying the actual group.

### Phase 4: Group Filter — Premium Requests
- [PASS] Scope dropdown visible.
- [PASS] Selecting `Team Alpha` showed the scope banner and filtered pill.
- [FAIL] Premium Requests metrics appeared unchanged after filtering; KPI values/model breakdown looked identical to `All Users`.

### Phase 5: Group Filter — Usage Report
- [PASS] Scope dropdown visible.
- [PASS] Selecting `Team Alpha` showed the scope banner and filtered pill.
- [PASS] Filtered state displayed `No data available for the selected group.`

### Phase 6: Group Filter — Cost Centers
- [PASS] Scope dropdown visible.
- [PASS] Selecting `Team Alpha` showed the scope banner and filtered pill.
- [PASS] Filtered view rendered correctly with enterprise fallback messaging.
- [PASS] Filtered KPIs updated to `0` total seats and `0` active users.
- [FAIL] Scope interaction was inconsistent during automation because multiple comboboxes exist on the page and the top-right scope control is easy to mis-target.

### Phase 7: User Groups
- [PASS] Scope filter is not shown on User Groups, which matches expected behavior.
- [PASS] Groups page listed `Team Alpha` and `Team Beta` with 3 members each.
- [PASS] Team Alpha members modal showed `user1`, `user2`, `user5`.
- [PASS] Members modal could be closed.
- [FAIL] `Members` is ambiguous for automation/UX because both card text and buttons contain the same label.

### Phase 8: Manager Login Test
- [FAIL] Manager login succeeded, but dashboard access was blocked with `Access restricted to super admins.`
- [FAIL] Expected auto-selected `Team Alpha` scope was not available because manager never reached a scoped dashboard view.
- [BLOCKED] Could not verify that manager cannot switch to `Team Beta` because no scope dropdown was available on the restricted screen.

### Phase 9: Scope Banner i18n
- [INFO] Language toggle was exercised from the Usage Metrics page.
- [FAIL] First language switch went to Chinese (`中文`) instead of Vietnamese as requested.
- [PASS] Localized filtered banner appeared after selecting `Team Alpha`, showing `按组过滤: Team Alpha (3)`.
- [FAIL] Localization quality is inconsistent; some strings remained mixed-language (for example `Xem giải thích chỉ số` beside Chinese labels).
- [PASS] After cycling languages, the UI returned to English successfully.

## Bugs Found
- Admin dashboard defaults to a filtered group (`Team Alpha`) instead of `All Users`.
- Repeated 401 console errors for `/api/health` and `/api/auth/me`.
- Premium Requests filter appears non-functional; metrics do not visibly change when filtering to Team Alpha.
- Manager cannot access a scoped dashboard and is blocked by `Access restricted to super admins.`
- Language toggle did not go directly to Vietnamese; it switched to Chinese first.
- Localization is incomplete/mixed across the UI.

## Anomalies / Confusing UX
- Generic `Filtered` pill is redundant and less useful than showing the actual group name.
- Cost Centers page has multiple comboboxes, making the scope control easy to confuse with other filters.
- `Members` appears both as descriptive text and as an action button, which is ambiguous.
- Mixed-language strings reduce confidence in i18n quality.
