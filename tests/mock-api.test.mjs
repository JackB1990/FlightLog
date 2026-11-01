// Run with: node --test tests/mock-api.test.mjs
// Test fixture only: the in-memory API the UI tests run against (it is not part of the app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const core = require(join(root, 'shared/core.js'));

function sandbox() {
  const store = new Map();
  const window = {
    FLCore: core,
    FL_AIRPORTS: JSON.parse(readFileSync(join(root, 'server/data/airports-fallback.json'), 'utf8')),
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
  };
  const ctx = vm.createContext({
    window, console, URL, URLSearchParams, JSON, Date, Math, Number, String, Array, Set, Map, Object, Error, Promise,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    crypto: window.crypto,
  });
  vm.runInContext(readFileSync(join(root, 'tests/support/mock-api.js'), 'utf8'), ctx);
  const call = async (method, path, body) => {
    const res = await window.FL_TEST_API.handle(path, { method, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, ok: res.ok, data: await res.json() };
  };
  return { call, window };
}

test('demo ships seeded data across several years', async () => {
  const { call } = sandbox();
  const { data } = await call('GET', 'api/flights');
  assert.equal(data.flights.length, 19);
  assert.ok(data.flights[0].date >= data.flights[1].date, 'newest first');
  const years = new Set(data.flights.map((f) => f.date.slice(0, 4)));
  assert.deepEqual([...years].sort(), ['2023', '2024', '2025', '2026']);
  assert.ok(data.flights.every((f) => f.distance_km > 0));
});

test('demo stats are sane', async () => {
  const { call } = sandbox();
  const s = (await call('GET', 'api/stats')).data;
  assert.equal(s.total_flights, 19);
  assert.equal(s.home_country, 'United Kingdom');
  assert.equal(s.longest_streak, 4);
  assert.ok(s.by_companion.find((c) => c.label === 'Alex').flights >= 8);
  assert.equal(s.by_punctuality.find((r) => r.label === 'Delayed').flights, 4);
  assert.ok(s.by_departure_home_country_airport.length > 0);
  assert.ok(s.by_arrival_international_airport.length > 0);
});

test('demo CRUD, validation, import/export, reset', async () => {
  const { call, window } = sandbox();
  const created = await call('POST', 'api/flights', { date: '2026-10-01', airline: 'Loganair', from_iata: 'EDI', to_iata: 'INV' });
  assert.equal(created.status, 201);
  assert.equal((await call('GET', 'api/flights')).data.flights.length, 20);
  assert.equal((await call('POST', 'api/flights', { date: '2026-10-01' })).status, 400);
  assert.equal((await call('POST', 'api/flights', { date: '2026-10-01', airline: 'X', from_iata: 'EDI', to_iata: 'QQQ' })).status, 400);
  assert.equal((await call('DELETE', 'api/flights/' + created.data.id)).status, 204);

  const exp = (await call('GET', 'api/export')).data;
  const imp = await call('POST', 'api/import?mode=replace', exp);
  assert.equal(imp.data.imported, 19);
  assert.equal(imp.data.skipped.length, 0);

  assert.equal((await call('GET', 'api/airports?q=humberside')).data.airports[0].iata, 'HUY');
  assert.equal((await call('POST', 'api/airports', { iata: 'abc', name: 'Test', lat: 1, lon: 2 })).status, 201);

  await call('DELETE', 'api/companions/demo-companion-alex');
  const after = (await call('GET', 'api/flights')).data.flights;
  assert.ok(after.every((f) => f.companions.every((c) => c.name !== 'Alex')));

  window.FL_TEST_API.reset();
  assert.equal((await call('GET', 'api/flights')).data.flights.length, 19);
});

test('demo trips: seed contains trips, trip API validates and round-trips', async () => {
  const { call } = sandbox();
  const flights = (await call('GET', '/api/flights')).data.flights;
  assert.equal(new Set(flights.filter((f) => f.trip_id).map((f) => f.trip_id)).size, 8);
  assert.equal(flights.filter((f) => !f.trip_id).length, 1);
  const leg = (from, to, direction, extra) => ({ from_iata: from, to_iata: to, direction, date: '2026-10-01', airline: 'KLM', ...extra });
  assert.equal((await call('POST', '/api/trips', { type: 'return', legs: [leg('HUY', 'AMS', 'outbound')] })).status, 400);
  const made = await call('POST', '/api/trips', { type: 'return', legs: [leg('HUY', 'AMS', 'outbound'), leg('AMS', 'HUY', 'return')] });
  assert.equal(made.status, 201);
  const trip = (await call('GET', '/api/trips/' + made.data.id)).data;
  assert.equal(trip.type, 'return');
  assert.equal(trip.legs.length, 2);
  const upd = await call('PUT', '/api/trips/' + made.data.id, { type: 'oneway', legs: [{ ...trip.legs[0], direction: 'outbound' }] });
  assert.equal(upd.status, 200);
  const solo = (await call('GET', '/api/trips/' + upd.data.id)).data;
  assert.equal(solo.trip_id, null);
  assert.equal(solo.legs.length, 1);
  assert.equal((await call('DELETE', '/api/trips/' + upd.data.id)).status, 204);
  assert.equal((await call('GET', '/api/trips/' + upd.data.id)).status, 404);
});
