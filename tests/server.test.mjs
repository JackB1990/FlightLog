// Run with: node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let dataDir;

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'fv-test-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  await waitUp();
});
after(() => { proc.kill(); rmSync(dataDir, { recursive: true, force: true }); });

test('airport search finds by code and name', async () => {
  const a = await call('GET', '/api/airports?q=LHR');
  assert.equal(a.data.airports[0].iata, 'LHR');
  const b = await call('GET', '/api/airports?q=humberside');
  assert.equal(b.data.airports[0].iata, 'HUY');
});

test('flight CRUD, distance and companions', async () => {
  const c = await call('POST', '/api/companions', { name: 'Alex', relationship: 'Partner' });
  assert.equal(c.status, 201);
  const created = await call('POST', '/api/flights', {
    date: '2026-03-01', airline: 'British Airways', flight_number: 'BA117', aircraft_type: 'Boeing 777-300ER',
    seat_class: 'Business', seat_number: '12A', from_iata: 'lhr', to_iata: 'JFK',
    departure_time: '10:30', arrival_time: '13:10', delay_reason: 'Weather', companion_ids: [c.data.id],
  });
  assert.equal(created.status, 201);
  const list = await call('GET', '/api/flights');
  assert.equal(list.data.flights.length, 1);
  const f = list.data.flights[0];
  assert.equal(f.from_airport.iata, 'LHR');
  assert.ok(f.distance_km > 5500 && f.distance_km < 5600, `distance ${f.distance_km}`);
  assert.deepEqual(f.companions.map((x) => x.name), ['Alex']);

  const one = await call('GET', '/api/flights/' + created.data.id);
  assert.deepEqual(one.data.companion_ids, [c.data.id]);

  const upd = await call('PUT', '/api/flights/' + created.data.id, { ...one.data, to_iata: 'BOS', companion_ids: [] });
  assert.equal(upd.status, 200);
  const after = (await call('GET', '/api/flights')).data.flights[0];
  assert.equal(after.to_airport.iata, 'BOS');
  assert.equal(after.companions.length, 0);
});

test('aircraft registration and price are stored and validated', async () => {
  const body = { date: '2026-04-01', airline: 'Jet2', from_iata: 'LBA', to_iata: 'PMI', aircraft_registration: 'g-drtb', price: '£249.999' };
  const r = await call('POST', '/api/flights', body);
  assert.equal(r.status, 201);
  const f = (await call('GET', '/api/flights/' + r.data.id)).data;
  assert.equal(f.aircraft_registration, 'G-DRTB');
  assert.equal(f.price, 250);
  const blank = await call('POST', '/api/flights', { ...body, price: '', aircraft_registration: '' });
  assert.equal((await call('GET', '/api/flights/' + blank.data.id)).data.price, null);
  assert.equal((await call('POST', '/api/flights', { ...body, price: 'lots-1' })).status, 400);
  await call('DELETE', '/api/flights/' + r.data.id);
  await call('DELETE', '/api/flights/' + blank.data.id);
});

test('validation errors', async () => {
  assert.equal((await call('POST', '/api/flights', { date: '2026-01-01' })).status, 400);
  assert.equal((await call('POST', '/api/flights', { date: 'nope', airline: 'X', from_iata: 'LHR', to_iata: 'JFK' })).status, 400);
  assert.equal((await call('POST', '/api/flights', { date: '2026-01-01', airline: 'X', from_iata: 'LHR', to_iata: 'ZZZ' })).status, 400);
  assert.equal((await call('GET', '/api/flights/does-not-exist')).status, 404);
});

test('stats, settings, countries', async () => {
  await call('POST', '/api/flights', { date: '2025-07-04', airline: 'easyJet', from_iata: 'MAN', to_iata: 'PMI', seat_class: 'Economy' });
  await call('PUT', '/api/account/settings', { home_country: 'United Kingdom', distance_unit: 'mi' });
  const s = (await call('GET', '/api/stats')).data;
  assert.equal(s.total_flights, 2);
  assert.equal(s.unique_airports, 4);
  assert.equal(s.home_country, 'United Kingdom');
  assert.equal(s.by_trip_type.find((r) => r.label === 'International').flights, 2);
  assert.equal(s.by_punctuality.find((r) => r.label === 'Delayed').flights, 1);
  assert.equal(s.by_year.length, 2);
  assert.ok(s.by_manufacturer.some((r) => r.label === 'Boeing'));
  const settings = (await call('GET', '/api/account/settings')).data;
  assert.equal(settings.distance_unit, 'mi');
  const countries = (await call('GET', '/api/countries')).data.countries;
  assert.ok(countries.find((c) => c.name === 'United Kingdom'));
});

test('add a custom airport', async () => {
  const bad = await call('POST', '/api/airports', { iata: 'XYZ', name: 'Nowhere' });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/airports', { iata: 'xyz', name: 'Test Strip', city: 'Testville', country: 'Testland', lat: 10.5, lon: -20.25 });
  assert.equal(ok.status, 201);
  assert.equal((await call('GET', '/api/airports?q=XYZ')).data.airports[0].name, 'Test Strip');
});

test('export then import round-trips (replace mode)', async () => {
  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.flights.length, 2);
  const res = await fetch(BASE + '/api/import?mode=replace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exp) });
  const out = await res.json();
  assert.equal(out.imported, 2);
  assert.equal(out.skipped.length, 0);
  assert.equal((await call('GET', '/api/flights')).data.flights.length, 2);
  const bad = await call('POST', '/api/import', { nope: true });
  assert.equal(bad.status, 400);
});

test('delete flight and companion', async () => {
  const flights = (await call('GET', '/api/flights')).data.flights;
  assert.equal((await call('DELETE', '/api/flights/' + flights[0].id)).status, 204);
  assert.equal((await call('GET', '/api/flights')).data.flights.length, 1);
  const comps = (await call('GET', '/api/companions')).data.companions;
  assert.equal((await call('DELETE', '/api/companions/' + comps[0].id)).status, 204);
});

test('static files, traversal blocked', async () => {
  const res = await fetch(BASE + '/../server/index.js');
  assert.ok([403, 404].includes(res.status));
  const raw = await fetch(BASE + '/%2e%2e/server/index.js');
  assert.ok([403, 404].includes(raw.status));
});

test('trips: one-way flight stays standalone, connections and returns become trips', async () => {
  const leg = (from, to, extra) => ({ from_iata: from, to_iata: to, date: '2025-03-01', airline: 'British Airways', ...extra });

  // single one-way flight -> standalone, no trip_id
  let r = await call('POST', '/api/trips', { type: 'oneway', legs: [leg('LHR', 'AMS', { direction: 'outbound' })] });
  assert.equal(r.status, 201);
  const soloId = r.data.id;
  let list = (await call('GET', '/api/flights')).data.flights;
  const solo = list.find((f) => f.id === soloId);
  assert.equal(solo.trip_id, null);
  assert.equal((await call('GET', '/api/trips/' + soloId)).data.type, 'oneway');

  // return trip with a connection each way
  r = await call('POST', '/api/trips', {
    type: 'return', companion_ids: [],
    legs: [
      leg('HUY', 'AMS', { direction: 'outbound', flight_number: 'KL1' }),
      leg('AMS', 'JFK', { direction: 'outbound', flight_number: 'KL2' }),
      leg('JFK', 'AMS', { direction: 'return', date: '2025-03-10', flight_number: 'KL3' }),
      leg('AMS', 'HUY', { direction: 'return', date: '2025-03-11', flight_number: 'KL4' }),
    ],
  });
  assert.equal(r.status, 201);
  const tripId = r.data.id;
  let trip = (await call('GET', '/api/trips/' + tripId)).data;
  assert.equal(trip.type, 'return');
  assert.deepEqual(trip.legs.map((l) => l.flight_number), ['KL1', 'KL2', 'KL3', 'KL4']);
  assert.deepEqual(trip.legs.map((l) => l.direction), ['outbound', 'outbound', 'return', 'return']);
  assert.ok(trip.legs.every((l) => l.trip_id === tripId));
  list = (await call('GET', '/api/flights')).data.flights;
  assert.equal(list.filter((f) => f.trip_id === tripId).length, 4);

  // edit: drop a leg, change another, keep ids
  const keepIds = trip.legs.map((l) => l.id);
  r = await call('PUT', '/api/trips/' + tripId, {
    type: 'return',
    legs: [
      { ...trip.legs[0], direction: 'outbound', flight_number: 'KL1X' },
      { ...trip.legs[2], direction: 'return' },
    ],
  });
  assert.equal(r.status, 200);
  trip = (await call('GET', '/api/trips/' + tripId)).data;
  assert.equal(trip.legs.length, 2);
  assert.deepEqual(trip.legs.map((l) => l.flight_number), ['KL1X', 'KL3']);
  assert.equal(trip.legs[0].id, keepIds[0], 'existing flight rows are updated in place');
  assert.equal((await call('GET', '/api/flights/' + keepIds[1])).status, 404, 'removed leg is deleted');

  // validation
  assert.equal((await call('POST', '/api/trips', { type: 'return', legs: [leg('LHR', 'JFK', { direction: 'outbound' })] })).status, 400);
  assert.equal((await call('POST', '/api/trips', { type: 'oneway', legs: [] })).status, 400);
  assert.equal((await call('POST', '/api/trips', { type: 'oneway', legs: [leg('LHR', 'ZZZ', {})] })).status, 400);
  assert.equal((await call('GET', '/api/trips/nope')).status, 404);

  // standalone flight converted to a trip by adding a return leg
  r = await call('PUT', '/api/trips/' + soloId, {
    type: 'return',
    legs: [{ ...solo, direction: 'outbound', from_iata: 'LHR', to_iata: 'AMS' }, leg('AMS', 'LHR', { direction: 'return', date: '2025-03-05' })],
  });
  const newKey = r.data.id;
  assert.notEqual(newKey, soloId);
  trip = (await call('GET', '/api/trips/' + newKey)).data;
  assert.equal(trip.legs.length, 2);
  assert.ok(trip.legs.some((l) => l.id === soloId));

  // export / import keeps the trip structure
  const exp = (await call('GET', '/api/export')).data;
  const exported = exp.flights.filter((f) => f.trip_id === newKey);
  assert.equal(exported.length, 2);
  assert.deepEqual(exported.map((f) => f.direction).sort(), ['outbound', 'return']);

  // deleting the trip removes every leg
  assert.equal((await call('DELETE', '/api/trips/' + newKey)).status, 204);
  assert.equal((await call('GET', '/api/trips/' + newKey)).status, 404);
  assert.equal((await call('DELETE', '/api/trips/' + tripId)).status, 204);
  list = (await call('GET', '/api/flights')).data.flights;
  assert.ok(!list.some((f) => f.trip_id === tripId || f.trip_id === newKey));
});

test('an existing database from before trips is migrated in place', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'fl-old-'));
  const db = new DatabaseSync(join(dir, 'flightlog.db'));
  db.exec(`
    CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT NOT NULL, city TEXT, country TEXT, lat REAL NOT NULL, lon REAL NOT NULL);
    INSERT INTO airports VALUES ('LHR','EGLL','Heathrow','London','United Kingdom',51.47,-0.45),('JFK','KJFK','JFK','New York','United States',40.64,-73.78);
    CREATE TABLE flights (id TEXT PRIMARY KEY, date TEXT NOT NULL, airline TEXT NOT NULL, flight_number TEXT, aircraft_type TEXT, seat_class TEXT, seat_number TEXT,
      from_iata TEXT NOT NULL, to_iata TEXT NOT NULL, distance_km REAL, departure_time TEXT, arrival_time TEXT, actual_departure_time TEXT, actual_arrival_time TEXT,
      delay_reason TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    INSERT INTO flights (id, date, airline, from_iata, to_iata, distance_km) VALUES ('old1','2020-01-01','BA','LHR','JFK',5540);
  `);
  db.close();
  const port = PORT + 100;
  const p2 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server/index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up);
    const res = await (await fetch(`http://127.0.0.1:${port}/api/flights`)).json();
    assert.equal(res.flights.length, 1);
    assert.equal(res.flights[0].trip_id, null);
    assert.equal(res.flights[0].direction, 'outbound');
    assert.equal(res.flights[0].price, null, 'old databases gain the price and registration columns');
    assert.equal(res.flights[0].aircraft_registration, null);
  } finally {
    p2.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('airports carry IANA time zones; manual airports validate theirs', async () => {
  const lhr = (await call('GET', '/api/airports?q=LHR')).data.airports.find((a) => a.iata === 'LHR');
  assert.equal(lhr.tz, 'Europe/London');
  assert.equal((await call('POST', '/api/airports', { iata: 'ZZA', name: 'Test A', lat: 1, lon: 2, tz: 'Mars/Olympus' })).status, 400);
  assert.equal((await call('POST', '/api/airports', { iata: 'ZZB', name: 'Test B', lat: 51.5, lon: -0.1, tz: 'Europe/London' })).status, 201);
  const list = (await call('POST', '/api/trips', { type: 'oneway', legs: [{ direction: 'outbound', from_iata: 'ZZB', to_iata: 'AMS', date: '2025-05-01', airline: 'KLM' }] }));
  assert.equal(list.status, 201);
  const f = (await call('GET', '/api/flights')).data.flights.find((x) => x.id === list.data.id);
  assert.equal(f.from_airport.tz, 'Europe/London');
  assert.equal(f.to_airport.tz, 'Europe/Amsterdam');
  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.airports.find((a) => a.iata === 'ZZB').tz, 'Europe/London');
});
