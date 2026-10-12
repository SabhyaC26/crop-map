// Usage: node scripts/check-controls.mjs   (needs dev server with dev-controls.html; URL env)
import { chromium } from 'playwright';

const base = process.env.URL ?? 'http://localhost:5188/dev-controls.html';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

async function open(viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[console.error] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => window.__controls, null, { timeout: 60000 });
  return page;
}

const topResult = async (page, q) => {
  await page.fill('.cs-input', q);
  await page.waitForTimeout(120);
  return page.$$eval('.cs-option .cs-name', (n) => n.map((x) => x.textContent));
};
const dimmed = (page) => page.evaluate(() => JSON.stringify(window.__map.getPaintProperty('fields-fill', 'fill-opacity')).includes('literal'));

const page = await open({ width: 1280, height: 800 }, false);
await page.waitForTimeout(2500);

await page.focus('.cs-input');
check('combobox role', (await page.getAttribute('.cs-input', 'role')) === 'combobox');
check('expanded on focus', (await page.getAttribute('.cs-input', 'aria-expanded')) === 'true');
check('listbox role', (await page.getAttribute('.cs-list', 'role')) === 'listbox');
const aliases = {
  broc: 'Broccoli & cole crops',
  cauliflower: 'Broccoli & cole crops',
  spinach: 'Lettuce & greens',
  nectarine: 'Peaches & nectarines',
  prune: 'Prunes',
  wine: 'Grapes',
  lemon: 'Citrus',
  orange: 'Citrus',
  avo: 'Avocados',
  avacado: 'Avocados',
};
for (const [q, want] of Object.entries(aliases)) {
  const got = await topResult(page, q);
  check(`"${q}" -> ${want}`, got[0] === want, got.slice(0, 3).join(' | '));
}
await topResult(page, 'zzzz');
check('empty state', (await page.$$('.cs-empty')).length === 1);

await topResult(page, 'a');
await page.keyboard.press('ArrowDown');
check('ArrowDown moves active', (await page.getAttribute('.cs-input', 'aria-activedescendant'))?.endsWith('-1'));
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Escape');
check('Escape clears text first', (await page.inputValue('.cs-input')) === '');
await page.keyboard.press('Escape');
check('Escape again closes', (await page.getAttribute('.cs-input', 'aria-expanded')) === 'false');

await page.focus('.cs-input');
await page.keyboard.type('avocado');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('chip shown', (await page.textContent('.cs-chip-name')) === 'Avocados');
check('fields dimmed after select', await dimmed(page));
check('flying to avocado', await page.evaluate(() => window.__map.isMoving()));
await page.waitForFunction(() => !window.__map.isMoving(), null, { timeout: 60000 });

await page.click('.cm-cols', { position: { x: 20, y: 20 } });
await page.waitForTimeout(400);
check('slider valuetext Jan', (await page.getAttribute('.cm-track', 'aria-valuetext')) === 'January');
const hint = await page.textContent('.cm-hint').catch(() => null);
check('hint when avocado not in Jan', hint === 'Not in harvest in January', String(hint));
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
check('arrow keys move slider', (await page.getAttribute('.cm-track', 'aria-valuetext')) === 'March');
check('no hint in March', (await page.$('.cm-hint')) === null);
check('bloom filter is avocado only', await page.evaluate(() => JSON.stringify(window.__map.getFilter('fields-bloom')).includes('[24]')));

await page.click('.cs-chip-clear');
await page.waitForTimeout(300);
check('chip cleared', (await page.$('.cs-chip:not([hidden])')) === null);
check('month emphasis remains', await dimmed(page));
await page.click('.cm-all');
await page.waitForTimeout(500);
check('all year clears emphasis', !(await dimmed(page)));
check('all year valuetext', (await page.getAttribute('.cm-track', 'aria-valuetext')) === 'All year');

await page.click('.cm-play');
await page.waitForTimeout(300);
check('play shows pause state', await page.evaluate(() => document.querySelector('.cm-root').classList.contains('is-playing')));
const m0 = await page.getAttribute('.cm-track', 'aria-valuenow');
await page.waitForTimeout(3000);
const m1 = await page.getAttribute('.cm-track', 'aria-valuenow');
check('play advances months', m0 !== m1, `${m0} -> ${m1}`);
await page.keyboard.press('Tab');
await page.focus('.cm-track');
await page.keyboard.press('ArrowRight');
check('interaction pauses play', !(await page.evaluate(() => document.querySelector('.cm-root').classList.contains('is-playing'))));
await page.click('.cm-all');

// drag
const box = await page.locator('.cm-cols').boundingBox();
await page.mouse.move(box.x + (box.width / 12) * 1.5, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + (box.width / 12) * 6.5, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(500);
check('drag lands on July', (await page.getAttribute('.cm-track', 'aria-valuetext')) === 'July');
await page.click('.cm-all');
await page.context().close();

// popup sheet hides slider on mobile
const mob = await open({ width: 390, height: 844 }, true);
await mob.evaluate(() => window.__map.jumpTo({ center: [-121.62, 36.62], zoom: 13 }));
await mob.waitForTimeout(1000);
await mob.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 120000 });
await mob.waitForTimeout(1200);
const opened = await mob.evaluate(() => {
  const map = window.__map;
  const w = map.getContainer().clientWidth;
  const h = map.getContainer().clientHeight;
  for (let y = h * 0.3; y < h * 0.7; y += 14)
    for (let x = w * 0.2; x < w * 0.8; x += 14) {
      const hit = window.__app.fields.queryAt([x, y]);
      if (hit) {
        window.__app.popup.openField(hit, map.unproject([x, y]));
        return true;
      }
    }
  return false;
});
check('opened popup sheet', opened);
await mob.waitForTimeout(700);
check('slider tucked while sheet open', await mob.evaluate(() => document.querySelector('.cm-root').classList.contains('is-tucked')));
await mob.evaluate(() => window.__app.popup.close());
await mob.waitForTimeout(800);
check('slider returns after close', !(await mob.evaluate(() => document.querySelector('.cm-root').classList.contains('is-tucked'))));
const hs = await mob.evaluate(() => [...document.querySelectorAll('.cs-search, .cm-play, .cm-all')].map((n) => [n.className, Math.round(n.getBoundingClientRect().height)]));
check('touch targets >= 44px', hs.every(([, h]) => h >= 44), JSON.stringify(hs));

await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail || problems.length ? 1 : 0;
