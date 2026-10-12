// Interaction checks for the legend + destinations. Needs a dev server: URL=http://127.0.0.1:5195/
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5195/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, extra);
};

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__app, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  return page;
}
const settle = async (page, ms = 1500) => {
  await page.waitForFunction(() => window.__map.areTilesLoaded() && !window.__map.isMoving(), null, { timeout: 120000 });
  await page.waitForTimeout(ms);
};
const jump = async (page, c, z) => {
  await page.evaluate(([c, z]) => window.__map.jumpTo({ center: c, zoom: z }), [c, z]);
  await settle(page, 1800);
};
const fillOpacity = (page) => page.evaluate(() => JSON.stringify(window.__map.getPaintProperty('fields-fill', 'fill-opacity')));
const row = (page, name) => page.locator('.lg-row', { has: page.locator('.lg-name', { hasText: new RegExp(`^${name}$`) }) });

{
  const page = await open({ width: 1280, height: 800 });
  check('legend hidden at state zoom', (await page.locator('.lg-root').getAttribute('data-visible')) === 'false');
  await jump(page, [-121.65, 36.68], 12);
  check('legend visible at z12', (await page.locator('.lg-root').getAttribute('data-visible')) === 'true');
  const shares = (await page.locator('.lg-pct').allTextContents()).slice(0, 3);
  check('shares ranked', shares.length === 3 && parseInt(shares[0]) >= parseInt(shares[1]), shares.join(','));
  check('top 8 + more', (await page.locator('.lg-row').count()) === 8 && (await page.locator('.lg-more').isVisible()));
  await page.locator('.lg-more').click();
  check('expander shows all', (await page.locator('.lg-row').count()) > 8);
  await page.locator('.lg-more').click();

  const base = await fillOpacity(page);
  await row(page, 'Strawberries').hover();
  await page.waitForTimeout(450);
  const hovered = await fillOpacity(page);
  check('hover previews', hovered !== base && (await page.locator('.lg-row[aria-pressed="true"]').count()) === 0);
  await page.mouse.move(700, 600);
  await page.waitForTimeout(450);
  check('hover restores', (await fillOpacity(page)) === base);

  await row(page, 'Strawberries').click();
  await row(page, 'Lettuce & greens').click();
  check('second click adds', (await page.locator('.lg-row[aria-pressed="true"]').count()) === 2);
  await row(page, 'Lettuce & greens').click({ modifiers: ['Meta'] });
  check('toggle off', (await page.locator('.lg-row[aria-pressed="true"]').count()) === 1);
  await page.locator('.lg-clear').click();
  await page.waitForTimeout(300);
  const afterClear = await fillOpacity(page);
  check('show all', afterClear === base, afterClear === base ? '' : `${base.slice(0, 120)} VS ${afterClear.slice(0, 120)}`);

  // keyboard
  await row(page, 'Strawberries').focus();
  await page.keyboard.press('Enter');
  check('keyboard toggles', (await row(page, 'Strawberries').getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Space');
  check('space untoggles', (await row(page, 'Strawberries').getAttribute('aria-pressed')) === 'false');

  // search selection + legend share state
  await page.locator('.cs-input').click();
  await page.keyboard.type('strawb');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await settle(page, 2000);
  await jump(page, [-121.65, 36.68], 12);
  check('search selects in legend', (await page.locator('.lg-row[aria-pressed="true"]').count()) === 1);
  check('destinations open', (await page.locator('.dc').count()) === 1);
  await row(page, 'Strawberries').click();
  await page.waitForTimeout(500);
  check('legend unselect clears chip+card', (await page.locator('.dc:not(.is-leaving)').count()) === 0 && (await page.locator('.cs-chip').isHidden()));
  await page.context().close();
}

// Search lights up the crop's confetti dots, hides the emoji markers (no pins), and restores everything on clear.
{
  const page = await open({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.querySelector('.crop-marker[data-state=shown]'), null, { timeout: 90000 });
  const hlFilter = () => page.evaluate(() => JSON.stringify(window.__map.getFilter('overview-hl-dots')));
  const quiltOpacity = () => page.evaluate(() => JSON.stringify(window.__map.getPaintProperty('overview-dots', 'circle-opacity')));
  const markerGates = () =>
    page.evaluate(() => ({
      flagged: document.querySelectorAll('.crop-marker[data-suppressed]').length,
      total: document.querySelectorAll('.crop-marker').length,
      visible: [...document.querySelectorAll('.crop-marker[data-state=shown][data-gate=on]')].filter(
        (e) => Number(getComputedStyle(e.querySelector('.crop-marker__gate')).opacity) > 0.02,
      ).length,
    }));
  const baseQuilt = await quiltOpacity();
  const noHighlight = await hlFilter();
  await page.locator('.cs-input').click();
  await page.keyboard.type('almond');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('no numbered place pins', (await page.locator('.dp').count()) === 0);
  check('where-it-grows card lists places', (await page.locator('.dc-row').count()) >= 2);
  const lit = await hlFilter();
  check('highlight layers filter to the searched crop', lit !== noHighlight && lit.includes('"literal"') && lit.includes('[1]'), lit);
  check('quilt dims behind the highlight', (await quiltOpacity()) !== baseQuilt);
  const hidden = await markerGates();
  check('every emoji marker fades out', hidden.flagged === hidden.total && hidden.visible === 0, JSON.stringify(hidden));
  await settle(page, 1200);
  await page.locator('.dc-row').first().click();
  await settle(page, 2200);
  check('fields emphasise the same crop', (await fillOpacity(page)).includes('"in"'));
  await page.locator('.cs-chip-clear').click();
  await page.waitForTimeout(1000);
  check('clear restores highlight, quilt and markers', (await hlFilter()) === noHighlight && (await quiltOpacity()) === baseQuilt && (await markerGates()).flagged === 0);
  await page.context().close();
}

{
  const page = await open({ width: 800, height: 700 });
  await jump(page, [-121.65, 36.68], 12);
  await page.locator('.cs-input').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/mid-width.png' });
  await page.context().close();
}

{
  const page = await open({ width: 390, height: 844 }, true);
  await jump(page, [-121.62, 36.62], 13);
  const pt = await page.evaluate(() => {
    const m = window.__map;
    const w = m.getContainer().clientWidth;
    const h = m.getContainer().clientHeight;
    for (let y = h * 0.25; y < h * 0.5; y += 10)
      for (let x = w * 0.2; x < w * 0.8; x += 10) if (window.__app.fields.queryAt([x, y])) return { x, y };
    return null;
  });
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(1000);
  const lift = await page.locator('.lg-root').evaluate((n) => n.style.getPropertyValue('--lift'));
  check('pill lifts above sheet', parseFloat(lift) > 100, lift);
  await page.screenshot({ path: '/tmp/mobile-lift.png' });
  await page.context().close();
}

console.log('console errors', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
