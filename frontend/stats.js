/*
 * FlightLog statistics page.
 * FLStats.mount(root, flights, { home, unit }) draws the whole page into `root`
 * from the rows returned by GET /api/flights. No dependencies; needs shared/core.js (FLCore)
 * and world.js (window.FL_WORLD, window.FL_COUNTRY_IDS) for the country map.
 */
(function () {
  'use strict';
  const MI = 0.621371;
  const TEMPLATE = "<div class=\"fl\" id=\"flightlog-stats\">\n  <header class=\"fl-head\" id=\"top\">\n    \n    <p class=\"fl-take\" id=\"take\" data-source=\"totals\"></p>\n  </header>\n  <div class=\"fl-controls\" id=\"controls\">\n    <nav class=\"fl-tabs toggle-pill\" role=\"tablist\" aria-label=\"Statistics sections\" id=\"nav\"></nav>\n  </div>\n\n  <section class=\"fl-sec\" id=\"time-section\" data-tab=\"trips\" role=\"tabpanel\">\n    <h2>Over time</h2>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Flights and distance per year</h3><p class=\"n\">Blue bars are flights, dark bars are distance. Each has its own scale.</p><div id=\"c-year\" data-source=\"byYear\"></div></div>\n      <div class=\"fl-card\"><h3>Flights and distance by month</h3><p class=\"n\">All years together, January to December.</p><div id=\"c-month\" data-source=\"byMonth\"></div></div>\n    </div>\n  </section>\n\n  <section class=\"fl-sec\" id=\"places\" data-tab=\"places\" role=\"tabpanel\">\n    <h2>Places</h2>\n    <p>Counted in numbers of flights and journeys, not distance.</p>\n    <div class=\"fl-tiles\" id=\"places-tiles\" style=\"grid-template-columns: repeat(2, minmax(0, 1fr));\"></div>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Departure airports</h3><p class=\"n\">Journeys that started at each airport in your home country.</p><div id=\"c-dep\" data-source=\"depAirports\"></div></div>\n      <div class=\"fl-card\"><h3>Arrival airports</h3><p class=\"n\">Where each outbound journey ended, connections ignored.</p><div id=\"c-arr\" data-source=\"arrAirports\"></div></div>\n<div class=\"fl-card fl-wide\"><h3>Countries visited</h3><p class=\"n\" id=\"n-map\">Countries you have flown to or from, home highlighted.</p><div id=\"c-map\" data-source=\"byCountry\"></div></div>\n      <div class=\"fl-card\"><h3>Country visits</h3><p class=\"n\">Flights that touched each country, home excluded.</p><div id=\"c-countries\" data-source=\"byCountry\"></div></div>\n      <div class=\"fl-card\"><h3>Route pairs</h3><p class=\"n\">Completed return trips between the same two airports.</p><div id=\"c-routes\" data-source=\"returnPairs\"></div></div>\n\n    </div>\n  </section>\n\n  <section class=\"fl-sec\" id=\"fleet\" data-tab=\"fleet\" role=\"tabpanel\">\n    <h2>Airlines and aircraft</h2>\n    <div class=\"fl-tiles\" id=\"fleet-tiles\" style=\"grid-template-columns: repeat(2, minmax(0, 1fr));\"></div>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Airlines</h3><p class=\"n\">Flights and distance flown, ranked by flights.</p><div id=\"c-airlines\" data-source=\"byAirline\"></div></div>\n      <div class=\"fl-card\"><h3>Aircraft types</h3><p class=\"n\">Flights and distance flown, ranked by flights.</p><div id=\"c-aircraft\" data-source=\"byAircraft\"></div></div>\n      <div class=\"fl-card\"><h3>Aircraft makers</h3><p class=\"n\">Flights and distance flown, ranked by flights.</p><div id=\"c-makers\" data-source=\"byManufacturer\"></div></div>\n      <div class=\"fl-card\"><h3>Cabin class</h3><p class=\"n\">Share of flights and of distance flown.</p><div id=\"c-class\" data-source=\"byClass\"></div></div>\n      <div class=\"fl-card fl-wide\"><h3>Individual aircraft</h3><p class=\"n\" id=\"n-tails\">Flown more than once, most flights first.</p><div class=\"tbl-wrap\" id=\"c-tails\" data-source=\"byTail\"></div></div>\n    </div>\n  </section>\n\n  <section class=\"fl-sec\" id=\"air\" data-tab=\"air\" role=\"tabpanel\">\n    <h2>Flights and delays</h2>\n    <div class=\"fl-tiles\" id=\"air-tiles\" ></div>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Flight length</h3><p class=\"n\">Booked time in the air, grouped by hours.</p><div id=\"c-length\" data-source=\"lengthBins totals\"></div></div>\n      <div class=\"fl-card\"><h3>Longest and shortest</h3><p class=\"n\">Three of each, by distance.</p><div class=\"tbl-wrap\" id=\"c-extremes\" data-source=\"extremes\"></div></div>\n      <div class=\"fl-card\"><h3>Punctuality</h3><p class=\"n\" id=\"n-punct\">On time includes early departures. Based on flights with an actual time logged.</p><div id=\"c-punct\" data-source=\"punct punctStats\"></div></div>\n      <div class=\"fl-card\"><h3>Why flights were late</h3><p class=\"n\">Recorded delay reasons, with the average minutes late.</p><div id=\"c-reasons\" data-source=\"delayReasons\"></div></div>\n    </div>\n  </section>\n\n  <section class=\"fl-sec\" id=\"trips\" data-tab=\"trips\" role=\"tabpanel\">\n    <h2>Trips and connections</h2>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Journey types</h3><p class=\"n\">Journeys, not flights: a return trip counts once.</p><div id=\"c-types\" data-source=\"journeyTypes\"></div></div>\n      <div class=\"fl-card\"><h3>Time away</h3><p class=\"n\">Return trips, by days between first and last flight.</p><div id=\"c-away\" data-source=\"tripLength\"></div></div>\n      <div class=\"fl-card\"><h3>Connections</h3><p class=\"n\" id=\"n-conn\">Where you changed planes.</p><div id=\"c-layovers\" data-source=\"layovers totals\"></div></div>\n    </div>\n  </section>\n\n  <section class=\"fl-sec\" id=\"spend\" data-tab=\"spend\" role=\"tabpanel\">\n    <h2>Spend</h2>\n    <p>One price per booking, taken from the total cost logged on its first flight.</p>\n    <p class=\"fl-empty\" id=\"spend-empty\" hidden>No prices logged yet. Add the total cost when you log or edit a flight and your spending will appear here.</p>\n    <div id=\"spend-body\" style=\"display:flex;flex-direction:column;gap:12px;\">\n    <div class=\"fl-tiles\" id=\"spend-tiles\" data-source=\"totals\"></div>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Spend per year</h3><p class=\"n\">Bookings by the year of the first flight.</p><div id=\"c-spendyear\" data-source=\"spendYear\"></div></div>\n      <div class=\"fl-card\"><h3>By cabin</h3><p class=\"n\">Average per booking, with cost per {U1}.</p><div id=\"c-spendclass\" data-source=\"spendClass\"></div></div>\n      <div class=\"fl-card\"><h3>By airline</h3><p class=\"n\">Total spent, with cost per {U1}.</p><div id=\"c-spendairline\" data-source=\"spendAirline\"></div></div>\n      <div class=\"fl-card\"><h3>Priciest journeys</h3><p class=\"n\">Eight most expensive bookings.</p><div class=\"tbl-wrap\" id=\"c-topspend\" data-source=\"topSpend\"></div></div>\n    </div>\n    </div>\n  </section>\n\n  <section class=\"fl-sec\" id=\"people\" data-tab=\"people\" role=\"tabpanel\">\n    <h2>Travel companions</h2>\n    <div class=\"fl-grid\">\n      <div class=\"fl-card\"><h3>Who you fly with</h3><p class=\"n\">Flights and distance shared with each person.</p><div id=\"c-people\" data-source=\"byCompanion\"></div></div>\n      <div class=\"fl-card\"><h3>Solo or together</h3><p class=\"n\">Flights with at least one companion logged.</p><div id=\"c-solo\" data-source=\"totals\"></div></div>\n    </div>\n  </section>\n</div>\n";
  const COLORS = ['#0062e3', '#05203c', '#e70866', '#ffb600', '#0b8a5a', '#8a939d'];

  /* One tidy row per flight, and one per trip, in the shape the calculations below expect. */
  function shape(api, core) {
    const sorted = [...api].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.departure_time || '').localeCompare(String(b.departure_time || '')) || (a.leg_order || 0) - (b.leg_order || 0));
    const byTrip = new Map();
    sorted.forEach((f) => { if (f.trip_id) { if (!byTrip.has(f.trip_id)) byTrip.set(f.trip_id, []); byTrip.get(f.trip_id).push(f); } });
    const rows = [];
    for (const f of sorted) {
      const a = f.from_airport, b = f.to_airport;
      const km = Number(f.distance_km) || (a && b && a.lat != null && b.lat != null ? core.haversineKm(a, b) : 0);
      const t = core.legTimes({ date: f.date, departure_time: f.departure_time, arrival_time: f.arrival_time, actual_departure_time: f.actual_departure_time, actual_arrival_time: f.actual_arrival_time, distance_km: km, from_airport: a, to_airport: b });
      const trip = f.trip_id ? byTrip.get(f.trip_id) : null;
      const type = !trip ? 'single' : trip.some((x) => x.direction === 'return') ? 'return' : 'oneway';
      const price = Number(f.price) > 0 ? Number(f.price) : null;
      rows.push({
        id: f.id, date: f.date, year: +String(f.date).slice(0, 4), month: +String(f.date).slice(5, 7), airline: f.airline || '', flight_number: f.flight_number || '',
        aircraft_type: f.aircraft_type || '', manufacturer: core.aircraftManufacturer(f.aircraft_type) || '', seat_class: f.seat_class || '',
        from_iata: a.iata, to_iata: b.iata, from_name: core.airportName(a), to_name: core.airportName(b),
        from_country: a.country || '', to_country: b.country || '', distance_km: Math.round(km * 10) / 10,
        air_min: t.sched ? t.sched.minutes : null, dep_delay_min: t.depDelay, arr_delay_min: t.arrDelay, delay_reason: f.delay_reason || '',
        trip_id: f.trip_id || '', trip_type: type, direction: f.direction || 'outbound', price,
        registration: f.aircraft_registration || '',
        companions: (f.companions || []).map((c) => c.name).filter(Boolean).join('; '),
      });
    }
    const trips = [];
    for (const [id, legs] of byTrip) {
      const out = legs.filter((l) => l.direction !== 'return'), ret = legs.filter((l) => l.direction === 'return');
      const rr = rows.filter((r) => r.trip_id === id);
      const last = legs[legs.length - 1];
      const first = out[0] || legs[0];
      const days = Math.round((Date.parse((ret.length ? ret[ret.length - 1] : last).date) - Date.parse(legs[0].date)) / 864e5);
      const end = out.length ? out[out.length - 1] : last;
      trips.push({
        trip_id: id, start: legs[0].date, year: +String(legs[0].date).slice(0, 4), type: ret.length ? 'return' : 'oneway', legs: legs.length,
        connections: Math.max(0, out.length - 1) + Math.max(0, ret.length - 1),
        origin: core.airportName(first.from_airport), destination: core.airportName(end.to_airport), destination_country: end.to_airport.country || '',
        end: last.date, days_away: ret.length ? days : null, distance_km: Math.round(rr.reduce((n, r) => n + r.distance_km, 0)),
        price: rr.reduce((n, r) => n + (r.price || 0), 0) || null,
      });
    }
    return { rows, trips };
  }

  function mount(root, api, opts) {
    opts = opts || {};
    const core = window.FLCore;
    const HOME = opts.home || '';
    const logos = { airline: opts.airlineLogo || (() => null), maker: opts.manufacturerLogo || (() => null) };
    const mi = opts.unit === 'mi';
    const K = mi ? MI : 1, U = mi ? 'mi' : 'km', UN = mi ? 'miles' : 'kilometres';
    root.innerHTML = '<div class="fl" id="flightlog-stats">' + TEMPLATE.replace(/\{U1\}/g, UN.slice(0, -1)) + '</div>';
    const host = root.firstChild;
    const ROOT = host;
    if (!api.length) {
      host.replaceChildren();
      const e = document.createElement('div'); e.className = 'empty-state';
      e.innerHTML = '<p>No flights logged yet.</p><p><a href="#/add">Log your first flight</a> and your statistics will appear here.</p>';
      host.append(e); return;
    }
    const { rows: FLIGHTS, trips: TRIPS } = shape(api, core);
    const defs = new Map(); const cache = new Map();
    const dash = {
      colors: COLORS,
      calc(id, def) { defs.set(id, def); },
      data(id) {
        if (!cache.has(id)) {
          const d = defs.get(id);
          try { cache.set(id, { status: 'ok', data: d.fn(...d.inputs.map((n) => (n === 'trips' ? TRIPS : FLIGHTS))) }); } catch (e) { cache.set(id, { status: 'error', error: e }); }
        }
        return cache.get(id);
      },
      onData(fn) { fn(); },
    };

    const nf = new Intl.NumberFormat('en');
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
  const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
  const pence = (v) => (Math.round(v * 1000) / 10).toFixed(1) + 'p';
  const TABS = [['fleet', 'Airlines & Aircraft'], ['places', 'Places'], ['air', 'Flights and delays'], ['spend', 'Spend'], ['people', 'People'], ['trips', 'Other']];
  let initial = 'fleet'; try { initial = sessionStorage.getItem('fl-stats-tab') || 'fleet'; } catch (e) { /* storage unavailable */ }
  let tab = TABS.some((t) => t[0] === initial) ? initial : 'fleet';
  let metric = 'flights';
  const expanded = new Set();

  /* ---------- calculations: every figure below is worked out from the flights and trips files ---------- */
dash.calc("byYear", { title: "Flights per year", description: "Flights and miles for each calendar year.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { const k = String(r.year); if (!k) continue; const e = m.get(k) || { label: k, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("byMonth", { title: "Flights by month", description: "Flights and miles for each month of the year, all years together.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { const k = String(r.month); if (!k) continue; const e = m.get(k) || { label: k, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("byAirline", { title: "Airlines flown", description: "Flights and miles per airline.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { const k = r.airline; if (!k) continue; const e = m.get(k) || { label: k, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("byAircraft", { title: "Aircraft types flown", description: "Flights and miles per aircraft type.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { const k = r.aircraft_type; if (!k) continue; const e = m.get(k) || { label: k, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("byManufacturer", { title: "Aircraft makers", description: "Flights and miles per aircraft manufacturer.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { const k = r.manufacturer; if (!k) continue; const e = m.get(k) || { label: k, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("byClass", { title: "Cabin classes", description: "Flights and miles per cabin class.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { const k = r.seat_class; if (!k) continue; const e = m.get(k) || { label: k, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("depAirports", { title: "Departure airports", description: "Journeys that started at each airport in your home country.", inputs: ["flights"], fn: (flights) => { const home = HOME; const first = new Map(); for (const r of flights) { if (r.direction !== 'outbound') continue; const k = r.trip_id || r.id; if (!first.has(k)) first.set(k, r); } const m = new Map(); for (const r of first.values()) { if (r.from_country !== home) continue; const e = m.get(r.from_iata) || { label: r.from_name, code: r.from_iata, journeys: 0 }; e.journeys += 1; m.set(r.from_iata, e); } return [...m.values()]; } });
dash.calc("arrAirports", { title: "Arrival airports", description: "Where each outbound journey ended, ignoring connections.", inputs: ["flights"], fn: (flights) => { const last = new Map(); for (const r of flights) { if (r.direction !== 'outbound') continue; last.set(r.trip_id || r.id, r); } const m = new Map(); for (const r of last.values()) { const e = m.get(r.to_iata) || { label: r.to_name, code: r.to_iata, country: r.to_country, journeys: 0 }; e.journeys += 1; m.set(r.to_iata, e); } return [...m.values()]; } });
dash.calc("byCountry", { title: "Country visits", description: "Flights that touched each country outside your home country.", inputs: ["flights"], fn: (flights) => { const home = HOME; const m = new Map(); for (const r of flights) for (const c of new Set([r.from_country, r.to_country])) { if (!c || c === home) continue; const e = m.get(c) || { label: c, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(c, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("returnPairs", { title: "Route pairs", description: "Completed return trips for each pair of airports: the outbound start and its final destination.", inputs: ["trips"], fn: (trips) => { const today = new Date().toISOString().slice(0, 10); const m = new Map(); for (const t of trips) { if (t.type !== 'return' || t.end > today) continue; const k = t.origin + '|' + t.destination; const e = m.get(k) || { label: t.origin + ' \u21c4 ' + t.destination, trips: 0 }; e.trips += 1; m.set(k, e); } return [...m.values()]; } });
dash.calc("byCompanion", { title: "Travel companions", description: "Flights and miles shared with each companion.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) for (const n of r.companions ? r.companions.split('; ') : []) { const e = m.get(n) || { label: n, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(n, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("byTail", { title: "Aircraft registrations", description: "Flights per individual aircraft registration (sample values).", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { if (!r.registration) continue; const e = m.get(r.registration) || { label: r.registration, type: r.aircraft_type, airline: r.airline, flights: 0, miles: 0 }; e.flights += 1; e.miles += r.distance_km * K; m.set(r.registration, e); } return [...m.values()].map((e) => ({ label: e.label, type: e.type, airline: e.airline, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("delayReasons", { title: "Delay reasons", description: "Delayed flights per recorded reason, with the average minutes late.", inputs: ["flights"], fn: (flights) => { const m = new Map(); for (const r of flights) { if (!r.delay_reason) continue; const d = r.arr_delay_min !== null ? r.arr_delay_min : r.dep_delay_min; const e = m.get(r.delay_reason) || { label: r.delay_reason, flights: 0, total: 0, n: 0 }; e.flights += 1; if (d !== null) { e.total += d; e.n += 1; } m.set(r.delay_reason, e); } return [...m.values()].map((e) => ({ label: e.label, flights: e.flights, avg_min: e.n ? Math.round(e.total / e.n) : null })); } });
dash.calc("lengthBins", { title: "Flight length", description: "Flights, and the miles they covered, by booked time in the air.", inputs: ["flights"], fn: (flights) => { const labels = ['Under 1 hour', '1\u20132 hours', '2\u20133 hours', '3\u20135 hours', '5\u20138 hours', '8+ hours']; const rows = labels.map((l) => ({ label: l, flights: 0, miles: 0 })); for (const r of flights) { if (r.air_min === null) continue; const h = r.air_min / 60; const b = h < 1 ? 0 : h < 2 ? 1 : h < 3 ? 2 : h < 5 ? 3 : h < 8 ? 4 : 5; rows[b].flights += 1; rows[b].miles += r.distance_km * K; } return rows.map((e) => ({ label: e.label, flights: e.flights, miles: Math.round(e.miles) })); } });
dash.calc("punct", { title: "Punctuality", description: "Flights with a recorded actual time: on time (including early), up to an hour late, over an hour late.", inputs: ["flights"], fn: (flights) => { const rows = [{ label: 'On Time', flights: 0 }, { label: 'Up to an hour late', flights: 0 }, { label: 'Over an hour late', flights: 0 }]; for (const r of flights) { const d = r.arr_delay_min !== null ? r.arr_delay_min : r.dep_delay_min; if (d === null) continue; rows[d < 15 ? 0 : d <= 60 ? 1 : 2].flights += 1; } return rows; } });
dash.calc("punctStats", { title: "Delay summary", description: "How many flights have actual times, and how late the late ones were.", inputs: ["flights"], fn: (flights) => { let tracked = 0, late = 0, total = 0, worst = 0; for (const r of flights) { const d = r.arr_delay_min !== null ? r.arr_delay_min : r.dep_delay_min; if (d === null) continue; tracked += 1; if (d >= 15) { late += 1; total += d; if (d > worst) worst = d; } } return [{ tracked, late, avg_late: late ? Math.round(total / late) : 0, worst }]; } });
dash.calc("journeyTypes", { title: "Journey types", description: "Return trips, one-way trips with connections, and single flights.", inputs: ["flights", "trips"], fn: (flights, trips) => { const ret = trips.filter((t) => t.type === 'return'); const one = trips.filter((t) => t.type === 'oneway'); const single = flights.filter((r) => r.trip_id === ''); return [{ label: 'Return trips', journeys: ret.length, flights: ret.reduce((n, t) => n + t.legs, 0) }, { label: 'One-way with connections', journeys: one.length, flights: one.reduce((n, t) => n + t.legs, 0) }, { label: 'Single flights', journeys: single.length, flights: single.length }]; } });
dash.calc("tripLength", { title: "Time away", description: "Return trips grouped by days between the first and last flight.", inputs: ["trips"], fn: (trips) => { const labels = ['Up to 3 days', '4\u20137 days', '8\u201314 days', '15+ days']; const rows = labels.map((l) => ({ label: l, trips: 0 })); for (const t of trips) { if (t.days_away === null) continue; const d = t.days_away; rows[d <= 3 ? 0 : d <= 7 ? 1 : d <= 14 ? 2 : 3].trips += 1; } return rows; } });
dash.calc("layovers", { title: "Connection airports", description: "Where connecting flights changed planes.", inputs: ["flights"], fn: (flights) => { const m = new Map(); let prev = ''; for (const r of flights) { const key = r.trip_id ? r.trip_id + '|' + r.direction : ''; if (key && key === prev) { const e = m.get(r.from_iata) || { label: r.from_name, code: r.from_iata, flights: 0 }; e.flights += 1; m.set(r.from_iata, e); } prev = key; } return [...m.values()]; } });
dash.calc("spendYear", { title: "Spend per year", description: "Money spent on bookings made in each year (sample prices).", inputs: ["flights"], fn: (flights) => { const mi = new Map(); for (const r of flights) { const k = r.trip_id || r.id; mi.set(k, (mi.get(k) || 0) + r.distance_km * K); } const m = new Map(); for (const r of flights) { if (r.price === null) continue; const k = String(r.year); if (!k) continue; const e = m.get(k) || { label: k, spend: 0, bookings: 0, miles: 0 }; e.spend += r.price; e.bookings += 1; e.miles += mi.get(r.trip_id || r.id); m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, spend: Math.round(e.spend), bookings: e.bookings, miles: Math.round(e.miles), per_booking: Math.round(e.spend / e.bookings), per_mile: Math.round((e.spend / e.miles) * 1000) / 1000 })); } });
dash.calc("spendClass", { title: "Spend by cabin", description: "Spend per booking by cabin class (sample prices).", inputs: ["flights"], fn: (flights) => { const mi = new Map(); for (const r of flights) { const k = r.trip_id || r.id; mi.set(k, (mi.get(k) || 0) + r.distance_km * K); } const m = new Map(); for (const r of flights) { if (r.price === null) continue; const k = r.seat_class; if (!k) continue; const e = m.get(k) || { label: k, spend: 0, bookings: 0, miles: 0 }; e.spend += r.price; e.bookings += 1; e.miles += mi.get(r.trip_id || r.id); m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, spend: Math.round(e.spend), bookings: e.bookings, miles: Math.round(e.miles), per_booking: Math.round(e.spend / e.bookings), per_mile: Math.round((e.spend / e.miles) * 1000) / 1000 })); } });
dash.calc("spendAirline", { title: "Spend by airline", description: "Spend per booking by airline of the first flight (sample prices).", inputs: ["flights"], fn: (flights) => { const mi = new Map(); for (const r of flights) { const k = r.trip_id || r.id; mi.set(k, (mi.get(k) || 0) + r.distance_km * K); } const m = new Map(); for (const r of flights) { if (r.price === null) continue; const k = r.airline; if (!k) continue; const e = m.get(k) || { label: k, spend: 0, bookings: 0, miles: 0 }; e.spend += r.price; e.bookings += 1; e.miles += mi.get(r.trip_id || r.id); m.set(k, e); } return [...m.values()].map((e) => ({ label: e.label, spend: Math.round(e.spend), bookings: e.bookings, miles: Math.round(e.miles), per_booking: Math.round(e.spend / e.bookings), per_mile: Math.round((e.spend / e.miles) * 1000) / 1000 })); } });
dash.calc("topSpend", { title: "Priciest journeys", description: "The eight most expensive bookings (sample prices).", inputs: ["trips"], fn: (trips) => trips.filter((t) => t.price !== null).sort((a, b) => b.price - a.price).slice(0, 8).map((t) => ({ label: t.origin + (t.type === 'return' ? ' \u21c4 ' : ' \u2192 ') + t.destination, start: t.start, price: Math.round(t.price), miles: Math.round(t.distance_km * K), per_mile: Math.round((t.price / (t.distance_km * K)) * 1000) / 1000 })) });
dash.calc("extremes", { title: "Longest and shortest flights", description: "The three longest and three shortest flights by distance.", inputs: ["flights"], fn: (flights) => { const rows = flights.map((r) => ({ label: r.from_name + ' \u2192 ' + r.to_name, date: r.date, airline: r.airline, miles: Math.round(r.distance_km * K), hours: r.air_min === null ? null : Math.round(r.air_min / 6) / 10 })).sort((a, b) => b.miles - a.miles); return [...rows.slice(0, 3).map((e) => ({ kind: 'Longest', ...e })), ...rows.slice(-3).reverse().map((e) => ({ kind: 'Shortest', ...e }))]; } });
dash.calc("totals", { title: "Headline totals", description: "Counts and sums across every flight and trip.", inputs: ["flights", "trips"], fn: (flights, trips) => { const home = HOME; const set = (f) => new Set(flights.map(f).filter(Boolean)); const countries = new Set(); const airports = new Set(); const tails = new Map(); let km = 0, mins = 0, spend = 0, bookings = 0, withOthers = 0; for (const r of flights) { km += r.distance_km; mins += r.air_min || 0; if (r.price !== null) { spend += r.price; bookings += 1; } if (r.companions) withOthers += 1; airports.add(r.from_iata); airports.add(r.to_iata); for (const c of [r.from_country, r.to_country]) if (c && c !== home) countries.add(c); if (r.registration) tails.set(r.registration, (tails.get(r.registration) || 0) + 1); } const miles = km * K; const singles = flights.filter((r) => r.trip_id === '').length; const years = flights.map((r) => r.year); return [{ flights: flights.length, journeys: trips.length + singles, miles: Math.round(miles), hours: Math.round(mins / 60), countries: countries.size, airports: airports.size, avg_hours: flights.length ? Math.round(mins / flights.length / 6) / 10 : 0, airlines: set((r) => r.airline).size, aircraft_types: set((r) => r.aircraft_type).size, since: Math.min(...years), latest: Math.max(...years), spend: Math.round(spend), per_booking: bookings ? Math.round(spend / bookings) : 0, per_mile: miles ? Math.round((spend / miles) * 1000) / 1000 : 0, tails: tails.size, repeat_tails: [...tails.values()].filter((n) => n > 1).length, connections: trips.reduce((n, t) => n + t.connections, 0), with_others: withOthers, solo: flights.length - withOthers }]; } });

  const ok = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data : null; };
  const val = (r) => r[metric];
  const fmtMetric = (v) => nf.format(v);
  const fmtAxis = (v) => (metric === 'flights' ? nf.format(v) : compact.format(v));
  const metricWord = () => (metric === 'flights' ? 'Flights' : 'Distance');

  function prep(host, ids) {
    const rows = ids.map(ok);
    const failed = ids.some((i) => dash.data(i).status === 'error' || dash.data(i).status === 'connect');
    host.replaceChildren();
    host.classList.remove('dash-skeleton');
    if (failed) { host.append(el('div', 'fl-empty', 'Failed to load')); return null; }
    if (rows.some((r) => r === null)) { host.classList.add('dash-skeleton'); return null; }
    return rows;
  }

  function hbars(host, rows, o) {
    o = o || {};
    const value = o.value || val;
    const text = o.text || ((r) => fmtMetric(value(r)));
    const list = [...rows].sort((a, b) => value(b) - value(a) || String(a.label).localeCompare(String(b.label)));
    const key = host.id;
    const limit = o.limit || 8;
    const shown = expanded.has(key) ? list : list.slice(0, limit);
    if (!list.length) { host.append(el('div', 'fl-empty', o.empty || 'Nothing to show yet.')); return; }
    const max = Math.max(...list.map(value), 1);
    const wrap = el('div', 'hb');
    for (const r of shown) {
      const row = el('div', 'hb-row');
      const lab = el('div', 'lab');
      if (r.code && o.showCode) lab.append(el('i', '', r.code));
      lab.append(document.createTextNode(r.label));
      lab.title = (r.code && o.showCode ? r.code + ' ' : '') + r.label;
      const track = el('div', 'track'); const fill = el('div', 'fill'); fill.style.width = (value(r) / max * 100).toFixed(1) + '%'; track.append(fill);
      row.append(lab, track, el('div', 'val', text(r)));
      wrap.append(row);
    }
    host.append(wrap);
    if (list.length > limit) {
      const b = el('button', 'fl-more', expanded.has(key) ? 'Show top ' + limit : 'Show all ' + list.length);
      b.type = 'button';
      b.addEventListener('click', () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); });
      host.append(b);
    }
  }

  function columns(host, rows, o) {
    const value = o.value || val;
    const fmt = o.fmt || fmtAxis;
    const max = Math.max(...rows.map(value), 1);
    const peak = rows.reduce((p, r) => (value(r) > value(p) ? r : p), rows[0]);
    const wrap = el('div', 'cols');
    for (const r of rows) {
      const c = el('div', 'col' + (r === peak && value(r) > 0 ? ' peak' : ''));
      c.append(el('div', 'cv', value(r) > 0 ? fmt(value(r)) : ''));
      const b = el('div', 'bar'); b.style.height = (value(r) / max * 140).toFixed(1) + 'px'; c.append(b);
      c.append(el('div', 'cl', r.axis));
      wrap.append(c);
    }
    host.append(wrap);
  }


  function columnsDual(host, rows) {
    dkey(host);
    const maxF = Math.max(...rows.map((r) => r.flights), 1), maxM = Math.max(...rows.map((r) => r.miles), 1);
    const pf = rows.reduce((p, r) => (r.flights > p.flights ? r : p), rows[0]), pm = rows.reduce((p, r) => (r.miles > p.miles ? r : p), rows[0]);
    const wrap = el('div', 'cols pair'); wrap.style.marginTop = '8px';
    for (const r of rows) {
      const c = el('div', 'col');
      const v = el('div', 'cv2'); v.append(el('span', '', r.flights ? nf.format(r.flights) : ''), el('span', '', r.miles ? compact.format(r.miles) : '')); c.append(v);
      const pair = el('div', 'pair');
      [[r.flights / maxF, r === pf && r.flights > 0 ? dash.colors[0] : dash.colors[0], r.flights], [r.miles / maxM, dash.colors[1], r.miles]].forEach(([w, col, raw]) => {
        const b = el('div', 'bar'); b.style.height = (w * 140).toFixed(1) + 'px'; b.style.background = col; if (!raw) b.style.minHeight = '0'; pair.append(b);
      });
      c.append(pair, el('div', 'cl', r.axis)); wrap.append(c);
    }
    host.append(wrap);
  }


  function stacked(host, rows, value, label, keepZero) {
    const items = keepZero ? [...rows] : rows.filter((r) => value(r) > 0);
    const total = items.reduce((n, r) => n + value(r), 0);
    if (!items.length || !total) { host.append(el('div', 'fl-empty', 'Nothing to show yet.')); return; }
    if (!keepZero) items.sort((a, b) => value(b) - value(a));
    const bar = el('div', 'stack'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', items.map((r) => r.label + ' ' + Math.round(value(r) / total * 100) + '%').join(', '));
    const legend = el('div', 'legend');
    items.forEach((r, i) => {
      const s = el('span'); s.style.width = (value(r) / total * 100) + '%'; s.style.display = value(r) ? 'block' : 'none'; s.style.background = dash.colors[i % dash.colors.length]; bar.append(s);
      const row = el('div'); const sw = el('i'); sw.style.background = dash.colors[i % dash.colors.length];
      row.append(sw, el('span', '', r.label), el('span', 'c', label(r)), el('span', 'p', Math.round(value(r) / total * 100) + '%'));
      legend.append(row);
    });
    host.append(bar, legend);
  }


  function dkey(host) {
    const k = el('div', 'dkey');
    [['Flights', dash.colors[0]], ['Distance', dash.colors[1]]].forEach(([t, c]) => { const sp = el('span'); const i = el('i'); i.style.background = c; sp.append(i, t); k.append(sp); });
    host.append(k);
  }

  function hbarsDual(host, rows, limit, logoFn) {
    limit = limit || 8;
    const list = [...rows].sort((a, b) => b.flights - a.flights || b.miles - a.miles || String(a.label).localeCompare(String(b.label)));
    if (!list.length) { host.append(el('div', 'fl-empty', 'Nothing to show yet.')); return; }
    dkey(host);
    const key = host.id;
    const shown = expanded.has(key) ? list : list.slice(0, limit);
    const maxF = Math.max(...list.map((x) => x.flights), 1), maxM = Math.max(...list.map((x) => x.miles), 1);
    const wrap = el('div', 'hb'); wrap.style.marginTop = '8px';
    for (const r of shown) {
      const row = el('div', 'hb-row dual');
      const lab = el('div', 'lab', logoFn ? '' : r.label); lab.title = r.label;
      if (logoFn) {
        row.classList.add('has-logo');
        const url = logoFn(r.label);
        const box = el('span', 'logo');
        if (url) { const img = el('img'); img.src = url; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => { img.style.display = 'none'; }); box.append(img); }
        lab.append(box, el('span', 'nm', r.label));
      }
      const tracks = el('div', 'tracks');
      [[r.flights / maxF, dash.colors[0]], [r.miles / maxM, dash.colors[1]]].forEach(([w, c]) => { const t = el('div', 'track'); const f = el('div', 'fill'); f.style.width = (w * 100).toFixed(1) + '%'; f.style.background = c; t.append(f); tracks.append(t); });
      const vals = el('div', 'vals'); vals.append(el('span', '', nf.format(r.flights) + (r.flights === 1 ? ' flight' : ' flights')), el('span', '', nf.format(r.miles) + ' ' + U));
      row.append(lab, tracks, vals); wrap.append(row);
    }
    host.append(wrap);
    if (list.length > limit) {
      const b = el('button', 'fl-more', expanded.has(key) ? 'Show top ' + limit : 'Show all ' + list.length); b.type = 'button';
      b.addEventListener('click', () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); });
      host.append(b);
    }
  }

  function stackedDual(host, rows) {
    const items = rows.filter((r) => r.flights > 0).sort((a, b) => b.flights - a.flights);
    const tf = items.reduce((n, r) => n + r.flights, 0), tm = items.reduce((n, r) => n + r.miles, 0);
    if (!items.length) { host.append(el('div', 'fl-empty', 'Nothing to show yet.')); return; }
    const mk = (title, get, total) => {
      host.append(el('div', 'stack-label', title));
      const bar = el('div', 'stack'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', title + ': ' + items.map((r) => r.label + ' ' + Math.round(get(r) / total * 100) + '%').join(', '));
      items.forEach((r, i) => { const s = el('span'); s.style.width = (get(r) / total * 100) + '%'; s.style.background = dash.colors[i % dash.colors.length]; bar.append(s); });
      host.append(bar);
    };
    mk('Flights', (r) => r.flights, tf); mk('Distance', (r) => r.miles, tm || 1);
    const legend = el('div', 'legend two');
    items.forEach((r, i) => {
      const row = el('div'); const sw = el('i'); sw.style.background = dash.colors[i % dash.colors.length];
      row.append(sw, el('span', '', r.label), el('span', 'c', nf.format(r.flights) + ' (' + Math.round(r.flights / tf * 100) + '%)'), el('span', 'p', nf.format(r.miles) + ' ' + U), el('span', 'p', Math.round(r.miles / (tm || 1) * 100) + '%'));
      legend.append(row);
    });
    host.append(legend);
  }

  function table(host, heads, rows) {
    if (!rows.length) { host.append(el('div', 'fl-empty', 'Nothing to show yet.')); return; }
    const t = el('table', 'tbl'); const thead = el('thead'); const hr = el('tr');
    heads.forEach((h) => { const th = el('th', h.r ? 'r' : '', h.t); th.scope = 'col'; hr.append(th); });
    thead.append(hr); t.append(thead);
    const tb = el('tbody');
    for (const cells of rows) {
      const tr = el('tr');
      cells.forEach((c, i) => {
        const td = el('td', heads[i].r ? 'r' : '');
        if (c && typeof c === 'object') { td.append(document.createTextNode(c.main)); if (c.sub) td.append(el('span', 'sub', c.sub)); } else td.textContent = c;
        tr.append(td);
      });
      tb.append(tr);
    }
    t.append(tb); host.append(t);
  }

  function num(parent, source, field, text) { const s = el('b', '', text); s.dataset.source = source; s.dataset.field = field; parent.append(s); return s; }

  function tile(host, source, field, text, unit, label) {
    const t = el('div', 'fl-tile'); const v = el('div', 'v');
    v.dataset.source = source; v.dataset.field = field; v.append(document.createTextNode(text));
    if (unit) v.append(el('small', '', unit));
    t.append(v, el('div', 'l', label)); host.append(t);
  }

  function render() {
    ROOT.style.setProperty('--bar', dash.colors[0]);
    ROOT.style.setProperty('--peak', dash.colors[1]);
    document.querySelectorAll('#flightlog-stats .fl-sec').forEach((sec) => { sec.hidden = sec.dataset.tab !== tab; });
    document.querySelectorAll('#nav button').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); b.classList.toggle('active', b.dataset.tab === tab); });

    let r;
    const totalsRows = ok('totals');
    const T = totalsRows && totalsRows[0];

    /* headline */
    const take = $('take'); take.replaceChildren(); take.classList.toggle('dash-skeleton', !T);
    const sp = $('spend-tiles'); sp.replaceChildren();
    if (T) {
      num(take, 'totals', 'flights', nf.format(T.flights)); take.append(' flights on '); num(take, 'totals', 'journeys', nf.format(T.journeys));
      take.append(' journeys since '); num(take, 'totals', 'since', String(T.since)); take.append(': '); num(take, 'totals', 'miles', nf.format(T.miles));
      take.append(' ' + UN + ' and '); num(take, 'totals', 'hours', nf.format(T.hours)); take.append(' hours in the air, across '); num(take, 'totals', 'countries', nf.format(T.countries));
      take.append(' countries and '); num(take, 'totals', 'airlines', nf.format(T.airlines)); take.append(' airlines.');
      tile(sp, 'totals', 'spend', gbp.format(T.spend), '', 'Total spent');
      tile(sp, 'totals', 'per_booking', gbp.format(T.per_booking), '', 'Average per booking');
      tile(sp, 'totals', 'per_mile', pence(T.per_mile), '/' + U, 'Cost per ' + UN.slice(0, -1));
    }

    if (tab === 'trips') {
    /* over time */
    r = prep($('c-year'), ['byYear', 'totals']);
    if (r && T) {
      const by = new Map(r[0].map((x) => [x.label, x])); const rows = [];
      const wide = $('c-year').clientWidth > 520;
      for (let y = T.since; y <= T.latest; y++) { const x = by.get(String(y)) || { flights: 0, miles: 0 }; rows.push({ ...x, axis: wide ? String(y) : '’' + String(y).slice(2) }); }
      columnsDual($('c-year'), rows);
    }
    r = prep($('c-month'), ['byMonth']);
    if (r) {
      const by = new Map(r[0].map((x) => [x.label, x]));
      columnsDual($('c-month'), MONTHS.map((m, i) => ({ ...(by.get(String(i + 1)) || { flights: 0, miles: 0 }), axis: m.slice(0, 3) })));
    }

    }
    if (tab === 'places') {
    const pt = $('places-tiles'); pt.replaceChildren();
    if (T) { tile(pt, 'totals', 'airports', nf.format(T.airports), '', 'Airports visited'); tile(pt, 'totals', 'countries', nf.format(T.countries), '', 'Countries visited'); }
    /* places: always counts, never distance */
    const count = (k) => (x) => x[k];
    r = prep($('c-map'), ['byCountry']);
    if (r) {
      const seen = new Set(r[0].map((x) => window.FL_COUNTRY_IDS[x.label]).filter(Boolean));
      const home = window.FL_COUNTRY_IDS[HOME];
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 960 500'); svg.setAttribute('width', '100%'); svg.setAttribute('class', 'map-svg'); svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'World map with ' + seen.size + ' visited countries shaded');
      for (const c of window.FL_WORLD) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', c.d); if (c.i === home) p.setAttribute('class', 'home'); else if (seen.has(c.i)) p.setAttribute('class', 'seen'); svg.append(p); }
      const key = el('div', 'map-key');
      [['Visited', '#05203c'], ['Home', '#6f9fe0'], ['Not yet', '#d5dce4']].forEach(([t, c]) => { const sp = el('span'); const i = el('i'); i.style.background = c; sp.append(i, t); key.append(sp); });
      $('c-map').append(svg, key);
      $('n-map').textContent = r[0].length + ' countries visited besides home. Very small countries are too small to show at this scale.';
    }
    r = prep($('c-countries'), ['byCountry']); if (r) hbars($('c-countries'), r[0], { value: count('flights'), text: (x) => nf.format(x.flights) });
    r = prep($('c-routes'), ['returnPairs']); if (r) hbars($('c-routes'), r[0], { value: count('trips'), text: (x) => nf.format(x.trips) + (x.trips === 1 ? ' trip' : ' trips'), empty: 'No completed return trips yet.' });
    r = prep($('c-dep'), ['depAirports']); if (r && !HOME) $('c-dep').append(el('div', 'fl-empty', 'Set your home country in Settings to see this breakdown.')); else if (r) hbars($('c-dep'), r[0], { showCode: true, value: count('journeys'), text: (x) => nf.format(x.journeys) + (x.journeys === 1 ? ' journey' : ' journeys') });
    r = prep($('c-arr'), ['arrAirports']); if (r) hbars($('c-arr'), r[0], { showCode: true, value: count('journeys'), text: (x) => nf.format(x.journeys) + (x.journeys === 1 ? ' journey' : ' journeys') });

    }
    if (tab === 'fleet') {
    const ft = $('fleet-tiles'); ft.replaceChildren();
    if (T) { tile(ft, 'totals', 'airlines', nf.format(T.airlines), '', 'Airlines flown'); tile(ft, 'totals', 'aircraft_types', nf.format(T.aircraft_types), '', 'Aircraft types flown'); }
    /* fleet */
    r = prep($('c-airlines'), ['byAirline']); if (r) hbarsDual($('c-airlines'), r[0], 8, logos.airline);
    r = prep($('c-aircraft'), ['byAircraft']); if (r) hbarsDual($('c-aircraft'), r[0]);
    r = prep($('c-makers'), ['byManufacturer']); if (r) hbarsDual($('c-makers'), r[0], 8, logos.maker);
    r = prep($('c-class'), ['byClass']); if (r) stackedDual($('c-class'), r[0]);
    r = prep($('c-tails'), ['byTail']);
    if (r) {
      const all = r[0]; const again = all.filter((x) => x.flights > 1).sort((a, b) => b.flights - a.flights || a.label.localeCompare(b.label));
      if (!all.length) $('n-tails').textContent = 'No aircraft registrations logged yet. Add one when you log or edit a flight.';
      else $('n-tails').textContent = again.length + ' of ' + all.length + ' registrations flown more than once. Top ' + Math.min(10, again.length) + ' shown.';
      table($('c-tails'), [{ t: 'Registration' }, { t: 'Aircraft' }, { t: 'Flights', r: true }, { t: 'Distance', r: true }],
        again.slice(0, 10).map((x) => [x.label, { main: x.type || '—', sub: x.airline }, nf.format(x.flights), nf.format(x.miles) + ' ' + U]));
    }

    }
    if (tab === 'air') {
    const at = $('air-tiles'); at.replaceChildren();
    if (T) { tile(at, 'totals', 'flights', nf.format(T.flights), '', 'Number of flights'); tile(at, 'totals', 'miles', nf.format(T.miles), U, 'Distance flown'); tile(at, 'totals', 'hours', nf.format(T.hours), 'h', 'Time in the air'); }
    /* time in the air */
    r = prep($('c-length'), ['lengthBins', 'totals']);
    if (r) {
      const big = el('div', 'big'); const bb = el('b', '', r[1][0].avg_hours + ' h'); bb.dataset.source = 'totals'; bb.dataset.field = 'avg_hours';
      big.append(bb, el('span', '', 'average booked time in the air per flight'));
      $('c-length').append(big); const gap = el('div'); gap.style.height = '12px'; $('c-length').append(gap);
      columns($('c-length'), r[0].map((x) => ({ ...x, axis: x.label.replace(' hours', 'h').replace(' hour', 'h').replace('Under ', '<').replace('\u2013', '\u2013') })), {});
    }
    r = prep($('c-extremes'), ['extremes']);
    if (r) table($('c-extremes'), [{ t: '' }, { t: 'Flight' }, { t: 'Distance', r: true }, { t: 'Air time', r: true }],
      r[0].map((x) => [x.kind, { main: x.label, sub: x.airline + ' · ' + x.date }, nf.format(x.miles) + ' ' + U, x.hours === null ? '—' : x.hours + ' h']));
    r = prep($('c-punct'), ['punct', 'punctStats']);
    if (r) {
      const S = r[1][0];
      if (!S.tracked) { $('c-punct').append(el('div', 'fl-empty', 'Log actual departure or arrival times to see punctuality.')); }
      else {
        const big = el('div', 'big'); const b = el('b', '', S.avg_late + ' min'); b.dataset.source = 'punctStats'; b.dataset.field = 'avg_late';
        big.append(b, el('span', '', 'average for the ' + S.late + ' of ' + S.tracked + ' tracked flights that ran 15+ min late (worst ' + S.worst + ' min)'));
        $('c-punct').append(big); const gap = el('div'); gap.style.height = '10px'; $('c-punct').append(gap);
        stacked($('c-punct'), r[0], (x) => x.flights, (x) => nf.format(x.flights), true);
      }
    }
    r = prep($('c-reasons'), ['delayReasons']);
    if (r) hbars($('c-reasons'), r[0], { value: (x) => x.flights, text: (x) => nf.format(x.flights) + (x.avg_min === null ? '' : ' · avg ' + x.avg_min + ' min'), empty: 'No delay reasons recorded yet.' });

    }
    if (tab === 'trips') {
    /* trips */
    r = prep($('c-types'), ['journeyTypes']);
    if (r) stacked($('c-types'), r[0], (x) => x.journeys, (x) => nf.format(x.journeys) + (x.journeys ? ' (' + nf.format(x.flights) + ' flights)' : ''));
    r = prep($('c-away'), ['tripLength']);
    if (r) columns($('c-away'), r[0].map((x) => ({ ...x, axis: x.label.replace(' days', 'd').replace('Up to ', '≤') })), { value: (x) => x.trips, fmt: (v) => nf.format(v) });
    r = prep($('c-layovers'), ['layovers', 'totals']);
    if (r) {
      const n = r[1][0].connections;
      const big = el('div', 'big'); const b = el('b', '', nf.format(n)); b.dataset.source = 'totals'; b.dataset.field = 'connections';
      big.append(b, el('span', '', n === 1 ? 'connecting flight across all trips' : 'connecting flights across all trips'));
      $('c-layovers').append(big); const gap = el('div'); gap.style.height = '10px'; $('c-layovers').append(gap);
      hbars($('c-layovers'), r[0], { showCode: true, value: (x) => x.flights, text: (x) => nf.format(x.flights) + (x.flights === 1 ? ' change' : ' changes'), empty: 'No connections logged yet.' });
    }

    }
    if (tab === 'spend') {
    const noSpend = !!T && T.spend === 0;
    $('spend-empty').hidden = !noSpend;
    $('spend-body').style.display = noSpend ? 'none' : 'flex';
    if (!noSpend) {
    /* spend */
    r = prep($('c-spendyear'), ['spendYear', 'totals']);
    if (r && T) {
      const by = new Map(r[0].map((x) => [x.label, x])); const rows = [];
      const wide = $('c-spendyear').clientWidth > 520;
      for (let y = T.since; y <= T.latest; y++) { const x = by.get(String(y)) || { spend: 0 }; rows.push({ ...x, axis: wide ? String(y) : '’' + String(y).slice(2) }); }
      columns($('c-spendyear'), rows, { value: (x) => x.spend, fmt: (v) => '£' + compact.format(v) });
    }
    r = prep($('c-spendclass'), ['spendClass']);
    if (r) hbars($('c-spendclass'), r[0], { value: (x) => x.per_booking, text: (x) => gbp.format(x.per_booking) + ' · ' + pence(x.per_mile) + '/' + U });
    r = prep($('c-spendairline'), ['spendAirline']);
    if (r) hbars($('c-spendairline'), r[0], { value: (x) => x.spend, text: (x) => gbp.format(x.spend) + ' · ' + pence(x.per_mile) + '/' + U });
    r = prep($('c-topspend'), ['topSpend']);
    if (r) table($('c-topspend'), [{ t: 'Journey' }, { t: 'Price', r: true }, { t: 'Distance', r: true }, { t: 'Per ' + U, r: true }],
      r[0].map((x) => [{ main: x.label, sub: x.start }, gbp.format(x.price), nf.format(x.miles) + ' ' + U, pence(x.per_mile)]));

    }
    }
    if (tab === 'people') {
    /* people */
    r = prep($('c-people'), ['byCompanion']); if (r) hbarsDual($('c-people'), r[0]);
    const solo = $('c-solo'); solo.replaceChildren(); solo.classList.toggle('dash-skeleton', !T);
    if (T) {
      const big = el('div', 'big'); const b = el('b', '', Math.round(T.with_others / T.flights * 100) + '%');
      big.append(b, el('span', '', 'of flights had company'));
      solo.append(big); const gap = el('div'); gap.style.height = '10px'; solo.append(gap);
      stacked(solo, [{ label: 'With companions', n: T.with_others }, { label: 'Solo', n: T.solo }], (x) => x.n, (x) => nf.format(x.n));
    }
    }
  }

  /* ---------- controls ---------- */
  const nav = $('nav');
  TABS.forEach(([id, t]) => {
    const b = el('button', '', t); b.type = 'button'; b.dataset.tab = id; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { tab = id; try { sessionStorage.setItem('fl-stats-tab', id); } catch (e) { /* ignore */ } render(); });
    nav.append(b);
  });
  document.querySelectorAll('#flightlog-stats [id^="c-"]').forEach((h) => h.classList.add('dash-skeleton'));
  dash.onData(render);

  }

  window.FLStats = { mount, shape };
})();
