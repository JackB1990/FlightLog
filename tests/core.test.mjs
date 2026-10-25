// Run with: node --test tests/core.test.mjs
// Flight and trip duration maths across time zones (booked vs actual).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = createRequire(import.meta.url)(join(root, 'shared/core.js'));
const rows = JSON.parse(readFileSync(join(root, 'server/data/airports-fallback.json'), 'utf8'));
const ap = (iata) => {
  const r = rows.find((x) => x[0] === iata);
  return { iata: r[0], name: r[2], city: r[3], country: r[4], lat: r[5], lon: r[6], tz: r[7] };
};
const leg = (from, to, date, dep, arr, extra) => {
  const a = ap(from), b = ap(to);
  return { date, from_airport: a, to_airport: b, departure_time: dep, arrival_time: arr, actual_departure_time: null, actual_arrival_time: null, distance_km: core.haversineKm(a, b), ...(extra || {}) };
};

test('every bundled airport has a valid IANA time zone', () => {
  for (const r of rows) assert.ok(core.validTz(r[7]), `${r[0]} has tz ${r[7]}`);
});

test('booked duration crosses time zones and daylight saving correctly', () => {
  // LHR (BST, UTC+1) -> JFK (EDT, UTC-4): 08:25 -> 11:00 local is 7h35
  let t = core.legTimes(leg('LHR', 'JFK', '2024-10-12', '08:25', '11:00'));
  assert.equal(t.sched.minutes, 7 * 60 + 35);
  assert.equal(t.sched.dayOffset, 0);
  assert.equal(t.actual, null);
  assert.equal(t.estimated, false);
  // London winter (GMT) -> Dubai (UTC+4), lands after midnight: 14:10 -> 00:20(+1) is 6h10
  t = core.legTimes(leg('LHR', 'DXB', '2024-02-17', '14:10', '00:20'));
  assert.equal(t.sched.minutes, 6 * 60 + 10);
  assert.equal(t.sched.dayOffset, 1);
  // Sydney -> Los Angeles lands "earlier" on the same calendar day: 11:00 -> 06:25 is 14h25, no +1
  t = core.legTimes(leg('SYD', 'LAX', '2024-03-04', '11:00', '06:25'));
  assert.equal(t.sched.minutes, 14 * 60 + 25);
  assert.equal(t.sched.dayOffset, 0);
  // Long westbound flight: Dubai -> Sydney 10:30 -> 07:05(+1) is 13h35
  t = core.legTimes(leg('DXB', 'SYD', '2024-02-19', '10:30', '07:05'));
  assert.equal(t.sched.minutes, 13 * 60 + 35);
  assert.equal(t.sched.dayOffset, 1);
});

test('actual duration and delays use the recorded actual times', () => {
  const t = core.legTimes(leg('LHR', 'JFK', '2024-10-12', '08:25', '11:00', { actual_departure_time: '09:20', actual_arrival_time: '11:55' }));
  assert.equal(t.sched.minutes, 455);
  assert.equal(t.actual.minutes, 455);
  assert.equal(t.depDelay, 55);
  assert.equal(t.arrDelay, 55);
  // arrived faster than booked
  const quick = core.legTimes(leg('LHR', 'JFK', '2024-10-12', '08:25', '11:00', { actual_departure_time: '08:25', actual_arrival_time: '10:30' }));
  assert.equal(quick.actual.minutes, 425);
  assert.equal(quick.arrDelay, -30);
  // only the arrival was recorded: departure assumed on time
  const half = core.legTimes(leg('LHR', 'JFK', '2024-10-12', '08:25', '11:00', { actual_arrival_time: '11:40' }));
  assert.equal(half.actual.minutes, 455 + 40);
  assert.equal(half.depDelay, 0);
});

test('a delayed departure that slips past midnight lands on the right day', () => {
  const t = core.legTimes(leg('LHR', 'AMS', '2025-01-10', '23:30', '01:45', { actual_departure_time: '00:20', actual_arrival_time: '02:35' }));
  assert.equal(t.sched.minutes, 75);
  assert.equal(t.actual.minutes, 75);
  assert.equal(t.depDelay, 50);
  assert.equal(t.arrDelay, 50);
  assert.equal(t.actual.dayOffset, 1 + 0); // lands 11 Jan local time
});

test('missing time zones fall back to a longitude estimate and are flagged', () => {
  const l = leg('LHR', 'JFK', '2024-10-12', '08:25', '11:00');
  l.to_airport = { ...l.to_airport, tz: null };
  const t = core.legTimes(l);
  assert.equal(t.estimated, true);
  assert.ok(t.sched.minutes > 6 * 60 && t.sched.minutes < 9 * 60);
  assert.equal(core.estimateTz(-74), 'Etc/GMT+5');
  assert.equal(core.estimateTz(104), 'Etc/GMT-7');
  assert.equal(core.estimateTz(0.1), 'Etc/GMT');
  assert.equal(core.validTz('Not/AZone'), false);
});

test('journey and trip totals: connections, time in the air and time away', () => {
  const out = [leg('MAN', 'DXB', '2025-03-01', '09:00', '19:30'), leg('DXB', 'SIN', '2025-03-01', '22:00', '09:20')].map(core.legTimes);
  const back = [leg('SIN', 'LHR', '2025-03-10', '23:00', '05:30')].map(core.legTimes);
  const tt = core.tripTimes(out, back);
  const o = tt.outbound.scheduled;
  assert.equal(o.layovers.length, 1);
  assert.equal(o.layovers[0], 150); // land 19:30 Dubai, leave 22:00
  assert.equal(o.air + o.layover, o.elapsed);
  assert.equal(tt.outbound.actual, null);
  assert.equal(tt.scheduled.air, o.air + tt.return.scheduled.air);
  assert.ok(tt.scheduled.away > 9 * 24 * 60 && tt.scheduled.away < 10 * 24 * 60);
  // an actual delay on the first flight shortens the connection and is reflected in actual totals
  const late = [leg('MAN', 'DXB', '2025-03-01', '09:00', '19:30', { actual_departure_time: '10:00', actual_arrival_time: '20:30' }), leg('DXB', 'SIN', '2025-03-01', '22:00', '09:20')].map(core.legTimes);
  const t2 = core.journeyTimes(late);
  assert.equal(t2.actual.layovers[0], 90);
  assert.equal(t2.scheduled.layovers[0], 150);
});

test('durations format as hours and minutes', () => {
  assert.equal(core.fmtDuration(455), '7h 35m');
  assert.equal(core.fmtDuration(45), '45m');
  assert.equal(core.fmtDuration(120), '2h 00m');
  assert.equal(core.fmtDuration(-30), '−30m');
  assert.equal(core.fmtDuration(60 * 50 + 5), '2d 2h 05m');
  assert.equal(core.fmtDuration(null), '—');
});
