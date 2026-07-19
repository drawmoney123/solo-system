/*
 * End-to-end contract for Solo System schema v7 wellness support.
 *
 * Run from the repository root:
 *   node .\work\v7-wellness-smoke.js
 *
 * Stable UI hooks expected by this test:
 *   training sections:  .train-nav [data-id="yoga|meditation"]
 *   start timer:        [data-act="startpractice"][data-id="<practiceId>"]
 *   manual session:     [data-act="addpractice"][data-id="<practiceId>"]
 *   timer root:         [data-wellness-timer]
 *   countdown:          [data-timer-remaining]
 *   timer actions:      [data-act="pausetimer|resumetimer|finishtimer|canceltimer"]
 *   schedule modal:     [data-act="wellnesssettings"]
 *   schedule days:      #mYogaDay0 .. #mYogaDay6
 *   schedule presets:   #mYogaPractice, #mMeditationPractice
 *
 * Modal fields for a manually recorded practice:
 *   #mPracticeDate, #mPracticeDuration, #mPracticeTemplate, #mPracticeNote
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
let playwright;
try {
  playwright = require('playwright-core');
} catch (error) {
  // Codex workspace fallback; keeps the repository free from vendored node_modules.
  playwright = require('C:/Users/draw/Documents/Codex/2026-07-18/new-chat/work/node_modules/playwright-core');
}
const { chromium } = playwright;

const APP_ROOT = path.resolve('C:/Users/draw/клод/solo-system');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STATE_KEY = 'soloSystemV1';
const EXPECTED_CACHE = 'solo-system-v13';
const PRACTICES = {
  yoga: new Set(['yoga-reset-5', 'yoga-mobility-10', 'yoga-beginner-15']),
  meditation: new Set(['med-breath-3', 'med-body-5', 'med-count-10']),
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(APP_ROOT, '.' + relative);
  if (!file.toLowerCase().startsWith(APP_ROOT.toLowerCase())) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, bytes) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(bytes);
  });
});

function dateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function yesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return dateKey(date);
}

async function readState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

async function writeState(page, mutatorSource) {
  await page.evaluate(({ key, source }) => {
    const state = JSON.parse(localStorage.getItem(key));
    // The source is test-owned code, not application/user input.
    const mutate = (0, eval)('(' + source + ')');
    mutate(state);
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, source: String(mutatorSource) });
}

async function reload(page, waitUntil = 'networkidle') {
  await page.reload({ waitUntil });
}

function dailyByKind(state, kind) {
  return state.dailies.find(item => item.kind === kind);
}

function sessionsByType(state, type) {
  return state.training.sessions.filter(item => item.type === type);
}

async function openTrainingSection(page, id) {
  await page.locator('.tabbar [data-tab="training"]').click();
  const section = page.locator(`.train-nav [data-id="${id}"]`);
  await section.waitFor();
  await section.click();
  assert.equal(await section.getAttribute('aria-selected'), 'true');
}

async function recordPractice(page, { kind, practiceId, date, duration, note = '' }) {
  await openTrainingSection(page, kind);
  const opener = page.locator(`[data-act="addpractice"][data-id="${practiceId}"]`);
  await opener.click();
  try {
    await page.locator('.modal').waitFor({ timeout: 3000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      tab: document.querySelector('.tabbar button.on')?.dataset.tab,
      selected: document.querySelector('.train-nav [aria-selected="true"]')?.dataset.id,
      overlay: document.querySelector('#overlay')?.innerHTML,
    }));
    throw new Error(`manual practice modal did not open: ${JSON.stringify(diagnostics)}`);
  }
  if (!(await page.locator('#mPracticeDate').count())) {
    const diagnostics = await page.locator('.modal').evaluate(modal => ({
      title: modal.querySelector('h2')?.textContent,
      html: modal.innerHTML.slice(0, 1200),
    }));
    throw new Error(`wrong modal after addpractice: ${JSON.stringify(diagnostics)}`);
  }
  await page.locator('#mPracticeDate').fill(date);
  await page.locator('#mPracticeDuration').fill(String(duration));
  const practice = page.locator('#mPracticeTemplate');
  if (await practice.count()) await practice.selectOption(practiceId);
  const noteField = page.locator('#mPracticeNote');
  if (await noteField.count()) await noteField.fill(note);
  await page.locator('[data-m="ok"]').click();
}

async function startTimer(page, kind, practiceId) {
  await openTrainingSection(page, kind);
  await page.locator(`[data-act="startpractice"][data-id="${practiceId}"]`).click();
  await page.locator('[data-wellness-timer]').waitFor();
}

async function makeTimerExpireSoon(page, kind, seconds = 1) {
  await writeState(page, state => {
    const timer = state.training.wellness.timer;
    if (!timer) throw new Error('No active wellness timer in state');
    timer.accumulatedSec = Math.max(0, timer.targetSec - 1);
    timer.runningSince = Date.now();
  });
  await reload(page, 'domcontentloaded');
  await openTrainingSection(page, kind);
  await page.locator('[data-wellness-timer]').waitFor();
  await page.waitForTimeout(seconds * 1000 + 350);
}

async function finishTimer(page) {
  const finish = page.locator('[data-act="finishtimer"]');
  await finish.waitFor();
  await finish.click();
  // Implementations may save immediately or ask for an optional note.
  const confirm = page.locator('[data-m="ok"]');
  if (await confirm.count()) await confirm.click();
}

async function auditMonochrome(page, label) {
  const violations = await page.evaluate(label => {
    const properties = [
      'color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor',
      'borderBottomColor', 'borderLeftColor', 'boxShadow', 'textShadow', 'outlineColor',
    ];
    const output = [];
    for (const element of document.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const style = getComputedStyle(element);
      for (const property of properties) {
        const value = style[property] || '';
        for (const match of value.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/g)) {
          const rgb = match.slice(1, 4).map(Number);
          if (Math.max(...rgb) - Math.min(...rgb) > 2) {
            output.push({ label, node: element.tagName + '.' + element.className, property, value });
            break;
          }
        }
      }
    }
    return output;
  }, label);
  assert.equal(violations.length, 0, JSON.stringify(violations.slice(0, 20), null, 2));
}

async function auditMobile(page, label) {
  const result = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewport;
    const tooSmall = [...document.querySelectorAll('button,a[href],input,select,textarea,summary')].filter(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (element.matches('input[type="checkbox"],input[type="radio"]')) {
        const label = element.closest('label') || document.querySelector(`label[for="${element.id}"]`);
        if (label) {
          const labelRect = label.getBoundingClientRect();
          return labelRect.width < 43.5 || labelRect.height < 43.5;
        }
      }
      return rect.width < 43.5 || rect.height < 43.5;
    }).map(element => ({
      tag: element.tagName,
      text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 80),
      rect: [element.getBoundingClientRect().width, element.getBoundingClientRect().height],
    }));
    return { overflow, tooSmall };
  });
  assert(result.overflow <= 0, `${label}: horizontal overflow ${result.overflow}px`);
  assert.equal(result.tooSmall.length, 0, `${label}: undersized controls ${JSON.stringify(result.tooSmall.slice(0, 10))}`);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url, { waitUntil: 'networkidle' });

    // 1. A v6-shaped state must gain v7 wellness defaults while preserving
    // profile values, economy, streak and immutable training history.
    await writeState(page, state => {
      state.v = 6;
      state.hunter.name = 'Артём';
      state.hunter.gold = 777;
      state.streak = 4;
      state.lastDay = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      })();
      delete state.personalization;
      delete state.archive;
      state.training.nextStrength = 'B';
      delete state.training.wellness;
      state.training.sessions = [{
        id: 'v6-preserved-strength', type: 'strength', date: state.lastDay, at: 100,
        duration: 42, distance: 0, steps: 0, effort: 'moderate', note: 'Не менять',
        variant: 'A', runLevel: 1, walkType: 'recovery', planText: '',
        exercises: [{ slot: 'a-squat', name: 'Гоблет-присед', sets: 2, reps: 9, load: 8 }],
      }];
    });
    await reload(page);
    let state = await readState(page);
    assert.equal(state.v, 7);
    assert.equal(state.hunter.name, 'Артём');
    assert.equal(state.hunter.gold, 777);
    assert.equal(state.streak, 4);
    assert.equal(state.training.sessions.length, 1);
    assert.equal(state.training.sessions[0].id, 'v6-preserved-strength');
    assert.equal(state.training.sessions[0].exercises[0].name, 'Гоблет-присед');
    assert.deepEqual(state.training.wellness.schedule.yoga, { days: [0, 3], practiceId: 'yoga-mobility-10' });
    assert.deepEqual(state.training.wellness.schedule.meditation, { days: [0, 1, 2, 3, 4, 5, 6], practiceId: 'med-body-5' });
    assert.equal(state.training.wellness.timer, null);
    assert.equal(state.dailies.length, 7);
    assert(dailyByKind(state, 'movement'), 'personalized movement daily is missing');
    assert(dailyByKind(state, 'meditation'), 'personalized meditation daily is missing');

    // 2. Dedicated sections and stable navigation hooks.
    await openTrainingSection(page, 'yoga');
    assert.equal(await page.locator('.train-nav [role="tab"]').count(), 9);
    await auditMonochrome(page, 'yoga');
    await openTrainingSection(page, 'meditation');
    await auditMonochrome(page, 'meditation');

    // 3. A past manual entry is journal-only: no task reward today.
    const economyBeforePast = {
      gold: state.hunter.gold,
      vit: state.stats.vit,
      meditationDone: dailyByKind(state, 'meditation').done,
    };
    await recordPractice(page, {
      kind: 'meditation', practiceId: 'med-breath-3', date: yesterdayKey(), duration: 3,
      note: 'Историческая запись',
    });
    state = await readState(page);
    assert.equal(sessionsByType(state, 'meditation').length, 1);
    assert.equal(sessionsByType(state, 'meditation')[0].date, yesterdayKey());
    assert.equal(state.hunter.gold, economyBeforePast.gold);
    assert.equal(state.stats.vit, economyBeforePast.vit);
    assert.equal(dailyByKind(state, 'meditation').done, economyBeforePast.meditationDone);

    // 4. Timer persists through pause and reload. Merely expiring never writes
    // a session or marks/rewards the linked daily.
    await startTimer(page, 'meditation', 'med-body-5');
    state = await readState(page);
    assert.equal(state.training.wellness.timer.practiceId, 'med-body-5');
    assert.equal(state.training.wellness.timer.targetSec, 300);
    assert.equal(typeof state.training.wellness.timer.runningSince, 'number');
    const firstRemaining = await page.locator('[data-timer-remaining]').textContent();
    await page.waitForFunction(first => {
      const output = document.querySelector('[data-timer-remaining]');
      return output && output.textContent !== first;
    }, firstRemaining, { timeout: 3000 });
    const secondRemaining = await page.locator('[data-timer-remaining]').textContent();
    assert.notEqual(secondRemaining, firstRemaining, 'running countdown did not advance');

    await page.locator('[data-act="pausetimer"]').click();
    state = await readState(page);
    assert(!state.training.wellness.timer.runningSince, 'paused timer resumed itself after reload');
    const pausedAccumulated = state.training.wellness.timer.accumulatedSec;
    const pausedRemaining = await page.locator('[data-timer-remaining]').textContent();
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('[data-timer-remaining]').textContent(), pausedRemaining);
    await reload(page, 'domcontentloaded');
    await openTrainingSection(page, 'meditation');
    await page.locator('[data-wellness-timer]').waitFor();
    state = await readState(page);
    assert.equal(state.training.wellness.timer.runningSince, null);
    assert.equal(state.training.wellness.timer.accumulatedSec, pausedAccumulated);

    await page.locator('[data-act="resumetimer"]').click();
    state = await readState(page);
    assert.equal(typeof state.training.wellness.timer.runningSince, 'number');
    const sessionsBeforeExpiry = state.training.sessions.length;
    const goldBeforeExpiry = state.hunter.gold;
    await makeTimerExpireSoon(page, 'meditation');
    state = await readState(page);
    assert.equal(state.training.sessions.length, sessionsBeforeExpiry, 'timer auto-created a false session');
    assert.equal(state.hunter.gold, goldBeforeExpiry, 'timer expiry auto-awarded points');
    assert.equal(dailyByKind(state, 'meditation').done, false, 'timer expiry auto-completed daily');
    await auditMonochrome(page, 'timer');

    // 5. Explicit save creates one session and completes the linked daily once.
    const beforeFirstSave = {
      sessions: sessionsByType(state, 'meditation').length,
      gold: state.hunter.gold,
      vit: state.stats.vit,
      streak: state.streak,
    };
    await finishTimer(page);
    state = await readState(page);
    assert.equal(sessionsByType(state, 'meditation').length, beforeFirstSave.sessions + 1);
    assert.equal(state.training.wellness.timer, null);
    assert.equal(dailyByKind(state, 'meditation').done, true);
    assert.equal(state.hunter.gold, beforeFirstSave.gold + 5, 'meditation must earn only the linked daily reward');
    assert.equal(state.stats.vit, beforeFirstSave.vit + 2, 'focused daily category should advance once');
    assert.equal(state.streak, beforeFirstSave.streak, 'one of seven dailies must not finish the strict day');

    // 6. A second same-day session is valid journal data but cannot award the
    // same daily a second time.
    const economyAfterFirst = { gold: state.hunter.gold, vit: state.stats.vit };
    await startTimer(page, 'meditation', 'med-breath-3');
    await makeTimerExpireSoon(page, 'meditation');
    await finishTimer(page);
    state = await readState(page);
    assert.equal(sessionsByType(state, 'meditation').length, beforeFirstSave.sessions + 2);
    assert.equal(state.hunter.gold, economyAfterFirst.gold);
    assert.equal(state.stats.vit, economyAfterFirst.vit);

    // 7. Yoga completes the generic movement daily, also only once.
    const yogaBefore = { gold: state.hunter.gold, str: state.stats.str };
    await recordPractice(page, {
      kind: 'yoga', practiceId: 'yoga-reset-5', date: dateKey(new Date()), duration: 5,
      note: 'Мягко, без боли',
    });
    state = await readState(page);
    assert.equal(sessionsByType(state, 'yoga').length, 1);
    assert.equal(dailyByKind(state, 'movement').done, true);
    assert.equal(state.hunter.gold, yogaBefore.gold + 5);
    assert.equal(state.stats.str, yogaBefore.str + 2);
    const yogaRewarded = { gold: state.hunter.gold, str: state.stats.str };
    await recordPractice(page, {
      kind: 'yoga', practiceId: 'yoga-mobility-10', date: dateKey(new Date()), duration: 10,
    });
    state = await readState(page);
    assert.equal(sessionsByType(state, 'yoga').length, 2);
    assert.deepEqual({ gold: state.hunter.gold, str: state.stats.str }, yogaRewarded);

    // 8. Schedule is editable and survives a full reload.
    await openTrainingSection(page, 'yoga');
    await page.locator('[data-act="wellnesssettings"]').first().click();
    for (let day = 0; day <= 6; day++) {
      await page.locator(`#mYogaDay${day}`).setChecked(day === 1 || day === 4);
    }
    await page.locator('#mYogaPractice').selectOption('yoga-reset-5');
    await page.locator('[data-m="ok"]').click();
    await reload(page);
    state = await readState(page);
    assert.deepEqual(state.training.wellness.schedule.yoga, { days: [1, 4], practiceId: 'yoga-reset-5' });

    // 9. Journal filters expose both new types and preserve old strength data.
    await openTrainingSection(page, 'journal');
    for (const type of ['strength', 'yoga', 'meditation']) {
      const filter = page.locator(`[data-act="trainfilter"][data-id="${type}"]`);
      await filter.click();
      const expected = sessionsByType(state, type).length;
      assert.equal(await page.locator('.train-session').count(), expected);
    }

    // 10. Mobile geometry and monochrome theme for both sections and timer.
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 760 });
      for (const section of ['yoga', 'meditation', 'journal']) {
        await openTrainingSection(page, section);
        await auditMobile(page, `${width}/${section}`);
        await auditMonochrome(page, `${width}/${section}`);
      }
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await startTimer(page, 'yoga', 'yoga-reset-5');
    await auditMobile(page, '320/timer');
    await auditMonochrome(page, '320/timer');
    await page.locator('[data-act="canceltimer"]').click();
    const cancelConfirm = page.locator('[data-m="ok"]');
    if (await cancelConfirm.count()) await cancelConfirm.click();

    // 11. Normalization rejects invalid schedules/practices and stale timers.
    await writeState(page, state => {
      state.training.wellness.schedule.yoga = { days: [-1, 1, 1, 9, 4], practiceId: 'med-body-5' };
      state.training.wellness.schedule.meditation = { days: ['bad', 0, 0, 6], practiceId: 'not-a-practice' };
      state.training.wellness.timer = {
        kind: 'meditation', practiceId: 'med-body-5', targetSec: 999999,
        accumulatedSec: 999999, runningSince: Date.now() - 86400000 * 3,
      };
    });
    await reload(page);
    state = await readState(page);
    for (const kind of ['yoga', 'meditation']) {
      const schedule = state.training.wellness.schedule[kind];
      assert(schedule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6));
      assert.equal(new Set(schedule.days).size, schedule.days.length);
      assert(PRACTICES[kind].has(schedule.practiceId), `${kind} received a foreign/unknown practice`);
    }
    assert.equal(state.training.wellness.timer, null, 'stale or oversized timer was not discarded');

    // 12. The entire wellness flow remains available from the service worker.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await reload(page, 'domcontentloaded');
    }
    const cacheNames = await page.evaluate(() => caches.keys());
    assert(cacheNames.includes(EXPECTED_CACHE), `missing ${EXPECTED_CACHE}: ${cacheNames.join(', ')}`);
    await context.setOffline(true);
    await reload(page, 'domcontentloaded');
    await openTrainingSection(page, 'yoga');
    await page.getByText(/Мягкое начало|Мобильность всего тела/).first().waitFor();
    await openTrainingSection(page, 'meditation');
    await page.getByText(/Дыхание|Сканирование тела/).first().waitFor();
    state = await readState(page);
    assert.equal(state.v, 7);
    assert.equal(state.training.sessions.some(item => item.id === 'v6-preserved-strength'), true);

    const unexpectedErrors = errors.filter(message => !message.includes('ERR_INTERNET_DISCONNECTED'));
    assert.equal(unexpectedErrors.length, 0, unexpectedErrors.join('\n'));
    console.log(JSON.stringify({
      schema: state.v,
      migrationPreserved: true,
      sections: ['yoga', 'meditation'],
      timer: { reload: true, pause: true, expiryRequiresSave: true },
      idempotentRewards: true,
      schedulesPersist: true,
      journalTypes: ['strength', 'yoga', 'meditation'],
      widths: [320, 375, 430],
      monochrome: true,
      offlineCache: EXPECTED_CACHE,
      consoleErrors: unexpectedErrors,
    }, null, 2));
  } finally {
    await context.setOffline(false).catch(() => {});
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
