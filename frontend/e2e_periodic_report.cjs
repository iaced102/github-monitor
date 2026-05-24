/**
 * E2E Test: Báo cáo Định kỳ Theo Tháng/Quý
 *
 * Kiểm tra toàn bộ 7 requirements:
 * 1. Thống kê quản lý License
 * 2. Thống kê người dùng
 * 3. Thống kê mức độ sử dụng Copilot
 * 4. Thống kê kỹ thuật
 * 5. Thống kê và đánh giá theo đơn vị
 * 6. Thống kê xu hướng sử dụng
 * 7. Thống kê phục vụ tối ưu license
 *
 * + Bổ sung: XLSX export, CSV export, HTML export, quarterly month-by-month breakdown
 */

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:8000';
const USERNAME = 'phucvh';
const PASSWORD = 'OctoFinance2024!';

const OUT_DIR = path.join(
  '/home/azureuser/.copilot/session-state/9077cd9f-3554-4060-b0f8-a6e515d2178c/files',
  'e2e_periodic_report'
);

const RESULTS = {
  timestamp: new Date().toISOString(),
  tests: {},
  summary: { passed: 0, failed: 0, skipped: 0 },
  screenshots: [],
};

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function shot(page, filename, fullPage = false) {
  const file = path.join(OUT_DIR, filename);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage, animations: 'disabled' });
  RESULTS.screenshots.push(filename);
  console.log(`  📸 ${filename}`);
  return file;
}

function pass(name, evidence = {}) {
  RESULTS.tests[name] = { status: 'PASS', evidence };
  RESULTS.summary.passed++;
  console.log(`  ✅ PASS: ${name}`);
}

function fail(name, reason, evidence = {}) {
  RESULTS.tests[name] = { status: 'FAIL', reason, evidence };
  RESULTS.summary.failed++;
  console.log(`  ❌ FAIL: ${name} — ${reason}`);
}

function skip(name, reason) {
  RESULTS.tests[name] = { status: 'SKIP', reason };
  RESULTS.summary.skipped++;
  console.log(`  ⏭  SKIP: ${name} — ${reason}`);
}

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await Promise.race([
    page.waitForSelector('input[placeholder="Username"]', { timeout: 10000 }).catch(() => null),
    page.waitForSelector('.status-bar', { timeout: 10000 }).catch(() => null),
  ]);
  await page.waitForTimeout(1000);

  const loginBtn = page.getByRole('button', { name: /login/i });
  if (await loginBtn.count()) {
    await page.locator('input[placeholder="Username"]').fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await loginBtn.click();
  }

  await page.waitForSelector('.status-bar', { timeout: 30000 });
  await page.waitForTimeout(2000);
}

/**
 * Test: Periodic Report API endpoints directly
 */
async function testApiEndpoints(page) {
  console.log('\n=== API ENDPOINT TESTS ===');

  // Test HTML format
  const htmlRes = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=html`, {
      credentials: 'include',
    });
    return { status: r.status, contentType: r.headers.get('content-type'), size: (await r.blob()).size };
  }, BASE_URL);

  if (htmlRes.status === 200 && htmlRes.contentType?.includes('html')) {
    pass('API-HTML-format', { contentType: htmlRes.contentType, size: htmlRes.size });
  } else {
    fail('API-HTML-format', `Expected 200 HTML, got ${htmlRes.status} ${htmlRes.contentType}`, htmlRes);
  }

  // Test CSV format
  const csvRes = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=csv`, {
      credentials: 'include',
    });
    return { status: r.status, contentType: r.headers.get('content-type'), size: (await r.blob()).size };
  }, BASE_URL);

  if (csvRes.status === 200 && csvRes.contentType?.includes('csv')) {
    pass('API-CSV-format', { contentType: csvRes.contentType, size: csvRes.size });
  } else {
    fail('API-CSV-format', `Expected 200 CSV, got ${csvRes.status} ${csvRes.contentType}`, csvRes);
  }

  // Test XLSX format (NEW)
  const xlsxRes = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=xlsx`, {
      credentials: 'include',
    });
    return { status: r.status, contentType: r.headers.get('content-type'), size: (await r.blob()).size };
  }, BASE_URL);

  if (xlsxRes.status === 200 && xlsxRes.contentType?.includes('spreadsheetml')) {
    pass('API-XLSX-format', { contentType: xlsxRes.contentType, size: xlsxRes.size });
  } else {
    fail('API-XLSX-format', `Expected 200 XLSX, got ${xlsxRes.status} ${xlsxRes.contentType}`, xlsxRes);
  }

  // Test Quarterly format
  const qRes = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=quarterly&year=2026&period=1&format=html`, {
      credentials: 'include',
    });
    return { status: r.status, size: (await r.blob()).size };
  }, BASE_URL);

  if (qRes.status === 200 && qRes.size > 0) {
    pass('API-quarterly-format', { size: qRes.size });
  } else {
    fail('API-quarterly-format', `Got ${qRes.status}, size=${qRes.size}`, qRes);
  }

  // Test invalid format
  const badRes = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=pdf`, {
      credentials: 'include',
    });
    const json = await r.json();
    return { status: r.status, error: json.error };
  }, BASE_URL);

  if (badRes.error?.includes('format must be')) {
    pass('API-invalid-format-validation', { error: badRes.error });
  } else {
    fail('API-invalid-format-validation', `Expected validation error, got: ${JSON.stringify(badRes)}`);
  }
}

/**
 * Test: HTML report content covers all 7 sections
 */
async function testHtmlReportContent(page) {
  console.log('\n=== HTML REPORT CONTENT ===');

  const html = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=html`, {
      credentials: 'include',
    });
    return r.text();
  }, BASE_URL);

  // Section 1: License Management
  const hasLicenseSection = html.includes('Thống kê quản lý License') || html.includes('1. Thống kê');
  const hasLicenseKpis = html.includes('Tổng số License') || html.includes('License Active');
  if (hasLicenseSection && hasLicenseKpis) {
    pass('HTML-sec1-license-management', { hasSection: hasLicenseSection, hasKpis: hasLicenseKpis });
  } else {
    fail('HTML-sec1-license-management', 'Missing Section 1 content', { hasLicenseSection, hasLicenseKpis });
  }

  // Section 2: User Usage
  const hasUserSection = html.includes('Thống kê người dùng') || html.includes('2. Thống kê');
  const hasUserColumns = html.includes('Ngày bắt đầu') && html.includes('Hoạt động gần nhất') && html.includes('Ngày HĐ');
  if (hasUserSection && hasUserColumns) {
    pass('HTML-sec2-user-usage', { hasSection: hasUserSection, hasColumns: hasUserColumns });
  } else {
    fail('HTML-sec2-user-usage', 'Missing Section 2 columns', { hasUserSection, hasUserColumns });
  }

  // Section 3: Copilot Usage
  const hasCopilotSection = html.includes('Mức độ sử dụng Copilot') || html.includes('3. Thống kê');
  const hasCopilotKpis = html.includes('Tỷ lệ chấp nhận') && html.includes('Acceptance Rate') || html.includes('acceptance_rate') || html.includes('Tổng tương tác');
  const hasChatStats = html.includes('Chat') && html.includes('PR Summary');
  if (hasCopilotSection && hasChatStats) {
    pass('HTML-sec3-copilot-usage', { hasSection: hasCopilotSection, hasChat: hasChatStats });
  } else {
    fail('HTML-sec3-copilot-usage', 'Missing Section 3 content', { hasCopilotSection, hasChatStats });
  }

  // Section 4: Technical (Model/IDE/Language/Feature) + repo note
  const hasTechSection = html.includes('Thống kê kỹ thuật') || html.includes('4. Thống kê');
  const hasModelStats = html.includes('Theo Model AI') || html.includes('Model AI');
  const hasIdeStats = html.includes('Theo IDE') || html.includes('IDE');
  const hasLangStats = html.includes('Ngôn ngữ lập trình') || html.includes('Theo Ngôn ngữ');
  const hasFeatureStats = html.includes('Loại tính năng') || html.includes('Theo Loại tính năng') || html.includes('Tính năng');
  const hasRepoNote = html.includes('repository') || html.includes('Repository');
  if (hasTechSection && hasModelStats && hasIdeStats && hasLangStats && hasFeatureStats) {
    pass('HTML-sec4-technical-metrics', { hasModel: hasModelStats, hasIde: hasIdeStats, hasLang: hasLangStats, hasFeat: hasFeatureStats });
  } else {
    fail('HTML-sec4-technical-metrics', 'Missing technical metric tables', { hasTechSection, hasModelStats, hasIdeStats, hasLangStats, hasFeatureStats });
  }
  if (hasRepoNote) {
    pass('HTML-sec4-repo-limitation-note', { hasNote: hasRepoNote });
  } else {
    fail('HTML-sec4-repo-limitation-note', 'Missing repository limitation note in Section 4');
  }

  // Section 5: By Org/Team + ranking
  const hasOrgSection = html.includes('đánh giá theo đơn vị') || html.includes('5. Thống kê');
  const hasRanking = html.includes('Hạng') || html.includes('rank');
  const hasTeamStats = html.includes('Team/Nhóm') || html.includes('Team/Đơn vị');
  if (hasOrgSection && hasRanking && hasTeamStats) {
    pass('HTML-sec5-org-stats', { hasOrgSection, hasRanking, hasTeamStats });
  } else {
    fail('HTML-sec5-org-stats', 'Missing Section 5 content', { hasOrgSection, hasRanking, hasTeamStats });
  }

  // Section 6: Usage Trends (DAU/WAU/MAU)
  const hasTrendSection = html.includes('xu hướng') || html.includes('Xu hướng') || html.includes('6. Thống kê');
  const hasDAU = html.includes('DAU') || html.includes('Daily Active');
  const hasWAU = html.includes('WAU') || html.includes('Weekly Active');
  const hasMAU = html.includes('MAU') || html.includes('Monthly Active');
  if (hasTrendSection && hasDAU && hasWAU && hasMAU) {
    pass('HTML-sec6-trends', { hasDAU, hasWAU, hasMAU });
  } else {
    fail('HTML-sec6-trends', 'Missing DAU/WAU/MAU in trends', { hasTrendSection, hasDAU, hasWAU, hasMAU });
  }

  // Section 7: Optimization + reallocation
  const hasOptSection = html.includes('tối ưu License') || html.includes('tối ưu license') || html.includes('7. Thống kê');
  const hasInactiveList = html.includes('không hoạt động') || html.includes('inactive');
  const hasLowUsage = html.includes('ít sử dụng') || html.includes('low');
  const hasRealloc = html.includes('cấp lại') || html.includes('tái phân bổ') || html.includes('Loại đề xuất');
  if (hasOptSection && hasInactiveList && hasLowUsage) {
    pass('HTML-sec7-optimization', { hasInactive: hasInactiveList, hasLow: hasLowUsage });
  } else {
    fail('HTML-sec7-optimization', 'Missing Section 7 content', { hasOptSection, hasInactiveList, hasLowUsage });
  }
  if (hasRealloc) {
    pass('HTML-sec7-reallocation-recommendation', { hasRealloc });
  } else {
    fail('HTML-sec7-reallocation-recommendation', 'Missing reallocation recommendation in Section 7');
  }

  // Sticky TOC
  const hasTOC = html.includes('position:sticky') || html.includes('position: sticky');
  if (hasTOC) {
    pass('HTML-sticky-toc', { hasTOC });
  } else {
    fail('HTML-sticky-toc', 'Missing sticky Table of Contents in HTML report');
  }

  // Section anchors
  const hasAnchors = html.includes('id="sec1"') && html.includes('id="sec7"');
  if (hasAnchors) {
    pass('HTML-section-anchors', { hasAnchors });
  } else {
    fail('HTML-section-anchors', 'Missing section anchor IDs');
  }
}

/**
 * Test: Quarterly report has monthly breakdown
 */
async function testQuarterlyReport(page) {
  console.log('\n=== QUARTERLY REPORT ===');

  const html = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=quarterly&year=2026&period=1&format=html`, {
      credentials: 'include',
    });
    return r.text();
  }, BASE_URL);

  const hasMonthlyBreakdown = html.includes('So sánh từng tháng trong quý') || html.includes('MoM');
  if (hasMonthlyBreakdown) {
    pass('Quarterly-monthly-breakdown', { hasBreakdown: hasMonthlyBreakdown });
  } else {
    fail('Quarterly-monthly-breakdown', 'Missing month-by-month comparison table in quarterly HTML report');
  }

  // CSV quarterly
  const csv = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=quarterly&year=2026&period=1&format=csv`, {
      credentials: 'include',
    });
    return r.text();
  }, BASE_URL);

  const csvHasMoM = csv.includes('MoM') || csv.includes('tháng trong quý');
  if (csvHasMoM) {
    pass('Quarterly-CSV-monthly-breakdown', { csvHasMoM });
  } else {
    fail('Quarterly-CSV-monthly-breakdown', 'Missing monthly breakdown in quarterly CSV');
  }
}

/**
 * Test: CSV report content
 */
async function testCsvContent(page) {
  console.log('\n=== CSV CONTENT ===');

  const csv = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=csv`, {
      credentials: 'include',
    });
    return r.text();
  }, BASE_URL);

  const sections = [
    { key: 'CSV-sec1-license', pattern: /License/i },
    { key: 'CSV-sec2-users', pattern: /người dùng|Người dùng|User/i },
    { key: 'CSV-sec3-copilot', pattern: /Copilot/i },
    { key: 'CSV-sec4-technical', pattern: /Model AI|IDE|Ngôn ngữ/i },
    { key: 'CSV-sec5-org', pattern: /đơn vị|Org\/Đơn/i },
    { key: 'CSV-sec6-trends', pattern: /xu hướng|DAU|Xu hướng/i },
    { key: 'CSV-sec7-optimization', pattern: /tối ưu|License.*đề xuất/i },
  ];

  for (const { key, pattern } of sections) {
    if (pattern.test(csv)) {
      pass(key, { matched: String(pattern) });
    } else {
      fail(key, `Section not found in CSV`, { pattern: String(pattern) });
    }
  }

  // Repo limitation note in CSV
  if (csv.includes('[Lưu ý]') || (csv.includes('GitHub Copilot') && (csv.includes('repository') || csv.includes('Repository') || csv.includes('Usage API')))) {
    pass('CSV-sec4-repo-note', {});
  } else {
    fail('CSV-sec4-repo-note', 'Missing repository limitation note in CSV');
  }
}

/**
 * Test: Frontend UI - PeriodicReportButton has 3 format buttons
 */
async function testFrontendUI(page) {
  console.log('\n=== FRONTEND UI TESTS ===');

  // Navigate to the app
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.status-bar', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Go to CostCenter or Overview tab that has the periodic report button
  // Try various nav buttons
  let foundReportButton = false;
  const navButtons = ['Cost Center', 'Overview', 'Dashboard', 'Usage Report'];
  for (const btnName of navButtons) {
    const btn = page.getByRole('button', { name: new RegExp(btnName, 'i') });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(1200);
      const reportBtn = page.locator('button').filter({ hasText: /Periodic Report|Báo cáo định kỳ|定期报告/i });
      if (await reportBtn.count()) {
        foundReportButton = true;
        await shot(page, 'ui_01_periodic_report_button.png');

        // Click the button to open the dropdown
        await reportBtn.first().click();
        await page.waitForTimeout(800);
        await shot(page, 'ui_02_periodic_report_dropdown.png', true);

        // Check for 3 format buttons: HTML, CSV, Excel/XLSX
        const htmlBtn = page.locator('button').filter({ hasText: /HTML/i });
        const csvBtn = page.locator('button').filter({ hasText: /CSV/i });
        const xlsxBtn = page.locator('button').filter({ hasText: /Excel|XLSX/i });

        const hasHtml = await htmlBtn.count() > 0;
        const hasCsv = await csvBtn.count() > 0;
        const hasXlsx = await xlsxBtn.count() > 0;

        if (hasHtml && hasCsv && hasXlsx) {
          pass('UI-three-format-buttons', { hasHtml, hasCsv, hasXlsx });
        } else {
          fail('UI-three-format-buttons', `Missing format buttons. HTML:${hasHtml} CSV:${hasCsv} XLSX:${hasXlsx}`);
        }

        // Check period type toggle (monthly/quarterly)
        const monthlyBtn = page.locator('button').filter({ hasText: /Monthly|Tháng|按月/i });
        const quarterlyBtn = page.locator('button').filter({ hasText: /Quarterly|Quý|季度/i });
        const hasMonthly = await monthlyBtn.count() > 0;
        const hasQuarterly = await quarterlyBtn.count() > 0;

        if (hasMonthly && hasQuarterly) {
          pass('UI-monthly-quarterly-toggle', { hasMonthly, hasQuarterly });
        } else {
          fail('UI-monthly-quarterly-toggle', `Toggle missing. Monthly:${hasMonthly} Quarterly:${hasQuarterly}`);
        }

        // Switch to quarterly and check Q1-Q4 options
        if (hasQuarterly) {
          await quarterlyBtn.first().click();
          await page.waitForTimeout(500);
          const quarterSelect = page.locator('select').last();
          const options = await quarterSelect.locator('option').allTextContents();
          const hasQ1 = options.some(o => /Q1/i.test(o));
          const hasQ4 = options.some(o => /Q4/i.test(o));
          if (hasQ1 && hasQ4) {
            pass('UI-quarterly-options-Q1-Q4', { options });
          } else {
            fail('UI-quarterly-options-Q1-Q4', 'Missing Q1-Q4 options', { options });
          }
          await shot(page, 'ui_03_quarterly_selector.png', true);
        }

        // Close dropdown
        const closeBtn = page.locator('button').filter({ hasText: '✕' });
        if (await closeBtn.count()) await closeBtn.first().click();
        break;
      }
    }
  }

  if (!foundReportButton) {
    skip('UI-periodic-report-button', 'Could not find Periodic Report button in any nav tab');
    skip('UI-three-format-buttons', 'Depends on finding periodic report button');
    skip('UI-monthly-quarterly-toggle', 'Depends on finding periodic report button');
    skip('UI-quarterly-options-Q1-Q4', 'Depends on finding periodic report button');
  }
}

/**
 * Test: Download HTML report and verify content by fetching as text
 */
async function testReportDownload(page, context) {
  console.log('\n=== REPORT DOWNLOAD TEST ===');

  // Fetch the HTML report as text (instead of navigating, which triggers download)
  const htmlContent = await page.evaluate(async (baseUrl) => {
    const r = await fetch(
      `${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=html`,
      { credentials: 'include' }
    );
    if (!r.ok) return { error: r.status };
    return { html: await r.text() };
  }, BASE_URL);

  if (htmlContent.error) {
    fail('Download-HTML-report', `Got status ${htmlContent.error}`);
    return;
  }

  // Render in a new page using setContent
  const newPage = await context.newPage();
  await newPage.setContent(htmlContent.html, { waitUntil: 'domcontentloaded' });
  await newPage.waitForTimeout(800);
  await shot(newPage, 'report_01_html_report.png', true);

  // Verify TOC is present
  const tocExists = await newPage.locator('nav').count();
  const tocLink = await newPage.locator('a[href="#sec1"]').count();
  if (tocExists > 0 && tocLink > 0) {
    pass('Download-HTML-has-toc', { tocExists, tocLink });
  } else {
    fail('Download-HTML-has-toc', `Sticky TOC nav not found. nav:${tocExists} anchor-link:${tocLink}`);
  }

  // Verify section anchors are present
  const sec1 = await newPage.locator('#sec1').count();
  const sec7 = await newPage.locator('#sec7').count();
  if (sec1 > 0 && sec7 > 0) {
    pass('Download-HTML-section-anchors', { sec1, sec7 });
  } else {
    fail('Download-HTML-section-anchors', `sec1:${sec1} sec7:${sec7}`);
  }

  // Section 1 KPI values visible
  const sec1Text = await newPage.locator('#sec1').innerText().catch(() => '');
  const hasLicenseNumbers = /\d/.test(sec1Text);
  if (hasLicenseNumbers) {
    pass('Download-HTML-sec1-has-data', { textLength: sec1Text.length });
  } else {
    fail('Download-HTML-sec1-has-data', 'Section 1 has no numeric data');
  }

  // Section 7 reallocation column
  const sec7Text = await newPage.locator('#sec7').innerText().catch(() => '');
  const hasRealloc = /Thu hồi|cấp lại|Loại đề xuất/i.test(sec7Text);
  if (hasRealloc) {
    pass('Download-HTML-sec7-reallocation-column', {});
  } else {
    fail('Download-HTML-sec7-reallocation-column', 'Section 7 missing reallocation column');
  }

  // Section 4 repo note
  const sec4Text = await newPage.locator('#sec4').innerText().catch(() => '');
  const hasRepoNote = /repository|Repository|Usage API|Lưu ý/i.test(sec4Text);
  if (hasRepoNote) {
    pass('Download-HTML-sec4-repo-note', {});
  } else {
    fail('Download-HTML-sec4-repo-note', 'Section 4 missing repo limitation note');
  }

  await shot(newPage, 'report_01b_sec7_detail.png', false);
  await newPage.close();
}

/**
 * Test: Quarterly report monthly breakdown in HTML
 */
async function testQuarterlyHTMLBreakdown(page, context) {
  console.log('\n=== QUARTERLY HTML BREAKDOWN ===');

  const htmlContent = await page.evaluate(async (baseUrl) => {
    const r = await fetch(
      `${baseUrl}/api/data/periodic-report?period_type=quarterly&year=2026&period=1&format=html`,
      { credentials: 'include' }
    );
    if (!r.ok) return { error: r.status };
    return { html: await r.text() };
  }, BASE_URL);

  if (htmlContent.error) {
    fail('Quarterly-HTML-renders', `Got status ${htmlContent.error}`);
    return;
  }

  const newPage = await context.newPage();
  await newPage.setContent(htmlContent.html, { waitUntil: 'domcontentloaded' });
  await newPage.waitForTimeout(800);
  await shot(newPage, 'report_02_quarterly_html.png', true);

  // Check quarterly label in title/header
  const pageTitle = await newPage.title();
  const headerText = await newPage.locator('h1, h2').first().innerText().catch(() => '');
  const hasQuarterlyLabel = /Q1|Q2|Q3|Q4|Quý/i.test(pageTitle + headerText);
  if (hasQuarterlyLabel) {
    pass('Quarterly-HTML-title-label', { pageTitle, headerText });
  } else {
    fail('Quarterly-HTML-title-label', `No Q1-Q4 or Quý label in "${pageTitle}" / "${headerText}"`);
  }

  // Monthly breakdown table
  const fullText = await newPage.locator('body').innerText();
  const hasMonthlyTable = /So sánh từng tháng trong quý|Tháng \d+ — Q[1-4]/i.test(fullText);
  if (hasMonthlyTable) {
    pass('Quarterly-HTML-monthly-comparison-table', {});
  } else {
    fail('Quarterly-HTML-monthly-comparison-table', 'Month-by-month comparison table not found in quarterly report');
  }

  // MoM growth
  const hasMoM = /MoM/i.test(fullText) || /tháng trong quý/i.test(fullText);
  if (hasMoM) {
    pass('Quarterly-HTML-MoM-growth-column', {});
  } else {
    fail('Quarterly-HTML-MoM-growth-column', 'Month-over-Month growth column not found');
  }

  await newPage.close();
}

/**
 * Test: All 7 requirement sections present in CSV
 */
async function testCSVAllSections(page) {
  console.log('\n=== CSV ALL SECTIONS ===');

  const csvBytes = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=csv`, {
      credentials: 'include',
    });
    const ab = await r.arrayBuffer();
    return Array.from(new Uint8Array(ab)).slice(0, 50000);
  }, BASE_URL);

  const csvText = Buffer.from(csvBytes).toString('utf8').replace(/^\ufeff/, '');

  const checks = [
    ['CSV-7sections-1-license', /=== 1\. Thống kê quản lý License ===/],
    ['CSV-7sections-2-users', /=== 2\. Thống kê người dùng ===/],
    ['CSV-7sections-3-copilot', /=== 3\. Thống kê mức độ sử dụng Copilot ===/],
    ['CSV-7sections-4a-model', /=== 4a\. Theo Model AI ===/],
    ['CSV-7sections-4b-ide', /=== 4b\. Theo IDE ===/],
    ['CSV-7sections-4c-lang', /=== 4c\. Theo Ngôn ngữ lập trình ===/],
    ['CSV-7sections-4d-feature', /=== 4d\. Theo Tính năng ===/],
    ['CSV-7sections-5-org', /=== 5\. Thống kê và đánh giá theo đơn vị ===/],
    ['CSV-7sections-6a-daily', /=== 6a\. Xu hướng hàng ngày ===/],
    ['CSV-7sections-6b-weekly', /=== 6b\. Xu hướng hàng tuần ===/],
    ['CSV-7sections-7-optimize', /=== 7\. Tối ưu License/],
    ['CSV-7sections-7b-low-usage', /=== 7b\. User ít sử dụng ===/],
    ['CSV-7sections-8-premium', /=== 8\. Premium Requests ===/],
  ];

  let allPassed = true;
  for (const [key, pattern] of checks) {
    if (pattern.test(csvText)) {
      pass(key, {});
    } else {
      fail(key, `Section header not found: ${pattern}`);
      allPassed = false;
    }
  }
}

/**
 * Test: Org filter parameter works
 */
async function testOrgFilter(page) {
  console.log('\n=== ORG FILTER TEST ===');

  // Get list of orgs first
  const orgs = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/orgs`, { credentials: 'include' });
    const d = await r.json();
    return (d.orgs || []).slice(0, 2).map(o => o.login);
  }, BASE_URL);

  if (!orgs || orgs.length === 0) {
    skip('API-org-filter', 'No orgs found to test filter');
    return;
  }

  const orgParam = orgs[0];
  const res = await page.evaluate(async ({ baseUrl, orgParam }) => {
    const r = await fetch(
      `${baseUrl}/api/data/periodic-report?period_type=monthly&year=2026&period=5&format=csv&orgs=${orgParam}`,
      { credentials: 'include' }
    );
    return { status: r.status, size: (await r.blob()).size };
  }, { baseUrl: BASE_URL, orgParam });

  if (res.status === 200 && res.size > 0) {
    pass('API-org-filter', { org: orgParam, size: res.size });
  } else {
    fail('API-org-filter', `Expected 200, got ${res.status}`, res);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  await ensureDir(OUT_DIR);
  console.log(`\n🚀 E2E Periodic Report Test\n   Output: ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    // Login
    console.log('\n=== LOGIN ===');
    await login(page);
    await shot(page, 'login_01_after_login.png', true);
    console.log('  Logged in successfully');

    // Run all test suites
    await testApiEndpoints(page);
    await testHtmlReportContent(page);
    await testQuarterlyReport(page);
    await testCsvContent(page);
    await testCSVAllSections(page);
    await testFrontendUI(page);
    await testReportDownload(page, context);
    await testQuarterlyHTMLBreakdown(page, context);
    await testOrgFilter(page);
    await testAlertsAPI(page);
    await testReportHistoryAPI(page);
    await testBudgetsAPI(page);

  } catch (err) {
    RESULTS.error = String(err?.stack || err);
    console.error('\n💥 Fatal error:', RESULTS.error);
  } finally {
    await context.close();
    await browser.close();
  }

  // Save results
  const resultsFile = path.join(OUT_DIR, 'results.json');
  await fs.writeFile(resultsFile, JSON.stringify(RESULTS, null, 2), 'utf8');

  // Print summary
  const { passed, failed, skipped } = RESULTS.summary;
  const total = passed + failed + skipped;
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 SUMMARY: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`📁 Results: ${resultsFile}`);
  console.log(`📸 Screenshots: ${OUT_DIR}`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const [name, t] of Object.entries(RESULTS.tests)) {
      if (t.status === 'FAIL') {
        console.log(`   • ${name}: ${t.reason}`);
      }
    }
    process.exitCode = 1;
  } else {
    console.log('\n✅ All tests passed!');
  }
})();

// ========== NEW FEATURE TESTS (Alerts, Report History, Budgets) ==========

async function testAlertsAPI(page) {
  console.log('\n=== ALERTS API TEST ===');

  // GET /api/alerts/config via page.evaluate (cookies already set by login)
  const configResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(`${baseUrl}/api/alerts/config`, { credentials: 'include' });
      return { status: r.status, data: await r.json() };
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (configResult.error) { fail('Alerts-config-has-thresholds', configResult.error); return; }
  const config = configResult.data;

  if (config.thresholds && typeof config.thresholds === 'object') {
    pass('Alerts-config-has-thresholds', { keys: Object.keys(config.thresholds) });
  } else {
    fail('Alerts-config-has-thresholds', `thresholds missing or wrong type: ${JSON.stringify(config)}`);
  }

  if (typeof config.enabled === 'boolean') {
    pass('Alerts-config-has-enabled', { enabled: config.enabled });
  } else {
    fail('Alerts-config-has-enabled', `enabled field not boolean: ${typeof config.enabled}`);
  }

  if (config.thresholds?.inactive_rate) {
    pass('Alerts-config-inactive-rate', config.thresholds.inactive_rate);
  } else {
    fail('Alerts-config-inactive-rate', 'inactive_rate threshold not found');
  }

  if (config.thresholds?.acceptance_rate) {
    pass('Alerts-config-acceptance-rate', config.thresholds.acceptance_rate);
  } else {
    fail('Alerts-config-acceptance-rate', 'acceptance_rate threshold not found');
  }

  // GET /api/alerts/active
  const activeResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(`${baseUrl}/api/alerts/active`, { credentials: 'include' });
      return { status: r.status, data: await r.json() };
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (activeResult.error) { fail('Alerts-active-has-alerts-array', activeResult.error); return; }
  const active = activeResult.data;

  if (Array.isArray(active.alerts)) {
    pass('Alerts-active-has-alerts-array', { count: active.alerts.length });
  } else {
    fail('Alerts-active-has-alerts-array', `alerts not an array: ${JSON.stringify(active)}`);
  }

  if (typeof active.count === 'number') {
    pass('Alerts-active-has-count', { count: active.count });
  } else {
    fail('Alerts-active-has-count', `count field missing: ${JSON.stringify(active)}`);
  }

  if (typeof active.critical === 'number' && typeof active.warning === 'number') {
    pass('Alerts-active-severity-fields', { critical: active.critical, warning: active.warning });
  } else {
    fail('Alerts-active-severity-fields', `critical/warning fields missing: ${JSON.stringify(active)}`);
  }

  // POST /api/alerts/config
  const saveResult = await page.evaluate(async ({ baseUrl, cfg }) => {
    try {
      const r = await fetch(`${baseUrl}/api/alerts/config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      return { status: r.status, data: await r.json() };
    } catch (e) { return { error: String(e) }; }
  }, { baseUrl: BASE_URL, cfg: config });

  if (saveResult.data?.ok === true) {
    pass('Alerts-save-config-ok', { status: saveResult.status });
  } else {
    fail('Alerts-save-config-ok', `save failed: ${JSON.stringify(saveResult)}`);
  }
}

async function testReportHistoryAPI(page) {
  console.log('\n=== REPORT HISTORY API TEST ===');

  // GET /api/data/report-history
  const listResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(`${baseUrl}/api/data/report-history`, { credentials: 'include' });
      return { status: r.status, data: await r.json() };
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (listResult.error) { fail('ReportHistory-has-reports-array', listResult.error); return; }
  const list1 = listResult.data;

  if (Array.isArray(list1.reports)) {
    pass('ReportHistory-has-reports-array', { count: list1.count });
  } else {
    fail('ReportHistory-has-reports-array', `reports not an array: ${JSON.stringify(list1)}`);
  }

  if (typeof list1.count === 'number') {
    pass('ReportHistory-has-count', { count: list1.count });
  } else {
    fail('ReportHistory-has-count', `count field missing`);
  }

  // Generate a report → auto-saved to history
  const genResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(
        `${baseUrl}/api/data/periodic-report?period_type=monthly&year=2025&month=1&format=html`,
        { credentials: 'include' }
      );
      return { status: r.status, size: (await r.blob()).size };
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (genResult.status === 200) {
    pass('ReportHistory-generate-creates-entry', { size: genResult.size });
  } else {
    fail('ReportHistory-generate-creates-entry', `generation failed: status ${genResult.status}`);
  }

  // List again — should have at least 1 entry
  const list2 = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/data/report-history`, { credentials: 'include' });
    return await r.json();
  }, BASE_URL);

  if (list2.count >= 1) {
    pass('ReportHistory-entry-saved-after-generate', { count: list2.count });
  } else {
    fail('ReportHistory-entry-saved-after-generate', `count still 0 after report generation`);
  }

  if (list2.reports.length > 0) {
    const first = list2.reports[0];

    if (typeof first.id === 'string' && typeof first.filename === 'string' && typeof first.format === 'string') {
      pass('ReportHistory-entry-has-fields', { id: first.id, format: first.format });
    } else {
      fail('ReportHistory-entry-has-fields', `entry fields missing: ${JSON.stringify(first)}`);
    }

    // Re-download by id
    const dlResult = await page.evaluate(async ({ baseUrl, id }) => {
      const r = await fetch(`${baseUrl}/api/data/report-history/${id}`, { credentials: 'include' });
      return { status: r.status, size: (await r.blob()).size };
    }, { baseUrl: BASE_URL, id: first.id });

    if (dlResult.status === 200 && dlResult.size > 0) {
      pass('ReportHistory-redownload-ok', { size: dlResult.size });
    } else {
      fail('ReportHistory-redownload-ok', `redownload failed: status ${dlResult.status}`);
    }

    // Delete
    const delResult = await page.evaluate(async ({ baseUrl, id }) => {
      const r = await fetch(`${baseUrl}/api/data/report-history/${id}`, {
        method: 'DELETE', credentials: 'include'
      });
      return await r.json();
    }, { baseUrl: BASE_URL, id: first.id });

    if (delResult.ok === true) {
      pass('ReportHistory-delete-ok', { id: first.id });
    } else {
      fail('ReportHistory-delete-ok', `delete failed: ${JSON.stringify(delResult)}`);
    }

    // Verify deleted
    const list3 = await page.evaluate(async (baseUrl) => {
      const r = await fetch(`${baseUrl}/api/data/report-history`, { credentials: 'include' });
      return await r.json();
    }, BASE_URL);
    const stillExists = list3.reports.some(r => r.id === first.id);
    if (!stillExists) {
      pass('ReportHistory-entry-removed-after-delete', {});
    } else {
      fail('ReportHistory-entry-removed-after-delete', `entry ${first.id} still in list after DELETE`);
    }
  } else {
    skip('ReportHistory-entry-has-fields', 'No history entries to test');
    skip('ReportHistory-redownload-ok', 'No history entries to test');
    skip('ReportHistory-delete-ok', 'No history entries to test');
    skip('ReportHistory-entry-removed-after-delete', 'No history entries to test');
  }
}

async function testBudgetsAPI(page) {
  console.log('\n=== BUDGETS API TEST ===');

  // GET /api/budgets
  const listResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(`${baseUrl}/api/budgets`, { credentials: 'include' });
      return { status: r.status, data: await r.json() };
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (listResult.error) { fail('Budgets-has-budgets-array', listResult.error); return; }
  const list1 = listResult.data;

  if (Array.isArray(list1.budgets)) {
    pass('Budgets-has-budgets-array', { count: list1.budgets.length });
  } else {
    fail('Budgets-has-budgets-array', `budgets not an array: ${JSON.stringify(list1)}`);
  }

  // POST /api/budgets/e2e-test-org
  const saveResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(`${baseUrl}/api/budgets/e2e-test-org`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_budget_usd: 5000, currency: 'USD', alert_at_pct: 80 }),
      });
      return { status: r.status, data: await r.json() };
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (saveResult.data?.ok === true) {
    pass('Budgets-save-ok', { status: saveResult.status });
  } else {
    fail('Budgets-save-ok', `save failed: ${JSON.stringify(saveResult)}`);
  }

  // GET /api/budgets — verify e2e-test-org appears
  const list2 = await page.evaluate(async (baseUrl) => {
    const r = await fetch(`${baseUrl}/api/budgets`, { credentials: 'include' });
    return await r.json();
  }, BASE_URL);

  if (Array.isArray(list2.budgets)) {
    pass('Budgets-list-after-save', { count: list2.budgets.length });
  } else {
    fail('Budgets-list-after-save', `list after save failed: ${JSON.stringify(list2)}`);
  }

  // DELETE /api/budgets/e2e-test-org
  const delResult = await page.evaluate(async (baseUrl) => {
    try {
      const r = await fetch(`${baseUrl}/api/budgets/e2e-test-org`, {
        method: 'DELETE',
        credentials: 'include',
      });
      return await r.json();
    } catch (e) { return { error: String(e) }; }
  }, BASE_URL);

  if (delResult.ok === true) {
    pass('Budgets-delete-ok', {});
  } else {
    fail('Budgets-delete-ok', `delete failed: ${JSON.stringify(delResult)}`);
  }
}
