import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const core = require(join(root, 'shared/core.js'));

function load() {
  const ctx = { window: {}, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'frontend/stats.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(root, 'frontend/world.js'), 'utf8'), ctx);
  return ctx;
}

const LHR = { iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'United Kingdom', lat: 51.47, lon: -0.45, tz: 'Europe/London' };
const MAN = { iata: 'MAN', name: 'Manchester', city: 'Manchester', country: 'United Kingdom', lat: 53.35, lon: -2.27, tz: 'Europe/London' };
const BCN = { iata: 'BCN', name: 'Barcelona-El Prat', city: 'Barcelona', country: 'Spain', lat: 41.3, lon: 2.08, tz: 'Europe/Madrid' };
const fl = (o) => ({ id: o.id, date: o.date, airline: 'Ryanair', flight_number: 'FR1', aircraft_type: 'Boeing 737-800', seat_class: 'Economy', distance_km: 1000,
  departure_time: '09:00', arrival_time: '12:30', actual_departure_time: null, actual_arrival_time: null, delay_reason: null, aircraft_registration: null, price: null,
  trip_id: null, direction: 'outbound', leg_order: 0, from_airport: MAN, to_airport: BCN, companions: [], ...o });

test('statistics: shapes flights into per-flight and per-trip rows', () => {
  const { FLStats } = load();
  const api = [
    fl({ id: 'a', date: '2026-05-01', trip_id: 't1', price: 120, aircraft_registration: 'EI-ABC', companions: [{ id: 'c1', name: 'Sam' }] }),
    fl({ id: 'b', date: '2026-05-08', trip_id: 't1', direction: 'return', from_airport: BCN, to_airport: MAN }),
    fl({ id: 'c', date: '2025-01-02', from_airport: LHR, to_airport: BCN, seat_class: 'Business' }),
  ];
  const { rows, trips } = FLStats.shape(api, core);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, '2025-01-02');
  assert.equal(rows[0].trip_id, '');
  assert.equal(rows[0].from_name, core.airportName(LHR));
  const first = rows.find((r) => r.id === 'a');
  assert.equal(first.price, 120);
  assert.equal(first.registration, 'EI-ABC');
  assert.equal(first.companions, 'Sam');
  assert.ok(first.air_min > 60 && first.air_min < 240);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].type, 'return');
  assert.equal(trips[0].days_away, 7);
  assert.equal(trips[0].price, 120);
  assert.equal(trips[0].connections, 0);
});

test('statistics: page markup is wired up and the old statistics page is gone', () => {
  const html = readFileSync(join(root, 'frontend/index.html'), 'utf8');
  assert.ok(html.includes('<script src="world.js"></script>') && html.includes('<script src="stats.js"></script>'));
  const page = html.slice(html.indexOf("x-if=\"route==='stats'\""), html.indexOf("x-if=\"route==='add'\""));
  assert.ok(page.includes('x-ref="statsRoot"'));
  assert.ok(!page.includes('metric-toggle') && !page.includes('donut'));
});

test('statistics: map knows the common country names and every id has a shape', () => {
  const ctx = load();
  const shapes = new Set(ctx.FL_WORLD.map((c) => c.i));
  for (const [name, id] of Object.entries(ctx.FL_COUNTRY_IDS)) assert.ok(shapes.has(id), name);
  for (const n of ['United Kingdom', 'United States', 'Spain', 'Canada', 'Turkey']) assert.ok(ctx.FL_COUNTRY_IDS[n], n);
});
