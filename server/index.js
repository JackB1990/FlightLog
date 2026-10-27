'use strict';
/*
 * FlightLog server: zero npm dependencies.
 * Node's built-in HTTP server + built-in SQLite (node:sqlite), serving the
 * static frontend and a small JSON API. Data lives in a single SQLite file.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const core = require('../shared/core.js');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FRONTEND_DIR = process.env.FL_FRONTEND_DIR || path.join(ROOT, 'frontend');
const PASSWORD = process.env.FL_PASSWORD || '';
const USERNAME = process.env.FL_USER || 'flightlog';
// New accounts can be created from the login page unless FL_SIGNUPS is off. The very first account is always allowed.
const SIGNUPS = !/^(0|false|off|no)$/i.test(String(process.env.FL_SIGNUPS || 'on').trim());
const SESSION_DAYS = 30;
const MAX_BODY = 10 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------------------------------------------------------------- database */

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, process.env.FL_DB_FILE || 'flightlog.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS airports (
  iata TEXT PRIMARY KEY, icao TEXT, name TEXT NOT NULL, city TEXT, country TEXT,
  lat REAL NOT NULL, lon REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  distance_unit TEXT NOT NULL DEFAULT 'km',
  home_country TEXT
);
INSERT OR IGNORE INTO settings (id) VALUES (1);
CREATE TABLE IF NOT EXISTS travel_companions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, relationship TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  airline TEXT NOT NULL,
  flight_number TEXT, aircraft_type TEXT, seat_class TEXT, seat_number TEXT,
  from_iata TEXT NOT NULL REFERENCES airports(iata),
  to_iata TEXT NOT NULL REFERENCES airports(iata),
  distance_km REAL,
  departure_time TEXT, arrival_time TEXT, actual_departure_time TEXT, actual_arrival_time TEXT,
  delay_reason TEXT, aircraft_registration TEXT, price REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS flight_companions (
  flight_id TEXT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  companion_id TEXT NOT NULL REFERENCES travel_companions(id) ON DELETE CASCADE,
  PRIMARY KEY (flight_id, companion_id)
);
CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  distance_unit TEXT NOT NULL DEFAULT 'km',
  home_country TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
`);
// Trips: flights that belong together share a trip_id. A flight with trip_id NULL is a standalone one-way flight.
{
  const have = new Set(db.prepare('PRAGMA table_info(flights)').all().map((c) => c.name));
  if (!have.has('trip_id')) db.exec('ALTER TABLE flights ADD COLUMN trip_id TEXT');
  if (!have.has('direction')) db.exec("ALTER TABLE flights ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound'");
  if (!have.has('aircraft_registration')) db.exec('ALTER TABLE flights ADD COLUMN aircraft_registration TEXT');
  if (!have.has('price')) db.exec('ALTER TABLE flights ADD COLUMN price REAL');
  if (!have.has('leg_order')) db.exec('ALTER TABLE flights ADD COLUMN leg_order INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_flights_trip ON flights(trip_id)');
  // Per-account data. user_id NULL = created before accounts existed; it is adopted by the first account.
  if (!have.has('user_id')) db.exec('ALTER TABLE flights ADD COLUMN user_id TEXT');
  const compCols = new Set(db.prepare('PRAGMA table_info(travel_companions)').all().map((c) => c.name));
  if (!compCols.has('user_id')) db.exec('ALTER TABLE travel_companions ADD COLUMN user_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_flights_user ON flights(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_companions_user ON travel_companions(user_id)');
  const airportCols = new Set(db.prepare('PRAGMA table_info(airports)').all().map((c) => c.name));
  if (!airportCols.has('tz')) db.exec('ALTER TABLE airports ADD COLUMN tz TEXT');
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw e;
  }
}

function loadAirportDataset() {
  const dataDir = path.join(__dirname, 'data');
  for (const file of ['airports.json', 'airports-fallback.json']) {
    const p = path.join(dataDir, file);
    if (fs.existsSync(p)) return { file, rows: JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  return { file: null, rows: [] };
}

function seedAirports() {
  const { file, rows } = loadAirportDataset();
  if (!rows.length) return;
  const insert = db.prepare('INSERT OR IGNORE INTO airports (iata, icao, name, city, country, lat, lon, tz) VALUES (?,?,?,?,?,?,?,?)');
  const backfill = db.prepare('UPDATE airports SET tz = ? WHERE iata = ? AND tz IS NULL');
  tx(() => {
    for (const r of rows) {
      const tz = r[7] && core.validTz(r[7]) ? r[7] : null;
      insert.run(r[0], r[1] || null, r[2], r[3] || null, r[4] || null, r[5], r[6], tz);
      if (tz) backfill.run(tz, r[0]);
    }
  });
  const n = db.prepare('SELECT COUNT(*) AS n FROM airports').get().n;
  console.log(`[flightlog] airport dataset: ${file} (${n} airports in database)`);
}
seedAirports();

/* ----------------------------------------------------------------- helpers */

const str = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

function timeOrNull(v, label) {
  const s = str(v, 8);
  if (!s) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) throw new HttpError(400, `${label} must be a time like 14:30`);
  return s.slice(0, 5);
}

// A money amount: blank gives null, otherwise a non-negative number rounded to pence.
function priceOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new HttpError(400, 'price must be an amount like 249.99');
  return Math.round(n * 100) / 100;
}

function getAirport(iata) {
  return db.prepare('SELECT iata, icao, name, city, country, lat, lon, tz FROM airports WHERE iata = ?').get(String(iata || '').toUpperCase());
}

let countryCache = null;
function getCountries() {
  if (!countryCache) {
    const rows = db.prepare('SELECT country, lat, lon FROM airports WHERE country IS NOT NULL').all();
    countryCache = core.countryCenters(rows);
  }
  return countryCache;
}

// The signed-in user for the request being handled (set by the HTTP handler; handleApi is synchronous).
let CU = null;

function getSettings() {
  const r = db.prepare('SELECT distance_unit, home_country FROM users WHERE id = ?').get(CU.id);
  return { distance_unit: r.distance_unit, home_country: r.home_country };
}

function airportOut(f, p) {
  return { iata: f[`${p}_iata`], name: f[`${p}_name`], city: f[`${p}_city`], country: f[`${p}_country`], lat: f[`${p}_lat`], lon: f[`${p}_lon`], tz: f[`${p}_tz`] || null };
}

function listFlights() {
  const rows = db.prepare(`
    SELECT f.*, fa.name AS from_name, fa.city AS from_city, fa.country AS from_country, fa.lat AS from_lat, fa.lon AS from_lon, fa.tz AS from_tz,
           ta.name AS to_name, ta.city AS to_city, ta.country AS to_country, ta.lat AS to_lat, ta.lon AS to_lon, ta.tz AS to_tz
    FROM flights f
    JOIN airports fa ON fa.iata = f.from_iata
    JOIN airports ta ON ta.iata = f.to_iata
    WHERE f.user_id = ?
    ORDER BY f.date DESC, f.created_at DESC`).all(CU.id);
  const links = db.prepare(`
    SELECT fc.flight_id, tc.id, tc.name, tc.relationship
    FROM flight_companions fc JOIN travel_companions tc ON tc.id = fc.companion_id
    JOIN flights fl ON fl.id = fc.flight_id
    WHERE fl.user_id = ? AND tc.user_id = ?
    ORDER BY tc.name`).all(CU.id, CU.id);
  const byFlight = new Map();
  for (const l of links) {
    if (!byFlight.has(l.flight_id)) byFlight.set(l.flight_id, []);
    byFlight.get(l.flight_id).push({ id: l.id, name: l.name, relationship: l.relationship });
  }
  return rows.map((f) => ({
    id: f.id, date: f.date, airline: f.airline, flight_number: f.flight_number,
    aircraft_type: f.aircraft_type, seat_class: f.seat_class, seat_number: f.seat_number,
    distance_km: f.distance_km, departure_time: f.departure_time, arrival_time: f.arrival_time,
    actual_departure_time: f.actual_departure_time, actual_arrival_time: f.actual_arrival_time,
    delay_reason: f.delay_reason, aircraft_registration: f.aircraft_registration || null, price: f.price == null ? null : f.price,
    trip_id: f.trip_id || null, direction: f.direction || 'outbound', leg_order: f.leg_order || 0,
    from_airport: airportOut(f, 'from'),
    to_airport: airportOut(f, 'to'),
    companions: byFlight.get(f.id) || [],
  }));
}

function cleanFlight(b) {
  const date = str(b.date, 10);
  const airline = str(b.airline);
  const from_iata = str(b.from_iata, 3);
  const to_iata = str(b.to_iata, 3);
  if (!from_iata || !to_iata || !date || !airline) {
    throw new HttpError(400, 'from_iata, to_iata, date, and airline are required');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime())) {
    throw new HttpError(400, 'date must be YYYY-MM-DD');
  }
  return {
    date, airline,
    from_iata: from_iata.toUpperCase(), to_iata: to_iata.toUpperCase(),
    flight_number: str(b.flight_number, 12), aircraft_type: str(b.aircraft_type, 60),
    seat_class: str(b.seat_class, 30), seat_number: str(b.seat_number, 8),
    departure_time: timeOrNull(b.departure_time, 'departure_time'),
    arrival_time: timeOrNull(b.arrival_time, 'arrival_time'),
    actual_departure_time: timeOrNull(b.actual_departure_time, 'actual_departure_time'),
    actual_arrival_time: timeOrNull(b.actual_arrival_time, 'actual_arrival_time'),
    delay_reason: str(b.delay_reason, 80),
    aircraft_registration: (str(b.aircraft_registration, 12) || '').toUpperCase() || null,
    price: priceOrNull(b.price),
  };
}

function prepareFlight(b) {
  const f = cleanFlight(b);
  const from = getAirport(f.from_iata);
  const to = getAirport(f.to_iata);
  if (!from || !to) throw new HttpError(400, 'Unknown airport code: ' + (!from ? f.from_iata : f.to_iata));
  const companionIds = Array.isArray(b.companion_ids) ? [...new Set(b.companion_ids.map(String))] : [];
  return { f, distance_km: core.haversineKm(from, to), companionIds };
}

// Insert or update one flight row. Must be called inside tx(). `trip` is { trip_id, direction, leg_order }
// or null to leave the trip fields of an existing flight untouched.
function storeFlight(id, prep, trip) {
  const { f, distance_km, companionIds } = prep;
  const cols = [f.date, f.airline, f.flight_number, f.aircraft_type, f.seat_class, f.seat_number,
    f.from_iata, f.to_iata, distance_km, f.departure_time, f.arrival_time,
    f.actual_departure_time, f.actual_arrival_time, f.delay_reason, f.aircraft_registration, f.price];
  let flightId = id;
  if (!flightId) {
    flightId = crypto.randomUUID();
    const t = trip || { trip_id: null, direction: 'outbound', leg_order: 0 };
    db.prepare(`INSERT INTO flights (id, date, airline, flight_number, aircraft_type, seat_class, seat_number,
      from_iata, to_iata, distance_km, departure_time, arrival_time, actual_departure_time, actual_arrival_time, delay_reason,
      aircraft_registration, price, trip_id, direction, leg_order, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(flightId, ...cols, t.trip_id, t.direction, t.leg_order, CU.id);
  } else {
    db.prepare(`UPDATE flights SET date=?, airline=?, flight_number=?, aircraft_type=?, seat_class=?, seat_number=?,
      from_iata=?, to_iata=?, distance_km=?, departure_time=?, arrival_time=?,
      actual_departure_time=?, actual_arrival_time=?, delay_reason=?, aircraft_registration=?, price=? WHERE id=? AND user_id=?`).run(...cols, flightId, CU.id);
    if (trip) db.prepare('UPDATE flights SET trip_id=?, direction=?, leg_order=? WHERE id=? AND user_id=?').run(trip.trip_id, trip.direction, trip.leg_order, flightId, CU.id);
    db.prepare('DELETE FROM flight_companions WHERE flight_id = ?').run(flightId);
  }
  const link = db.prepare('INSERT OR IGNORE INTO flight_companions (flight_id, companion_id) SELECT ?, id FROM travel_companions WHERE id = ? AND user_id = ?');
  for (const cid of companionIds) link.run(flightId, cid, CU.id);
  return flightId;
}

function writeFlight(id, b) {
  const prep = prepareFlight(b);
  return tx(() => storeFlight(id, prep, null));
}

/* ------------------------------------------------------------------ trips
 * A "trip" is one or more flights saved together: a one-way journey with connections,
 * or a return journey (outbound legs + return legs). A single one-way flight with no
 * connections is stored as a plain standalone flight (trip_id NULL).
 * The key used by the API is either a trip_id or the id of a standalone flight. */

const MAX_LEGS = 12;

function tripRows(key) {
  let rows = db.prepare(`SELECT * FROM flights WHERE trip_id = ? AND user_id = ?
    ORDER BY CASE direction WHEN 'return' THEN 1 ELSE 0 END, leg_order, date, departure_time`).all(key, CU.id);
  if (!rows.length) rows = db.prepare('SELECT * FROM flights WHERE id = ? AND trip_id IS NULL AND user_id = ?').all(key, CU.id);
  return rows;
}

function getTrip(key) {
  const rows = tripRows(key);
  if (!rows.length) throw new HttpError(404, 'Trip not found');
  const link = db.prepare('SELECT companion_id FROM flight_companions WHERE flight_id = ?');
  const legs = rows.map((r) => ({ ...r, companion_ids: link.all(r.id).map((x) => x.companion_id) }));
  return {
    trip_id: rows[0].trip_id || null,
    type: rows.some((r) => r.direction === 'return') ? 'return' : 'oneway',
    legs,
  };
}

function saveTrip(key, body) {
  const b = body || {};
  const type = b.type === 'return' ? 'return' : 'oneway';
  const legsIn = Array.isArray(b.legs) ? b.legs : [];
  const outbound = legsIn.filter((l) => l && l.direction !== 'return');
  const inbound = type === 'return' ? legsIn.filter((l) => l && l.direction === 'return') : [];
  if (!outbound.length) throw new HttpError(400, 'A trip needs at least one outbound flight.');
  if (type === 'return' && !inbound.length) throw new HttpError(400, 'A return trip needs at least one return flight.');
  if (outbound.length > MAX_LEGS || inbound.length > MAX_LEGS) throw new HttpError(400, `At most ${MAX_LEGS} flights per direction.`);
  const companionIds = Array.isArray(b.companion_ids) ? b.companion_ids : [];
  const ordered = [
    ...outbound.map((l, i) => ({ l, direction: 'outbound', leg_order: i })),
    ...inbound.map((l, i) => ({ l, direction: 'return', leg_order: i })),
  ].map((x) => ({ ...x, prep: prepareFlight({ ...x.l, companion_ids: companionIds }) }));
  const existing = key ? tripRows(key) : [];
  if (key && !existing.length) throw new HttpError(404, 'Trip not found');
  const standalone = ordered.length === 1 && type === 'oneway';
  const tripId = standalone ? null : ((existing[0] && existing[0].trip_id) || crypto.randomUUID());
  return tx(() => {
    const keep = new Set();
    let first = null;
    for (const x of ordered) {
      const reuse = x.l.id && existing.some((r) => r.id === String(x.l.id)) && !keep.has(String(x.l.id)) ? String(x.l.id) : null;
      const id = storeFlight(reuse, x.prep, { trip_id: tripId, direction: x.direction, leg_order: x.leg_order });
      keep.add(id);
      if (!first) first = id;
    }
    for (const r of existing) if (!keep.has(r.id)) db.prepare('DELETE FROM flights WHERE id = ? AND user_id = ?').run(r.id, CU.id);
    return { key: tripId || first, ids: [...keep] };
  });
}

function deleteTrip(key) {
  const rows = tripRows(key);
  if (!rows.length) throw new HttpError(404, 'Trip not found');
  tx(() => { for (const r of rows) db.prepare('DELETE FROM flights WHERE id = ? AND user_id = ?').run(r.id, CU.id); });
}

function exportAll() {
  const flights = db.prepare('SELECT * FROM flights WHERE user_id = ? ORDER BY date, created_at').all(CU.id).map((f) => { const { user_id, ...rest } = f; return { ...rest }; });
  const links = db.prepare('SELECT fc.flight_id, fc.companion_id FROM flight_companions fc JOIN flights f ON f.id = fc.flight_id WHERE f.user_id = ?').all(CU.id);
  for (const f of flights) f.companion_ids = links.filter((l) => l.flight_id === f.id).map((l) => l.companion_id);
  const used = new Set(flights.flatMap((f) => [f.from_iata, f.to_iata]));
  const airports = db.prepare('SELECT iata, icao, name, city, country, lat, lon, tz FROM airports').all()
    .filter((a) => used.has(a.iata)).map((a) => ({ ...a }));
  return {
    app: 'flightlog',
    version: 1,
    exported_at: new Date().toISOString(),
    settings: getSettings(),
    companions: db.prepare('SELECT id, name, relationship FROM travel_companions WHERE user_id = ? ORDER BY name').all(CU.id).map((c) => ({ ...c })),
    airports,
    flights,
  };
}

function importAll(data, mode) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.flights)) {
    throw new HttpError(400, 'This does not look like a FlightLog export (no "flights" list).');
  }
  const companions = Array.isArray(data.companions) ? data.companions : [];
  const airports = Array.isArray(data.airports) ? data.airports : [];
  let imported = 0;
  const skipped = [];
  tx(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM flights WHERE user_id = ?').run(CU.id);
      db.prepare('DELETE FROM travel_companions WHERE user_id = ?').run(CU.id);
    }
    const insAirport = db.prepare('INSERT OR IGNORE INTO airports (iata, icao, name, city, country, lat, lon, tz) VALUES (?,?,?,?,?,?,?,?)');
    for (const a of airports) {
      if (a && a.iata && a.name && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon))) {
        insAirport.run(String(a.iata).toUpperCase(), str(a.icao, 4), String(a.name), str(a.city), str(a.country), Number(a.lat), Number(a.lon), a.tz && core.validTz(a.tz) ? String(a.tz) : null);
        if (a.tz && core.validTz(a.tz)) db.prepare('UPDATE airports SET tz = ? WHERE iata = ? AND tz IS NULL').run(String(a.tz), String(a.iata).toUpperCase());
      }
    }
    // Ids that already belong to another account are replaced with fresh ones, so an import can never touch someone else's rows.
    const owner = (table, id) => { const r = db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).get(id); return r ? r.user_id : undefined; };
    const freeId = (table, id) => { const o = owner(table, id); return o === undefined || o === CU.id ? id : crypto.randomUUID(); };
    const companionMap = new Map();
    const insCompanion = db.prepare('INSERT OR IGNORE INTO travel_companions (id, name, relationship, user_id) VALUES (?,?,?,?)');
    for (const c of companions) {
      if (c && c.id && c.name) {
        const id = freeId('travel_companions', String(c.id));
        companionMap.set(String(c.id), id);
        insCompanion.run(id, String(c.name).slice(0, 100), str(c.relationship, 60), CU.id);
      }
    }
    const upsert = db.prepare(`INSERT INTO flights (id, date, airline, flight_number, aircraft_type, seat_class, seat_number,
        from_iata, to_iata, distance_km, departure_time, arrival_time, actual_departure_time, actual_arrival_time, delay_reason,
        aircraft_registration, price, trip_id, direction, leg_order, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET date=excluded.date, airline=excluded.airline, flight_number=excluded.flight_number,
        aircraft_type=excluded.aircraft_type, seat_class=excluded.seat_class, seat_number=excluded.seat_number,
        from_iata=excluded.from_iata, to_iata=excluded.to_iata, distance_km=excluded.distance_km,
        departure_time=excluded.departure_time, arrival_time=excluded.arrival_time,
        actual_departure_time=excluded.actual_departure_time, actual_arrival_time=excluded.actual_arrival_time,
        delay_reason=excluded.delay_reason, aircraft_registration=excluded.aircraft_registration, price=excluded.price, trip_id=excluded.trip_id, direction=excluded.direction, leg_order=excluded.leg_order WHERE flights.user_id = excluded.user_id`);
    const link = db.prepare('INSERT OR IGNORE INTO flight_companions (flight_id, companion_id) SELECT ?, id FROM travel_companions WHERE id = ? AND user_id = ?');
    for (const raw of data.flights) {
      try {
        const rawDate = raw && raw.date ? String(raw.date).slice(0, 10) : '';
        const f = cleanFlight({ ...raw, date: rawDate });
        const from = getAirport(f.from_iata);
        const to = getAirport(f.to_iata);
        if (!from || !to) throw new Error(`unknown airport ${!from ? f.from_iata : f.to_iata}`);
        const id = raw.id ? freeId('flights', String(raw.id)) : crypto.randomUUID();
        const distance = Number.isFinite(Number(raw.distance_km)) && raw.distance_km !== null ? Number(raw.distance_km) : core.haversineKm(from, to);
        upsert.run(id, f.date, f.airline, f.flight_number, f.aircraft_type, f.seat_class, f.seat_number,
          f.from_iata, f.to_iata, distance, f.departure_time, f.arrival_time,
          f.actual_departure_time, f.actual_arrival_time, f.delay_reason, f.aircraft_registration, f.price,
          raw.trip_id ? String(raw.trip_id).slice(0, 64) : null, raw.direction === 'return' ? 'return' : 'outbound', Number.isInteger(raw.leg_order) ? raw.leg_order : 0, CU.id);
        db.prepare('DELETE FROM flight_companions WHERE flight_id = ?').run(id);
        for (const cid of Array.isArray(raw.companion_ids) ? raw.companion_ids : []) link.run(id, companionMap.get(String(cid)) || String(cid), CU.id);
        imported += 1;
      } catch (e) {
        skipped.push(`${raw && raw.date ? raw.date : '?'} ${raw && raw.from_iata ? raw.from_iata : ''}-${raw && raw.to_iata ? raw.to_iata : ''}: ${e.message}`);
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      if (['km', 'mi'].includes(data.settings.distance_unit)) {
        db.prepare('UPDATE users SET distance_unit = ? WHERE id = ?').run(data.settings.distance_unit, CU.id);
      }
      if (data.settings.home_country) {
        db.prepare('UPDATE users SET home_country = ? WHERE id = ?').run(String(data.settings.home_country), CU.id);
      }
    }
  });
  countryCache = null;
  return { imported, skipped };
}

/* ------------------------------------------------------------------ router */

function handleApi(method, pathname, query, body) {

  if (pathname === '/api/flights') {
    if (method === 'GET') return [200, { flights: listFlights() }];
    if (method === 'POST') return [201, { id: writeFlight(null, body || {}) }];
    throw new HttpError(405, 'Method not allowed');
  }

  let m = pathname.match(/^\/api\/flights\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const row = db.prepare('SELECT * FROM flights WHERE id = ? AND user_id = ?').get(id, CU.id);
    if (!row) throw new HttpError(404, 'Flight not found');
    if (method === 'GET') {
      const ids = db.prepare('SELECT companion_id FROM flight_companions WHERE flight_id = ?').all(id).map((r) => r.companion_id);
      const { user_id, ...pub } = row;
      return [200, { ...pub, companion_ids: ids }];
    }
    if (method === 'PUT') { writeFlight(id, body || {}); return [200, { id }]; }
    if (method === 'DELETE') { db.prepare('DELETE FROM flights WHERE id = ? AND user_id = ?').run(id, CU.id); return [204, null]; }
    throw new HttpError(405, 'Method not allowed');
  }

  if (pathname === '/api/trips' && method === 'POST') {
    const out = saveTrip(null, body);
    return [201, { id: out.key }];
  }
  m = pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    if (method === 'GET') return [200, getTrip(key)];
    if (method === 'PUT') { const out = saveTrip(key, body); return [200, { id: out.key }]; }
    if (method === 'DELETE') { deleteTrip(key); return [204, null]; }
    throw new HttpError(405, 'Method not allowed');
  }

  if (pathname === '/api/airports') {
    if (method === 'GET') {
      const q = String(query.get('q') || '').trim();
      if (!q) return [200, { airports: [] }];
      const like = `%${q.replace(/[%_]/g, '')}%`;
      const rows = db.prepare(`
        SELECT iata, icao, name, city, country, lat, lon, tz FROM airports
        WHERE iata LIKE ? OR icao LIKE ? OR name LIKE ? OR city LIKE ?
        ORDER BY (CASE WHEN iata LIKE ? OR icao LIKE ? THEN 0 ELSE 1 END), name LIMIT 25`).all(like, like, like, like, q, q);
      return [200, { airports: rows.map((r) => ({ ...r })) }];
    }
    if (method === 'POST') {
      const b = body || {};
      const iata = str(b.iata, 3);
      const lat = Number(b.lat);
      const lon = Number(b.lon);
      if (!iata || !str(b.name) || b.lat === undefined || b.lon === undefined || b.lat === '' || b.lon === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new HttpError(400, 'iata, name, lat, and lon are required');
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new HttpError(400, 'lat/lon out of range');
      const tz = str(b.tz, 64);
      if (tz && !core.validTz(tz)) throw new HttpError(400, 'Unknown time zone "' + tz + '". Use a name like Europe/London.');
      db.prepare('INSERT OR IGNORE INTO airports (iata, icao, name, city, country, lat, lon, tz) VALUES (?,?,?,?,?,?,?,?)')
        .run(iata.toUpperCase(), str(b.icao, 4), str(b.name), str(b.city), str(b.country), lat, lon, tz);
      countryCache = null;
      return [201, { iata: iata.toUpperCase() }];
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (pathname === '/api/companions') {
    if (method === 'GET') {
      return [200, { companions: db.prepare('SELECT id, name, relationship FROM travel_companions WHERE user_id = ? ORDER BY name').all(CU.id).map((r) => ({ ...r })) }];
    }
    if (method === 'POST') {
      const name = str((body || {}).name, 100);
      if (!name) throw new HttpError(400, 'name is required');
      const id = crypto.randomUUID();
      const relationship = str((body || {}).relationship, 60);
      db.prepare('INSERT INTO travel_companions (id, name, relationship, user_id) VALUES (?,?,?,?)').run(id, name, relationship, CU.id);
      return [201, { id, name, relationship }];
    }
    throw new HttpError(405, 'Method not allowed');
  }

  m = pathname.match(/^\/api\/companions\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const row = db.prepare('SELECT id, name, relationship FROM travel_companions WHERE id = ? AND user_id = ?').get(id, CU.id);
    if (!row) throw new HttpError(404, 'Companion not found');
    if (method === 'DELETE') { db.prepare('DELETE FROM travel_companions WHERE id = ? AND user_id = ?').run(id, CU.id); return [204, null]; }
    if (method === 'PUT') {
      const name = str((body || {}).name, 100) || row.name;
      const relationship = 'relationship' in (body || {}) ? str(body.relationship, 60) : row.relationship;
      db.prepare('UPDATE travel_companions SET name = ?, relationship = ? WHERE id = ? AND user_id = ?').run(name, relationship, id, CU.id);
      return [200, { id, name, relationship }];
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (pathname === '/api/account/settings') {
    if (method === 'GET') return [200, getSettings()];
    if (method === 'PUT') {
      const b = body || {};
      if (b.distance_unit && !['km', 'mi'].includes(b.distance_unit)) throw new HttpError(400, "distance_unit must be 'km' or 'mi'");
      if (b.distance_unit) db.prepare('UPDATE users SET distance_unit = ? WHERE id = ?').run(b.distance_unit, CU.id);
      if ('home_country' in b) db.prepare('UPDATE users SET home_country = ? WHERE id = ?').run(str(b.home_country), CU.id);
      return [200, getSettings()];
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (pathname === '/api/countries' && method === 'GET') return [200, { countries: getCountries() }];
  if (pathname === '/api/stats' && method === 'GET') return [200, core.computeStats(listFlights(), getSettings().home_country)];
  if (pathname === '/api/export' && method === 'GET') return [200, exportAll(), { 'Content-Disposition': `attachment; filename="flightlog-export-${new Date().toISOString().slice(0, 10)}.json"` }];
  if (pathname === '/api/import' && method === 'POST') return [200, importAll(body, query.get('mode') === 'replace' ? 'replace' : 'merge')];

  throw new HttpError(404, 'Not found');
}

/* ------------------------------------------------------------- http server */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, data, headers = {}) {
  const common = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
  if (data === null || data === undefined) { res.writeHead(status, { ...common, ...headers }); return res.end(); }
  const payload = JSON.stringify(data);
  res.writeHead(status, { ...common, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

/* ---------------------------------------------------------------- accounts */

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const COOKIE = 'fl_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function publicUser(u) { return { username: u.username, distance_unit: u.distance_unit, home_country: u.home_country }; }
function userCount() { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; }

// Flights and companions saved before accounts existed belong to the first account.
function adoptLegacyData(userId) {
  db.prepare('UPDATE flights SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE travel_companions SET user_id = ? WHERE user_id IS NULL').run(userId);
}
function hasLegacyData() {
  return !!db.prepare('SELECT 1 FROM flights WHERE user_id IS NULL LIMIT 1').get() || !!db.prepare('SELECT 1 FROM travel_companions WHERE user_id IS NULL LIMIT 1').get();
}

function createUser(username, password, unit, country) {
  const id = crypto.randomUUID();
  tx(() => {
    db.prepare('INSERT INTO users (id, username, password_hash, distance_unit, home_country) VALUES (?,?,?,?,?)')
      .run(id, username, hashPassword(password), unit, country);
    if (userCount() === 1) adoptLegacyData(id);
  });
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// FL_USER / FL_PASSWORD from earlier versions: that login keeps working, on the new login page.
function ensureEnvUser() {
  if (!PASSWORD) return;
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(USERNAME);
  if (existing) {
    if (!verifyPassword(PASSWORD, existing.password_hash)) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(PASSWORD), existing.id);
    if (userCount() === 1) adoptLegacyData(existing.id);
    return;
  }
  const legacy = db.prepare('SELECT distance_unit, home_country FROM settings WHERE id = 1').get() || {};
  const hadUsers = userCount() > 0;
  const u = createUser(USERNAME, PASSWORD, legacy.distance_unit || 'km', legacy.home_country || null);
  // Other accounts already exist but old data is still unclaimed: it belongs to the person who used FL_USER.
  if (hadUsers) adoptLegacyData(u.id);
  console.log(`[flightlog] account "${USERNAME}" is ready (from FL_USER / FL_PASSWORD)`);
}
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
ensureEnvUser();

const failures = new Map();
function tooManyAttempts(keys) {
  const now = Date.now();
  return keys.some(([k, max]) => (failures.get(k) || []).filter((t) => now - t < 600000).length >= max);
}
function noteFailure(keys) {
  const now = Date.now();
  for (const [k] of keys) failures.set(k, [...(failures.get(k) || []).filter((t) => now - t < 600000), now]);
}
function attemptKeys(req, username) {
  return [['u:' + String(username || '').toLowerCase(), 10], ['ip:' + (req.socket.remoteAddress || ''), 40]];
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function sessionCookie(req, token, maxAge) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || req.socket.encrypted;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function startSession(req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, Date.now() + SESSION_DAYS * 86400000);
  return { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) };
}

// The signed-in user: from the session cookie, or HTTP Basic credentials (handy for scripts and backups).
function currentUser(req) {
  const token = cookieValue(req, COOKIE);
  if (token) {
    const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(sha(token), Date.now());
    if (r) return r;
  }
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const name = decoded.slice(0, idx);
    const keys = attemptKeys(req, name);
    if (tooManyAttempts(keys)) return null;
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
    if (u && verifyPassword(decoded.slice(idx + 1), u.password_hash)) return u;
    noteFailure(keys);
  }
  return null;
}

function authStatus(user) {
  return { authenticated: !!user, user: user ? publicUser(user) : null, signups: SIGNUPS || userCount() === 0, hasUsers: userCount() > 0, legacyData: userCount() === 0 && hasLegacyData() };
}

function handleAuth(req, method, pathname, body) {
  if (pathname === '/api/auth/status' && method === 'GET') return [200, authStatus(currentUser(req))];
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = cookieValue(req, COOKIE);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
    return [200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) }];
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const b = body || {};
    const username = String(b.username || '').trim();
    const keys = attemptKeys(req, username);
    if (tooManyAttempts(keys)) throw new HttpError(429, 'Too many failed attempts. Please wait a few minutes and try again.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !verifyPassword(String(b.password || ''), u.password_hash)) {
      noteFailure(keys);
      throw new HttpError(401, 'Incorrect username or password.');
    }
    return [200, { user: publicUser(u) }, startSession(req, u.id)];
  }
  if (pathname === '/api/auth/signup' && method === 'POST') {
    const b = body || {};
    if (userCount() > 0 && !SIGNUPS) throw new HttpError(403, 'New accounts are switched off on this server.');
    const keys = [['signup-ip:' + (req.socket.remoteAddress || ''), 20]];
    if (tooManyAttempts(keys)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    noteFailure(keys);
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dots, dashes or underscores.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (!['km', 'mi'].includes(b.distance_unit)) throw new HttpError(400, 'Choose miles or kilometres.');
    const country = str(b.home_country);
    if (!country) throw new HttpError(400, 'Choose your home country.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is already taken.');
    const u = createUser(username, password, b.distance_unit, country);
    return [201, { user: publicUser(u) }, startSession(req, u.id)];
  }
  throw new HttpError(404, 'Not found');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = rel === '/core.js' ? path.join(__dirname, '..', 'shared', 'core.js') : path.normalize(path.join(FRONTEND_DIR, rel));
  if (rel !== '/core.js' && file !== FRONTEND_DIR && !file.startsWith(FRONTEND_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(file).toLowerCase();
    const isVendor = rel.startsWith('/vendor/') || rel.startsWith('/logos/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isVendor ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      const method = req.method || 'GET';
      let body;
      if (method === 'POST' || method === 'PUT') {
        // Browsers can only send JSON cross-site after a permission check, which keeps other websites from posting here.
        if (Number(req.headers['content-length'] || 0) > 0 && !/^application\/json/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'Send JSON');
        body = await readBody(req);
      }
      if (pathname === '/api/health') return send(res, 200, { ok: true });
      if (pathname.startsWith('/api/auth/')) {
        const [status, data, headers] = handleAuth(req, method, pathname, body);
        return send(res, status, data, headers || {});
      }
      // The list of countries is needed on the sign-up form, before there is an account.
      if (pathname === '/api/countries' && method === 'GET') return send(res, 200, { countries: getCountries() });
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'Please sign in.' });
      CU = user;
      let out;
      try { out = handleApi(method, pathname, url.searchParams, body); } finally { CU = null; }
      const [status, data, headers] = out;
      return send(res, status, data, headers || {});
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (e && /constraint/i.test(String(e.message))) return send(res, 400, { error: 'That change conflicts with existing data.' });
    console.error('[flightlog] error:', e);
    return send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[flightlog] listening on :${PORT}  data: ${DATA_DIR}  accounts: ${userCount()}  sign-ups: ${SIGNUPS ? 'on' : 'off'}`);
});

function shutdown() {
  console.log('[flightlog] shutting down');
  server.close(() => { try { db.close(); } catch (_) { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { server };
