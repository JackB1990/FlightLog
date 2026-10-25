/* FlightLog front end: Alpine.js components + a tiny API helper. */

// Tests can set window.FL_TEST_API to replace the network layer with an in-memory implementation of the same API.
function api(path, opts) {
  if (window.FL_TEST_API) return window.FL_TEST_API.handle(path, opts || {});
  return fetch(path, opts);
}
const JSON_HEADERS = { 'Content-Type': 'application/json' };
async function apiJson(path, opts) {
  const res = await api(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
  return data;
}

/* ------------------------------------------------------------------ helpers */

const AIRLINE_COLORS = {};
const AIRLINE_COLORS2 = {};
const AIRLINE_CODES = {};
for (const a of FL_DATA.AIRLINES) {
  AIRLINE_COLORS[a.name] = a.color;
  if (a.color2) AIRLINE_COLORS2[a.name] = a.color2;
  AIRLINE_CODES[a.name] = a.code;
}

function airlineLogo(name, w, h) {
  if (name === 'Monarch Airlines') return 'logos/monarch.svg';
  const code = AIRLINE_CODES[name];
  return code ? 'https://pics.avs.io/' + w + '/' + h + '/' + code + '.png' : null;
}

function getContrast(hex) {
  if (!hex) return '#f5f1e6';
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? '#1b2430' : '#f5f1e6';
}

function lighten(hex, amt) {
  if (!hex) return '#ffffff';
  const c = hex.replace('#', '');
  let r = parseInt(c.substring(0, 2), 16);
  let g = parseInt(c.substring(2, 4), 16);
  let b = parseInt(c.substring(4, 6), 16);
  r = Math.round(r + (255 - r) * amt);
  g = Math.round(g + (255 - g) * amt);
  b = Math.round(b + (255 - b) * amt);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function groupByYear(flights) {
  const byYear = new Map();
  flights.forEach((f) => {
    const year = (f.date || '').slice(0, 4) || 'Undated';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(f);
  });
  return [...byYear.keys()].sort((a, b) => b.localeCompare(a)).map((year) => ({ year, flights: byYear.get(year) }));
}

/* ------------------------------------------------------- trips & flights model */

// Adds the display fields used by every flight card / page.
function decorateFlight(f) {
  const color = AIRLINE_COLORS[f.airline] || '#4a5568';
  const depLate = !!(f.actual_departure_time && f.departure_time && f.actual_departure_time !== f.departure_time);
  const arrLate = !!(f.actual_arrival_time && f.arrival_time && f.actual_arrival_time !== f.arrival_time);
  const core = window.FLCore;
  const t = core ? core.legTimes(f) : null;
  const shown = t && (t.actual || t.sched);
  // arrival day relative to departure (+1, +2 ...); uses real time zones when we have the times
  const dayOffset = shown ? shown.dayOffset : (f.departure_time && f.arrival_time && f.arrival_time < f.departure_time ? 1 : 0);
  return {
    ...f,
    direction: f.direction || 'outbound',
    _color: color,
    _colorText: getContrast(color),
    _logoUrl: airlineLogo(f.airline, 350, 100),
    _dep: f.actual_departure_time || f.departure_time || '\u2014',
    _arr: f.actual_arrival_time || f.arrival_time || '\u2014',
    _depLate: depLate, _arrLate: arrLate,
    _depSched: depLate ? f.departure_time : '',
    _arrSched: arrLate ? f.arrival_time : '',
    _t: t,
    _dayOffset: dayOffset,
    _nextDay: dayOffset !== 0,
    _dayText: dayOffset > 0 ? '+' + dayOffset : dayOffset < 0 ? '\u2212' + Math.abs(dayOffset) : '',
    _durMin: shown ? shown.minutes : null,
    _durText: shown ? core.fmtDuration(shown.minutes) : '',
  };
}

// "11h 15m", or "11h 40m (booked 11h 15m)" when the real flight differed from the booking.
function journeyDurationText(l) {
  const t = l._t;
  if (!t || !(t.sched || t.actual)) return '\u2014';
  const core = window.FLCore;
  if (t.actual && t.sched && t.actual.minutes !== t.sched.minutes) return core.fmtDuration(t.actual.minutes) + ' (booked ' + core.fmtDuration(t.sched.minutes) + ')';
  return core.fmtDuration((t.actual || t.sched).minutes);
}

function arrivesDateText(l) {
  const t = l._t;
  const s = t && (t.actual || t.sched);
  if (!s) return '\u2014';
  const dt = new Date(s.arrDate + 'T00:00:00Z');
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
}

// Minutes late/early -> "35min late", "On time", "1h 05m early"
function delayMinutesText(d) {
  if (d === null || d === undefined) return null;
  if (d === 0) return 'On time';
  const txt = window.FLCore.fmtDuration(Math.abs(d)).replace(/^0/, '');
  return txt + (d > 0 ? ' late' : ' early');
}

// One journey (a single flight, or several flights joined by stopovers) summarised for display.
function buildJourney(legs, label) {
  const core = window.FLCore;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const jt = core.journeyTimes(legs.map((l) => l._t || { sched: null, actual: null }));
  const best = jt.actual || jt.scheduled;
  const fs = first._t && (first._t.actual || first._t.sched);
  const ls = last._t && (last._t.actual || last._t.sched);
  const days = fs && ls ? Math.round((Date.parse(ls.arrDate + 'T00:00:00Z') - Date.parse(fs.depDate + 'T00:00:00Z')) / 86400000) : 0;
  const stops = legs.length - 1;
  const codes = legs.slice(1).map((l) => l.from_airport.iata).join(', ');
  const names = [...new Set(legs.map((l) => l.airline))];
  let durationText = best ? core.fmtDuration(best.elapsed) : '\u2014';
  if (jt.actual && jt.scheduled && jt.actual.elapsed !== jt.scheduled.elapsed) durationText += ' (booked ' + core.fmtDuration(jt.scheduled.elapsed) + ')';
  return {
    id: legs.map((l) => l.id).join('+'), label: label || '', legs, single: legs.length === 1,
    first, last, date: first.date,
    airlines: names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0],
    logos: names.slice(0, 3).map((n) => { const l = legs.find((x) => x.airline === n); return { airline: n, url: l._logoUrl, color: l._color, colorText: l._colorText }; }),
    durText: best ? core.fmtDuration(best.elapsed) : '',
    durationText,
    stops, stopsText: stops + (stops === 1 ? ' stop ' : ' stops ') + codes,
    stopsCount: stops + (stops === 1 ? ' stop' : ' stops'), stopCodes: codes,
    dayText: days > 0 ? '+' + days : days < 0 ? '\u2212' + Math.abs(days) : '',
    arrives: arrivesDateText(last),
    depTime: first._dep, depLate: first._depLate, depSched: first._depSched, depCode: first.from_airport.iata,
    arrTime: last._arr, arrLate: last._arrLate, arrSched: last._arrSched, arrCode: last.to_airport.iata,
    distance_km: legs.reduce((s, l) => s + (Number(l.distance_km) || 0), 0),
    delayed: legs.some((l) => l.delay_reason),
  };
}

// Turns a flat list of (decorated) flights into journeys: standalone flights and trips.
function buildItems(flights) {
  const items = [];
  const trips = new Map();
  flights.forEach((f) => {
    if (!f.trip_id) { items.push({ kind: 'flight', key: f.id, date: f.date, distance_km: Number(f.distance_km) || 0, legs: [f], f, delayed: !!f.delay_reason, rows: [buildJourney([f])] }); return; }
    if (!trips.has(f.trip_id)) trips.set(f.trip_id, []);
    trips.get(f.trip_id).push(f);
  });
  trips.forEach((legs, key) => {
    const order = (l) => (l.direction === 'return' ? 1 : 0);
    legs.sort((x, y) => order(x) - order(y) || (x.leg_order || 0) - (y.leg_order || 0) || x.date.localeCompare(y.date));
    const outbound = legs.filter((l) => l.direction !== 'return');
    const inbound = legs.filter((l) => l.direction === 'return');
    const first = (outbound[0] || legs[0]);
    const lastOut = (outbound[outbound.length - 1] || first);
    const seen = new Map();
    legs.forEach((l) => (l.companions || []).forEach((c) => seen.set(c.id, c)));
    const dates = legs.map((l) => l.date).sort();
    items.push({
      kind: 'trip', key, type: inbound.length ? 'return' : 'oneway',
      date: dates[0], endDate: dates[dates.length - 1],
      legs, outbound, inbound,
      origin: first.from_airport, destination: lastOut.to_airport,
      distance_km: legs.reduce((s, l) => s + (Number(l.distance_km) || 0), 0),
      delayed: legs.some((l) => l.delay_reason),
      companions: [...seen.values()],
      rows: [
        buildJourney(outbound.length ? outbound : legs, inbound.length ? 'Outbound' : ''),
        ...(inbound.length ? [buildJourney(inbound, 'Return')] : []),
      ],
    });
  });
  return items;
}

const itemAirline = (it) => it.legs[0].airline;
const dayMs = 86400000;

function fmtTripRange(a, b, longMonth) {
  const d = (s) => new Date(s + 'T00:00:00Z');
  const A = d(a), B = d(b);
  if (isNaN(A.getTime()) || isNaN(B.getTime())) return a || '—';
  const o = { timeZone: 'UTC' };
  const mon = longMonth ? 'long' : 'short';
  const full = (x) => x.toLocaleDateString('en-GB', { ...o, day: 'numeric', month: mon, year: 'numeric' });
  if (a === b) return full(A);
  if (A.getUTCFullYear() === B.getUTCFullYear()) {
    return A.toLocaleDateString('en-GB', { ...o, day: 'numeric', month: mon }) + ' – ' + full(B);
  }
  return full(A) + ' – ' + full(B);
}


const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Base map: free tiles, tinted in the app's blue by CSS (see .brand-map in theme.css), so no API key is needed.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_OPTS = { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 };
function addBaseMap(map) {
  map.getContainer().classList.add('brand-map');
  L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);
}

// A small Leaflet map showing just the given flights. The Leaflet objects live in this closure so Alpine
// never wraps them in reactive proxies.
function makeLegMap() {
  let map = null;
  let gone = false;
  const draw = (el, legs) => {
    map = L.map(el, { worldCopyJump: true, scrollWheelZoom: false });
    map.setView([20, 0], 2); // a view must exist before anything else is added
    addBaseMap(map);
    const airports = new Map();
    legs.forEach((l) => { airports.set(l.from_airport.iata, l.from_airport); airports.set(l.to_airport.iata, l.to_airport); });
    const centerLon = bestCenterLongitude([...airports.values()].map((x) => x.lon));
    const points = [];
    legs.forEach((l) => {
      const line = greatCircle(l.from_airport, l.to_airport, centerLon, 80);
      line.forEach((pt) => points.push(pt));
      continuousLines(line).forEach((seg) => L.polyline(seg, { color: '#0062e3', weight: 2.5, opacity: 0.85 }).addTo(map));
    });
    airports.forEach((x) => {
      L.circleMarker([x.lat, wrapToCenter(x.lon, centerLon)], { radius: 6, color: '#ffffff', fillColor: '#05203c', fillOpacity: 1, weight: 2 })
        .bindTooltip(escHtml(x.iata), { permanent: true, direction: 'top', offset: [0, -6], className: 'leg-map-label' })
        .bindPopup('<strong>' + escHtml(x.iata) + '</strong> \u2014 ' + escHtml(x.name) + '<br>' + escHtml(x.city || ''))
        .addTo(map);
    });
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 6 });
    // Re-measure once the page has settled, in case the panel was still being laid out.
    setTimeout(() => { if (map) { map.invalidateSize(); map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 6 }); } }, 150);
  };
  return {
    // `target` is an element id (or an element); the page may still be rendering, so wait for it to exist and have a size.
    init(target, legs) {
      if (map || typeof L === 'undefined' || !legs || !legs.length) return;
      const plain = [...legs];
      let tries = 0;
      const attempt = () => {
        if (gone || map) return;
        const el = typeof target === 'string' ? document.getElementById(target) : target;
        if (!el || !(el.offsetHeight > 0)) {
          if (++tries < 50) setTimeout(attempt, 60);
          return;
        }
        try { draw(el, plain); } catch (e) {
          if (typeof console !== 'undefined') console.error('Flight map failed', e);
          if (map) { try { map.remove(); } catch (_) { /* ignore */ } map = null; }
          el.textContent = 'The map could not be drawn.';
        }
      };
      attempt();
    },
    destroy() { gone = true; if (map) { map.remove(); map = null; } },
  };
}

function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* -------------------------------------------------------------------- shell */

const ROUTES = ['home', 'flight', 'trip', 'map', 'stats', 'add', 'companions', 'settings'];
const STRIPS = { home: 'All your flights', flight: 'Flight details', trip: 'Trip details', map: 'Where you have flown', stats: 'Your flying in numbers', add: 'Log a flight', companions: 'People you travel with', settings: 'Preferences and backups' };
const TITLES = { home: 'Flights', flight: 'Flight Details', trip: 'Trip Details', map: 'Route Map', stats: 'Statistics', add: 'Log a Flight', companions: 'Travel Companions', settings: 'Settings' };

function shell() {
  return {
    route: 'home',
    params: {},
    get stripText() { return this.route === 'add' && this.params.id ? 'Edit flight' : STRIPS[this.route]; },
    init() {
      this.parse();
      window.addEventListener('hashchange', () => this.parse());
    },
    parse() {
      const h = location.hash.replace(/^#\/?/, '');
      const parts = h.split('?');
      const name = parts[0] || 'home';
      this.params = Object.fromEntries(new URLSearchParams(parts[1] || ''));
      this.route = ROUTES.includes(name) ? name : 'home';
      document.title = TITLES[this.route] + ' — FlightLog';
      window.scrollTo(0, 0);
    },
  };
}

/* ------------------------------------------------------------ flight list */

function flightList() {
  const sortLabels = { newest: 'Newest', oldest: 'Oldest', longest: 'Longest', shortest: 'Shortest', airline: 'Airline A–Z' };
  const countBy = (list, fn) => {
    const m = new Map();
    list.forEach((f) => { const k = fn(f); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  return {
    flights: [], items: [], yearGroups: [], activeYear: '__all__', loading: true, unit: 'km', error: '',
    sort: 'newest', airlineFilter: [], classFilter: [], punctFilter: [],
    open: { year: true, airline: true, cls: true, punct: true },
    async load() {
      try {
        const [fr, settings] = await Promise.all([apiJson('api/flights'), apiJson('api/account/settings')]);
        this.unit = settings.distance_unit || 'km';
        this.flights = fr.flights.map(decorateFlight);
        this.items = buildItems(this.flights);
        this.yearGroups = groupByYear(this.items);
        this.activeYear = '__all__';
      } catch (e) {
        this.error = 'Could not load flights: ' + e.message;
      }
      this.loading = false;
    },
    /* ----- filtering and sorting ----- */
    get filtersActive() {
      return this.activeYear !== '__all__' || this.airlineFilter.length || this.classFilter.length || this.punctFilter.length;
    },
    resetFilters() { this.activeYear = '__all__'; this.airlineFilter = []; this.classFilter = []; this.punctFilter = []; },
    get airlineOptions() { return countBy(this.flights, (f) => f.airline); },
    get classOptions() { return countBy(this.flights, (f) => f.seat_class); },
    get sortLabel() { return sortLabels[this.sort] || 'Newest'; },
    get visibleItems() {
      let list = this.items.filter((it) => {
        if (this.activeYear !== '__all__' && (it.date || '').slice(0, 4) !== this.activeYear) return false;
        if (this.airlineFilter.length && !it.legs.some((l) => this.airlineFilter.includes(l.airline))) return false;
        if (this.classFilter.length && !it.legs.some((l) => this.classFilter.includes(l.seat_class))) return false;
        if (this.punctFilter.length && !this.punctFilter.includes(it.delayed ? 'Delayed' : 'On time')) return false;
        return true;
      });
      const byDate = (a, b) => b.date.localeCompare(a.date) || String(b.key).localeCompare(String(a.key));
      if (this.sort === 'oldest') list = list.sort((a, b) => -byDate(a, b));
      else if (this.sort === 'longest') list = list.sort((a, b) => b.distance_km - a.distance_km);
      else if (this.sort === 'shortest') list = list.sort((a, b) => a.distance_km - b.distance_km);
      else if (this.sort === 'airline') list = list.sort((a, b) => itemAirline(a).localeCompare(itemAirline(b)) || byDate(a, b));
      else list = list.sort(byDate);
      return list;
    },
    get tripCount() { return this.visibleItems.filter((it) => it.kind === 'trip').length; },
    get summaryLine() {
      const n = this.visibleItems.length;
      const t = this.tripCount;
      return n + (n === 1 ? ' journey' : ' journeys') + ' (' + t + (t === 1 ? ' trip' : ' trips') + ', ' + (n - t) + (n - t === 1 ? ' single flight' : ' single flights') + ')';
    },
    get newestInfo() {
      const l = [...this.visibleItems].sort((a, b) => b.date.localeCompare(a.date));
      return { value: l.length + (l.length === 1 ? ' journey' : ' journeys'), sub: l.length ? 'latest ' + this.fmtDate(l[0].date) : '—' };
    },
    routeLabel(it) {
      if (it.kind === 'flight') return it.f.from_airport.iata + ' → ' + it.f.to_airport.iata;
      return it.origin.iata + (it.type === 'return' ? ' ⇄ ' : ' → ') + it.destination.iata;
    },
    extreme(pick) {
      const l = this.visibleItems.filter((it) => it.distance_km);
      if (!l.length) return { value: '—', sub: '—' };
      const it = l.reduce((a, b) => (pick(b.distance_km, a.distance_km) ? b : a));
      return { value: this.fmtDist(it.distance_km), sub: this.routeLabel(it) };
    },
    get longestInfo() { return this.extreme((b, a) => b > a); },
    get shortestInfo() { return this.extreme((b, a) => b < a); },
    /* ----- display helpers ----- */
    initials(name) {
      const code = AIRLINE_CODES[name];
      if (code) return code;
      return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    },
    metaLine(f) {
      const bits = [f.flight_number, f.aircraft_type].filter(Boolean);
      return bits.length ? ' · ' + bits.join(' · ') : '';
    },
    sideLine(f) {
      return [f.seat_class, f.seat_number ? 'Seat ' + f.seat_number : ''].filter(Boolean).join(' · ') || ' ';
    },
    itemPrice(it) { return it.legs.reduce((n, l) => n + (Number(l.price) || 0), 0); },
    fmtMoney(v) { return '\u00a3' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    sideSummary(it) {
      const n = it.legs.length;
      const flights = n + (n === 1 ? ' flight' : ' flights');
      if (it.kind === 'flight') return 'One-way \u00b7 ' + flights;
      return (it.type === 'return' ? 'Return trip' : 'One-way trip') + ' \u00b7 ' + flights;
    },
    sideDate(it) { return it.kind === 'flight' ? this.fmtLongDate(it.f.date) : this.tripRange(it); },
    placeName(a) { return a.city || a.name; },
    tripTitle(it) { return this.placeName(it.origin) + (it.type === 'return' ? ' ⇄ ' : ' → ') + this.placeName(it.destination); },
    rowMeta(row) { return row.single ? this.metaLine(row.first) : ''; },
    rowFoot(row) { return this.placeName(row.first.from_airport) + ' to ' + this.placeName(row.last.to_airport) + ' \u00b7 ' + this.fmtDist(row.distance_km); },
    itemStopover(it) { return it.rows.some((r) => r.stops > 0); },
    rowDate(row) { return this.fmtDayDate(row.date); },
    fmtDayDate(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || '\u2014';
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
    },
    tripCounts(it) {
      const o = it.outbound.length, r = it.inbound.length;
      if (it.type === 'return') return o + (o === 1 ? ' flight out' : ' flights out') + ', ' + r + (r === 1 ? ' flight back' : ' flights back');
      return o + (o === 1 ? ' flight' : ' flights');
    },
    tripClasses(it) { return [...new Set(it.legs.map((l) => l.seat_class).filter(Boolean))].join(', ') || ' '; },
    tripRange(it) { return fmtTripRange(it.date, it.endDate, true); },
    legLine(l) {
      return l.from_airport.iata + ' → ' + l.to_airport.iata;
    },
    fmtDist(km) {
      if (!km) return '—';
      const v = this.unit === 'mi' ? km * 0.621371 : km;
      return Math.round(v).toLocaleString() + ' ' + this.unit;
    },
    fmtDate(d) {
      if (!d) return '—';
      const [y, m, day] = d.split('-');
      if (!y || !m || !day) return d;
      return day + '/' + m + '/' + y.slice(2);
    },
    fmtLongDate(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || '—';
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    },
    fmtShortDay(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || '—';
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    },
  };
}

/* ------------------------------------------------------------- flight details */

function flightDetail(id) {
  const dash = '\u2014';
  const legMap = makeLegMap();
  const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  return {
    id, f: null, loading: true, error: '', unit: 'km',
    async load() {
      try {
        const [fr, settings] = await Promise.all([apiJson('api/flights'), apiJson('api/account/settings')]);
        this.unit = settings.distance_unit || 'km';
        const found = fr.flights.find((x) => x.id === this.id);
        if (!found) { this.error = 'That flight could not be found. It may have been deleted.'; this.loading = false; return; }
        this.f = decorateFlight(found);
      } catch (e) {
        this.error = 'Could not load this flight: ' + e.message;
      }
      this.loading = false;
      if (this.f && this.$nextTick) this.$nextTick(() => legMap.init('trip-map', [this.f]));
    },
    destroy() { legMap.destroy(); },
    initials(name) {
      const code = AIRLINE_CODES[name];
      if (code) return code;
      return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    },
    fmtDist(km) {
      if (!km) return dash;
      const v = this.unit === 'mi' ? km * 0.621371 : km;
      return Math.round(v).toLocaleString() + ' ' + this.unit;
    },
    fmtLongDate(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || dash;
      return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    },
    fmtDayDate(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || dash;
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
    },
    durLabel(l) { return l._durText || this.fmtDist(l.distance_km); },
    flightTime(l) { return journeyDurationText(l); },
    arrives(l) { return arrivesDateText(l); },
    delayText(sched, actual) {
      if (!sched || !actual) return null;
      let d = mins(actual) - mins(sched);
      if (d < -720) d += 1440;
      if (d > 720) d -= 1440;
      if (d === 0) return 'On time';
      const abs = Math.abs(d);
      const txt = (abs >= 60 ? Math.floor(abs / 60) + 'h ' : '') + (abs % 60 ? (abs % 60) + 'min' : '');
      return txt.trim() + (d > 0 ? ' late' : ' early');
    },
    get flightFacts() {
      const f = this.f;
      return [
        ['Airline', f.airline], ['Flight number', f.flight_number || dash],
        ['Aircraft', f.aircraft_type || dash], ['Registration', f.aircraft_registration || dash], ['Date', this.fmtLongDate(f.date)],
      ];
    },
    get scheduleFacts() {
      const f = this.f;
      const t = f._t || {};
      const dep = delayMinutesText(t.depDelay) || this.delayText(f.departure_time, f.actual_departure_time);
      const arr = delayMinutesText(t.arrDelay) || this.delayText(f.arrival_time, f.actual_arrival_time);
      const fd = window.FLCore.fmtDuration;
      return [
        ['Scheduled departure', f.departure_time || dash], ['Actual departure', f.actual_departure_time || dash],
        ['Departure', dep || dash, !!f._depLate],
        ['Scheduled arrival', f.arrival_time || dash], ['Actual arrival', f.actual_arrival_time || dash],
        ['Arrival', arr || dash, !!f._arrLate],
        ['Booked flight time', t.sched ? fd(t.sched.minutes) : dash],
        ['Actual flight time', t.actual ? fd(t.actual.minutes) : dash],
        ['Arrives', this.arrives(f)],
        ['Punctuality', f.delay_reason ? 'Delayed' : 'On time', !!f.delay_reason],
        ['Delay reason', f.delay_reason || dash, !!f.delay_reason],
      ];
    },
    get routeFacts() {
      const a = this.f.from_airport;
      const b = this.f.to_airport;
      const km = Number(this.f.distance_km) || 0;
      const fmt = (x) => Math.round(x).toLocaleString();
      return [
        ['From', a.iata + ' \u2014 ' + a.name], ['From city', [a.city, a.country].filter(Boolean).join(', ') || dash],
        ['To', b.iata + ' \u2014 ' + b.name], ['To city', [b.city, b.country].filter(Boolean).join(', ') || dash],
        ['Distance', km ? fmt(km) + ' km / ' + fmt(km * 0.621371) + ' mi' : dash],
        ['Trip type', a.country && b.country ? (a.country === b.country ? 'Domestic' : 'International') : dash],
      ];
    },
    get seatFacts() {
      const f = this.f;
      return [
        ['Cabin class', f.seat_class || dash], ['Seat', f.seat_number || dash],
        ['Travelling with', f.companions && f.companions.length ? f.companions.map((c) => c.name + (c.relationship ? ' (' + c.relationship + ')' : '')).join(', ') : 'Travelling solo'],
        ...(Number(f.price) > 0 ? [['Total cost', this.fmtMoney(f.price)]] : []),
      ];
    },
    fmtMoney(v) { return '\u00a3' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    async del() {
      if (this.f && this.f.trip_id) return;
      if (!confirm('Remove this flight from your log?')) return;
      try { await apiJson('api/flights/' + this.id, { method: 'DELETE' }); } catch (e) { this.error = e.message; return; }
      location.hash = '#/';
    },
  };
}

/* ---------------------------------------------------------------- trip details */

function tripDetail(key) {
  const dash = '—';
  const legMap = makeLegMap();
  const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  return {
    key, item: null, loading: true, error: '', unit: 'km',
    async load() {
      try {
        const [fr, settings] = await Promise.all([apiJson('api/flights'), apiJson('api/account/settings')]);
        this.unit = settings.distance_unit || 'km';
        const legs = fr.flights.filter((f) => f.trip_id === this.key).map(decorateFlight);
        const built = buildItems(legs.length ? legs : fr.flights.filter((f) => f.id === this.key && !f.trip_id).map(decorateFlight));
        if (!built.length) { this.error = 'That trip could not be found. It may have been deleted.'; this.loading = false; return; }
        this.item = built[0];
        if (this.item.kind === 'flight') { location.hash = '#/flight?id=' + this.item.key; return; }
      } catch (e) {
        this.error = 'Could not load this trip: ' + e.message;
      }
      this.loading = false;
      if (this.item && this.$nextTick) this.$nextTick(() => legMap.init('trip-map', this.item.legs));
    },
    destroy() { legMap.destroy(); },
    initials(name) {
      const code = AIRLINE_CODES[name];
      if (code) return code;
      return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    },
    place(a) { return a.city || a.name; },
    get title() { return this.place(this.item.origin) + (this.item.type === 'return' ? ' ⇄ ' : ' → ') + this.place(this.item.destination); },
    get subtitle() {
      const it = this.item;
      return (it.type === 'return' ? 'Return trip' : 'One-way trip') + ' · ' + fmtTripRange(it.date, it.endDate);
    },
    get sections() {
      const it = this.item;
      const out = [{ id: 'outbound', label: it.type === 'return' ? 'Outbound' : 'Flights', title: it.type === 'return' ? 'Outbound Journey' : 'Your Journey', legs: it.outbound }];
      if (it.inbound.length) out.push({ id: 'return', label: 'Return', title: 'Return journey', legs: it.inbound });
      return out;
    },
    get totalCost() { return this.item ? this.item.legs.reduce((n, l) => n + (Number(l.price) || 0), 0) : 0; },
    get summaryFacts() {
      const it = this.item;
      const airlines = [...new Set(it.legs.map((l) => l.airline))].join(', ');
      const classes = [...new Set(it.legs.map((l) => l.seat_class).filter(Boolean))].join(', ');
      const km = it.distance_km;
      return [
        ['Flights', String(it.legs.length)],
        ['Total distance', this.fmtDist(km)],
        ['Airlines', airlines || dash],
        ['Cabin', classes || dash],
        ['Travelling with', it.companions.length ? it.companions.map((c) => c.name + (c.relationship ? ' (' + c.relationship + ')' : '')).join(', ') : 'Travelling solo'],
        ...(this.totalCost > 0 ? [['Total cost', this.fmtMoney(this.totalCost)]] : []),
      ];
    },
    fmtDist(km) {
      if (!km) return dash;
      const v = this.unit === 'mi' ? km * 0.621371 : km;
      return Math.round(v).toLocaleString() + ' ' + this.unit;
    },
    fmtLongDate(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || dash;
      return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    },
    fmtDayDate(d) {
      const dt = new Date(d + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return d || dash;
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
    },
    durLabel(l) { return l._durText || this.fmtDist(l.distance_km); },
    flightTime(l) { return journeyDurationText(l); },
    arrives(l) { return arrivesDateText(l); },
    delayText(sched, actual) {
      if (!sched || !actual) return null;
      let d = mins(actual) - mins(sched);
      if (d < -720) d += 1440;
      if (d > 720) d -= 1440;
      if (d === 0) return 'On time';
      const abs = Math.abs(d);
      const txt = ((abs >= 60 ? Math.floor(abs / 60) + 'h ' : '') + (abs % 60 ? (abs % 60) + 'min' : '')).trim();
      return txt + (d > 0 ? ' late' : ' early');
    },
    detailsTitle(section) {
      return section.id === 'return' ? 'Return Details' : section.label === 'Outbound' ? 'Outbound Details' : 'Flight Details';
    },
    // Per-flight facts for the details cards. Rows with nothing to show are left out.
    fmtMoney(v) { return '\u00a3' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    detailRows(l) {
      const dash = '\u2014';
      const place = (a) => a.iata + ' \u2014 ' + a.name + (a.country ? ', ' + a.country : '');
      const pair = (x, y) => (x || y ? (x || dash) + ' \u2192 ' + (y || dash) : '');
      const rows = [
        ['From', place(l.from_airport)],
        ['To', place(l.to_airport)],
        ['Airline', l.airline],
        ['Flight Number', l.flight_number],
        ['Aircraft Registration', l.aircraft_registration],
        ['Cabin Class', l.seat_class],
        ['Seat', l.seat_number],
        ['Scheduled Departure/Arrival', pair(l.departure_time, l.arrival_time)],
        ['Actual Departure/Arrival', pair(l.actual_departure_time, l.actual_arrival_time), l._depLate || l._arrLate],
        ['Reason for Delay', l.delay_reason, !!l.delay_reason],
        ['Distance', l.distance_km ? this.fmtDist(l.distance_km) : ''],
      ];
      return rows.filter((r) => r[1] !== null && r[1] !== undefined && String(r[1]).trim() !== '');
    },
    legFacts(l) {
      const dep = this.delayText(l.departure_time, l.actual_departure_time);
      const arr = this.delayText(l.arrival_time, l.actual_arrival_time);
      return [
        ['Airline', l.airline], ['Flight number', l.flight_number || dash], ['Aircraft', l.aircraft_type || dash],
        ['Cabin class', l.seat_class || dash], ['Seat', l.seat_number || dash],
        ['Scheduled', (l.departure_time || dash) + ' → ' + (l.arrival_time || dash)],
        ['Actual', (l.actual_departure_time || dash) + ' → ' + (l.actual_arrival_time || dash)],
        ['Departure', dep || dash, l._depLate], ['Arrival', arr || dash, l._arrLate],
        ['Delay reason', l.delay_reason || dash, !!l.delay_reason],
        ['From', l.from_airport.iata + ' — ' + l.from_airport.name + (l.from_airport.country ? ', ' + l.from_airport.country : '')],
        ['To', l.to_airport.iata + ' — ' + l.to_airport.name + (l.to_airport.country ? ', ' + l.to_airport.country : '')],
        ['Distance', this.fmtDist(l.distance_km)],
      ];
    },
    // Time between arriving on one leg and departing on the next, e.g. "2h 15m".
    // Booked vs actual journey and trip durations, as table rows: [label, booked, actual].
    get timeBlocks() {
      const core = window.FLCore;
      const it = this.item;
      const tt = core.tripTimes(it.outbound.map((l) => l._t), it.inbound.map((l) => l._t));
      const fd = core.fmtDuration;
      const dash = '\u2014';
      const booked = (v) => (v === null || v === undefined ? dash : fd(v));
      const actual = (a, b) => {
        if (a === null || a === undefined) return dash;
        if (b === null || b === undefined || a === b) return fd(a);
        const d = a - b;
        return fd(a) + ' (' + (d > 0 ? '+' : '\u2212') + fd(Math.abs(d)) + ')';
      };
      const journey = (title, j, legs) => {
        if (!j) return null;
        const s = j.scheduled, a = j.actual;
        const rows = [
          ['Journey Time', booked(s && s.elapsed), actual(a && a.elapsed, s && s.elapsed)],
          ['Time In The Air', booked(s && s.air), actual(a && a.air, s && s.air)],
        ];
        if (legs > 1) rows.push(['Connections', booked(s && s.layover), actual(a && a.layover, s && s.layover)]);
        return { title, rows };
      };
      const blocks = [];
      const multi = it.type === 'return';
      const o = journey(multi ? 'Outbound Journey' : 'Your Journey', tt.outbound, it.outbound.length);
      if (o) blocks.push(o);
      const r = journey('Return Journey', tt.return, it.inbound.length);
      if (r) blocks.push(r);
      const total = { title: 'Whole Trip', rows: [] };
      if (multi) {
        total.rows.push(['Total Time In The Air', booked(tt.scheduled && tt.scheduled.air), actual(tt.actual && tt.actual.air, tt.scheduled && tt.scheduled.air)]);
        total.rows.push(['Time Away', booked(tt.scheduled && tt.scheduled.away), actual(tt.actual && tt.actual.away, tt.scheduled && tt.scheduled.away)]);
      } else if (it.legs.length > 1) {
        total.rows.push(['Total Time In The Air', booked(tt.scheduled && tt.scheduled.air), actual(tt.actual && tt.actual.air, tt.scheduled && tt.scheduled.air)]);
      }
      if (total.rows.length) blocks.push(total);
      return blocks;
    },
    get timesEstimated() { return this.item.legs.some((l) => l._t && l._t.estimated); },
    get hasActualTimes() { return this.item.legs.some((l) => l._t && l._t.actual); },
    // Real elapsed minutes between landing on one flight and taking off on the next (null if unknown).
    connectionMinutes(prev, next) {
      const a = prev && prev._t && (prev._t.actual || prev._t.sched);
      const b = next && next._t && (next._t.actual || next._t.sched);
      if (!a || !b) return null;
      const m = Math.round((b.depUtc - a.arrUtc) / 60000);
      return m >= 0 && m <= 14 * 24 * 60 ? m : null;
    },
    connection(prev, next) {
      const m = this.connectionMinutes(prev, next);
      return m === null || m > 72 * 60 ? '' : window.FLCore.fmtDuration(m);
    },
    // The pink "2h 10m Connect in airport" box between two flights of one journey.
    connectInfo(prev, next) {
      const m = this.connectionMinutes(prev, next);
      if (m === null) return null;
      let label = 'Connect in airport';
      if (prev.to_airport.iata !== next.from_airport.iata) label = 'Change airport (' + prev.to_airport.iata + ' \u2192 ' + next.from_airport.iata + ')';
      else if (m >= 24 * 60) label = 'Stopover in ' + (next.from_airport.city || next.from_airport.iata);
      return { dur: window.FLCore.fmtDuration(m), label, long: m >= 240 && m < 24 * 60 };
    },
    get hasStopover() { return this.item.outbound.length > 1 || this.item.inbound.length > 1; },
    // One combined card for a journey made of several flights (a stopover).
    journeyCard(section) { return buildJourney(section.legs); },
    legConnection(section, i) {
      return i > 0 ? this.connection(section.legs[i - 1], section.legs[i]) : '';
    },
    async del() {
      if (!confirm('Remove this whole trip (' + this.item.legs.length + ' flights) from your log?')) return;
      try { await apiJson('api/trips/' + encodeURIComponent(this.key), { method: 'DELETE' }); } catch (e) { this.error = e.message; return; }
      location.hash = '#/';
    },
  };
}

/* ------------------------------------------------------------------ log form */

function flightForm(editId) {
  const emptyAirport = () => ({ iata: '', name: '', city: '', country: '', lat: '', lon: '', tz: '' });
  const MAX_LEGS = 12;
  const FIELDS = ['date', 'airline', 'flight_number', 'aircraft_type', 'seat_class', 'seat_number',
    'departure_time', 'arrival_time', 'actual_departure_time', 'actual_arrival_time', 'delay_reason', 'aircraft_registration'];
  const timers = new Map();
  let counter = 0;
  const side = (iata) => ({ query: iata || '', options: [], resolved: iata || null, addOpen: false, newAirport: emptyAirport() });
  const newLeg = (base) => {
    const b = base || {};
    const leg = { _k: ++counter, id: b.id || null, ui: { from: side(b.from_iata), to: side(b.to_iata) } };
    FIELDS.forEach((k) => { leg[k] = b[k] == null ? '' : b[k]; });
    return leg;
  };
  return {
    editId,
    type: 'oneway',
    legs: { outbound: [], return: [] },
    companion_ids: [],
    price: '',
    companions: [],
    airlines: FL_DATA.AIRLINES,
    aircraftTypes: FL_DATA.AIRCRAFT_TYPES,
    delayReasons: FL_DATA.DELAY_REASONS,
    error: '',
    saving: false,
    async load() {
      try {
        this.companions = (await apiJson('api/companions')).companions;
        if (this.editId) {
          const trip = await apiJson('api/trips/' + encodeURIComponent(this.editId));
          this.type = trip.type;
          trip.legs.forEach((l) => this.legs[l.direction === 'return' ? 'return' : 'outbound'].push(newLeg(l)));
          this.companion_ids = (trip.legs[0] && trip.legs[0].companion_ids) || [];
          const paid = trip.legs.reduce((n, l) => n + (Number(l.price) || 0), 0);
          this.price = paid > 0 ? paid.toFixed(2) : '';
        } else {
          this.legs.outbound = [newLeg({ date: localToday() })];
        }
      } catch (e) {
        this.error = e.message;
      }
    },
    /* ----- trip structure ----- */
    get dirs() { return this.type === 'return' ? ['outbound', 'return'] : ['outbound']; },
    get totalLegs() { return this.dirs.reduce((n, d) => n + this.legs[d].length, 0); },
    dirTitle(dir) {
      if (this.type === 'return') return dir === 'outbound' ? 'Outbound journey' : 'Return journey';
      return this.legs.outbound.length > 1 ? 'Your journey' : 'Your flight';
    },
    dirHint(dir) {
      if (this.type !== 'return') return this.legs.outbound.length > 1 ? 'Flights in the order you flew them.' : 'Add another flight below if you had a connection.';
      return dir === 'outbound' ? 'Flights going out, in the order you flew them.' : 'Flights coming back, in the order you flew them.';
    },
    legTitle(dir, i) {
      const n = this.legs[dir].length;
      if (n === 1) return 'Flight';
      return 'Flight ' + (i + 1) + ' of ' + n + (i > 0 ? ' · connection' : '');
    },
    addLabel(dir) { return '+ Add a connecting flight' + (this.type === 'return' ? ' to the ' + (dir === 'outbound' ? 'outbound' : 'return') + ' journey' : ''); },
    get saveLabel() {
      if (this.saving) return 'Saving…';
      if (this.editId) return 'Save Changes';
      return this.type === 'return' || this.legs.outbound.length > 1 ? 'Save Trip' : 'Save Flight';
    },
    setType(t) {
      this.type = t;
      if (t === 'return' && !this.legs.return.length) this.legs.return.push(this.returnSeed());
    },
    returnSeed() {
      const out = this.legs.outbound;
      const last = out[out.length - 1];
      const first = out[0];
      return newLeg({
        date: last.date, airline: last.airline, seat_class: last.seat_class,
        from_iata: last.ui.to.resolved || '', to_iata: first.ui.from.resolved || '',
      });
    },
    addLeg(dir) {
      const list = this.legs[dir];
      if (list.length >= MAX_LEGS) return;
      if (!list.length) { list.push(this.returnSeed()); return; }
      const prev = list[list.length - 1];
      list.push(newLeg({ date: prev.date, airline: prev.airline, seat_class: prev.seat_class, from_iata: prev.ui.to.resolved || '' }));
    },
    removeLeg(dir, i) {
      if (this.legs[dir].length > 1) this.legs[dir].splice(i, 1);
    },
    /* ----- airports ----- */
    // ---- drop-down search boxes (airports, airlines, aircraft) ----
    openKey: '', hi: 0,
    isOpen(k) { return this.openKey === k; },
    openDD(k) { this.openKey = k; this.hi = 0; },
    closeDD() { this.openKey = ''; },
    airportLabel(x) { return String(x.name || '').replace(/ Airport$/i, '') + ' (' + x.iata + ')'; },
    airportSub(x) { return [x.city && !String(x.name || '').includes(x.city) ? x.city : '', x.country].filter(Boolean).join(', '); },
    hl(text, q) {
      const t = String(text || ''), s = String(q || '').trim();
      const i = s ? t.toLowerCase().indexOf(s.toLowerCase()) : -1;
      if (i < 0) return escHtml(t);
      return escHtml(t.slice(0, i)) + '<b>' + escHtml(t.slice(i, i + s.length)) + '</b>' + escHtml(t.slice(i + s.length));
    },
    airportOptions(leg, sd) { return leg.ui[sd].options.slice(0, 8); },
    pickAirport(leg, sd, x) {
      const s = leg.ui[sd];
      s.query = this.airportLabel(x); s.resolved = x.iata; s.options = []; s.addOpen = false;
      this.closeDD();
    },
    clearAirport(leg, sd) {
      const s = leg.ui[sd];
      s.query = ''; s.resolved = null; s.options = [];
    },
    suggestions(kind, leg) {
      const list = kind === 'airline' ? this.airlines.map((x) => x.name) : this.aircraftTypes;
      const q = String(leg[kind === 'airline' ? 'airline' : 'aircraft_type'] || '').trim().toLowerCase();
      const starts = [], has = [];
      for (const n of list) {
        const l = String(n).toLowerCase();
        if (!q || l.startsWith(q)) starts.push(n); else if (l.includes(q)) has.push(n);
      }
      return starts.concat(has).slice(0, 8);
    },
    pickSuggestion(kind, leg, v) { leg[kind === 'airline' ? 'airline' : 'aircraft_type'] = v; this.closeDD(); },
    selectOptions(kind) {
      if (kind === 'seat') return [{ v: '', label: 'Not specified' }, ...['Economy', 'Premium Economy', 'Business', 'First'].map((v) => ({ v, label: v }))];
      return [{ v: '', label: 'No delay' }, ...this.delayReasons.map((v) => ({ v, label: v }))];
    },
    selectField(kind) { return kind === 'seat' ? 'seat_class' : 'delay_reason'; },
    selectLabel(kind, leg) {
      const cur = leg[this.selectField(kind)] || '';
      const o = this.selectOptions(kind).find((x) => x.v === cur);
      return o ? o.label : cur;
    },
    pickSelect(kind, leg, o) { leg[this.selectField(kind)] = o.v; this.closeDD(); },
    openSelect(k, items, cur) { if (this.isOpen(k)) { this.closeDD(); return; } this.openDD(k); this.hi = Math.max(0, items.findIndex((x) => x.v === cur)); },
    companionOptions() { return this.companions.map((c) => ({ v: c.id, label: c.name + (c.relationship ? ' (' + c.relationship + ')' : '') })); },
    companionsLabel() {
      const names = this.companionOptions().filter((o) => this.companion_ids.includes(o.v)).map((o) => o.label);
      return names.length ? names.join(', ') : 'Nobody selected';
    },
    toggleCompanion(o) {
      this.companion_ids = this.companion_ids.includes(o.v) ? this.companion_ids.filter((x) => x !== o.v) : [...this.companion_ids, o.v];
    },
    // ---- date and time pickers ----
    pick: { y: 2026, m: 0, sel: '', h: null, min: null },
    MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    openDate(key, value) {
      if (this.isOpen(key)) { this.closeDD(); return; }
      const base = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : localToday();
      this.pick = { ...this.pick, y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1, sel: value || '' };
      this.openDD(key);
    },
    monthView(offset) {
      const d = new Date(Date.UTC(this.pick.y, this.pick.m + offset, 1));
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      const lead = (d.getUTCDay() + 6) % 7; // Monday first
      const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const today = localToday();
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(null);
      for (let n = 1; n <= days; n++) {
        const iso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(n).padStart(2, '0');
        cells.push({ n, iso, today: iso === today, sel: iso === this.pick.sel });
      }
      return { title: this.MONTHS[m] + ' ' + y, cells };
    },
    stepMonth(n) { const d = new Date(Date.UTC(this.pick.y, this.pick.m + n, 1)); this.pick.y = d.getUTCFullYear(); this.pick.m = d.getUTCMonth(); },
    pickDay(c) { if (c) this.pick.sel = c.iso; },
    applyDate(leg, field) { if (this.pick.sel) leg[field] = this.pick.sel; this.closeDD(); },
    pickedDateText() { return this.pick.sel ? this.fmtPickDate(this.pick.sel) : 'Select a date'; },
    fmtPickDate(iso) {
      const dt = new Date(iso + 'T00:00:00Z');
      if (isNaN(dt.getTime())) return iso;
      return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
    },
    HOURS: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    MINUTES: Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')),
    openTime(key, value) {
      if (this.isOpen(key)) { this.closeDD(); return; }
      const m = /^(\d{2}):(\d{2})$/.exec(value || '');
      this.pick = { ...this.pick, h: m ? m[1] : null, min: m ? m[2] : null };
      this.openDD(key);
    },
    applyTime(leg, field) {
      if (this.pick.h != null) leg[field] = this.pick.h + ':' + (this.pick.min != null ? this.pick.min : '00');
      this.closeDD();
    },
    clearTime(leg, field) { leg[field] = ''; this.pick.h = null; this.pick.min = null; this.closeDD(); },
    pickedTimeText() { return this.pick.h == null ? 'Select a time' : this.pick.h + ':' + (this.pick.min != null ? this.pick.min : '00'); },
    // One total for the whole booking; it is saved on the first flight and shown as the trip's total cost.
    tidyPrice() {
      const raw = String(this.price == null ? '' : this.price).trim();
      const n = Number(raw.replace(/[^0-9.]/g, ''));
      this.price = raw === '' || !Number.isFinite(n) ? '' : n.toFixed(2);
    },
    // Typing a time: accepts 930, 9:30 or 09.30 and tidies it to HH:MM; anything unreadable clears the box.
    tidyTime(leg, field) {
      const v = String(leg[field] || '').trim();
      const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(v);
      leg[field] = m && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[1].padStart(2, '0') + ':' + m[2] : '';
    },
    // keyboard: arrows move, Enter picks, Escape closes. `items` is the list currently shown, `pick(item)` chooses one.
    ddKey(e, items, pick) {
      if (e.key === 'Escape') { this.closeDD(); return; }
      if (!items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.hi = (this.hi + 1) % items.length; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.hi = (this.hi - 1 + items.length) % items.length; }
      else if (e.key === 'Enter' && this.openKey) { e.preventDefault(); pick(items[Math.min(this.hi, items.length - 1)]); }
    },
    async searchAirport(leg, sideName) {
      const s = leg.ui[sideName];
      const trimmed = s.query.trim();
      if (/^[A-Za-z0-9]{3} /.test(trimmed)) { s.resolved = trimmed.slice(0, 3).toUpperCase(); return; }
      s.resolved = /^[A-Za-z]{3}$/.test(trimmed) ? trimmed.toUpperCase() : null;
      if (trimmed.length < 2) { s.options = []; return; }
      const tk = leg._k + sideName;
      clearTimeout(timers.get(tk));
      timers.set(tk, setTimeout(async () => {
        try { s.options = (await apiJson('api/airports?q=' + encodeURIComponent(trimmed))).airports; } catch (e) { /* ignore */ }
      }, 120));
    },
    async addAirport(leg, sideName) {
      const s = leg.ui[sideName];
      const a = s.newAirport;
      this.error = '';
      try {
        const out = await apiJson('api/airports', {
          method: 'POST', headers: JSON_HEADERS,
          body: JSON.stringify({ ...a, iata: (a.iata || '').toUpperCase(), lat: a.lat === '' ? undefined : Number(a.lat), lon: a.lon === '' ? undefined : Number(a.lon), tz: a.tz || undefined }),
        });
        s.query = out.iata + ' — ' + a.name;
        s.resolved = out.iata;
        s.addOpen = false;
        s.newAirport = emptyAirport();
      } catch (e) {
        this.error = e.message;
      }
    },
    /* ----- save ----- */
    buildPayload() {
      const legs = [];
      for (const dir of this.dirs) {
        for (let i = 0; i < this.legs[dir].length; i++) {
          const leg = this.legs[dir][i];
          const label = this.dirTitle(dir) + (this.legs[dir].length > 1 ? ', flight ' + (i + 1) : '');
          for (const sn of ['from', 'to']) {
            const s = leg.ui[sn];
            if (!s.resolved && s.options.length === 1) s.resolved = s.options[0].iata;
          }
          if (!leg.ui.from.resolved || !leg.ui.to.resolved) throw new Error(label + ': please choose a valid From and To airport.');
          if (!leg.date) throw new Error(label + ': please enter the date.');
          if (!String(leg.airline || '').trim()) throw new Error(label + ': please enter the airline.');
          const out = { direction: dir, from_iata: leg.ui.from.resolved, to_iata: leg.ui.to.resolved };
          if (leg.id) out.id = leg.id;
          FIELDS.forEach((k) => { out[k] = leg[k]; });
          out.price = dir === this.dirs[0] && i === 0 ? this.price : '';
          legs.push(out);
        }
      }
      return { type: this.type, legs, companion_ids: (this.companion_ids || []).map(String) };
    },
    async save() {
      this.error = '';
      let payload;
      try { payload = this.buildPayload(); } catch (e) { this.error = e.message; return; }
      this.saving = true;
      try {
        await apiJson(this.editId ? 'api/trips/' + encodeURIComponent(this.editId) : 'api/trips', {
          method: this.editId ? 'PUT' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload),
        });
      } catch (e) {
        this.error = e.message || 'Could not save.';
        this.saving = false;
        return;
      }
      this.saving = false;
      location.hash = '#/';
    },
  };
}

/* ----------------------------------------------------------------------- map */

function wrapToCenter(lon, center) {
  let diff = lon - center;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return center + diff;
}

function bestCenterLongitude(lons) {
  const unique = [...new Set(lons)].sort((a, b) => a - b);
  if (!unique.length) return 0;
  if (unique.length === 1) return unique[0];
  let maxGap = -1;
  let gapMid = 0;
  for (let i = 0; i < unique.length; i++) {
    const a = unique[i];
    const b = i + 1 < unique.length ? unique[i + 1] : unique[0] + 360;
    const gap = b - a;
    if (gap > maxGap) { maxGap = gap; gapMid = a + gap / 2; }
  }
  const c = gapMid + 180;
  return ((c + 180) % 360 + 360) % 360 - 180;
}

function greatCircle(from, to, centerLon, segments) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(from.lat), lon1 = toRad(from.lon), lat2 = toRad(to.lat), lon2 = toRad(to.lon);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0) return [[from.lat, wrapToCenter(from.lon, centerLon)]];
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), wrapToCenter(toDeg(Math.atan2(y, x)), centerLon)]);
  }
  return pts;
}

// Great-circle points come back wrapped into one 360-degree window, so a route that crosses the edge of that
// window would jump across the whole map. This makes the line continuous (longitudes may run past +/-180) and
// returns it with its two neighbouring world copies, so it shows however the map is panned.
function continuousLines(line) {
  const out = [];
  line.forEach(([lat, lon], i) => {
    let l = lon;
    if (i > 0) { const prev = out[i - 1][1]; while (l - prev > 180) l -= 360; while (l - prev < -180) l += 360; }
    out.push([lat, l]);
  });
  return [-360, 0, 360].map((shift) => out.map(([lat, lon]) => [lat, lon + shift]));
}

function mapView() {
  // Leaflet objects live in this closure, not on the reactive component.
  let map = null;
  let layerGroup = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return {
    routes: [], yearGroups: [], activeYear: '__all__', loading: true, error: '',
    countries: [], homeCountry: null,
    async load() {
      try {
        const [fr, cr, settings] = await Promise.all([apiJson('api/flights'), apiJson('api/countries'), apiJson('api/account/settings')]);
        this.routes = fr.flights;
        this.countries = cr.countries;
        this.homeCountry = settings.home_country;
        this.yearGroups = groupByYear(fr.flights);
      } catch (e) {
        this.error = 'Could not load flights: ' + e.message;
        this.loading = false;
        return;
      }
      this.loading = false;
      if (!this.routes.length) return;
      this.$nextTick(() => this.initMap());
    },
    get activeFlights() {
      if (this.activeYear === '__all__') return this.routes;
      const yg = this.yearGroups.find((y) => y.year === this.activeYear);
      return yg ? yg.flights : [];
    },
    initMap() {
      if (typeof L === 'undefined') { this.error = 'The map library did not load.'; return; }
      map = L.map('map', { worldCopyJump: true });
      addBaseMap(map);
      layerGroup = L.layerGroup().addTo(map);
      this.drawRoutes();
      setTimeout(() => map && map.invalidateSize(), 50);
    },
    drawRoutes() {
      if (!map) return;
      const flights = this.activeFlights;
      layerGroup.clearLayers();
      const airportMap = new Map();
      flights.forEach((f) => { airportMap.set(f.from_airport.iata, f.from_airport); airportMap.set(f.to_airport.iata, f.to_airport); });
      const airports = [...airportMap.values()];
      if (!airports.length) { map.setView([20, 0], 2); return; }

      const homeEntry = this.homeCountry ? this.countries.find((c) => c.name === this.homeCountry) : null;
      const centerLon = homeEntry ? homeEntry.lon : bestCenterLongitude(airports.map((a) => a.lon));
      const centerLat = homeEntry ? homeEntry.lat : airports.reduce((s, a) => s + a.lat, 0) / airports.length;

      map.setView([centerLat, centerLon], 2);
      flights.forEach((f) => {
        continuousLines(greatCircle(f.from_airport, f.to_airport, centerLon, 100)).forEach((seg) => L.polyline(seg, { color: '#0062e3', weight: 2.5, opacity: 0.85 }).addTo(layerGroup));
      });
      airports.forEach((a) => {
        L.circleMarker([a.lat, wrapToCenter(a.lon, centerLon)], { radius: 6, color: '#ffffff', fillColor: '#05203c', fillOpacity: 1, weight: 2 })
          .bindPopup('<strong>' + esc(a.iata) + '</strong> — ' + esc(a.name) + '<br>' + esc(a.city || ''))
          .addTo(layerGroup);
      });
    },
  };
}

/* ---------------------------------------------------------------- statistics */

function statsView() {
  return {
    s: {}, loading: true, error: '', page: 'airlines', metric: 'flights', unit: 'km',
    async load() {
      try {
        const [stats, settings] = await Promise.all([apiJson('api/stats'), apiJson('api/account/settings')]);
        this.s = stats;
        this.unit = settings.distance_unit || 'km';
        this.loading = false;
      } catch (e) {
        this.error = 'Could not load statistics: ' + e.message;
      }
    },
    fmtTotalDist() {
      const km = this.unit === 'km' ? this.s.total_distance_km : this.s.total_distance_mi;
      return Math.round(km).toLocaleString();
    },
    fmtDist(obj) {
      const v = this.unit === 'mi' ? obj.distance_mi : obj.distance_km;
      return Math.round(v).toLocaleString() + ' ' + this.unit;
    },
    val(row) { return this.metric === 'distance' ? (this.unit === 'mi' ? row.distance_mi : row.distance_km) : row.flights; },
    fmtVal(row) { const v = this.val(row); return this.metric === 'distance' ? Math.round(v).toLocaleString() + ' ' + this.unit : v; },
    pct(v, list) { const max = Math.max(1, ...list.map((r) => this.val(r))); return Math.round((v / max) * 100); },
    airlineLogo(name) { return airlineLogo(name, 120, 120); },
    manufacturerLogo(name) {
      const urls = {
        Boeing: 'https://upload.wikimedia.org/wikipedia/commons/4/4f/Boeing_full_logo.svg',
        Airbus: 'https://cdn.simpleicons.org/airbus',
        Bombardier: 'https://cdn.simpleicons.org/bombardier',
        Embraer: 'https://upload.wikimedia.org/wikipedia/commons/5/54/Embraer_logo.svg',
      };
      return urls[name] || null;
    },
    donutColors: ['#0062e3', '#e70866', '#05203c', '#ffb600', '#0b8a5a', '#8a939d'],
    donutColor(i) { return this.donutColors[i % this.donutColors.length]; },
    donutGradient(list) {
      const total = list.reduce((s, r) => s + this.val(r), 0) || 1;
      let acc = 0;
      const stops = list.map((r, i) => {
        const start = (acc / total) * 100;
        acc += this.val(r);
        const end = (acc / total) * 100;
        return this.donutColor(i) + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%';
      });
      return stops.length ? 'conic-gradient(' + stops.join(', ') + ')' : 'transparent';
    },
    donutTotalLabel(list) {
      const sum = list.reduce((a, r) => a + this.val(r), 0);
      return this.metric === 'distance' ? Math.round(sum).toLocaleString() + ' ' + this.unit : sum;
    },
  };
}

/* ----------------------------------------------------------------- companions */

function companionsView() {
  return {
    companions: [], loading: true, newName: '', newRelationship: '', error: '',
    async load() {
      try { this.companions = (await apiJson('api/companions')).companions; } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    async add() {
      if (!this.newName.trim()) return;
      await apiJson('api/companions', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: this.newName, relationship: this.newRelationship }) });
      this.newName = '';
      this.newRelationship = '';
      this.load();
    },
    async del(id) {
      if (!confirm('Remove this companion? They will also be removed from any flights they are on.')) return;
      await apiJson('api/companions/' + id, { method: 'DELETE' });
      this.companions = this.companions.filter((c) => c.id !== id);
    },
  };
}

/* ------------------------------------------------------------------- settings */

function settingsView() {
  return {
    unit: 'km', homeCountry: '', countries: [], saved: false,
    replaceOnImport: false, backupMsg: '', backupOk: true,
    async load() {
      const [s, c] = await Promise.all([apiJson('api/account/settings'), apiJson('api/countries')]);
      this.unit = s.distance_unit || 'km';
      this.homeCountry = s.home_country || '';
      this.countries = c.countries;
    },
    async setUnit(u) {
      this.unit = u;
      this.saved = false;
      await apiJson('api/account/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ distance_unit: u }) });
    },
    async setHomeCountry() {
      this.saved = false;
      await apiJson('api/account/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ home_country: this.homeCountry || null }) });
      this.saved = true;
    },
    async exportData() {
      try {
        const data = await apiJson('api/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'flightlog-export-' + localToday() + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        this.backupOk = true;
        this.backupMsg = 'Export downloaded (' + data.flights.length + ' flights).';
      } catch (e) {
        this.backupOk = false;
        this.backupMsg = 'Export failed: ' + e.message;
      }
    },
    async importData(ev) {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      if (this.replaceOnImport && !confirm('Replace ALL existing flights and companions with the contents of this file?')) return;
      try {
        const text = await file.text();
        JSON.parse(text);
        const out = await apiJson('api/import' + (this.replaceOnImport ? '?mode=replace' : ''), { method: 'POST', headers: JSON_HEADERS, body: text });
        this.backupOk = out.skipped.length === 0;
        this.backupMsg = 'Imported ' + out.imported + ' flight(s).' + (out.skipped.length ? ' Skipped ' + out.skipped.length + ': ' + out.skipped.slice(0, 3).join('; ') : '');
        this.load();
      } catch (e) {
        this.backupOk = false;
        this.backupMsg = 'Import failed: ' + e.message;
      }
    },
  };
}
