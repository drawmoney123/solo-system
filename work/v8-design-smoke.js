/*
 * Read-only visual/geometry contract for the v8 monochrome redesign.
 *
 * Run from the repository root after the redesign is ready:
 *   node .\work\v8-design-smoke.js
 *
 * The test deliberately does not complete tasks, submit forms, buy rewards,
 * or change settings. It snapshots localStorage after startup/content sync and
 * requires the application state to remain byte-for-byte unchanged.
 *
 * Covered surfaces:
 *   - five root tabs and the reward shop;
 *   - all nine training sections;
 *   - representative short, long, settings, and confirmation-style modals;
 *   - 320/375/390/430 px portrait layouts and an iPhone landscape layout;
 *   - monochrome computed styles, WCAG text/control contrast, 44 px targets,
 *     horizontal overflow, clipping, control overlaps, fixed navigation,
 *     sticky header, modal geometry, ARIA selected states, and browser errors.
 *
 * A screenshot is written to work/v8-design-failures only when the test fails.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let playwright;
try {
  playwright = require('playwright-core');
} catch (error) {
  playwright = require('C:/Users/draw/Documents/Codex/2026-07-18/new-chat/work/node_modules/playwright-core');
}
const { chromium } = playwright;

const APP_ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const STATE_KEY = 'soloSystemV1';
const TOUCH_MIN = 43.5;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568 },
  { id: '375x812', width: 375, height: 812 },
  { id: '390x844', width: 390, height: 844 },
  { id: '430x932', width: 430, height: 932 },
  { id: '844x390-landscape', width: 844, height: 390 },
];

const ROOT_SCREENS = [
  {
    id: 'status',
    required: ['.stTop', '.rankBox', '.statRow', '.chart', '[data-act="name"]'],
  },
  {
    id: 'quests',
    required: ['[data-act="daily"]', '[data-act="taskfilter"]', '[data-act="addQuest"]'],
  },
  {
    id: 'gates',
    required: ['.floor', '[data-act="addDungeon"]'],
  },
  {
    id: 'more',
    required: ['[data-act="openshop"]', '[data-act="export"]', '[data-act="swaparchive"]'],
  },
];

const TRAINING_SCREENS = [
  {
    id: 'today',
    required: ['.train-today', '.train-summary', '.week-list', '.train-quick'],
  },
  {
    id: 'week',
    required: ['.week-list', '[data-act="trainsettings"]'],
  },
  {
    id: 'strength',
    required: ['.profile-grid', '.train-plan', '[data-act="addstrength"]'],
  },
  {
    id: 'run',
    required: ['[data-act="addrun"]', '[data-act="runlevel"]'],
  },
  {
    id: 'walk',
    required: ['[data-act="addwalk"]'],
  },
  {
    id: 'yoga',
    required: ['[data-act="startpractice"][data-id^="yoga-"]', '[data-act="wellnesssettings"]'],
  },
  {
    id: 'meditation',
    required: ['[data-act="startpractice"][data-id^="med-"]', '[data-act="wellnesssettings"]'],
  },
  {
    id: 'journal',
    required: ['[data-act="trainfilter"]'],
  },
  {
    id: 'settings',
    required: ['[data-act="trainprofile"]', '[data-act="wellnesssettings"]'],
  },
];

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

function compactFailures(items, limit = 14) {
  return JSON.stringify(items.slice(0, limit), null, 2);
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function openRoot(page, id) {
  const control = page.locator(`.tabbar [data-tab="${id}"]`);
  await control.click();
  await settle(page);
  assert(await control.evaluate(node => node.classList.contains('on')), `${id}: root tab is not selected`);
}

async function openTraining(page, id) {
  await openRoot(page, 'training');
  const control = page.locator(`.train-nav [data-act="trainsection"][data-id="${id}"]`);
  await control.waitFor();
  await control.click();
  await settle(page);
  assert.equal(await control.getAttribute('aria-selected'), 'true', `${id}: training tab is not selected`);
  assert.equal(
    await page.locator('.train-nav [aria-selected="true"]').count(),
    1,
    `${id}: training tablist must have exactly one selected tab`,
  );
}

async function requireSelectors(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    assert(await locator.count(), `${label}: required selector is missing: ${selector}`);
    await locator.first().waitFor({ state: 'visible' });
  }
}

async function auditMonochrome(page, label, rootSelector) {
  const failures = await page.evaluate(({ label, rootSelector }) => {
    const root = rootSelector ? document.querySelector(rootSelector) : document;
    if (!root) return [{ label, issue: 'audit root missing', rootSelector }];
    const properties = [
      'color', 'backgroundColor', 'backgroundImage',
      'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      'outlineColor', 'boxShadow', 'textShadow', 'caretColor', 'textDecorationColor',
      'columnRuleColor', 'fill', 'stroke', 'accentColor',
    ];
    const output = [];

    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function colorTriples(value) {
      const triples = [];
      const rgbPattern = /rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)/gi;
      for (const match of value.matchAll(rgbPattern)) {
        triples.push(match.slice(1, 4).map(Number));
      }
      const hexPattern = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi;
      for (const match of value.matchAll(hexPattern)) {
        let hex = match[1];
        if (hex.length === 3) hex = [...hex].map(char => char + char).join('');
        triples.push([0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)));
      }
      return triples;
    }

    const auditedElements = root.nodeType === Node.DOCUMENT_NODE
      ? [...root.querySelectorAll('*')]
      : [root, ...root.querySelectorAll('*')];
    for (const element of auditedElements) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      if (element.matches('input[type="checkbox"],input[type="radio"]') && style.accentColor === 'auto') {
        output.push({ label, node: element.tagName + '#' + element.id, property: 'accentColor', value: 'auto' });
      }
      for (const property of properties) {
        const value = style[property] || '';
        for (const rgb of colorTriples(value)) {
          if (Math.max(...rgb) - Math.min(...rgb) > 2.1) {
            output.push({
              label,
              node: element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') +
                (typeof element.className === 'string' && element.className ? '.' + element.className.trim().replace(/\s+/g, '.') : ''),
              property,
              value,
            });
            break;
          }
        }
        if (output.length >= 60) return output;
      }
    }
    return output;
  }, { label, rootSelector });
  assert.equal(failures.length, 0, `${label}: non-monochrome styles\n${compactFailures(failures)}`);
}

async function auditContrast(page, label, rootSelector) {
  const failures = await page.evaluate(({ label, rootSelector }) => {
    const root = rootSelector ? document.querySelector(rootSelector) : document;
    if (!root) return [{ label, issue: 'audit root missing', rootSelector }];
    const output = [];

    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function parseColor(value) {
      if (!value) return null;
      const rgb = value.match(/rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+%?))?/i);
      if (rgb) {
        let alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4]);
        if (rgb[4] && rgb[4].endsWith('%')) alpha /= 100;
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
      }
      const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
      if (!hex) return null;
      let source = hex[1];
      if (source.length === 3) source = [...source].map(char => char + char).join('');
      const alpha = source.length === 8 ? parseInt(source.slice(6, 8), 16) / 255 : 1;
      return [0, 2, 4].map(offset => parseInt(source.slice(offset, offset + 2), 16)).concat(alpha);
    }

    function blend(top, bottom) {
      if (!top) return bottom;
      const alpha = Math.max(0, Math.min(1, top[3]));
      return [
        top[0] * alpha + bottom[0] * (1 - alpha),
        top[1] * alpha + bottom[1] * (1 - alpha),
        top[2] * alpha + bottom[2] * (1 - alpha),
        1,
      ];
    }

    function backgroundFor(element, includeSelf = true) {
      const chain = [];
      let node = includeSelf ? element : element && element.parentElement;
      while (node && node.nodeType === 1) {
        chain.push(node);
        node = node.parentElement;
      }
      let result = [255, 255, 255, 1];
      chain.reverse().forEach(item => {
        const parsed = parseColor(getComputedStyle(item).backgroundColor);
        if (parsed) result = blend(parsed, result);
      });
      return result;
    }

    function luminance(color) {
      const channels = color.slice(0, 3).map(value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }

    function ratio(first, second) {
      const a = luminance(first);
      const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    function descriptor(element) {
      return element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') +
        (typeof element.className === 'string' && element.className ? '.' + element.className.trim().replace(/\s+/g, '.') : '');
    }

    const all = [root, ...root.querySelectorAll('*')].filter(item => item && item.nodeType === 1);
    for (const element of all) {
      if (!visible(element)) continue;
      if (element.closest('button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled="true"]')) continue;
      const directText = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .join(' ')
        .trim();
      const isFormText = element.matches('input:not([type="checkbox"]):not([type="radio"]),select,textarea');
      if (directText || isFormText) {
        const style = getComputedStyle(element);
        const foregroundRaw = parseColor(style.color);
        if (foregroundRaw && foregroundRaw[3] > 0.01) {
          const background = backgroundFor(element);
          const foreground = blend(foregroundRaw, background);
          const fontSize = parseFloat(style.fontSize) || 16;
          const weight = parseInt(style.fontWeight, 10) || 400;
          const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
          const hasLettersOrNumbers = /[\p{L}\p{N}]/u.test(directText || 'field');
          const threshold = hasLettersOrNumbers ? (large ? 3 : 4.5) : 3;
          const actual = ratio(foreground, background);
          if (actual + 0.02 < threshold) {
            output.push({
              label,
              kind: 'text',
              node: descriptor(element),
              text: (directText || element.getAttribute('placeholder') || 'form control').slice(0, 90),
              ratio: Number(actual.toFixed(2)),
              required: threshold,
              color: style.color,
              background: background.slice(0, 3).map(Math.round),
            });
          }
        }
      }
    }

    const controls = root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
    for (const element of controls) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      const borderWidths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
        .map(parseFloat);
      const ownBackgroundRaw = parseColor(style.backgroundColor);
      const hasFill = ownBackgroundRaw && ownBackgroundRaw[3] > 0.02;
      const hasBorder = borderWidths.some(width => width > 0);
      if (!hasFill && !hasBorder) continue;
      const outside = backgroundFor(element, false);
      const ownBackground = blend(ownBackgroundRaw || [0, 0, 0, 0], outside);
      const fillRatio = ratio(ownBackground, outside);
      let strongestBoundary = fillRatio;
      for (const property of ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']) {
        const parsed = parseColor(style[property]);
        if (parsed) strongestBoundary = Math.max(strongestBoundary, ratio(blend(parsed, outside), outside));
      }
      if (strongestBoundary + 0.02 < 3) {
        output.push({
          label,
          kind: 'control-boundary',
          node: descriptor(element),
          ratio: Number(strongestBoundary.toFixed(2)),
          required: 3,
        });
      }
    }

    const variables = getComputedStyle(document.documentElement);
    const token = name => parseColor(variables.getPropertyValue(name).trim());
    const tokenPairs = [
      ['--bw-text', '--bw-bg', 4.5],
      ['--bw-text', '--bw-surface-raised', 4.5],
      ['--bw-secondary', '--bw-surface', 4.5],
      ['--bw-muted', '--bw-surface-raised', 4.5],
      ['--bw-dim', '--bw-bg', 3],
      ['--bw-line-strong', '--bw-surface', 3],
    ];
    for (const [foregroundName, backgroundName, threshold] of tokenPairs) {
      const foreground = token(foregroundName);
      const background = token(backgroundName);
      if (!foreground || !background) continue;
      const actual = ratio(blend(foreground, background), background);
      if (actual + 0.02 < threshold) {
        output.push({
          label,
          kind: 'token',
          pair: `${foregroundName}/${backgroundName}`,
          ratio: Number(actual.toFixed(2)),
          required: threshold,
        });
      }
    }
    return output.slice(0, 80);
  }, { label, rootSelector });
  assert.equal(failures.length, 0, `${label}: contrast failures\n${compactFailures(failures)}`);
}

async function auditGeometry(page, label, modal = false) {
  const result = await page.evaluate(({ label, modal, touchMin }) => {
    const root = modal ? document.querySelector('.modal') : document;
    if (!root) return { rootMissing: true, label };
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const failures = {
      containment: [],
      touch: [],
      text: [],
      overlap: [],
    };

    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function descriptor(element) {
      return element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') +
        (typeof element.className === 'string' && element.className ? '.' + element.className.trim().replace(/\s+/g, '.') : '');
    }

    function paintedRect(element) {
      const source = element.getBoundingClientRect();
      const rect = { left: source.left, right: source.right, top: source.top, bottom: source.bottom };
      const clips = value => /auto|scroll|hidden|clip/.test(value);
      for (let parent = element.parentElement; parent && parent !== root.parentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const parentRect = parent.getBoundingClientRect();
        if (clips(style.overflowX)) {
          rect.left = Math.max(rect.left, parentRect.left);
          rect.right = Math.min(rect.right, parentRect.right);
        }
        if (clips(style.overflowY)) {
          rect.top = Math.max(rect.top, parentRect.top);
          rect.bottom = Math.min(rect.bottom, parentRect.bottom);
        }
      }
      return rect;
    }

    const containmentSelector = modal
      ? '.modal,.train-form-block,.practice-timer,.m-btns'
      : '.panel,.qitem,.week-row,.train-plan,.profile-cell,.train-session,.practice-timer';
    for (const element of root.querySelectorAll(containmentSelector)) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -0.75 || rect.right > viewportWidth + 0.75) {
        failures.containment.push({ node: descriptor(element), left: rect.left, right: rect.right, viewportWidth });
      }
    }

    const controlSelector = 'button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"]';
    const controls = [...root.querySelectorAll(controlSelector)].filter(visible);
    for (const element of controls) {
      let rect = element.getBoundingClientRect();
      if (element.matches('input[type="checkbox"],input[type="radio"]')) {
        const labelElement = element.closest('label') || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`));
        if (labelElement && visible(labelElement)) rect = labelElement.getBoundingClientRect();
      }
      if (rect.width < touchMin || rect.height < touchMin) {
        failures.touch.push({
          node: descriptor(element),
          text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 70),
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1)),
        });
      }
    }

    const textSelector = [
      '.logo', '.gold', 'h2', '.qtitle', '.qmeta', '.todayRow>span', '.todayRow>b',
      '.week-main>b', '.week-main>span', '.week-mark', '.train-session-title',
      '.train-session-meta', '.profile-cell>b', '.btn', '.tabbar button', '.practice-timer-name',
      '.practice-timer-value', '.practice-timer-state', 'label.f', '.askText',
    ].join(',');
    for (const element of root.querySelectorAll(textSelector)) {
      if (!visible(element) || element.closest('.train-nav')) continue;
      const style = getComputedStyle(element);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      if (element.scrollWidth > element.clientWidth + 1.1) {
        failures.text.push({
          node: descriptor(element),
          text: (element.textContent || '').trim().slice(0, 90),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        });
      }
    }

    function intersect(first, second) {
      return {
        width: Math.min(first.right, second.right) - Math.max(first.left, second.left),
        height: Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
      };
    }

    const overlapRoots = modal
      ? [root]
      : [document.querySelector('#view'), document.querySelector('.tabbar')].filter(Boolean);
    for (const overlapRoot of overlapRoots) {
      const items = [...overlapRoot.querySelectorAll(controlSelector)].filter(visible);
      for (let firstIndex = 0; firstIndex < items.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < items.length; secondIndex += 1) {
          const first = items[firstIndex];
          const second = items[secondIndex];
          if (first.contains(second) || second.contains(first)) continue;
          const firstRect = paintedRect(first);
          const secondRect = paintedRect(second);
          if (firstRect.right <= firstRect.left || firstRect.bottom <= firstRect.top || secondRect.right <= secondRect.left || secondRect.bottom <= secondRect.top) continue;
          const overlap = intersect(firstRect, secondRect);
          if (overlap.width > 1 && overlap.height > 1) {
            failures.overlap.push({
              first: descriptor(first),
              second: descriptor(second),
              width: Number(overlap.width.toFixed(1)),
              height: Number(overlap.height.toFixed(1)),
            });
            if (failures.overlap.length >= 30) break;
          }
        }
        if (failures.overlap.length >= 30) break;
      }
    }

    const documentOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth;
    let shell = null;
    if (!modal) {
      const app = document.querySelector('#app').getBoundingClientRect();
      const tabbar = document.querySelector('.tabbar').getBoundingClientRect();
      const header = document.querySelector('header').getBoundingClientRect();
      shell = {
        appLeft: app.left,
        appRight: app.right,
        tabLeft: tabbar.left,
        tabRight: tabbar.right,
        tabBottomGap: viewportHeight - tabbar.bottom,
        tabPosition: getComputedStyle(document.querySelector('.tabbar')).position,
        headerPosition: getComputedStyle(document.querySelector('header')).position,
        headerTop: header.top,
      };
    }

    let modalGeometry = null;
    if (modal) {
      const modalRect = root.getBoundingClientRect();
      const footer = root.querySelector('.m-btns');
      const footerRect = footer ? footer.getBoundingClientRect() : null;
      modalGeometry = {
        left: modalRect.left,
        right: modalRect.right,
        top: modalRect.top,
        bottom: modalRect.bottom,
        widthOverflow: root.scrollWidth - root.clientWidth,
        footerTop: footerRect && footerRect.top,
        footerBottom: footerRect && footerRect.bottom,
      };
    }

    return { label, documentOverflow, failures, shell, modalGeometry, rootMissing: false };
  }, { label, modal, touchMin: TOUCH_MIN });

  assert.equal(result.rootMissing, false, `${label}: geometry root is missing`);
  assert(result.documentOverflow <= 1, `${label}: document horizontal overflow ${result.documentOverflow}px`);
  for (const [kind, failures] of Object.entries(result.failures)) {
    assert.equal(failures.length, 0, `${label}: ${kind} geometry failures\n${compactFailures(failures)}`);
  }

  if (result.shell) {
    assert.equal(result.shell.tabPosition, 'fixed', `${label}: tabbar is not fixed`);
    assert(result.shell.tabBottomGap >= -1 && result.shell.tabBottomGap <= 13, `${label}: floating tabbar bottom gap is invalid`);
    const leftInset=result.shell.tabLeft-result.shell.appLeft;
    const rightInset=result.shell.appRight-result.shell.tabRight;
    assert(leftInset >= -1 && leftInset <= 16, `${label}: floating tabbar left inset is invalid`);
    assert(rightInset >= -1 && rightInset <= 16, `${label}: floating tabbar right inset is invalid`);
    assert(Math.abs(leftInset-rightInset) <= 1, `${label}: floating tabbar is not horizontally centered`);
    assert.equal(result.shell.headerPosition, 'sticky', `${label}: header is not sticky`);
    assert(Math.abs(result.shell.headerTop) <= 1, `${label}: sticky header is not at viewport top`);
  }

  if (result.modalGeometry) {
    const geometry = result.modalGeometry;
    const viewport = page.viewportSize();
    assert(geometry.left >= -1 && geometry.right <= viewport.width + 1, `${label}: modal exceeds viewport width`);
    assert(geometry.top >= -1 && geometry.bottom <= viewport.height + 1, `${label}: modal exceeds viewport height`);
    assert(geometry.widthOverflow <= 1, `${label}: modal horizontal overflow ${geometry.widthOverflow}px`);
    assert(geometry.footerTop !== null, `${label}: modal action footer is missing`);
    assert(geometry.footerTop >= geometry.top - 1, `${label}: modal footer starts above modal`);
    assert(geometry.footerBottom <= geometry.bottom + 1, `${label}: modal footer ends below modal`);
  }
}

async function auditBottomClearance(page, label) {
  const result = await page.evaluate(async () => {
    const previousY = window.scrollY;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const tabbar = document.querySelector('.tabbar').getBoundingClientRect();
    const children = [...document.querySelector('#view').children].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    });
    const last = children[children.length - 1];
    const lastRect = last ? last.getBoundingClientRect() : null;
    const result = {
      last: last ? last.tagName.toLowerCase() + '.' + last.className : null,
      lastBottom: lastRect && lastRect.bottom,
      tabTop: tabbar.top,
    };
    window.scrollTo(0, previousY);
    return result;
  });
  assert(result.last, `${label}: #view has no visible content`);
  assert(
    result.lastBottom <= result.tabTop + 1,
    `${label}: final content is hidden by tabbar (${result.lastBottom.toFixed(1)} > ${result.tabTop.toFixed(1)})`,
  );
}

async function auditScreen(page, label, required) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  await requireSelectors(page, required, label);
  await auditGeometry(page, label, false);
  await auditMonochrome(page, label, null);
  await auditContrast(page, label, null);
  await auditBottomClearance(page, label);
}

async function openShop(page) {
  await openRoot(page, 'more');
  await page.locator('[data-act="openshop"]').click();
  await settle(page);
  await requireSelectors(page, ['.reward-balance', '[data-act="addShop"]', '[data-act="openmore"]'], 'shop');
}

async function closeModal(page, label) {
  const cancel = page.locator('#overlay:not(.hidden) [data-m="cancel"]');
  assert(await cancel.count(), `${label}: modal cancel control is missing`);
  await cancel.click();
  await page.locator('#overlay').waitFor({ state: 'hidden' });
}

async function auditOpenedModal(page, label) {
  const modal = page.locator('#overlay:not(.hidden) .modal[role="dialog"][aria-modal="true"]');
  await modal.waitFor({ state: 'visible' });
  assert.equal(await modal.getAttribute('aria-labelledby'), 'modalTitle', `${label}: dialog label contract changed`);
  assert(await page.locator('#overlay:not(.hidden) #modalTitle').count(), `${label}: modal title is missing`);
  await auditGeometry(page, label, true);
  await auditMonochrome(page, label, '.modal');
  await auditContrast(page, label, '.modal');
  await closeModal(page, label);
}

async function auditModals(page, viewportId) {
  const scenarios = [
    {
      id: 'name',
      prepare: () => openRoot(page, 'status'),
      open: () => page.locator('[data-act="name"]').click(),
      fields: ['#mTitle'],
    },
    {
      id: 'quest',
      prepare: () => openRoot(page, 'quests'),
      open: () => page.locator('[data-act="addQuest"]').click(),
      fields: ['#mTitle', '#mStat', '#mDiff'],
    },
    {
      id: 'full-body',
      prepare: () => openTraining(page, 'strength'),
      open: () => page.locator('[data-act="addstrength"]').first().click(),
      fields: ['#mTrainDate', '#mTrainDuration', '#mTrainNote'],
    },
    {
      id: 'walk',
      prepare: () => openTraining(page, 'walk'),
      open: () => page.locator('[data-act="addwalk"][data-id="recovery"]').click(),
      fields: ['#mTrainDate', '#mTrainDuration', '#mTrainDistance'],
    },
    {
      id: 'practice',
      prepare: () => openTraining(page, 'meditation'),
      open: () => page.locator('[data-act="addpractice"][data-id="med-breath-3"]').click(),
      fields: ['#mPracticeTemplate', '#mPracticeDate', '#mPracticeDuration', '#mPracticeNote'],
    },
    {
      id: 'wellness-settings',
      prepare: () => openTraining(page, 'settings'),
      open: () => page.locator('[data-act="wellnesssettings"]').click(),
      fields: ['#mYogaDay0', '#mYogaPractice', '#mMeditationPractice'],
    },
    {
      id: 'reward',
      prepare: () => openShop(page),
      open: () => page.locator('[data-act="addShop"]').click(),
      fields: ['#mTitle', '#mCost'],
    },
  ];

  for (const scenario of scenarios) {
    const label = `${viewportId}/modal/${scenario.id}`;
    await scenario.prepare();
    await scenario.open();
    await requireSelectors(page, scenario.fields, label);
    await auditOpenedModal(page, label);
  }
}

async function auditFocus(page) {
  await openRoot(page, 'quests');
  await page.evaluate(() => {
    document.activeElement && document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.keyboard.press('Tab');
  const result = await page.evaluate(() => {
    const element = document.activeElement;
    const style = element && getComputedStyle(element);
    return {
      tag: element && element.tagName,
      outlineStyle: style && style.outlineStyle,
      outlineWidth: style && parseFloat(style.outlineWidth),
      boxShadow: style && style.boxShadow,
    };
  });
  assert(result.tag && result.tag !== 'BODY', 'keyboard focus did not enter an interactive control');
  assert(
    (result.outlineStyle && result.outlineStyle !== 'none' && result.outlineWidth >= 1) ||
      (result.boxShadow && result.boxShadow !== 'none'),
    `focused control has no visible focus indicator: ${JSON.stringify(result)}`,
  );
}

async function saveFailureScreenshot(page, label) {
  if (!page || page.isClosed()) return null;
  const directory = path.join(APP_ROOT, 'work', 'v8-design-failures');
  fs.mkdirSync(directory, { recursive: true });
  const safeLabel = String(label || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  const file = path.join(directory, `${Date.now()}-${safeLabel}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => null);
  return fs.existsSync(file) ? file : null;
}

(async () => {
  let browser;
  let context;
  let page;
  let currentStep = 'startup';
  const browserErrors = [];

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ headless: true, executablePath: CHROME });
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });

    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await settle(page);
    const initialState = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    assert(initialState, 'application did not create its state');

    for (const viewport of VIEWPORTS) {
      currentStep = viewport.id;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await settle(page);

      for (const screen of ROOT_SCREENS) {
        currentStep = `${viewport.id}/${screen.id}`;
        await openRoot(page, screen.id);
        await auditScreen(page, currentStep, screen.required);
      }

      for (const screen of TRAINING_SCREENS) {
        currentStep = `${viewport.id}/training/${screen.id}`;
        await openTraining(page, screen.id);
        await auditScreen(page, currentStep, screen.required);
      }

      currentStep = `${viewport.id}/shop`;
      await openShop(page);
      await auditScreen(page, currentStep, ['.reward-balance', '[data-act="addShop"]', '[data-act="openmore"]']);

      currentStep = `${viewport.id}/modals`;
      await auditModals(page, viewport.id);
    }

    currentStep = 'keyboard-focus';
    await page.setViewportSize({ width: 390, height: 844 });
    await auditFocus(page);

    currentStep = 'read-only-state';
    const finalState = await page.evaluate(key => localStorage.getItem(key), STATE_KEY);
    assert.equal(finalState, initialState, 'design smoke changed application state');
    assert.equal(browserErrors.length, 0, `browser errors:\n${browserErrors.join('\n')}`);

    console.log(JSON.stringify({
      readOnly: true,
      rootScreens: ROOT_SCREENS.map(item => item.id).concat('training', 'shop'),
      trainingSections: TRAINING_SCREENS.map(item => item.id),
      viewports: VIEWPORTS.map(item => item.id),
      modals: ['name', 'quest', 'full-body', 'walk', 'practice', 'wellness-settings', 'reward'],
      checks: ['monochrome', 'contrast', '44px', 'overflow', 'overlap', 'fixed-shell', 'focus', 'console'],
      browserErrors: 0,
    }, null, 2));
  } catch (error) {
    const screenshot = await saveFailureScreenshot(page, currentStep);
    if (screenshot) error.message += `\nFailure screenshot: ${screenshot}`;
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
