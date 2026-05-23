const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:8000';
const OUT_DIR = '/home/azureuser/.copilot/session-state/f7e6cace-497d-4dd6-b6b4-635caebef9d3/files/regression/';
const USERNAME = 'phucvh';
const PASSWORD = 'U0lE0TJCJzqke1ksKVVpL';

const result = {
  screenshots: [],
  bugs: {},
  artifacts: {},
  notes: [],
};

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shot(pageOrLocator, filename, options = {}) {
  const target = pageOrLocator;
  const fullPage = options.fullPage ?? false;
  const file = path.join(OUT_DIR, filename);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (typeof target.screenshot !== 'function') throw new Error(`Cannot screenshot ${filename}`);
  if (typeof target.goto === 'function') {
    await target.screenshot({ path: file, fullPage, animations: 'disabled' });
  } else {
    await target.screenshot({ path: file, animations: 'disabled' });
  }
  result.screenshots.push(filename);
  return file;
}

async function getHealth(page) {
  return await page.evaluate(async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/health`, { credentials: 'include' });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { error: 'non-json', status: res.status, preview: text.slice(0, 200) };
      }
    } catch (error) {
      return { error: String(error) };
    }
  });
}

function textToNumber(text) {
  if (!text) return 0;
  const cleaned = String(text).replace(/[$,%\s,]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

(async () => {
  await ensureDir(OUT_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await Promise.race([
      page.waitForSelector('input[placeholder="Username"]', { timeout: 10000 }).catch(() => null),
      page.waitForSelector('.status-bar', { timeout: 10000 }).catch(() => null),
    ]);
    await page.waitForTimeout(1500);

    await shot(page, '01_login.png', { fullPage: true });

    const loginButton = page.getByRole('button', { name: /login/i });
    if (await loginButton.count()) {
      await page.locator('input[placeholder="Username"]').fill(USERNAME);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await loginButton.click();
    }

    await page.waitForSelector('.status-bar', { timeout: 30000 });
    await page.waitForFunction(async () => {
      const res = await fetch('/api/health');
      if (!res.ok) return false;
      const json = await res.json();
      return !!json.copilot_engine;
    }, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2000);
    await shot(page, '02_after_login.png', { fullPage: true });

    result.artifacts.health = await getHealth(page);

    await page.getByRole('button', { name: /^Dashboard$/i }).click();
    await page.waitForSelector('.dashboard-kpi .stat-card', { timeout: 30000 });
    await page.waitForTimeout(1500);

    const kpis = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.dashboard-kpi .stat-card')).map((card) => ({
        label: card.querySelector('.stat-label')?.textContent?.trim() || '',
        value: card.querySelector('.stat-value')?.textContent?.trim() || '',
      }));
    });
    result.artifacts.dashboardKpis = kpis;
    await shot(page.locator('.dashboard').first(), '03_dashboard_kpi.png');

    const seatsKpi = kpis.find((k) => /total seats/i.test(k.label));
    const costKpi = kpis.find((k) => /monthly cost/i.test(k.label));
    result.bugs['BUG-002'] = {
      status: textToNumber(seatsKpi?.value) > 0 && textToNumber(costKpi?.value) > 0 ? 'FIXED' : 'STILL BROKEN',
      values: { seats: seatsKpi?.value || null, monthlyCost: costKpi?.value || null },
      screenshot: '03_dashboard_kpi.png',
    };

    const acceptCard = page.locator('.chart-card').filter({ has: page.getByRole('heading', { name: /Acceptance Rate/i }) }).first();
    await acceptCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await shot(acceptCard, '04_acceptance_rate_chart.png');

    const acceptAxisTicks = await acceptCard.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents().catch(() => []);
    const acceptLegend = await acceptCard.locator('.recharts-legend-item-text').allTextContents().catch(() => []);
    const acceptText = await acceptCard.innerText().catch(() => '');
    result.artifacts.acceptanceChart = { axisTicks: acceptAxisTicks, legend: acceptLegend, text: acceptText };
    const extractedPercents = (acceptText.match(/\b\d+%/g) || []).map((t) => textToNumber(t));
    const axisMax = Math.max(0, ...acceptAxisTicks.map((t) => textToNumber(t)), ...extractedPercents);
    result.bugs['BUG-001'] = {
      status: axisMax <= 100 ? 'FIXED' : 'STILL BROKEN',
      evidence: { axisTicks: acceptAxisTicks, extractedPercents, axisMax },
      screenshot: '04_acceptance_rate_chart.png',
    };

    const billingBanner = page.locator('.billing-scope-banner').first();
    const billingBannerVisible = await billingBanner.isVisible().catch(() => false);
    if (billingBannerVisible) {
      await billingBanner.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await shot(billingBanner, '05_billing_scope_banner.png');
    } else {
      await shot(page.locator('.dashboard').first(), '05_billing_scope_banner.png');
    }
    const billingBannerText = billingBannerVisible ? (await billingBanner.innerText()) : '';
    result.bugs['BUG-004'] = {
      status: billingBannerVisible && /manage_billing:copilot/i.test(billingBannerText) ? 'FIXED' : 'STILL BROKEN',
      evidence: billingBannerText || 'Banner not found',
      screenshot: '05_billing_scope_banner.png',
    };

    await page.getByRole('button', { name: /^Chat$/i }).click();
    await page.waitForSelector('.chat-input', { timeout: 30000 });
    const newSessionButton = page.locator('.session-new-btn').first();
    if (await newSessionButton.isVisible().catch(() => false)) {
      await newSessionButton.click().catch(() => null);
      await page.waitForTimeout(1200);
    }
    await page.locator('.chat-input').fill('How many Copilot seats are assigned?');
    await page.getByRole('button', { name: /^Send$/i }).click();
    await page.waitForFunction(() => {
      const msgs = Array.from(document.querySelectorAll('.message-assistant .message-content'));
      if (!msgs.length) return false;
      const text = msgs[msgs.length - 1].innerText.trim();
      return text.length > 0;
    }, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot(page.locator('.chat-interface').first(), '06_chat_response.png');
    const assistantMessages = await page.locator('.message-assistant .message-content').allInnerTexts();
    const lastAssistant = assistantMessages[assistantMessages.length - 1] || '';
    result.artifacts.chatResponse = lastAssistant;
    result.bugs['BUG-003'] = {
      status: /\b\d+\b/.test(lastAssistant) && !/no data|hasn't been synced|don't have permissions/i.test(lastAssistant) ? 'FIXED' : 'STILL BROKEN',
      evidence: lastAssistant,
      screenshot: '06_chat_response.png',
    };

    const consoleToggle = page.getByRole('button', { name: /^Console$/i });
    await consoleToggle.click();
    await page.waitForSelector('.console-panel', { timeout: 10000 });
    const clearConsole = page.locator('.console-panel .console-btn', { hasText: 'Clear' }).first();
    if (await clearConsole.isVisible().catch(() => false)) {
      await clearConsole.click().catch(() => null);
      await page.waitForTimeout(500);
    }

    await page.waitForFunction(async () => {
      const res = await fetch('/api/health');
      if (!res.ok) return false;
      const json = await res.json();
      return !json.is_syncing;
    }, { timeout: 60000 }).catch(() => null);

    await page.getByRole('button', { name: /Sync Data|Syncing/i }).click();
    await page.waitForTimeout(10000);
    await shot(page.locator('.console-panel').first(), '07_sync_log.png');
    const consoleTitles = await page.locator('.console-panel .console-title').allInnerTexts();
    result.artifacts.syncConsoleTitles = consoleTitles;
    const syncStartLine = consoleTitles.find((line) => /Starting sync for/i.test(line)) || '';
    result.bugs['BUG-005'] = {
      status: /0 org\(s\) and 1 enterprise\(s\)/i.test(syncStartLine) ? 'FIXED' : 'STILL BROKEN',
      evidence: syncStartLine || consoleTitles.slice(0, 10),
      screenshot: '07_sync_log.png',
    };

    await page.getByRole('button', { name: /^Settings$/i }).click();
    await page.waitForSelector('.settings-modal', { timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page.locator('.settings-modal').first(), '08_pat_settings.png');
    const patBadgeTexts = await page.locator('.pat-item-user').allInnerTexts();
    result.artifacts.patBadges = patBadgeTexts;
    const patBadgeJoined = patBadgeTexts.join(' | ');
    result.bugs['BUG-006'] = {
      status: patBadgeTexts.length > 0 && !/0 orgs/i.test(patBadgeJoined) ? 'FIXED' : 'STILL BROKEN',
      evidence: patBadgeTexts,
      screenshot: '08_pat_settings.png',
    };
    await page.locator('.settings-close-btn').click();
    await page.waitForTimeout(500);

    const consolePanel = page.locator('.console-panel').first();
    await shot(consolePanel, '09_console_with_minimize.png');
    const consoleButtons = await page.locator('.console-panel .console-btn').allInnerTexts().catch(() => []);
    const minimizeBtn = page.locator('.console-panel .console-btn').filter({ hasText: '▼' }).first();
    const hasMinimize = await minimizeBtn.count().catch(() => 0);
    let minimized = false;
    let restored = false;
    if (hasMinimize) {
      await minimizeBtn.click();
      await page.waitForTimeout(700);
      await shot(consolePanel, '10_console_minimized.png');
      minimized = await page.locator('.console-panel .console-body').count() === 0;
      const restoreBtn = page.locator('.console-panel .console-btn').filter({ hasText: '▲' }).first();
      if (await restoreBtn.count().catch(() => 0)) {
        await restoreBtn.click();
        await page.waitForTimeout(700);
        restored = await page.locator('.console-panel .console-body').count() > 0;
      }
      await shot(consolePanel, '11_console_restored.png');
    }
    result.bugs['BUG-007'] = {
      status: minimized && restored ? 'FIXED' : 'STILL BROKEN',
      evidence: { consoleButtons, minimized, restored },
      screenshot: hasMinimize ? '09_console_with_minimize.png, 10_console_minimized.png, 11_console_restored.png' : '09_console_with_minimize.png',
    };

    await page.getByRole('button', { name: /^Dashboard$/i }).click();
    await page.waitForSelector('.dashboard', { timeout: 10000 });
    const seatSection = page.locator('.dash-section').filter({ has: page.getByRole('heading', { name: /Seat Management/i }) }).first();
    await seatSection.scrollIntoViewIfNeeded();
    const seatTableVisible = await seatSection.locator('table').isVisible().catch(() => false);
    if (!seatTableVisible) {
      await seatSection.locator('.dash-section-header').click();
      await page.waitForTimeout(800);
    }
    await shot(seatSection, '12_seats.png');
    const seatRows = await seatSection.locator('tbody tr').count().catch(() => 0);
    result.artifacts.seatRows = seatRows;

    await page.getByRole('button', { name: /Usage Report/i }).click();
    await page.waitForSelector('.unified-dashboard', { timeout: 10000 });
    await page.waitForTimeout(1200);
    await shot(page.locator('.unified-dashboard').first(), '13_usage.png');

    const usageUserSection = page.locator('.dash-section').filter({ has: page.getByRole('heading', { name: /Per-User Details/i }) }).first();
    await usageUserSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await shot(usageUserSection, '14_usage_acceptance.png');
    const usageAcceptanceValues = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.dash-section tbody tr')).slice(0, 10);
      const values = [];
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim() || '');
        for (const cell of cells) {
          if (/^\d+%$/.test(cell)) values.push(cell);
        }
      }
      return values;
    });
    result.artifacts.usageAcceptanceValues = usageAcceptanceValues;

    result.artifacts.usageAcceptanceMax = Math.max(0, ...usageAcceptanceValues.map((v) => textToNumber(v)));
    await fs.writeFile(path.join(OUT_DIR, 'regression_results.json'), JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.error = String(error && error.stack || error);
    await fs.writeFile(path.join(OUT_DIR, 'regression_results.json'), JSON.stringify(result, null, 2), 'utf8');
    console.error(result.error);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})();
