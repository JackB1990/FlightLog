// Run with: node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let dataDir;
let geoServer;
let geoCalls = 0;

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
let cookie = '';
const callAs = async (ck, method, path, body) => {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (ck) headers.Cookie = ck;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: text ? JSON.parse(text) : null, cookie: set ? set.split(';')[0] : null, setCookie: set };
};
const call = (method, path, body) => callAs(cookie, method, path, body);

before(async () => {
  // A stand-in for the address search service (Nominatim), so the tests never touch the internet.
  geoServer = createServer((req, res) => {
    geoCalls += 1;
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    res.setHeader('Content-Type', 'application/json');
    if (/boom/i.test(q)) { res.statusCode = 500; return res.end('{}'); }
    res.end(JSON.stringify(/linden/i.test(q) ? [
      { display_name: 'The Linden Row Hotel, 48, Linden Row, Manhattan, New York, 10014, United States', name: 'The Linden Row Hotel', lat: '40.7425', lon: '-74.0061', address: { house_number: '48', road: 'Linden Row', city: 'New York', postcode: '10014', country: 'United States' } },
      { display_name: 'Nowhere', lat: 'abc', lon: 'x' },
    ] : []));
  });
  await new Promise((r) => geoServer.listen(0, '127.0.0.1', r));
  dataDir = mkdtempSync(join(tmpdir(), 'fv-test-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, FL_GEOCODER_URL: `http://127.0.0.1:${geoServer.address().port}/search` },
    stdio: 'ignore',
  });
  await waitUp();
  const r = await callAs('', 'POST', '/api/auth/signup', { username: 'tester', password: 'correct-horse', distance_unit: 'mi', home_country: 'United Kingdom' });
  assert.equal(r.status, 201);
  cookie = r.cookie;
});
after(() => { proc.kill(); geoServer.close(); rmSync(dataDir, { recursive: true, force: true }); });

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
  const res = await fetch(BASE + '/api/import?mode=replace', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(exp) });
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

let oldPort = 0;
async function oldDatabase(env, fn) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'fl-old-'));
  const db = new DatabaseSync(join(dir, 'flightlog.db'));
  db.exec(`
    CREATE TABLE airports (iata TEXT PRIMARY KEY, icao TEXT, name TEXT NOT NULL, city TEXT, country TEXT, lat REAL NOT NULL, lon REAL NOT NULL);
    INSERT INTO airports VALUES ('LHR','EGLL','Heathrow','London','United Kingdom',51.47,-0.45),('JFK','KJFK','JFK','New York','United States',40.64,-73.78);
    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), distance_unit TEXT NOT NULL DEFAULT 'km', home_country TEXT);
    INSERT INTO settings VALUES (1, 'mi', 'United Kingdom');
    CREATE TABLE flights (id TEXT PRIMARY KEY, date TEXT NOT NULL, airline TEXT NOT NULL, flight_number TEXT, aircraft_type TEXT, seat_class TEXT, seat_number TEXT,
      from_iata TEXT NOT NULL, to_iata TEXT NOT NULL, distance_km REAL, departure_time TEXT, arrival_time TEXT, actual_departure_time TEXT, actual_arrival_time TEXT,
      delay_reason TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    INSERT INTO flights (id, date, airline, from_iata, to_iata, distance_km) VALUES ('old1','2020-01-01','BA','LHR','JFK',5540);
  `);
  db.close();
  const port = 4200 + Math.floor(Math.random() * 3000);
  const p2 = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server/index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up);
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    p2.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}
const post = (base, path, body, ck) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: JSON.stringify(body) });

test('upgrade: an old database is migrated, and the old FL_USER / FL_PASSWORD login works on the login page', async () => {
  await oldDatabase({ FL_USER: 'jack', FL_PASSWORD: 's3cret-pass' }, async (base) => {
    assert.equal((await fetch(base + '/api/flights')).status, 401);
    assert.equal((await post(base, '/api/auth/login', { username: 'jack', password: 'wrong' })).status, 401);
    const login = await post(base, '/api/auth/login', { username: 'jack', password: 's3cret-pass' });
    assert.equal(login.status, 200);
    const ck = login.headers.get('set-cookie').split(';')[0];
    const res = await (await fetch(base + '/api/flights', { headers: { Cookie: ck } })).json();
    assert.equal(res.flights.length, 1);
    assert.equal(res.flights[0].trip_id, null);
    assert.equal(res.flights[0].direction, 'outbound');
    assert.equal(res.flights[0].price, null, 'old databases gain the price and registration columns');
    assert.equal(res.flights[0].aircraft_registration, null);
    const settings = await (await fetch(base + '/api/account/settings', { headers: { Cookie: ck } })).json();
    assert.equal(settings.distance_unit, 'mi');
    assert.equal(settings.home_country, 'United Kingdom');
    // HTTP Basic still works for scripts
    const basic = 'Basic ' + Buffer.from('jack:s3cret-pass').toString('base64');
    assert.equal((await fetch(base + '/api/flights', { headers: { Authorization: basic } })).status, 200);
  });
});

test('upgrade without a password: the first account created adopts the existing flights', async () => {
  await oldDatabase({}, async (base) => {
    const st = await (await fetch(base + '/api/auth/status')).json();
    assert.equal(st.hasUsers, false);
    assert.equal(st.legacyData, true);
    const su = await post(base, '/api/auth/signup', { username: 'owner', password: 'owner-pass-1', distance_unit: 'km', home_country: 'United Kingdom' });
    assert.equal(su.status, 201);
    const ck = su.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(base + '/api/flights', { headers: { Cookie: ck } })).json()).flights.length, 1);
    const second = await post(base, '/api/auth/signup', { username: 'visitor', password: 'visitor-pass', distance_unit: 'km', home_country: 'France' });
    const ck2 = second.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(base + '/api/flights', { headers: { Cookie: ck2 } })).json()).flights.length, 0);
  });
});

test('FL_SIGNUPS=off blocks new accounts once one exists', async () => {
  await oldDatabase({ FL_SIGNUPS: 'off' }, async (base) => {
    assert.equal((await post(base, '/api/auth/signup', { username: 'first', password: 'first-pass-1', distance_unit: 'km', home_country: 'France' })).status, 201);
    assert.equal((await post(base, '/api/auth/signup', { username: 'second', password: 'second-pass', distance_unit: 'km', home_country: 'France' })).status, 403);
    assert.equal((await (await fetch(base + '/api/auth/status')).json()).signups, false);
  });
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

test('API needs a signed-in session; the login page itself is public', async () => {
  assert.equal((await callAs('', 'GET', '/api/flights')).status, 401);
  assert.equal((await fetch(BASE + '/')).status, 200);
  const st = await callAs('', 'GET', '/api/auth/status');
  assert.equal(st.data.authenticated, false);
  assert.equal(st.data.signups, true);
  assert.equal((await call('GET', '/api/auth/status')).data.user.username, 'tester');
});

test('login: wrong password refused, right password works, logout ends the session', async () => {
  assert.equal((await callAs('', 'POST', '/api/auth/login', { username: 'tester', password: 'nope-nope' })).status, 401);
  const ok = await callAs('', 'POST', '/api/auth/login', { username: 'TESTER', password: 'correct-horse' });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Lax/);
  assert.equal((await callAs(ok.cookie, 'GET', '/api/flights')).status, 200);
  await callAs(ok.cookie, 'POST', '/api/auth/logout', {});
  assert.equal((await callAs(ok.cookie, 'GET', '/api/flights')).status, 401);
});

test('signup validates input and asks for home country and distance unit', async () => {
  const base = { username: 'newbie', password: 'longenough1', distance_unit: 'km', home_country: 'France' };
  assert.equal((await callAs('', 'POST', '/api/auth/signup', { ...base, password: 'short' })).status, 400);
  assert.equal((await callAs('', 'POST', '/api/auth/signup', { ...base, distance_unit: 'parsecs' })).status, 400);
  assert.equal((await callAs('', 'POST', '/api/auth/signup', { ...base, home_country: '' })).status, 400);
  assert.equal((await callAs('', 'POST', '/api/auth/signup', { ...base, username: 'a b' })).status, 400);
  assert.equal((await callAs('', 'POST', '/api/auth/signup', { ...base, username: 'Tester' })).status, 409);
});

test('each account only sees its own flights, companions and settings', async () => {
  const other = await callAs('', 'POST', '/api/auth/signup', { username: 'second', password: 'another-pass', distance_unit: 'km', home_country: 'France' });
  assert.equal(other.status, 201);
  const mine = (await call('GET', '/api/flights')).data.flights.length;
  assert.ok(mine > 0);
  assert.equal((await callAs(other.cookie, 'GET', '/api/flights')).data.flights.length, 0);
  assert.equal((await callAs(other.cookie, 'GET', '/api/companions')).data.companions.length, 0);
  assert.equal((await callAs(other.cookie, 'GET', '/api/account/settings')).data.home_country, 'France');
  assert.equal((await call('GET', '/api/account/settings')).data.distance_unit, 'mi');
  const f = (await call('GET', '/api/flights')).data.flights[0];
  assert.equal((await callAs(other.cookie, 'GET', '/api/flights/' + f.id)).status, 404);
  assert.equal((await callAs(other.cookie, 'DELETE', '/api/flights/' + f.id)).status, 404);
  assert.equal((await call('GET', '/api/flights')).data.flights.length, mine);
  // an import with the same ids must not touch (or take over) the other account's rows
  const exp = (await call('GET', '/api/export')).data;
  const imp = await callAs(other.cookie, 'POST', '/api/import', exp);
  assert.equal(imp.status, 200);
  assert.equal(imp.data.imported, exp.flights.length);
  assert.equal((await call('GET', '/api/flights')).data.flights.length, mine);
  assert.equal((await callAs(other.cookie, 'GET', '/api/flights')).data.flights.length, exp.flights.length);
});

test('request bodies must be JSON', async () => {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"username":"tester","password":"correct-horse"}' });
  assert.equal(res.status, 415);
});

test('stays: CRUD, validation, per-account privacy and export/import', async () => {
  const bad = await call('POST', '/api/stays', { name: 'X', check_in: '2026-05-05', check_out: '2026-05-05' });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/stays', { name: 'No dates' })).status, 400);
  assert.equal((await call('POST', '/api/stays', { name: 'Bad rating', check_in: '2026-05-01', check_out: '2026-05-02', rating: 11 })).status, 400);

  const made = await call('POST', '/api/stays', {
    name: 'Hotel Test', city: 'Lisbon', country: 'Portugal', stay_type: 'Hotel', stars: 4, rating: 8.64,
    check_in: '2026-05-01', check_out: '2026-05-04', room_type: 'Double', guests: 2, rooms: 1, price: '312.50', notes: 'Nice',
  });
  assert.equal(made.status, 201);
  const id = made.data.id;
  await call('POST', '/api/stays', { name: 'Older', check_in: '2025-01-01', check_out: '2025-01-02' });

  const list = await call('GET', '/api/stays');
  assert.equal(list.data.stays.length, 2);
  assert.equal(list.data.stays[0].name, 'Hotel Test', 'newest check-in first');
  assert.equal(list.data.stays[0].rating, 8.6);
  assert.equal(list.data.stays[0].price, 312.5);
  assert.equal(list.data.stays[1].stay_type, 'Hotel', 'type defaults to Hotel');

  assert.equal((await call('PUT', '/api/stays/' + id, { name: 'Hotel Test 2', check_in: '2026-05-01', check_out: '2026-05-05' })).status, 200);
  assert.equal((await call('GET', '/api/stays/' + id)).data.name, 'Hotel Test 2');

  // another account cannot see, change or delete it
  const other = await callAs('', 'POST', '/api/auth/signup', { username: 'someone-else', password: 'another-pass-1', distance_unit: 'km', home_country: 'France' });
  assert.equal(other.status, 201);
  assert.equal((await callAs(other.cookie, 'GET', '/api/stays')).data.stays.length, 0);
  assert.equal((await callAs(other.cookie, 'GET', '/api/stays/' + id)).status, 404);
  assert.equal((await callAs(other.cookie, 'DELETE', '/api/stays/' + id)).status, 404);

  // export carries stays; importing into the other account gives it its own copies
  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.stays.length, 2);
  const imp = await callAs(other.cookie, 'POST', '/api/import?mode=merge', exp);
  assert.equal(imp.status, 200);
  assert.equal(imp.data.imported_stays, 2);
  const theirs = (await callAs(other.cookie, 'GET', '/api/stays')).data.stays;
  assert.equal(theirs.length, 2);
  assert.ok(theirs.every((s) => s.id !== id), 'imported rows get fresh ids when the id belongs to someone else');
  assert.equal((await call('GET', '/api/stays')).data.stays.length, 2, 'original account untouched');

  assert.equal((await call('DELETE', '/api/stays/' + id)).status, 204);
  assert.equal((await call('GET', '/api/stays')).data.stays.length, 1);
});

test('address search: needs sign-in, returns tidy results, caches and copes with failures', async () => {
  assert.equal((await callAs('', 'GET', '/api/geocode?q=linden+row')).status, 401);
  assert.deepEqual((await call('GET', '/api/geocode?q=li')).data.results, [], 'short searches are not sent on');
  const before = geoCalls;
  const r = await call('GET', '/api/geocode?q=Linden+Row+New+York');
  assert.equal(r.status, 200);
  assert.equal(r.data.results.length, 1, 'results without usable coordinates are dropped');
  assert.deepEqual(r.data.results[0], {
    label: 'The Linden Row Hotel, 48, Linden Row, Manhattan, New York, 10014, United States', name: 'The Linden Row Hotel',
    address: '48 Linden Row, New York, 10014', city: 'New York', country: 'United States', lat: 40.7425, lon: -74.0061,
  });
  await call('GET', '/api/geocode?q=linden+row+new+york');
  assert.equal(geoCalls - before, 1, 'the same search is answered from the cache');
  assert.equal((await call('GET', '/api/geocode?q=boom+boom')).status, 502);
});

test('stays: map pin, rooms and guests', async () => {
  const alex = (await call('POST', '/api/companions', { name: 'Alex', relationship: 'Partner' })).data.id;
  const sam = (await call('POST', '/api/companions', { name: 'Sam' })).data.id;
  const base = { name: 'Room Test', check_in: '2026-08-01', check_out: '2026-08-03', address: '48 Linden Row, New York', lat: 40.7425, lon: -74.0061 };

  // no rooms given: one room with "me" in it
  const plain = (await call('GET', '/api/stays/' + (await call('POST', '/api/stays', base)).data.id)).data;
  assert.deepEqual(plain.room_list, [{ room_type: null, guests: ['me'] }]);
  assert.equal(plain.lat, 40.7425);
  assert.equal(plain.guests, 1);
  assert.equal(plain.rooms, 1);

  // "me" is always first in room 1; duplicates, strangers and unknown ids are removed
  const made = await call('POST', '/api/stays', { ...base, name: 'Rooms', room_list: [
    { room_type: 'Double room', guests: [alex, 'me'] },
    { room_type: 'Single room', guests: [alex, sam, 'me', 'not-a-companion'] },
  ] });
  const got = (await call('GET', '/api/stays/' + made.data.id)).data;
  assert.deepEqual(got.room_list, [{ room_type: 'Double room', guests: ['me', alex] }, { room_type: 'Single room', guests: [sam] }]);
  assert.equal(got.rooms, 2);
  assert.equal(got.guests, 3);
  assert.equal(got.room_type, 'Double room');

  // half a coordinate pair is dropped; out-of-range is refused
  assert.equal((await call('GET', '/api/stays/' + (await call('POST', '/api/stays', { ...base, name: 'Half', lon: '' })).data.id)).data.lat, null);
  assert.equal((await call('POST', '/api/stays', { ...base, lat: 123 })).status, 400);

  // removing a companion removes them from the room
  await call('DELETE', '/api/companions/' + alex);
  const after = (await call('GET', '/api/stays/' + made.data.id)).data;
  assert.deepEqual(after.room_list[0].guests, ['me']);
  assert.equal(after.guests, 2);

  // an import into another account keeps the rooms, with the companion ids remapped
  const other = await callAs('', 'POST', '/api/auth/signup', { username: 'room-importer', password: 'another-pass-2', distance_unit: 'km', home_country: 'France' });
  const exp = (await call('GET', '/api/export')).data;
  const imp = await callAs(other.cookie, 'POST', '/api/import?mode=merge', exp);
  assert.equal(imp.status, 200);
  const theirs = (await callAs(other.cookie, 'GET', '/api/companions')).data.companions;
  const theirSam = theirs.find((c) => c.name === 'Sam');
  assert.ok(theirSam && theirSam.id !== sam, 'companion got a new id in the other account');
  const copy = (await callAs(other.cookie, 'GET', '/api/stays')).data.stays.find((x) => x.name === 'Rooms');
  assert.deepEqual(copy.room_list[1].guests, [theirSam.id]);
});

test('stay photos: upload, link, replace, remove, privacy and backup', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  const base = { name: 'Photo Hotel', check_in: '2026-10-01', check_out: '2026-10-03' };

  const made = await call('POST', '/api/stays', { ...base, image_data: dataUrl });
  assert.equal(made.status, 201);
  const id = made.data.id;
  const got = (await call('GET', '/api/stays/' + id)).data;
  assert.equal(got.image_source, 'upload');
  assert.match(got.image, new RegExp('^api/stays/' + id + '/image\\?v=\\d+$'));
  assert.equal(got.image_data, undefined, 'the photo itself is not sent in lists or details');

  const res = await fetch(BASE + '/' + got.image, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
  const again = await fetch(BASE + '/' + got.image, { headers: { Cookie: cookie, 'If-None-Match': res.headers.get('etag') } });
  assert.equal(again.status, 304);
  assert.equal((await fetch(BASE + '/' + got.image)).status, 401, 'signed-out visitors cannot fetch it');
  const other = await callAs('', 'POST', '/api/auth/signup', { username: 'photo-nosy', password: 'another-pass-3', distance_unit: 'km', home_country: 'France' });
  assert.equal((await fetch(BASE + '/' + got.image, { headers: { Cookie: other.cookie } })).status, 404, 'another account cannot fetch it');

  // only real JPEG, PNG or WebP files are accepted
  assert.equal((await call('POST', '/api/stays', { ...base, image_data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' })).status, 400);
  assert.equal((await call('POST', '/api/stays', { ...base, image_data: 'data:text/html;base64,PGI+aGk8L2I+' })).status, 400);
  assert.equal((await call('POST', '/api/stays', { ...base, image_data: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') })).status, 400, 'content must match the type');
  const big = 'data:image/png;base64,' + Buffer.concat([png.subarray(0, 8), Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
  assert.equal((await call('POST', '/api/stays', { ...base, image_data: big })).status, 413);

  // editing without touching the photo keeps it
  await call('PUT', '/api/stays/' + id, { ...base, name: 'Photo Hotel 2' });
  assert.equal((await call('GET', '/api/stays/' + id)).data.image_source, 'upload');

  // it comes back in a backup and into another account
  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.stays.find((x) => x.id === id).image_data, dataUrl);
  await callAs(other.cookie, 'POST', '/api/import?mode=merge', exp);
  const theirs = (await callAs(other.cookie, 'GET', '/api/stays')).data.stays.find((x) => x.name === 'Photo Hotel 2');
  assert.equal(theirs.image_source, 'upload');
  assert.equal((await fetch(BASE + '/' + theirs.image, { headers: { Cookie: other.cookie } })).status, 200);

  // a link replaces the upload; a bad link is refused
  assert.equal((await call('PUT', '/api/stays/' + id, { ...base, image_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call('PUT', '/api/stays/' + id, { ...base, image_url: 'https://example.com/hotel.jpg' })).status, 200);
  const linked = (await call('GET', '/api/stays/' + id)).data;
  assert.equal(linked.image_source, 'link');
  assert.equal(linked.image, 'https://example.com/hotel.jpg');
  assert.equal((await fetch(BASE + '/api/stays/' + id + '/image', { headers: { Cookie: cookie } })).status, 404, 'the upload is gone');

  // and it can be removed
  await call('PUT', '/api/stays/' + id, { ...base, clear_image_data: true });
  assert.equal((await call('GET', '/api/stays/' + id)).data.image, null);
});

test('packages: bundle a trip and a stay with transfers, "part of a package" flags, privacy and backup', async () => {
  const leg = (from, to, extra) => ({ from_iata: from, to_iata: to, date: '2026-05-01', airline: 'Jet2', price: '400', ...extra });
  const trip = (await call('POST', '/api/trips', { type: 'return', legs: [leg('MAN', 'PMI', { direction: 'outbound' }), leg('PMI', 'MAN', { direction: 'return', date: '2026-05-08', price: '' })] })).data.id;
  const stay = (await call('POST', '/api/stays', { name: 'Hotel Sol Palma', city: 'Palma', country: 'Spain', check_in: '2026-05-01', check_out: '2026-05-08', price: 700 })).data.id;
  const loose = (await call('POST', '/api/stays', { name: 'Not in a package', check_in: '2026-06-01', check_out: '2026-06-02' })).data.id;

  // validation
  assert.equal((await call('POST', '/api/packages', { trip_keys: [trip] })).status, 400, 'needs a name');
  assert.equal((await call('POST', '/api/packages', { name: 'Empty' })).status, 400, 'needs a trip or stay');
  assert.equal((await call('POST', '/api/packages', { name: 'Ghost', trip_keys: ['nope'] })).status, 400);
  assert.equal((await call('POST', '/api/packages', { name: 'Bad', stay_ids: [stay], transfers: [{ date: '2026-05-01' }] })).status, 400, 'a transfer needs a place');
  assert.equal((await call('POST', '/api/packages', { name: 'Bad', stay_ids: [stay], transfers: [{ from_place: 'a', time: '25:99' }] })).status, 400);

  const made = await call('POST', '/api/packages', {
    name: 'Majorca week', provider: 'Jet2holidays', board: 'All inclusive', travellers: 2, price: '1,250.50', booking_ref: 'J2-123',
    trip_keys: [trip], stay_ids: [stay],
    transfers: [
      { kind: 'arrival', mode: 'Coach', date: '2026-05-01', time: '12:30', from_place: 'Palma Airport', to_place: 'Hotel Sol Palma' },
      { kind: 'departure', mode: 'Coach', date: '2026-05-08', time: '09:15', from_place: 'Hotel Sol Palma', to_place: 'Palma Airport' },
    ],
  });
  assert.equal(made.status, 201);
  const pid = made.data.id;
  const pkg = (await call('GET', '/api/packages/' + pid)).data;
  assert.equal(pkg.price, 1250.5);
  assert.equal(pkg.start, '2026-05-01');
  assert.equal(pkg.end, '2026-05-08');
  assert.equal(pkg.nights, 7);
  assert.equal(pkg.trips.length, 1);
  assert.equal(pkg.trips[0].legs.length, 2);
  assert.equal(pkg.trips[0].from.iata, 'MAN');
  assert.equal(pkg.trips[0].to.iata, 'PMI');
  assert.deepEqual(pkg.stays.map((s) => s.name), ['Hotel Sol Palma']);
  assert.deepEqual(pkg.transfers.map((t) => t.kind), ['arrival', 'departure']);
  assert.equal(pkg.place, 'Palma, Spain');

  // the flights and stays still appear on their own pages, marked as part of the package
  const flights = (await call('GET', '/api/flights')).data.flights.filter((f) => f.trip_id === trip);
  assert.equal(flights.length, 2);
  assert.ok(flights.every((f) => f.package_id === pid && f.package_name === 'Majorca week'));
  const stays = (await call('GET', '/api/stays')).data.stays;
  assert.equal(stays.find((s) => s.id === stay).package_name, 'Majorca week');
  assert.equal(stays.find((s) => s.id === loose).package_id, null);
  assert.equal((await call('GET', '/api/trips/' + trip)).data.package_name, 'Majorca week');

  // editing a stay or a trip keeps it in the package; a new leg joins it too
  await call('PUT', '/api/stays/' + stay, { name: 'Hotel Sol Palma', check_in: '2026-05-01', check_out: '2026-05-08', price: 650 });
  assert.equal((await call('GET', '/api/stays/' + stay)).data.package_id, pid);
  const t0 = (await call('GET', '/api/trips/' + trip)).data;
  await call('PUT', '/api/trips/' + trip, { type: 'return', legs: [...t0.legs, leg('PMI', 'MAN', { direction: 'return', date: '2026-05-09' })] });
  assert.equal((await call('GET', '/api/flights')).data.flights.filter((f) => f.package_id === pid).length, 3);

  // one trip or stay cannot be in two packages
  assert.equal((await call('POST', '/api/packages', { name: 'Again', stay_ids: [stay] })).status, 400);
  assert.equal((await call('POST', '/api/packages', { name: 'Again', trip_keys: [trip] })).status, 400);

  // edit: swap the stay, drop a transfer
  const up = await call('PUT', '/api/packages/' + pid, { name: 'Majorca week', trip_keys: [trip], stay_ids: [loose], transfers: [{ from_place: 'A', to_place: 'B' }] });
  assert.equal(up.status, 200);
  const edited = (await call('GET', '/api/packages/' + pid)).data;
  assert.deepEqual(edited.stays.map((s) => s.name), ['Not in a package']);
  assert.equal(edited.transfers.length, 1);
  assert.equal((await call('GET', '/api/stays/' + stay)).data.package_id, null, 'a stay taken out is free again');

  // another account cannot see or use it
  const other = await callAs('', 'POST', '/api/auth/signup', { username: 'pkg-nosy', password: 'another-pass-9', distance_unit: 'km', home_country: 'France' });
  assert.equal((await callAs(other.cookie, 'GET', '/api/packages')).data.packages.length, 0);
  assert.equal((await callAs(other.cookie, 'GET', '/api/packages/' + pid)).status, 404);
  assert.equal((await callAs(other.cookie, 'PUT', '/api/packages/' + pid, { name: 'mine now', stay_ids: [] })).status, 404);
  assert.equal((await callAs(other.cookie, 'DELETE', '/api/packages/' + pid)).status, 404);
  assert.equal((await callAs(other.cookie, 'POST', '/api/packages', { name: 'steal', trip_keys: [trip] })).status, 400);

  // backup round trip keeps the package and which flights and stays are in it
  await call('PUT', '/api/packages/' + pid, { name: 'Majorca week', provider: 'Jet2holidays', price: 1250.5, trip_keys: [trip], stay_ids: [stay], transfers: [{ kind: 'arrival', from_place: 'Palma Airport', to_place: 'Hotel' }] });
  const backup = (await call('GET', '/api/export')).data;
  assert.equal(backup.packages.length, 1);
  assert.equal(backup.packages[0].transfers.length, 1);
  const back = await call('POST', '/api/import?mode=replace', backup);
  assert.equal(back.status, 200);
  assert.equal(back.data.imported_packages, 1);
  const again = (await call('GET', '/api/packages')).data.packages;
  assert.equal(again.length, 1);
  assert.equal(again[0].trips.length, 1);
  assert.equal(again[0].stays.length, 1);
  assert.equal(again[0].transfers.length, 1);

  // deleting the package keeps its flights and stays
  assert.equal((await call('DELETE', '/api/packages/' + pid)).status, 204);
  assert.equal((await call('GET', '/api/packages')).data.packages.length, 0);
  assert.ok((await call('GET', '/api/flights')).data.flights.filter((f) => f.trip_id === trip).every((f) => f.package_id === null));
  assert.equal((await call('GET', '/api/stays/' + stay)).data.package_id, null);
});

test('import: files with only stays or only packages work, and replace only touches what the file contains', async () => {
  const other = await callAs('', 'POST', '/api/auth/signup', { username: 'import-user', password: 'another-pass-7', distance_unit: 'km', home_country: 'France' });
  const ck = other.cookie;
  const imp = (body, mode) => callAs(ck, 'POST', '/api/import' + (mode ? '?mode=' + mode : ''), body);
  await callAs(ck, 'POST', '/api/trips', { type: 'oneway', legs: [{ from_iata: 'LHR', to_iata: 'AMS', date: '2025-03-01', airline: 'KLM', direction: 'outbound' }] });
  assert.equal((await imp({ nope: true })).status, 400);
  assert.equal((await imp({ stays: 'x' })).status, 400);

  // a file of just stays, like one converted from another app
  const hotel = (n, i, o, extra) => ({ id: 'imp-' + n, name: n, check_in: i, check_out: o, ...extra });
  let r = await imp({ stays: [hotel('Alpha Hotel', '2025-05-01', '2025-05-03', { city: 'Rome', country: 'Italy', lat: 41.9, lon: 12.5, price: 120 }), hotel('Bad Dates', '2025-05-05', '2025-05-05')] });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported_stays, 1);
  assert.equal(r.data.imported, 0);
  assert.equal(r.data.skipped.length, 1);
  assert.match(r.data.skipped[0], /Bad Dates/);
  // importing it again updates rather than duplicates
  await imp({ stays: [hotel('Alpha Hotel', '2025-05-01', '2025-05-03', { city: 'Rome', country: 'Italy' })] });
  assert.equal((await callAs(ck, 'GET', '/api/stays')).data.stays.length, 1);

  // replace with a stays-only file keeps the flights
  r = await imp({ stays: [hotel('Beta Hotel', '2025-06-01', '2025-06-02')] }, 'replace');
  assert.equal(r.status, 200);
  assert.deepEqual((await callAs(ck, 'GET', '/api/stays')).data.stays.map((s) => s.name), ['Beta Hotel']);
  assert.equal((await callAs(ck, 'GET', '/api/flights')).data.flights.length, 1);

  // a package in a file can carry its own stays and transfers
  r = await imp({ packages: [{ name: 'Rome break', provider: 'Jet2holidays', board: 'Half board', price: 640, transfers: [{ kind: 'arrival', from_place: 'Fiumicino', to_place: 'Alpha Hotel' }], stays: [hotel('Alpha Hotel', '2025-05-01', '2025-05-04')] }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported_packages, 1);
  assert.equal(r.data.imported_stays, 1);
  const pk = (await callAs(ck, 'GET', '/api/packages')).data.packages;
  assert.equal(pk.length, 1);
  assert.equal(pk[0].stays[0].name, 'Alpha Hotel');
  assert.equal(pk[0].transfers.length, 1);
  assert.equal((await callAs(ck, 'GET', '/api/stays')).data.stays.find((s) => s.name === 'Alpha Hotel').package_name, 'Rome break');

  // replace with a packages-only file swaps the packages and frees the stays, but keeps flights and stays
  r = await imp({ packages: [{ name: 'Second', stays: [] }] }, 'replace');
  assert.equal(r.status, 200);
  assert.deepEqual((await callAs(ck, 'GET', '/api/packages')).data.packages.map((p) => p.name), ['Second']);
  const left = (await callAs(ck, 'GET', '/api/stays')).data.stays;
  assert.equal(left.length, 2);
  assert.ok(left.every((s) => s.package_id === null));
  assert.equal((await callAs(ck, 'GET', '/api/flights')).data.flights.length, 1);
});

test('companion date of birth: add, edit, clear, validate, export and import', async () => {
  const add = await call('POST', '/api/companions', { name: 'Kid', relationship: 'Son', date_of_birth: '2018-04-01' });
  assert.equal(add.status, 201);
  assert.equal(add.data.date_of_birth, '2018-04-01');
  assert.equal((await call('POST', '/api/companions', { name: 'Bad', date_of_birth: '2999-01-01' })).status, 400);
  assert.equal((await call('POST', '/api/companions', { name: 'Bad2', date_of_birth: '2018-13-01' })).status, 400);
  const noDob = await call('POST', '/api/companions', { name: 'Plain' });
  assert.equal(noDob.data.date_of_birth, null);

  assert.equal((await call('PUT', '/api/companions/' + noDob.data.id, { date_of_birth: '2025-01-15' })).data.date_of_birth, '2025-01-15');
  assert.equal((await call('PUT', '/api/companions/' + noDob.data.id, { name: 'Plain2' })).data.date_of_birth, '2025-01-15', 'untouched when not sent');
  assert.equal((await call('PUT', '/api/companions/' + noDob.data.id, { date_of_birth: null })).data.date_of_birth, null);
  assert.equal((await call('PUT', '/api/companions/' + noDob.data.id, { date_of_birth: 'junk' })).status, 400);

  const list = (await call('GET', '/api/companions')).data.companions;
  assert.equal(list.find((c) => c.name === 'Kid').date_of_birth, '2018-04-01');

  const exp = (await call('GET', '/api/export')).data;
  assert.equal(exp.companions.find((c) => c.name === 'Kid').date_of_birth, '2018-04-01');
  const flightsBody = { date: '2026-01-01', airline: 'British Airways', flight_number: 'BA1', aircraft_type: 'Airbus A350', seat_class: 'Economy', from_iata: 'LHR', to_iata: 'JFK', departure_time: '10:00', arrival_time: '13:00', companion_ids: [add.data.id] };
  const fl = await call('POST', '/api/flights', flightsBody);
  assert.equal(fl.status, 201);
  const got = (await call('GET', '/api/flights')).data.flights.find((f) => f.companions.some((c) => c.id === add.data.id));
  assert.equal(got.companions[0].date_of_birth, '2018-04-01');

  const other = { flights: [], companions: [{ id: 'imp-1', name: 'Imported', relationship: 'Niece', date_of_birth: '2021-07-07' }, { id: 'imp-2', name: 'BadDob', date_of_birth: 'zzz' }] };
  assert.equal((await call('POST', '/api/import', other)).status, 200);
  const after = (await call('GET', '/api/companions')).data.companions;
  assert.equal(after.find((c) => c.name === 'Imported').date_of_birth, '2021-07-07');
  assert.equal(after.find((c) => c.name === 'BadDob').date_of_birth, null);
});
