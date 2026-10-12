// Side-by-side medians from perf-baseline JSON files. Files sharing a label are pooled (use to interleave runs).
//   node scripts/perf-compare.mjs before=a.json before=b.json after=c.json after=d.json
import { readFileSync } from 'node:fs';

const groups = new Map();
for (const arg of process.argv.slice(2)) {
  const [label, file] = arg.split('=');
  const raw = JSON.parse(readFileSync(file, 'utf8')).raw;
  groups.set(label, [...(groups.get(label) ?? []), ...raw]);
}
const labels = [...groups.keys()];
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const metric = (name, pick, digits = 0) => ({ name, pick, digits });
const frame = (n, k) => (r) => r.frames.find((f) => f.name.startsWith(n))?.[k];
const bytes = (t) => (r) => (r.loadByType[t]?.bytes ?? 0) / 1024;
const rows = [
  metric('first map render (ms)', (r) => r.load.firstRender),
  metric('first idle (ms)', (r) => r.load.firstIdle),
  metric('markers visible (ms)', (r) => r.load.markersVisible),
  metric('settled (ms)', (r) => r.load.settled),
  metric('requests in first 5 s', (r) => r.load.requestsFirst5s),
  metric('bytes until settled (KB)', (r) => r.load.bytesAtLoad / 1024),
  metric('  terrain KB', bytes('terrain')),
  metric('  icons KB', bytes('icons')),
  metric('  pmtiles KB', bytes('pmtiles')),
  metric('  js KB', bytes('js')),
  metric('long tasks during load', (r) => r.load.longTasks),
  metric('TBT during load (ms)', (r) => r.load.blockingMs),
  metric('zoom avg frame (ms)', frame('zoom', 'avg'), 1),
  metric('zoom p95 frame (ms)', frame('zoom', 'p95'), 1),
  metric('zoom max frame (ms)', frame('zoom', 'max'), 1),
  metric('zoom frames >33ms', frame('zoom', 'over33')),
  metric('pan avg frame (ms)', frame('pan', 'avg'), 1),
  metric('pan p95 frame (ms)', frame('pan', 'p95'), 1),
  metric('rotate avg frame (ms)', frame('rotate', 'avg'), 1),
  metric('rotate p95 frame (ms)', frame('rotate', 'p95'), 1),
  metric('hover latency (ms)', (r) => r.input.hoverMedian, 1),
  metric('click->popup (ms)', (r) => r.input.clickPopupMedian, 1),
  metric('search keystroke (ms)', (r) => r.input.searchMedian, 1),
];
console.log(`| metric | ${labels.map((l) => `${l} (n=${groups.get(l).length})`).join(' | ')} |`);
console.log(`|---|${labels.map(() => '---').join('|')}|`);
for (const row of rows) {
  const cells = labels.map((l) => median(groups.get(l).map(row.pick)).toFixed(row.digits));
  console.log(`| ${row.name} | ${cells.join(' | ')} |`);
}
