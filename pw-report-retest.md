# Playwright MCP Re-test Report

Target: http://localhost:8000  
Date: 2026-05-24

## TEST 1: Admin defaults to All Users on fresh login
[PASS] Admin fresh login opened Dashboard → Usage Metrics with GroupFilter defaulting to `All Users`.
- No scope banner was visible before selecting a group.
- KPI data was real/non-empty (`Total Seats: 40`, `Active: 39`, `Inactive: 1`).
- Evidence: `/var/www/OctoFinance/pw-retest-admin-default.png`

## TEST 2: Admin selects Team Alpha — scope banner + filter works
[PASS] Admin group scoping worked across tabs.
- Selecting `Team Alpha (3)` showed the scope banner and `FILTERED` badge.
- Usage Metrics/Monitor/Premium Requests all preserved scoped UI state.
- Monitor showed zero scoped metrics; Premium Requests stayed scoped and issued filtered API call.
- Evidence:
  - `/var/www/OctoFinance/pw-retest-admin-team-alpha-metrics.png`
  - `/var/www/OctoFinance/pw-retest-admin-team-alpha-monitor.png`
  - `/var/www/OctoFinance/pw-retest-admin-team-alpha-premium.png`
- API evidence: `GET /api/data/csv-dashboard?group_id=1` returned 200 on Premium Requests.

## TEST 3: Manager login — should default to metrics tab (not groups)
[PASS] Manager landed on Metrics, not Groups.
- Immediate post-login state showed Dashboard metrics view.
- No `Access restricted to super admins` message appeared.
- Scope auto-selected to `Team Alpha (3)` with visible scope banner.
- `User Groups` tab was not visible for manager.
- Forced localStorage state `dashboardTab=groups` and refreshed; app redirected back to metrics.
- Evidence: `/var/www/OctoFinance/pw-retest-manager-login.png`

## TEST 4: Manager cannot change scope
[PASS] Manager scope was locked to Team Alpha.
- GroupFilter contained only one option: `Team Alpha (3)`.
- `All Users` and `Team Beta` were not available.

## TEST 5: Language test
[PASS] Scope banner localized correctly.
- Chinese UI showed `按组过滤: Team Alpha`.
- Vietnamese UI showed `Đang lọc theo nhóm: Team Alpha`.
- Evidence: `/var/www/OctoFinance/pw-retest-admin-vietnamese.png`

## Final Verdict
[PASS] All 3 fixed bugs verified:
1. Admin default scope reset to `All Users` on fresh login.
2. Manager no longer lands on `groups`; redirect to metrics works.
3. Premium Requests respects active group scope and uses filtered API request.

## Saved Screenshots
- `/var/www/OctoFinance/pw-retest-admin-default.png`
- `/var/www/OctoFinance/pw-retest-admin-team-alpha-metrics.png`
- `/var/www/OctoFinance/pw-retest-admin-team-alpha-monitor.png`
- `/var/www/OctoFinance/pw-retest-admin-team-alpha-premium.png`
- `/var/www/OctoFinance/pw-retest-manager-login.png`
- `/var/www/OctoFinance/pw-retest-admin-vietnamese.png`
