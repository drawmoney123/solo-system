/*
 * End-to-end contract for the one-time Artem catalog migration in schema v7.
 *
 * Run from the repository root:
 *   node .\work\v7-personalization-smoke.js
 *
 * Covered contracts:
 *   - v6 catalog is moved to a recoverable archive and replaced once;
 *   - repeated reloads do not repeat the migration;
 *   - daily streak rollover uses the archived v6 completion state;
 *   - a fresh seed and a full reset open the Artem profile;
 *   - the active catalog and archive can be swapped in both directions;
 *   - automatic content sync accepts only profile "artem-v1".
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let playwright;
try {
  playwright = require('playwright-core');
} catch (error) {
  // Codex workspace fallback; keeps the repository free from vendored dependencies.
  playwright = require('C:/Users/draw/Documents/Codex/2026-07-18/new-chat/work/node_modules/playwright-core');
}
const { chromium } = playwright;

const APP_ROOT = path.resolve('C:/Users/draw/клод/solo-system');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STATE_KEY = 'soloSystemV1';
const PROFILE_ID = 'artem-v1';
const CATALOG_KEYS = ['dailies', 'quests', 'dungeons', 'shop'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

let contentPayload = makeContentPack('wrong-profile', 'startup-wrong-profile');

function makeContentPack(profile, id, title) {
  return {
    profile,
    dailies: [],
    quests: id ? [{
      id,
      title: title || id,
      stat: 'int',
      diff: 'D',
    }] : [],
    dungeons: [],
    shop: [],
  };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/content.json') {
    const bytes = Buffer.from(JSON.stringify(contentPayload), 'utf8');
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': bytes.length,
    });
    response.end(bytes);
    return;
  }

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
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

async function browserDateKey(page, daysAgo) {
  return page.evaluate(offset => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }, daysAgo);
}

async function readState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STATE_KEY);
}

async function reload(page) {
  await page.reload({ waitUntil: 'networkidle' });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function catalogSnapshot(state) {
  const output = {};
  for (const key of CATALOG_KEYS) output[key] = clone(state[key]);
  return output;
}

function catalogSize(catalog) {
  return CATALOG_KEYS.reduce((sum, key) => {
    return sum + (Array.isArray(catalog[key]) ? catalog[key].length : 0);
  }, 0);
}

function legacyCatalog(doneFlags) {
  const flags = doneFlags || [true, false];
  return {
    dailies: flags.map((done, index) => ({
      id: 'legacy-daily-' + index,
      title: 'Старая ежедневная задача ' + (index + 1),
      stat: index % 2 ? 'int' : 'str',
      done,
    })),
    quests: [{
      id: 'legacy-quest-proof',
      title: 'Старая разовая задача',
      stat: 'wil',
      diff: 'C',
      done: true,
      doneAt: 1700000000000,
    }],
    dungeons: [{
      id: 'legacy-project-proof',
      title: 'Старый проект',
      stat: 'car',
      diff: 'B',
      cleared: false,
      floors: [
        { title: 'Старый завершённый этап', cleared: true },
        { title: 'Старый незавершённый этап', cleared: false },
      ],
    }],
    shop: [{
      id: 'legacy-reward-proof',
      title: 'Старая награда',
      cost: 321,
      kind: 'restDay',
    }],
  };
}

async function installLegacyV6(page, options) {
  const settings = Object.assign({
    lastDay: await browserDateKey(page, 0),
    streak: 9,
    doneFlags: [true, false],
  }, options || {});
  const catalog = legacyCatalog(settings.doneFlags);

  await page.evaluate(({ key, settings, catalog }) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.v = 6;
    delete state.personalization;
    delete state.archive;
    state.hunter = { name: 'Старый пользователь', level: 4, xp: 17, gold: 777 };
    state.stats = { str: 11, int: 12, car: 13, vit: 14, cha: 15, wil: 16, fin: 17 };
    state.dailies = catalog.dailies;
    state.quests = catalog.quests;
    state.dungeons = catalog.dungeons;
    state.shop = catalog.shop;
    state.applied = ['legacy-content-id'];
    state.lastDay = settings.lastDay;
    state.streak = settings.streak;
    state.bonusDay = settings.doneFlags.every(Boolean) ? settings.lastDay : null;
    state.restDay = null;
    state.focus = ['fin'];
    state.history = {};
    state.history[settings.lastDay] = 7;
    state.log = [{ t: 1700000000000, m: 'Старая запись журнала' }];
    state.done = { quests: 3, dungeons: 1, buys: 2, bestStreak: 9, bosses: 0, hidden: 0 };
    state.training.sessions = [{
      id: 'legacy-walk-session',
      type: 'walk',
      date: settings.lastDay,
      at: 1700000000000,
      duration: 31,
      distance: 2.4,
      steps: 3200,
      effort: 'easy',
      note: 'Историческая прогулка',
      variant: 'A',
      runLevel: 1,
      walkType: 'recovery',
      planText: '',
      exercises: [],
    }];
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STATE_KEY, settings, catalog });

  return catalog;
}

function assertPersonalProfile(state) {
  assert.equal(state.v, 7);
  assert(state.personalization, 'personalization marker is missing');
  assert.equal(state.personalization.id, PROFILE_ID);
  assert.equal(state.personalization.mode, 'personal');
  assert.equal(state.hunter.name, 'Артём');
  assert.deepEqual(state.focus, ['str', 'vit', 'int']);
  assert.equal(state.dailies.length, 7);
  assert.equal(state.training.profile.setup, 'compact');

  for (const key of CATALOG_KEYS) {
    assert(state[key].length > 0, key + ' must not be empty');
    assert(
      state[key].every(item => typeof item.id === 'string' && item.id.startsWith(PROFILE_ID + '-')),
      key + ' contains an item outside the Artem catalog',
    );
  }
}

function assertLegacyArchive(state, sourceCatalog) {
  assert.equal(catalogSize(state.archive), catalogSize(sourceCatalog));
  assert.deepEqual(
    state.archive.dailies.map(item => ({ title: item.title, done: item.done })),
    sourceCatalog.dailies.map(item => ({ title: item.title, done: item.done })),
  );
  assert.equal(state.archive.quests[0].title, 'Старая разовая задача');
  assert.equal(state.archive.quests[0].done, true);
  assert.equal(state.archive.quests[0].doneAt, 1700000000000);
  assert.equal(state.archive.dungeons[0].title, 'Старый проект');
  assert.deepEqual(state.archive.dungeons[0].floors.map(item => item.cleared), [true, false]);
  assert.equal(state.archive.shop[0].title, 'Старая награда');
  assert.equal(state.archive.shop[0].cost, 321);
  assert.equal(state.archive.shop[0].kind, 'restDay');
}

async function withPage(browser, baseUrl, task) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await task(page);
    assert.deepEqual(errors, [], 'browser errors: ' + JSON.stringify(errors));
  } finally {
    await context.close();
  }
}

async function testMigrationAndIdempotency(browser, baseUrl) {
  contentPayload = makeContentPack('wrong-profile', 'wrong-during-migration', 'Не добавлять');
  await withPage(browser, baseUrl, async page => {
    const today = await browserDateKey(page, 0);
    const sourceCatalog = await installLegacyV6(page, {
      lastDay: today,
      doneFlags: [true, false],
      streak: 9,
    });
    await reload(page);

    let state = await readState(page);
    assertPersonalProfile(state);
    assertLegacyArchive(state, sourceCatalog);
    assert.equal(state.hunter.gold, 777);
    assert.equal(state.streak, 9);
    assert.equal(state.stats.fin, 17);
    assert.equal(state.done.quests, 3);
    assert.equal(state.training.sessions.length, 1);
    assert.equal(state.training.sessions[0].id, 'legacy-walk-session');
    assert(state.log.some(item => item.m === 'Старая запись журнала'));
    assert.equal(
      state.log.filter(item => item.m.includes('Подключён персональный план Артёма')).length,
      1,
    );
    for (const key of CATALOG_KEYS) {
      for (const item of state[key]) {
        assert(state.applied.includes(item.id), 'built-in id is absent from applied: ' + item.id);
      }
    }

    const stable = {
      personalization: clone(state.personalization),
      catalog: catalogSnapshot(state),
      archive: clone(state.archive),
    };

    await reload(page);
    await reload(page);
    state = await readState(page);
    assert.deepEqual(state.personalization, stable.personalization);
    assert.deepEqual(catalogSnapshot(state), stable.catalog);
    assert.deepEqual(state.archive, stable.archive);
    assert.equal(
      state.log.filter(item => item.m.includes('Подключён персональный план Артёма')).length,
      1,
    );
    assert.equal(state.applied.includes('wrong-during-migration'), false);
  });
}

async function testDailyRolloverCase(browser, baseUrl, config) {
  contentPayload = makeContentPack('wrong-profile', 'wrong-daily-case', 'Не добавлять');
  await withPage(browser, baseUrl, async page => {
    const lastDay = await browserDateKey(page, config.daysAgo);
    await installLegacyV6(page, {
      lastDay,
      doneFlags: config.doneFlags,
      streak: 9,
    });
    await reload(page);

    const state = await readState(page);
    const today = await browserDateKey(page, 0);
    assertPersonalProfile(state);
    assert.equal(state.lastDay, today, config.label + ': lastDay');
    assert.equal(state.streak, config.expectedStreak, config.label + ': streak');
    assert(state.dailies.every(item => item.done === false), config.label + ': new dailies were not reset');
    assert.equal(state.bonusDay, null, config.label + ': bonusDay');
  });
}

async function testSeedAndReset(browser, baseUrl) {
  contentPayload = makeContentPack('wrong-profile', 'wrong-seed-reset', 'Не добавлять');
  await withPage(browser, baseUrl, async page => {
    let state = await readState(page);
    assertPersonalProfile(state);
    assert.equal(catalogSize(state.archive), 0);

    await page.evaluate(key => {
      const current = JSON.parse(localStorage.getItem(key));
      current.hunter.name = 'После изменения';
      current.personalization.mode = 'archive';
      current.archive = {
        dailies: [{ id: 'temporary-old-daily', title: 'Временный архив', stat: 'wil', done: false }],
        quests: [],
        dungeons: [],
        shop: [],
      };
      localStorage.setItem(key, JSON.stringify(current));
    }, STATE_KEY);
    await reload(page);

    await page.locator('.tabbar [data-tab="more"]').click();
    await page.locator('[data-act="reset"]').click();
    await page.locator('[data-m="ok"]').waitFor();
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-m="ok"]').click(),
    ]);
    await page.waitForLoadState('networkidle');

    state = await readState(page);
    assertPersonalProfile(state);
    assert.equal(catalogSize(state.archive), 0);
    assert.equal(state.applied.includes('wrong-seed-reset'), false);
  });
}

async function confirmCatalogSwap(page) {
  await page.locator('.tabbar [data-tab="more"]').click();
  const button = page.locator('[data-act="swaparchive"]');
  await button.waitFor();
  assert.equal(await button.isDisabled(), false);
  await button.click();
  await page.locator('[data-m="ok"]').click();
}

async function testArchiveSwapTwice(browser, baseUrl) {
  contentPayload = makeContentPack('wrong-profile', 'wrong-during-swap', 'Не добавлять');
  await withPage(browser, baseUrl, async page => {
    const today = await browserDateKey(page, 0);
    await installLegacyV6(page, {
      lastDay: today,
      doneFlags: [false, false],
      streak: 5,
    });
    await reload(page);

    let state = await readState(page);
    const personalCatalog = catalogSnapshot(state);
    const legacyCatalogSnapshot = clone(state.archive);
    assert.equal(state.personalization.mode, 'personal');

    await confirmCatalogSwap(page);
    await page.waitForFunction(
      key => JSON.parse(localStorage.getItem(key)).personalization.mode === 'archive',
      STATE_KEY,
    );
    state = await readState(page);
    assert.deepEqual(catalogSnapshot(state), legacyCatalogSnapshot);
    assert.deepEqual(state.archive, personalCatalog);
    assert.equal(state.personalization.id, PROFILE_ID);

    await reload(page);
    state = await readState(page);
    assert.equal(state.personalization.mode, 'archive');
    assert.deepEqual(catalogSnapshot(state), legacyCatalogSnapshot);
    assert.equal(state.applied.includes('wrong-during-swap'), false);

    await confirmCatalogSwap(page);
    await page.waitForFunction(
      key => JSON.parse(localStorage.getItem(key)).personalization.mode === 'personal',
      STATE_KEY,
    );
    state = await readState(page);
    assert.deepEqual(catalogSnapshot(state), personalCatalog);
    assert.deepEqual(state.archive, legacyCatalogSnapshot);
    assert.equal(state.personalization.id, PROFILE_ID);
  });
}

async function testContentProfile(browser, baseUrl) {
  const contentPath = path.join(APP_ROOT, 'content.json');
  assert(fs.existsSync(contentPath), 'content.json is missing');
  const diskContent = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
  assert.equal(diskContent.profile, PROFILE_ID, 'content.json profile');

  const wrongId = 'content-profile-wrong-id';
  const acceptedId = 'artem-v1-content-profile-accepted';
  const blockedInArchiveId = 'artem-v1-content-profile-blocked-in-archive';

  contentPayload = makeContentPack('someone-else', wrongId, 'Чужая задача');
  await withPage(browser, baseUrl, async page => {
    let state = await readState(page);
    assert.equal(state.applied.includes(wrongId), false);
    assert.equal(state.quests.some(item => item.title === 'Чужая задача'), false);

    contentPayload = makeContentPack(PROFILE_ID, acceptedId, 'Проверка профильной синхронизации');
    await reload(page);
    await page.waitForFunction(
      ({ key, id }) => JSON.parse(localStorage.getItem(key)).applied.includes(id),
      { key: STATE_KEY, id: acceptedId },
    );
    state = await readState(page);
    assert.equal(state.quests.filter(item => item.title === 'Проверка профильной синхронизации').length, 1);
    assert.equal(state.applied.filter(id => id === acceptedId).length, 1);

    await reload(page);
    state = await readState(page);
    assert.equal(state.quests.filter(item => item.title === 'Проверка профильной синхронизации').length, 1);
    assert.equal(state.applied.filter(id => id === acceptedId).length, 1);

    await page.evaluate(key => {
      const current = JSON.parse(localStorage.getItem(key));
      current.personalization.mode = 'archive';
      localStorage.setItem(key, JSON.stringify(current));
    }, STATE_KEY);
    contentPayload = makeContentPack(
      PROFILE_ID,
      blockedInArchiveId,
      'Не синхронизировать в режиме архива',
    );
    await reload(page);
    state = await readState(page);
    assert.equal(state.personalization.mode, 'archive');
    assert.equal(state.applied.includes(blockedInArchiveId), false);
    assert.equal(state.quests.some(item => item.title === 'Не синхронизировать в режиме архива'), false);
  });
}

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = 'http://127.0.0.1:' + server.address().port + '/';
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME,
    });

    await testMigrationAndIdempotency(browser, baseUrl);
    await testDailyRolloverCase(browser, baseUrl, {
      label: 'yesterday/all done',
      daysAgo: 1,
      doneFlags: [true, true],
      expectedStreak: 9,
    });
    await testDailyRolloverCase(browser, baseUrl, {
      label: 'yesterday/one false',
      daysAgo: 1,
      doneFlags: [true, false],
      expectedStreak: 0,
    });
    await testDailyRolloverCase(browser, baseUrl, {
      label: 'gap greater than one day',
      daysAgo: 2,
      doneFlags: [true, true],
      expectedStreak: 0,
    });
    await testSeedAndReset(browser, baseUrl);
    await testArchiveSwapTwice(browser, baseUrl);
    await testContentProfile(browser, baseUrl);

    console.log(JSON.stringify({
      schema: 7,
      profile: PROFILE_ID,
      migrationArchive: true,
      idempotentReload: true,
      dailyRollover: {
        completedYesterdayPreserved: true,
        incompleteYesterdayReset: true,
        multiDayGapReset: true,
      },
      seedAndReset: true,
      archiveSwapTwice: true,
      contentProfileGuard: true,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
