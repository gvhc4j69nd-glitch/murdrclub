'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { phaseEnd, nextLocalHour, localParts, isValidTimeZone } = require('../lib/schedule');

const daily = (timeZone) => ({ pace: 'daily', timeZone, fastMinutes: { day: 3, tribunal: 2, backroom: 1 } });

test('phases end at fixed Club Time hours', () => {
  const tz = 'America/New_York';
  const start = Date.UTC(2026, 10, 23, 13, 0); // 08:00 in New York (EST)
  const dayEnd = phaseEnd(daily(tz), 'day', start);
  assert.deepStrictEqual(localParts(dayEnd, tz), { y: 2026, mo: 11, d: 23, h: 18, mi: 0 });
  const tribEnd = phaseEnd(daily(tz), 'tribunal', dayEnd);
  assert.strictEqual(localParts(tribEnd, tz).h, 21);
  const nightEnd = phaseEnd(daily(tz), 'backroom', tribEnd);
  assert.deepStrictEqual(localParts(nightEnd, tz), { y: 2026, mo: 11, d: 24, h: 8, mi: 0 });
});

test('Club Time holds across a daylight-saving change', () => {
  const tz = 'Europe/London';
  // The night clocks go back (25 Oct 2026). 08:00 is still 08:00.
  const evening = Date.UTC(2026, 9, 24, 20, 0); // 21:00 BST
  const morning = nextLocalHour(evening, tz, 8);
  assert.deepStrictEqual(localParts(morning, tz), { y: 2026, mo: 10, d: 25, h: 8, mi: 0 });
  assert.strictEqual(morning, Date.UTC(2026, 9, 25, 8, 0)); // now GMT
});

test('the first day is never shorter than four hours', () => {
  const tz = 'UTC';
  const start = Date.UTC(2026, 10, 23, 16, 0); // 16:00, two hours before 18:00
  const end = phaseEnd(daily(tz), 'day', start, { firstDay: true });
  assert.strictEqual(end, Date.UTC(2026, 10, 24, 18, 0));
});

test('fast clubs count minutes', () => {
  const s = { pace: 'fast', timeZone: 'UTC', fastMinutes: { day: 3, tribunal: 2, backroom: 1 } };
  assert.strictEqual(phaseEnd(s, 'tribunal', 1000), 1000 + 2 * 60000);
});

test('time zone validation', () => {
  assert.ok(isValidTimeZone('Asia/Tokyo'));
  assert.ok(!isValidTimeZone('Mars/Olympus_Mons'));
  assert.ok(!isValidTimeZone(''));
});
