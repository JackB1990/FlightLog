/*
 * TEST FIXTURE ONLY (not shipped in the app or the Docker image).
 * An in-memory copy of the /api/* endpoints, with sample flights, so the UI tests
 * can run without a server or a browser.
 * Expects globals: FLCore (shared/core.js) and FL_AIRPORTS (array of
 * [iata, icao, name, city, country, lat, lon]).
 */
(function () {
  'use strict';

  const KEY = 'flightlog-demo-v4';
  const core = window.FLCore;

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const str = (v, max = 200) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s.slice(0, max);
  };

  /* ---------------------------------------------------------------- seed data */

  function seed() {
    const F = (n, date, airline, flight_number, aircraft_type, seat_class, seat_number, from_iata, to_iata, dep, arr, extra) => ({
      id: 'demo-flight-' + String(n).padStart(2, '0'), date, airline, flight_number, aircraft_type, seat_class, seat_number,
      from_iata, to_iata, departure_time: dep, arrival_time: arr,
      actual_departure_time: null, actual_arrival_time: null, delay_reason: null, aircraft_registration: null, price: null, companion_ids: [],
      trip_id: null, direction: 'outbound', leg_order: 0,
      created_at: '2026-01-01T00:00:' + String(n).padStart(2, '0') + 'Z',
      ...(extra || {}),
    });
    // Trips: [trip number, [flight numbers outbound], [flight numbers return]]. Flight 19 stays a standalone flight.
    const TRIPS = [[1, [1], [2]], [2, [3], [4]], [3, [5, 6], [7, 8]], [4, [9], [10]], [5, [11], [12]], [6, [13], [14]], [7, [15], [16]], [8, [17], [18]]];
    const alex = 'demo-companion-alex', sam = 'demo-companion-sam', mum = 'demo-companion-mum';
    const flights = [
      F(1, '2023-04-08', 'KLM', 'KL1536', 'Embraer E190', 'Economy', '9C', 'HUY', 'AMS', '07:05', '09:10', { companion_ids: [alex] }),
      F(2, '2023-04-12', 'KLM', 'KL1537', 'Embraer E190', 'Economy', '10A', 'AMS', 'HUY', '19:50', '19:55', { companion_ids: [alex] }),
      F(3, '2023-08-05', 'Jet2.com', 'LS821', 'Boeing 737-800', 'Economy', '22F', 'MAN', 'PMI', '06:15', '09:55', { companion_ids: [alex, sam], delay_reason: 'Air Traffic Control', actual_departure_time: '06:50', actual_arrival_time: '10:30' }),
      F(4, '2023-08-19', 'Jet2.com', 'LS822', 'Boeing 737-800', 'Economy', '23A', 'PMI', 'MAN', '10:50', '12:35', { companion_ids: [alex, sam] }),
      F(5, '2024-02-17', 'Emirates', 'EK30', 'Airbus A380', 'Economy', '64K', 'LHR', 'DXB', '14:10', '00:20', { companion_ids: [alex] }),
      F(6, '2024-02-19', 'Emirates', 'EK412', 'Airbus A380', 'Premium Economy', '31A', 'DXB', 'SYD', '10:30', '07:05', { companion_ids: [alex] }),
      F(7, '2024-03-04', 'Qantas', 'QF11', 'Airbus A380', 'Premium Economy', '40A', 'SYD', 'LAX', '11:00', '06:25', { companion_ids: [alex] }),
      F(8, '2024-03-06', 'Virgin Atlantic', 'VS8', 'Boeing 787-9', 'Premium Economy', '23J', 'LAX', 'LHR', '20:30', '14:55', { companion_ids: [alex] }),
      F(9, '2024-10-12', 'British Airways', 'BA178', 'Boeing 777-300ER', 'Economy', '35C', 'LHR', 'JFK', '08:25', '11:00', { delay_reason: 'Late Inbound Aircraft', actual_departure_time: '09:20', actual_arrival_time: '11:55' }),
      F(10, '2024-10-19', 'British Airways', 'BA175', 'Boeing 777-300ER', 'Business', '7A', 'JFK', 'LHR', '21:00', '09:00'),
      F(11, '2025-05-23', 'Ryanair', 'FR8221', 'Boeing 737-800', 'Economy', '18D', 'MAN', 'DUB', '17:40', '18:40', { companion_ids: [sam] }),
      F(12, '2025-05-26', 'Ryanair', 'FR8222', 'Boeing 737-800', 'Economy', '4F', 'DUB', 'MAN', '19:10', '20:15', { companion_ids: [sam] }),
      F(13, '2025-09-14', 'British Airways', 'BA1442', 'Airbus A320', 'Economy', '12A', 'LHR', 'EDI', '07:30', '08:55', { companion_ids: [mum] }),
      F(14, '2025-09-17', 'British Airways', 'BA1459', 'Airbus A320', 'Economy', '14C', 'EDI', 'LHR', '18:45', '20:10', { companion_ids: [mum] }),
      F(15, '2026-01-10', 'easyJet', 'U28021', 'Airbus A320neo', 'Economy', '15B', 'LGW', 'FAO', '10:05', '13:20', { companion_ids: [alex, sam], delay_reason: 'Weather', actual_departure_time: '11:15', actual_arrival_time: '14:30' }),
      F(16, '2026-01-17', 'easyJet', 'U28022', 'Airbus A320neo', 'Economy', '15C', 'FAO', 'LGW', '14:05', '17:25', { companion_ids: [alex, sam] }),
      F(17, '2026-07-02', 'Jet2.com', 'LS731', 'Airbus A321neo', 'Economy', '8A', 'LBA', 'TFS', '06:00', '10:25', { companion_ids: [alex] }),
      F(18, '2026-07-09', 'Jet2.com', 'LS732', 'Airbus A321neo', 'Economy', '8B', 'TFS', 'LBA', '11:20', '17:40', { companion_ids: [alex], delay_reason: 'Crew Scheduling', actual_departure_time: '12:05', actual_arrival_time: '18:25' }),
      F(19, '2026-09-05', 'British Airways', 'BA5', 'Boeing 787-9', 'Business', '11K', 'LHR', 'HND', '12:35', '09:00'),
    ];
    Object.entries({1: "PH-EZK", 2: "PH-EZM", 3: "G-UZHA", 4: "G-UZHB", 5: "G-XWBA", 6: "A6-EEO", 7: "A6-EOB", 8: "G-XWBB", 9: "EI-DLK", 10: "EI-DLM", 11: "G-EUPT", 12: "G-EUUA", 13: "N123UA", 14: "N456UA", 15: "G-EZWA", 16: "G-UZHC", 17: "G-JZHA", 18: "G-JZHB", 19: "G-ZBKA"}).forEach(([n, r]) => { flights[n - 1].aircraft_registration = r; });
    // One total per booking, kept on the first flight (flight 11 is left blank to show "Not recorded").
    Object.entries({ 1: 189.5, 3: 342, 5: 1865.4, 9: 412.75, 13: 598.2, 15: 331, 17: 612.9, 19: 4120 }).forEach(([n, v]) => { flights[n - 1].price = v; });
    for (const [t, out, ret] of TRIPS) {
      [[out, 'outbound'], [ret, 'return']].forEach(([nums, direction]) => nums.forEach((n, i) => {
        Object.assign(flights[n - 1], { trip_id: 'demo-trip-' + t, direction, leg_order: i });
      }));
    }
    return {
      settings: { distance_unit: 'km', home_country: 'United Kingdom' },
      companions: [
        { id: alex, name: 'Alex', relationship: 'Partner' },
        { id: sam, name: 'Sam', relationship: 'Friend' },
        { id: mum, name: 'Mum', relationship: 'Family' },
      ],
      customAirports: [],
      flights,
    };
  }

  /* -------------------------------------------------------------------- state */

  let state;
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: stay in memory */ } }
  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && Array.isArray(s.flights)) return s; }
    } catch (e) { /* fall through to seed */ }
    return seed();
  }
  state = loadState();
  persist();

  const baseAirports = new Map();
  for (const r of window.FL_AIRPORTS) baseAirports.set(r[0], { iata: r[0], icao: r[1], name: r[2], city: r[3], country: r[4], lat: r[5], lon: r[6], tz: r[7] || null });
  const allAirports = () => [...baseAirports.values(), ...state.customAirports.filter((a) => !baseAirports.has(a.iata))];
  const getAirport = (iata) => baseAirports.get(String(iata || '').toUpperCase()) || state.customAirports.find((a) => a.iata === String(iata || '').toUpperCase());

  /* ----------------------------------------------------------------- helpers */

  function airportOut(a) { return { iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon, tz: a.tz || null }; }

  function listFlights() {
    return [...state.flights]
      .sort((a, b) => (b.date.localeCompare(a.date)) || String(b.created_at).localeCompare(String(a.created_at)))
      .map((f) => ({
        id: f.id, date: f.date, airline: f.airline, flight_number: f.flight_number,
        aircraft_type: f.aircraft_type, seat_class: f.seat_class, seat_number: f.seat_number,
        distance_km: f.distance_km != null ? f.distance_km : core.haversineKm(getAirport(f.from_iata), getAirport(f.to_iata)),
        departure_time: f.departure_time, arrival_time: f.arrival_time,
        actual_departure_time: f.actual_departure_time, actual_arrival_time: f.actual_arrival_time,
        delay_reason: f.delay_reason, aircraft_registration: f.aircraft_registration || null, price: f.price == null ? null : f.price,
        trip_id: f.trip_id || null, direction: f.direction || 'outbound', leg_order: f.leg_order || 0,
        from_airport: airportOut(getAirport(f.from_iata)),
        to_airport: airportOut(getAirport(f.to_iata)),
        companions: (f.companion_ids || []).map((id) => state.companions.find((c) => c.id === id)).filter(Boolean)
          .map((c) => ({ id: c.id, name: c.name, relationship: c.relationship })).sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }

  function timeOrNull(v, label) {
    const s = str(v, 8);
    if (!s) return null;
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) throw new HttpError(400, label + ' must be a time like 14:30');
    return s.slice(0, 5);
  }

  function priceOrNull(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new HttpError(400, 'price must be an amount like 249.99');
    return Math.round(n * 100) / 100;
  }

  function cleanFlight(b) {
    const date = str(b.date, 10);
    const airline = str(b.airline);
    const from_iata = str(b.from_iata, 3);
    const to_iata = str(b.to_iata, 3);
    if (!from_iata || !to_iata || !date || !airline) throw new HttpError(400, 'from_iata, to_iata, date, and airline are required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime())) throw new HttpError(400, 'date must be YYYY-MM-DD');
    return {
      date, airline, from_iata: from_iata.toUpperCase(), to_iata: to_iata.toUpperCase(),
      flight_number: str(b.flight_number, 12), aircraft_type: str(b.aircraft_type, 60),
      seat_class: str(b.seat_class, 30), seat_number: str(b.seat_number, 8),
      departure_time: timeOrNull(b.departure_time, 'departure_time'), arrival_time: timeOrNull(b.arrival_time, 'arrival_time'),
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
    const ids = Array.isArray(b.companion_ids) ? [...new Set(b.companion_ids.map(String))] : [];
    return { ...f, distance_km: core.haversineKm(from, to), companion_ids: ids.filter((cid) => state.companions.some((c) => c.id === cid)) };
  }

  function storeFlight(id, row, trip) {
    if (!id) {
      const t = trip || { trip_id: null, direction: 'outbound', leg_order: 0 };
      const created = { ...row, ...t, id: uid(), created_at: new Date().toISOString() };
      state.flights.push(created);
      return created.id;
    }
    const i = state.flights.findIndex((x) => x.id === id);
    state.flights[i] = { ...state.flights[i], ...row, ...(trip || {}) };
    return id;
  }

  function writeFlight(id, b) {
    const row = prepareFlight(b);
    const out = storeFlight(id, row, null);
    persist();
    return out;
  }

  /* trips: see server/index.js for the model */
  const MAX_LEGS = 12;

  function tripRows(key) {
    let rows = state.flights.filter((f) => f.trip_id === key);
    if (!rows.length) rows = state.flights.filter((f) => f.id === key && !f.trip_id);
    const dir = (f) => (f.direction === 'return' ? 1 : 0);
    return rows.sort((a, b) => dir(a) - dir(b) || (a.leg_order || 0) - (b.leg_order || 0) || a.date.localeCompare(b.date));
  }

  function getTrip(key) {
    const rows = tripRows(key);
    if (!rows.length) throw new HttpError(404, 'Trip not found');
    return {
      trip_id: rows[0].trip_id || null,
      type: rows.some((r) => r.direction === 'return') ? 'return' : 'oneway',
      legs: rows.map((r) => ({ ...r, direction: r.direction || 'outbound', companion_ids: r.companion_ids || [] })),
    };
  }

  function saveTrip(key, b) {
    b = b || {};
    const type = b.type === 'return' ? 'return' : 'oneway';
    const legsIn = Array.isArray(b.legs) ? b.legs : [];
    const outbound = legsIn.filter((l) => l && l.direction !== 'return');
    const inbound = type === 'return' ? legsIn.filter((l) => l && l.direction === 'return') : [];
    if (!outbound.length) throw new HttpError(400, 'A trip needs at least one outbound flight.');
    if (type === 'return' && !inbound.length) throw new HttpError(400, 'A return trip needs at least one return flight.');
    if (outbound.length > MAX_LEGS || inbound.length > MAX_LEGS) throw new HttpError(400, 'At most ' + MAX_LEGS + ' flights per direction.');
    const companionIds = Array.isArray(b.companion_ids) ? b.companion_ids : [];
    const ordered = [
      ...outbound.map((l, i) => ({ l, direction: 'outbound', leg_order: i })),
      ...inbound.map((l, i) => ({ l, direction: 'return', leg_order: i })),
    ].map((x) => ({ ...x, row: prepareFlight({ ...x.l, companion_ids: companionIds }) }));
    const existing = key ? tripRows(key) : [];
    if (key && !existing.length) throw new HttpError(404, 'Trip not found');
    const standalone = ordered.length === 1 && type === 'oneway';
    const tripId = standalone ? null : ((existing[0] && existing[0].trip_id) || uid());
    const keep = new Set();
    let first = null;
    for (const x of ordered) {
      const reuse = x.l.id && existing.some((r) => r.id === String(x.l.id)) && !keep.has(String(x.l.id)) ? String(x.l.id) : null;
      const id = storeFlight(reuse, x.row, { trip_id: tripId, direction: x.direction, leg_order: x.leg_order });
      keep.add(id);
      if (!first) first = id;
    }
    state.flights = state.flights.filter((f) => keep.has(f.id) || !existing.some((r) => r.id === f.id));
    persist();
    return tripId || first;
  }

  /* ------------------------------------------------------------------ router */

  function route(method, pathname, query, body) {
    if (pathname === '/api/health') return [200, { ok: true }];

    if (pathname === '/api/flights') {
      if (method === 'GET') return [200, { flights: listFlights() }];
      if (method === 'POST') return [201, { id: writeFlight(null, body || {}) }];
      throw new HttpError(405, 'Method not allowed');
    }

    let m = pathname.match(/^\/api\/flights\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const row = state.flights.find((f) => f.id === id);
      if (!row) throw new HttpError(404, 'Flight not found');
      if (method === 'GET') return [200, { ...row, companion_ids: row.companion_ids || [] }];
      if (method === 'PUT') { writeFlight(id, body || {}); return [200, { id }]; }
      if (method === 'DELETE') { state.flights = state.flights.filter((f) => f.id !== id); persist(); return [204, null]; }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/trips' && method === 'POST') return [201, { id: saveTrip(null, body) }];
    m = pathname.match(/^\/api\/trips\/([^/]+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (method === 'GET') return [200, getTrip(key)];
      if (method === 'PUT') return [200, { id: saveTrip(key, body) }];
      if (method === 'DELETE') {
        const rows = tripRows(key);
        if (!rows.length) throw new HttpError(404, 'Trip not found');
        state.flights = state.flights.filter((f) => !rows.includes(f));
        persist();
        return [204, null];
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/airports') {
      if (method === 'GET') {
        const q = String(query.get('q') || '').trim();
        if (!q) return [200, { airports: [] }];
        const needle = q.toLowerCase();
        const hits = allAirports().filter((a) =>
          [a.iata, a.icao, a.name, a.city].some((v) => v && String(v).toLowerCase().includes(needle)));
        hits.sort((a, b) => {
          const ea = (a.iata || '').toLowerCase() === needle || (a.icao || '').toLowerCase() === needle ? 0 : 1;
          const eb = (b.iata || '').toLowerCase() === needle || (b.icao || '').toLowerCase() === needle ? 0 : 1;
          return ea - eb || a.name.localeCompare(b.name);
        });
        return [200, { airports: hits.slice(0, 25) }];
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
        const code = iata.toUpperCase();
        const tz = str(b.tz, 64);
        if (tz && !core.validTz(tz)) throw new HttpError(400, 'Unknown time zone "' + tz + '". Use a name like Europe/London.');
        if (!getAirport(code)) {
          state.customAirports.push({ iata: code, icao: str(b.icao, 4), name: str(b.name), city: str(b.city), country: str(b.country), lat, lon, tz });
          persist();
        }
        return [201, { iata: code }];
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/companions') {
      if (method === 'GET') return [200, { companions: [...state.companions].sort((a, b) => a.name.localeCompare(b.name)) }];
      if (method === 'POST') {
        const name = str((body || {}).name, 100);
        if (!name) throw new HttpError(400, 'name is required');
        const c = { id: uid(), name, relationship: str((body || {}).relationship, 60) };
        state.companions.push(c);
        persist();
        return [201, c];
      }
      throw new HttpError(405, 'Method not allowed');
    }

    m = pathname.match(/^\/api\/companions\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const c = state.companions.find((x) => x.id === id);
      if (!c) throw new HttpError(404, 'Companion not found');
      if (method === 'DELETE') {
        state.companions = state.companions.filter((x) => x.id !== id);
        state.flights.forEach((f) => { f.companion_ids = (f.companion_ids || []).filter((x) => x !== id); });
        persist();
        return [204, null];
      }
      if (method === 'PUT') {
        c.name = str((body || {}).name, 100) || c.name;
        if ('relationship' in (body || {})) c.relationship = str(body.relationship, 60);
        persist();
        return [200, c];
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/account/settings') {
      if (method === 'GET') return [200, { ...state.settings }];
      if (method === 'PUT') {
        const b = body || {};
        if (b.distance_unit && !['km', 'mi'].includes(b.distance_unit)) throw new HttpError(400, "distance_unit must be 'km' or 'mi'");
        if (b.distance_unit) state.settings.distance_unit = b.distance_unit;
        if ('home_country' in b) state.settings.home_country = str(b.home_country);
        persist();
        return [200, { ...state.settings }];
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/countries' && method === 'GET') return [200, { countries: core.countryCenters(allAirports()) }];
    if (pathname === '/api/stats' && method === 'GET') return [200, core.computeStats(listFlights(), state.settings.home_country)];

    if (pathname === '/api/export' && method === 'GET') {
      const used = new Set(state.flights.flatMap((f) => [f.from_iata, f.to_iata]));
      return [200, {
        app: 'flightlog', version: 1, exported_at: new Date().toISOString(), settings: { ...state.settings },
        companions: state.companions, airports: allAirports().filter((a) => used.has(a.iata)),
        flights: state.flights.map((f) => ({ ...f, distance_km: f.distance_km != null ? f.distance_km : core.haversineKm(getAirport(f.from_iata), getAirport(f.to_iata)) })),
      }];
    }

    if (pathname === '/api/import' && method === 'POST') {
      const data = body;
      if (!data || !Array.isArray(data.flights)) throw new HttpError(400, 'This does not look like a FlightLog export (no "flights" list).');
      if (query.get('mode') === 'replace') { state.flights = []; state.companions = []; }
      for (const a of Array.isArray(data.airports) ? data.airports : []) {
        if (a && a.iata && a.name && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) && !getAirport(a.iata)) {
          state.customAirports.push({ iata: String(a.iata).toUpperCase(), icao: str(a.icao, 4), name: String(a.name), city: str(a.city), country: str(a.country), lat: Number(a.lat), lon: Number(a.lon), tz: a.tz && core.validTz(a.tz) ? String(a.tz) : null });
        }
      }
      for (const c of Array.isArray(data.companions) ? data.companions : []) {
        if (c && c.id && c.name && !state.companions.some((x) => x.id === String(c.id))) state.companions.push({ id: String(c.id), name: String(c.name).slice(0, 100), relationship: str(c.relationship, 60) });
      }
      let imported = 0;
      const skipped = [];
      for (const raw of data.flights) {
        try {
          const f = cleanFlight({ ...raw, date: raw && raw.date ? String(raw.date).slice(0, 10) : '' });
          const from = getAirport(f.from_iata);
          const to = getAirport(f.to_iata);
          if (!from || !to) throw new Error('unknown airport ' + (!from ? f.from_iata : f.to_iata));
          const id = raw.id ? String(raw.id) : uid();
          const row = {
            ...f, id, trip_id: raw.trip_id ? String(raw.trip_id).slice(0, 64) : null,
            direction: raw.direction === 'return' ? 'return' : 'outbound', leg_order: Number.isInteger(raw.leg_order) ? raw.leg_order : 0,
            created_at: raw.created_at || new Date().toISOString(),
            distance_km: Number.isFinite(Number(raw.distance_km)) && raw.distance_km !== null ? Number(raw.distance_km) : core.haversineKm(from, to),
            companion_ids: (Array.isArray(raw.companion_ids) ? raw.companion_ids : []).map(String).filter((cid) => state.companions.some((c) => c.id === cid)),
          };
          const i = state.flights.findIndex((x) => x.id === id);
          if (i >= 0) state.flights[i] = row; else state.flights.push(row);
          imported += 1;
        } catch (e) {
          skipped.push((raw && raw.date ? raw.date : '?') + ': ' + e.message);
        }
      }
      if (data.settings && ['km', 'mi'].includes(data.settings.distance_unit)) state.settings.distance_unit = data.settings.distance_unit;
      if (data.settings && data.settings.home_country) state.settings.home_country = String(data.settings.home_country);
      persist();
      return [200, { imported, skipped }];
    }

    throw new HttpError(404, 'Not found');
  }

  async function handle(path, opts) {
    const method = String(opts.method || 'GET').toUpperCase();
    const url = new URL(path, 'http://demo.local/');
    let body;
    try { body = opts.body ? JSON.parse(opts.body) : undefined; } catch (e) { return respond(400, { error: 'Invalid JSON body' }); }
    try {
      const out = route(method, url.pathname, url.searchParams, body);
      return respond(out[0], out[1]);
    } catch (e) {
      if (e instanceof HttpError) return respond(e.status, { error: e.message });
      console.error(e);
      return respond(500, { error: 'Internal demo error' });
    }
  }

  function respond(status, data) {
    // Deep-copy so the UI can never mutate stored state by accident.
    const copy = data === null || data === undefined ? null : JSON.parse(JSON.stringify(data));
    return { ok: status >= 200 && status < 300, status, json: async () => copy };
  }

  window.FL_TEST_API = {
    handle,
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } state = seed(); persist(); },
  };
})();
