'use strict';
const test = require('node:test');
const assert = require('node:assert');
const b = require('./ball');

test('snapPosition snaps to the nearest side and stays on screen', () => {
  const wa = { x: 0, y: 0, width: 1366, height: 728 };
  assert.strictEqual(b.snapPosition(900, 300, wa).side, 'right');
  assert.strictEqual(b.snapPosition(100, 9999, wa).side, 'left');
  const r = b.snapPosition(100, 9999, wa); assert.ok(r.y + b.SIZE <= wa.height);
});
test('expandBounds keeps the panel inside the work area', () => {
  const wa = { x: 0, y: 0, width: 1366, height: 728 };
  const e = b.expandBounds(1290, 600, wa);
  assert.ok(e.x >= 0 && e.x + e.width <= 1366 && e.y + e.height <= 728);
});
test('classifyDrop: link vs text vs nothing', () => {
  assert.strictEqual(b.classifyDrop('https://a.com/x').kind, 'url');
  assert.strictEqual(b.classifyDrop('hello').kind, 'text');
  assert.strictEqual(b.classifyDrop('  \n#c'), null);
});
test('insight: healthy PC scores high, loaded PC scores low', () => {
  const calm = b.insight({ cpu: Array(20).fill(5), ram: Array(20).fill(40) }, { cpu: 5, ram: 40, disk: 50, batt: null });
  assert.ok(calm.score >= 90 && calm.tone === 'ok');
  const hot = b.insight({ cpu: Array(20).fill(95), ram: Array(20).fill(95) }, { cpu: 95, ram: 95, disk: 96, batt: null });
  assert.ok(hot.score < 40 && hot.tone === 'bad');
});
test('insight: rising memory predicts when it will be full', () => {
  const ram = Array.from({ length: 20 }, (_, i) => 50 + i);
  const r = b.insight({ cpu: Array(20).fill(10), ram }, { cpu: 10, ram: 69, disk: 40, batt: null });
  assert.match(r.note, /rising .*full in about \d+ min/);
});
test('chips only appear when they make sense', () => {
  assert.deepStrictEqual(b.chips({ cpu: 5, ram: 40, disk: 40 }, null), []);
  const c = b.chips({ cpu: 5, ram: 85, disk: 93 }, { kind: 'text' }).map((x) => x.id);
  assert.deepStrictEqual(c, ['clip', 'scan', 'dl']);
});
test('parseTasklist groups programs and sorts by memory', () => {
  const csv = '"chrome.exe","1","Console","1","123,456 K"\r\n"chrome.exe","2","Console","1","100,000 K"\r\n"code.exe","3","Console","1","50,000 K"\r\n"System Idle Process","0","Services","0","8 K"\r\n';
  const r = b.parseTasklist(csv);
  assert.strictEqual(r[0].name, 'chrome'); assert.strictEqual(r[1].name, 'code'); assert.strictEqual(r.length, 2);
});
test('no common media/volume buttons are runnable from the ball', () => {
  assert.deepStrictEqual(Object.keys(b.TILE_ACTIONS), ['dl']);
});
