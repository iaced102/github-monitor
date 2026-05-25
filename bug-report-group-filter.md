# Group Filter Bug Report — OctoFinance

**Test date:** 2026-05-25  
**Tested by:** Playwright MCP automated testing  
**Tester account:** phucvh (super_admin)

---

## Groups tested

| Group | Members | Has usage data |
|-------|---------|----------------|
| Team Alpha (4) | baolq_TinLT (hpt org) | No — baolq_TinLT not in usage_users |
| Team Beta (1) | duynd_TinLT | Yes |
| ms (3) | vnpt22_TinLT, PhucVH01_TinLT, a | Yes (vnpt22_TinLT) |

---

## Bugs Found and Fixed

### BUG 1 — Hardcoded "(28 ngày)" in Giám sát period label ✅ FIXED

**File:** `frontend/src/components/UsageMonitorDashboard.tsx` line 167  
**Symptom:** Period label always showed "(28 ngày)" regardless of actual data range.  
When `ms` group selected, data spans 2026-05-18→2026-05-24 (7 days), but UI showed "(28 ngày)".  
**Fix:** Dynamically calculate actual days from `report_start` and `report_end`.  
**Result:** ms group now shows "(7 ngày)", Team Beta shows "(25 ngày)" ✅

---

### BUG 2 — unique_models KPI counts 0-activity models ✅ FIXED

**File:** `backend/app/routers/data.py` — `get_usage_monitor()` + `model_totals_list`  
**Symptom:** When filtering by group, per-user `totals_by_model_feature` records contain model entries with
`interactions=0, code_gen=0` (models that were available but not used). These were counted in:
- `unique_models` KPI ("SỐ MODEL SỬ DỤNG")
- `model_totals` list returned to the frontend

**Before fix:**
- Team Beta: `unique_models=6` (only 2 models had real activity)
- ms group: `unique_models=4` (only 2 models had real activity)

**After fix:** Filtered out `interactions + code_gen == 0` entries:
- Team Beta: `unique_models=2` ✅
- ms group: `unique_models=2` ✅

**Also fixed `all_models` list** to exclude 0-activity models (used as chart series keys).

---

### BUG 3 — 0-activity models in model_usage (Chỉ số sử dụng) ✅ FIXED

**File:** `backend/app/routers/data.py` line 554 — `get_dashboard()` `model_usage`  
**Symptom:** Same issue as Bug 2 but in the main dashboard endpoint. When group filter active,
`model_usage` list included models with 0 interactions and 0 code_gen.  
**Fix:** Added `if v["interactions"] + v["code_gen"] > 0` filter.  
**Note:** Models with only premium_requests (0 code activity) are still correctly included via the
premium merge logic (lines 581-584).

---

### BUG 4 — 0-activity models in premium section (Yêu cầu cao cấp) ✅ FIXED

**File:** `backend/app/routers/data.py` — `_build_api_premium_section()` line 836  
**Symptom:** When group filter active, `activity_models` list in premium section included models
with 0 interactions and 0 code_gen.  
**Fix:** Added `if v["interactions"] + v["code_gen"] > 0` filter.

---

## No-bug findings (correct behavior)

| Tab | Group | Expected | Actual | Status |
|-----|-------|----------|--------|--------|
| Chỉ số sử dụng | Team Alpha | 1 seat, 0 usage | 1 seat, 100% active, $39 | ✅ Correct |
| Chỉ số sử dụng | Team Beta | 1 seat, 877 code_gen | 1 seat, 877 code_gen | ✅ Correct |
| Chỉ số sử dụng | ms | 2 seats, 1 active | 2 seats, 1 active | ✅ Correct |
| ROI | Team Alpha | 0 (no usage data) | Blank/0 | ✅ Correct |
| ROI | Team Beta | 1 user, 99.2% acceptance | 1 user, 99.2% | ✅ Correct |
| Trung tâm chi phí | Team Alpha | baolq_TinLT, 0 interactions | Shows correctly | ✅ Correct |
| Giám sát | Team Beta | 91 interactions, 877 code_gen, 1 user | 91, 877, 1 user | ✅ Correct |

---

## Sidebar KPI note

The sidebar KPIs (Tổng ghế: 51, Hoạt động: 46, Lãng phí: 5) **intentionally do not respond to group filter** — by design, they always show global org-level stats. This is not a bug.

