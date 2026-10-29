/* FlightLog front end: Alpine.js components + a tiny API helper. */

// Tests can set window.FL_TEST_API to replace the network layer with an in-memory implementation of the same API.
function api(path, opts) {
  const p = window.FL_TEST_API ? Promise.resolve(window.FL_TEST_API.handle(path, opts || {})) : fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
  // A 401 on any data request means the session ended: show the login screen.
  return p.then((res) => {
    if (res && res.status === 401 && String(path).indexOf('api/auth/') !== 0) window.dispatchEvent(new Event('fl-unauth'));
    return res;
  });
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
  const local = (window.FL_DATA.LOCAL_LOGOS || {})[name];
  if (local) return local;
  return code ? 'https://pics.avs.io/' + w + '/' + h + '/' + code + '.png' : null;
}

function manufacturerLogo(name) {
  const urls = {
    Boeing: 'https://upload.wikimedia.org/wikipedia/commons/4/4f/Boeing_full_logo.svg',
    Airbus: 'https://cdn.simpleicons.org/airbus',
    Bombardier: 'https://cdn.simpleicons.org/bombardier',
    Embraer: 'https://upload.wikimedia.org/wikipedia/commons/5/54/Embraer_logo.svg',
  };
  return urls[name] || null;
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
// Display name for an airport (see FLCore.airportName).
function airportName(a) { return window.FLCore ? window.FLCore.airportName(a) : String((a && (a.name || a.city)) || ''); }

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
    if (!f.trip_id) { items.push({ kind: 'flight', key: f.id, package_id: f.package_id || null, package_name: f.package_name || null, date: f.date, distance_km: Number(f.distance_km) || 0, legs: [f], f, delayed: !!f.delay_reason, rows: [buildJourney([f])] }); return; }
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
      package_id: (legs.find((l) => l.package_id) || {}).package_id || null, package_name: (legs.find((l) => l.package_id) || {}).package_name || null,
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

const ROUTES = ['home', 'flight', 'trip', 'map', 'stats', 'add', 'stays', 'stay', 'stay-add', 'packages', 'package', 'package-add', 'companions', 'settings'];
const STRIPS = { home: 'All your flights', flight: 'Flight details', trip: 'Trip details', map: 'Where you have flown', stats: 'Your flying in numbers', add: 'Log a flight', stays: 'Where you have stayed', stay: 'Stay details', 'stay-add': 'Log a stay', packages: 'Your package holidays', package: 'Package details', 'package-add': 'Log a package', companions: 'People you travel with', settings: 'Preferences and backups' };
const TITLES = { home: 'Flights', flight: 'Flight Details', trip: 'Trip Details', map: 'Route Map', stats: 'Statistics', add: 'Log a Flight', stays: 'Stays', stay: 'Stay Details', 'stay-add': 'Log a Stay', packages: 'Packages', package: 'Package Details', 'package-add': 'Log a Package', companions: 'Travel Companions', settings: 'Settings' };

function shell() {
  return {
    route: 'home',
    params: {},
    auth: 'checking', user: null,
    async checkAuth() {
      try {
        const st = await apiJson('api/auth/status');
        this.user = st.user;
        this.auth = st.authenticated ? 'in' : 'out';
      } catch (e) {
        this.auth = 'out';
      }
    },
    async signOut() {
      try { await apiJson('api/auth/logout', { method: 'POST', headers: JSON_HEADERS, body: '{}' }); } catch (e) { /* already signed out */ }
      this.user = null;
      this.auth = 'out';
      location.hash = '#/';
    },
    get stripText() { return this.route === 'add' && this.params.id ? 'Edit flight' : this.route === 'stay-add' && this.params.id ? 'Edit stay' : this.route === 'package-add' && this.params.id ? 'Edit package' : STRIPS[this.route]; },
    init() {
      this.parse();
      window.addEventListener('hashchange', () => this.parse());
      window.addEventListener('fl-unauth', () => { if (this.auth === 'in') { this.auth = 'out'; this.user = null; } });
      window.addEventListener('fl-signed-in', (e) => { this.user = e.detail; this.auth = 'in'; location.hash = '#/'; this.parse(); });
      this.checkAuth();
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
    // a flight or trip inside a package has no price of its own: the package carries the cost
    itemPrice(it) { return it.package_id ? 0 : it.legs.reduce((n, l) => n + (Number(l.price) || 0), 0); },
    fmtMoney(v) { return '\u00a3' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    sideSummary(it) {
      const n = it.legs.length;
      const flights = n + (n === 1 ? ' flight' : ' flights');
      if (it.kind === 'flight') return 'One-way \u00b7 ' + flights;
      return (it.type === 'return' ? 'Return trip' : 'One-way trip') + ' \u00b7 ' + flights;
    },
    sideDate(it) { return it.kind === 'flight' ? this.fmtLongDate(it.f.date) : this.tripRange(it); },
    placeName(a) { return airportName(a); },
    airportName(a) { return airportName(a); },
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
        ['Travelling with', f.companions && f.companions.length ? f.companions.map((c) => companionLabel(c, f.date)).join(', ') : 'Travelling solo'],
        ...(f.package_id ? [['Total cost', 'Part of a package']] : Number(f.price) > 0 ? [['Total cost', this.fmtMoney(f.price)]] : []),
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
    place(a) { return airportName(a); },
    t(v) { return v === '\u2014' ? '' : v; },
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
    get totalCost() { return this.item && !this.item.package_id ? this.item.legs.reduce((n, l) => n + (Number(l.price) || 0), 0) : 0; },
    get summaryFacts() {
      const it = this.item;
      const airlines = [...new Set(it.legs.map((l) => l.airline).filter(Boolean))].join(', ');
      const classes = [...new Set(it.legs.map((l) => l.seat_class).filter(Boolean))].join(', ');
      const km = it.distance_km;
      const rows = [
        ['Flights', String(it.legs.length)],
        ['Total distance', km ? this.fmtDist(km) : ''],
        ['Airlines', airlines],
        ['Cabin', classes],
        ['Travelling with', it.companions.length ? it.companions.map((c) => companionLabel(c, it.date)).join(', ') : 'Travelling solo'],
        ['Total cost', it.package_id ? 'Part of a package' : this.totalCost > 0 ? this.fmtMoney(this.totalCost) : ''],
      ];
      // Blank fields are not shown; they appear once the trip is edited to include them.
      return rows.filter((r) => r[1] && String(r[1]).trim() !== '');
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
      const booked = (v) => (v === null || v === undefined ? null : fd(v));
      const actual = (a, b) => {
        if (a === null || a === undefined) return null;
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
        return { title, rows: rows.filter((r) => r[1] !== null || r[2] !== null) };
      };
      const blocks = [];
      const multi = it.type === 'return';
      const o = journey(multi ? 'Outbound Journey' : 'Your Journey', tt.outbound, it.outbound.length);
      if (o && o.rows.length) blocks.push(o);
      const r = journey('Return Journey', tt.return, it.inbound.length);
      if (r && r.rows.length) blocks.push(r);
      const total = { title: 'Whole Trip', rows: [] };
      if (multi) {
        total.rows.push(['Total Time In The Air', booked(tt.scheduled && tt.scheduled.air), actual(tt.actual && tt.actual.air, tt.scheduled && tt.scheduled.air)]);
        total.rows.push(['Time Away', booked(tt.scheduled && tt.scheduled.away), actual(tt.actual && tt.actual.away, tt.scheduled && tt.scheduled.away)]);
      } else if (it.legs.length > 1) {
        total.rows.push(['Total Time In The Air', booked(tt.scheduled && tt.scheduled.air), actual(tt.actual && tt.actual.air, tt.scheduled && tt.scheduled.air)]);
      }
      total.rows = total.rows.filter((r) => r[1] !== null || r[2] !== null);
      if (total.rows.length) blocks.push(total);
      return blocks;
    },
    get showBooked() { return this.timeBlocks.some((b) => b.rows.some((r) => r[1] !== null)); },
    get showActual() { return this.timeBlocks.some((b) => b.rows.some((r) => r[2] !== null)); },
    get timeCols() { return '1fr' + (this.showBooked ? ' 1fr' : '') + (this.showActual ? ' 1fr' : ''); },
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
      else if (m >= 24 * 60) label = 'Stopover in ' + airportName(next.from_airport);
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
    pkg: null,
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
          this.pkg = trip.package_id ? { id: trip.package_id, name: trip.package_name } : null;
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
    travelDate() { const l = this.legs.outbound[0]; return (l && l.date) || localToday(); },
    companionOptions() { const d = this.travelDate(); return this.companions.map((c) => ({ v: c.id, label: companionLabel(c, d) })); },
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
    airlineFilter: '__all__', homeAirport: '__all__',
    // Flights that pass the Airline and Home Airport filters (before the Year filter).
    get filteredBase() {
      return this.routes.filter((f) => (this.airlineFilter === '__all__' || f.airline === this.airlineFilter)
        && (this.homeAirport === '__all__' || f.from_airport.iata === this.homeAirport || f.to_airport.iata === this.homeAirport));
    },
    get airlineOptions() {
      const m = new Map();
      this.routes.forEach((f) => { if (f.airline) m.set(f.airline, (m.get(f.airline) || 0) + 1); });
      return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([name, n]) => ({ name, n }));
    },
    // Airports in the home country that flights departed from or arrived into.
    get homeAirportOptions() {
      const m = new Map();
      const add = (a) => {
        if (this.homeCountry && a.country !== this.homeCountry) return;
        const e = m.get(a.iata) || { iata: a.iata, label: a.iata + ' \u2014 ' + airportName(a), n: 0 };
        m.set(a.iata, e);
        return e;
      };
      this.routes.forEach((f) => {
        const x = add(f.from_airport), y = add(f.to_airport);
        if (x) x.n++;
        if (y && y !== x) y.n++;
      });
      return [...m.values()].sort((p, q) => q.n - p.n || p.iata.localeCompare(q.iata));
    },
    get yearOptions() { return groupByYear(this.filteredBase); },
    get activeFlights() {
      const base = this.filteredBase;
      if (this.activeYear === '__all__') return base;
      return base.filter((f) => ((f.date || '').slice(0, 4) || 'Undated') === String(this.activeYear));
    },
    get mapFiltersActive() { return this.airlineFilter !== '__all__' || this.homeAirport !== '__all__' || this.activeYear !== '__all__'; },
    clearFilters() { this.airlineFilter = '__all__'; this.homeAirport = '__all__'; this.activeYear = '__all__'; this.drawRoutes(); },
    applyFilters() {
      if (this.activeYear !== '__all__' && !this.yearOptions.some((y) => String(y.year) === String(this.activeYear))) this.activeYear = '__all__';
      this.drawRoutes();
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
    loading: true, error: '',
    async load() {
      try {
        const [fr, settings] = await Promise.all([apiJson('api/flights'), apiJson('api/account/settings')]);
        this.loading = false;
        await this.$nextTick();
        const root = this.$refs.statsRoot;
        if (root) FLStats.mount(root, fr.flights || [], { home: settings.home_country || '', unit: settings.distance_unit === 'mi' ? 'mi' : 'km', airlineLogo: (n) => airlineLogo(n, 120, 120), manufacturerLogo });
      } catch (e) {
        this.loading = false;
        this.error = 'Could not load statistics: ' + e.message;
      }
    },
  };
}

/* ---------------------------------------------------------------------- stays */

const STAY_TYPES = ['Hotel', 'Apartment', 'Hostel', 'Guest house', 'Resort', 'Villa', 'Other'];
const STAY_TINTS = [['#0b3a6e', '#0062e3'], ['#16314f', '#0b8a5a'], ['#3b2a63', '#8a4fd1'], ['#05203c', '#00a1de'], ['#5c0632', '#e70866'], ['#1f4d4a', '#2cb59e']];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stayDateParts(iso) {
  const d = new Date(String(iso) + 'T00:00:00Z');
  return { d, ok: !isNaN(d.getTime()) };
}
function fmtStayDate(iso) {
  const { d, ok } = stayDateParts(iso);
  if (!ok) return '';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + SHORT_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
function fmtStayShort(iso) {
  const { d, ok } = stayDateParts(iso);
  return ok ? d.getUTCDate() + ' ' + SHORT_MONTHS[d.getUTCMonth()] : '';
}
function stayScoreWord(r) {
  const n = Number(r);
  if (!(n > 0)) return '';
  return n >= 9 ? 'Exceptional' : n >= 8 ? 'Excellent' : n >= 7 ? 'Very good' : n >= 6 ? 'Good' : n >= 5 ? 'Fair' : 'Poor';
}
function stayTint(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STAY_TINTS[h % STAY_TINTS.length];
}
// A small map with one pin. Leaflet objects are kept in a WeakMap, outside Alpine's reactive data.
const PIN_MAPS = new WeakMap();
const PIN_SVG = '<svg viewBox="0 0 30 40" width="30" height="40" aria-hidden="true"><path d="M15 39C15 39 2 24.500 2 14.500a13 13 0 0 1 26 0C28 24.500 15 39 15 39z" fill="#e70866" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14.500" r="5" fill="#fff"/></svg>';
function drawPinMap(el, lat, lon, onMove) {
  if (typeof L === 'undefined' || !el || lat == null || lon == null) return;
  const ll = [Number(lat), Number(lon)];
  let m = PIN_MAPS.get(el);
  if (!m) {
    const map = L.map(el, { scrollWheelZoom: false }).setView(ll, 16);
    addBaseMap(map);
    const icon = L.divIcon({ className: 'pin-icon', html: PIN_SVG, iconSize: [30, 40], iconAnchor: [15, 38] });
    const marker = L.marker(ll, { icon, draggable: !!onMove, keyboard: false }).addTo(map);
    if (onMove) marker.on('dragend', () => { const q = marker.getLatLng(); onMove(Number(q.lat.toFixed(6)), Number(q.lng.toFixed(6))); });
    m = { map, marker };
    PIN_MAPS.set(el, m);
    setTimeout(() => map.invalidateSize(), 60);
  } else {
    m.marker.setLatLng(ll);
    m.map.setView(ll, Math.max(m.map.getZoom(), 15));
  }
}

// Reads a chosen photo and shrinks it to a JPEG (longest side 1280px) so uploads stay small and always work.
async function shrinkImage(file, maxDim, quality) {
  maxDim = maxDim || 1280; quality = quality || 0.82;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be read as an image. Try a JPEG or PNG.'));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    let q = quality, out = canvas.toDataURL('image/jpeg', q);
    while (out.length > 3000000 && q > 0.4) { q -= 0.12; out = canvas.toDataURL('image/jpeg', q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
function dataUrlBytes(d) { return Math.round((String(d).length - String(d).indexOf(',') - 1) * 0.75); }

function decorateStay(s) {
  const nights = window.FLCore.stayNights(s.check_in, s.check_out);
  const t = stayTint(s.name);
  return {
    ...s,
    nights,
    perNight: s.price != null && !s.package_id && nights > 0 ? s.price / nights : null,
    place: [s.city, s.country].filter(Boolean).join(', '),
    year: String(s.check_in).slice(0, 4),
    tint: 'linear-gradient(135deg,' + t[0] + ',' + t[1] + ')',
    scoreWord: stayScoreWord(s.rating),
    _map: false,
  };
}

function stayList() {
  const sortLabels = { newest: 'Newest', oldest: 'Oldest', rated: 'Top rated', longest: 'Longest stay', price: 'Highest price' };
  const countBy = (list, fn) => {
    const m = new Map();
    list.forEach((x) => { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  return {
    stays: [], companions: [], loading: true, error: '', sort: 'newest',
    yearFilter: '__all__', typeFilter: [], countryFilter: [], starFilter: [],
    open: { year: true, stars: true, type: true, country: true },
    async load() {
      try {
        const [st, co] = await Promise.all([apiJson('api/stays'), apiJson('api/companions')]);
        this.stays = st.stays.map(decorateStay);
        this.companions = co.companions;
      } catch (e) { this.error = 'Could not load stays: ' + e.message; }
      this.loading = false;
    },
    get filtersActive() { return this.yearFilter !== '__all__' || this.typeFilter.length || this.countryFilter.length || this.starFilter.length; },
    resetFilters() { this.yearFilter = '__all__'; this.typeFilter = []; this.countryFilter = []; this.starFilter = []; },
    get years() {
      const m = countBy(this.stays, (s) => s.year);
      return m.sort((a, b) => b.name.localeCompare(a.name));
    },
    get typeOptions() { return countBy(this.stays, (s) => s.stay_type); },
    get countryOptions() { return countBy(this.stays, (s) => s.country); },
    get starOptions() {
      return [5, 4, 3, 2, 1].map((n) => ({ name: String(n), n: this.stays.filter((s) => Math.round(s.stars || 0) === n).length })).filter((o) => o.n);
    },
    get visibleStays() {
      let out = this.stays.filter((s) => (this.yearFilter === '__all__' || s.year === this.yearFilter)
        && (!this.typeFilter.length || this.typeFilter.includes(s.stay_type))
        && (!this.countryFilter.length || this.countryFilter.includes(s.country))
        && (!this.starFilter.length || this.starFilter.includes(String(Math.round(s.stars || 0)))));
      const by = {
        newest: (a, b) => b.check_in.localeCompare(a.check_in),
        oldest: (a, b) => a.check_in.localeCompare(b.check_in),
        rated: (a, b) => (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating) || b.check_in.localeCompare(a.check_in),
        longest: (a, b) => b.nights - a.nights || b.check_in.localeCompare(a.check_in),
        price: (a, b) => (b.price == null ? -1 : b.price) - (a.price == null ? -1 : a.price) || b.check_in.localeCompare(a.check_in),
      }[this.sort] || (() => 0);
      return out.sort(by);
    },
    get sortLabel() { return sortLabels[this.sort] || 'Newest'; },
    get totalNights() { return this.visibleStays.reduce((n, s) => n + s.nights, 0); },
    get totalSpent() { return this.visibleStays.reduce((n, s) => n + (s.package_id ? 0 : Number(s.price) || 0), 0); },
    get summaryLine() {
      const n = this.visibleStays.length;
      return n + (n === 1 ? ' stay' : ' stays') + ' · ' + this.totalNights + (this.totalNights === 1 ? ' night' : ' nights');
    },
    get newestInfo() { const s = this.visibleStays.slice().sort((a, b) => b.check_in.localeCompare(a.check_in))[0]; return s ? { value: s.city || s.name, sub: fmtStayShort(s.check_in) + ' ' + s.year } : { value: '–', sub: '' }; },
    get ratedInfo() {
      const s = this.visibleStays.filter((x) => x.rating != null).sort((a, b) => b.rating - a.rating)[0];
      return s ? { value: s.rating.toFixed(1), sub: s.name } : { value: '–', sub: 'No ratings yet' };
    },
    get longestInfo() { const s = this.visibleStays.slice().sort((a, b) => b.nights - a.nights)[0]; return s ? { value: s.nights + (s.nights === 1 ? ' night' : ' nights'), sub: s.name } : { value: '–', sub: '' }; },
    fmtMoney(v) { return '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    fmtStayDate, fmtStayShort,
    nightsText(s) { return s.nights + (s.nights === 1 ? ' night' : ' nights'); },
    guestsText(s) {
      const bits = [];
      if (s.guests) bits.push(s.guests + (s.guests === 1 ? ' guest' : ' guests'));
      if (s.rooms) bits.push(s.rooms + (s.rooms === 1 ? ' room' : ' rooms'));
      return bits.join(', ');
    },
    guestName(id, on) {
      if (id === 'me') return 'You';
      const c = this.companions.find((x) => x.id === id);
      if (!c) return '';
      const t = ageTag(c, on);
      return t ? c.name + ' (' + t + ')' : c.name;
    },
    guestNames(r, s) { return (r.guests || []).map((g) => this.guestName(g, s && s.check_in)).filter(Boolean).join(', '); },
    toggleMap(s) { s._map = !s._map; },
    pinMapCard(el, s) { drawPinMap(el, s.lat, s.lon, null); },
    starsArray(s) { return Array.from({ length: Math.round(s.stars || 0) }, (_, i) => i); },
    initials(name) { return String(name).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); },
  };
}

function stayForm(editId) {
  let keySeq = 0;
  let searchSeq = 0;
  const newRoom = (guests, type) => ({ _k: 'r' + (++keySeq), room_type: type || '', guests: guests || [] });
  return {
    editId, loading: !!editId, saving: false, error: '', types: STAY_TYPES, roomTypes: window.FLCore.ROOM_TYPES,
    companions: [], pkg: null,
    f: { name: '', stay_type: 'Hotel', city: '', country: '', address: '', lat: null, lon: null, image_url: '', check_in: '', check_out: '', stars: 0, rating: '', price: '', booking_ref: '', notes: '' },
    rooms: [newRoom(['me'])],
    addr: { results: [], open: false, busy: false, msg: '' },
    photo: { mode: 'none', data: '', existing: '', busy: false, error: '', info: '' },
    async load() {
      try { this.companions = (await apiJson('api/companions')).companions; } catch (e) { /* the form still works without names */ }
      if (!this.editId) return;
      try {
        const s = await apiJson('api/stays/' + this.editId);
        for (const k of Object.keys(this.f)) this.f[k] = s[k] == null ? (k === 'stars' ? 0 : (k === 'lat' || k === 'lon' ? null : '')) : (typeof s[k] === 'number' && !['stars', 'lat', 'lon'].includes(k) ? String(s[k]) : s[k]);
        if (this.f.price !== '') this.f.price = Number(this.f.price).toFixed(2);
        this.pkg = s.package_id ? { id: s.package_id, name: s.package_name } : null;
        if (s.image_source === 'upload') { this.photo.mode = 'upload'; this.photo.existing = s.image; }
        else if (s.image_source === 'link') this.photo.mode = 'link';
        const list = Array.isArray(s.room_list) && s.room_list.length ? s.room_list : [{ room_type: s.room_type, guests: ['me'] }];
        const known = new Set(this.companions.map((c) => c.id));
        this.rooms = list.map((r) => newRoom((r.guests || []).filter((g) => g === 'me' || known.has(g)), r.room_type || ''));
      } catch (e) { this.error = 'Could not load this stay: ' + e.message; }
      this.loading = false;
    },
    get nights() { return window.FLCore.stayNights(this.f.check_in, this.f.check_out); },
    get nightsText() {
      if (!this.f.check_in || !this.f.check_out) return '';
      return this.nights > 0 ? this.nights + (this.nights === 1 ? ' night' : ' nights') : 'Check-out must be after check-in';
    },
    setStars(n) { this.f.stars = this.f.stars === n ? 0 : n; },
    tidyPrice() {
      const raw = String(this.f.price == null ? '' : this.f.price).trim();
      const n = Number(raw.replace(/[^0-9.\-]/g, ''));
      this.f.price = raw === '' || !Number.isFinite(n) ? '' : n.toFixed(2);
    },
    // Moves a too-early check-out forward when the check-in changes.
    checkInChanged() {
      if (this.f.check_in && (!this.f.check_out || this.f.check_out <= this.f.check_in)) {
        const d = new Date(this.f.check_in + 'T00:00:00Z');
        if (!isNaN(d.getTime())) { d.setUTCDate(d.getUTCDate() + 1); this.f.check_out = d.toISOString().slice(0, 10); }
      }
    },

    /* ----- address search and map pin ----- */
    async searchAddress() {
      const q = String(this.f.address || '').trim();
      const mine = ++searchSeq;
      if (q.length < 4) { this.addr.results = []; this.addr.open = false; this.addr.msg = ''; return; }
      this.addr.busy = true; this.addr.msg = '';
      try {
        const out = await apiJson('api/geocode?q=' + encodeURIComponent(q));
        if (mine !== searchSeq) return;
        this.addr.results = out.results || [];
        this.addr.msg = this.addr.results.length ? '' : 'No matching addresses found. You can still save the address as typed.';
        this.addr.open = true;
      } catch (e) {
        if (mine !== searchSeq) return;
        this.addr.results = []; this.addr.msg = e.message; this.addr.open = true;
      }
      this.addr.busy = false;
    },
    pickAddress(r) {
      this.f.address = r.address || r.label;
      this.f.lat = r.lat; this.f.lon = r.lon;
      if (!String(this.f.city || '').trim() && r.city) this.f.city = r.city;
      if (!String(this.f.country || '').trim() && r.country) this.f.country = r.country;
      if (!String(this.f.name || '').trim() && r.name) this.f.name = r.name;
      this.addr.open = false; this.addr.results = []; this.addr.msg = '';
      searchSeq++;
    },
    clearPin() { this.f.lat = null; this.f.lon = null; },
    pinMapForm(el) { drawPinMap(el, this.f.lat, this.f.lon, (la, lo) => { this.f.lat = la; this.f.lon = lo; }); },
    get pinText() { return this.f.lat == null ? '' : Number(this.f.lat).toFixed(5) + ', ' + Number(this.f.lon).toFixed(5); },

    /* ----- photo: a link or an upload ----- */
    setPhotoMode(m) { this.photo.mode = this.photo.mode === m ? 'none' : m; this.photo.error = ''; },
    get photoSrc() {
      if (this.photo.mode === 'link') { const u = String(this.f.image_url || '').trim(); return /^https?:\/\/\S+$/i.test(u) ? u : ''; }
      if (this.photo.mode === 'upload') return this.photo.data || this.photo.existing || '';
      return '';
    },
    readImage(file) { return shrinkImage(file); },
    async pickFile(ev) {
      const file = ev && ev.target && ev.target.files && ev.target.files[0];
      if (!file) return;
      this.photo.error = ''; this.photo.info = '';
      if (!/^image\//.test(file.type || '')) { this.photo.error = 'Please choose an image file (JPEG, PNG or WebP).'; return; }
      if (file.size > 30 * 1024 * 1024) { this.photo.error = 'That image is very large. Please choose one under 30 MB.'; return; }
      this.photo.busy = true;
      try {
        this.photo.data = await this.readImage(file);
        this.photo.info = file.name + ' \u00b7 ' + Math.max(1, Math.round(dataUrlBytes(this.photo.data) / 1024)) + ' KB after resizing';
      } catch (e) { this.photo.error = e.message; }
      this.photo.busy = false;
      if (ev.target) ev.target.value = '';
    },
    linkBroken() { if (this.photo.mode === 'link' && this.photoSrc) this.photo.error = 'That link did not load as an image. Check it, or try Upload instead.'; },
    linkLoaded() { if (this.photo.mode === 'link') this.photo.error = ''; },
    removePhoto() { this.photo.mode = 'none'; this.photo.data = ''; this.photo.existing = ''; this.photo.info = ''; this.photo.error = ''; this.f.image_url = ''; },

    /* ----- rooms and who is in them ----- */
    roomTitle(i) { return 'Room ' + (i + 1); },
    addRoom() { this.rooms.push(newRoom([])); },
    removeRoom(i) { if (i > 0) this.rooms.splice(i, 1); },
    guestName(id) { if (id === 'me') return 'You'; const c = this.companions.find((x) => x.id === id); return c ? c.name : ''; },
    inRoom(room, id) { return room.guests.includes(id); },
    // A person can only be in one room, so choosing them here takes them out of any other room.
    toggleGuest(i, id) {
      if (id === 'me') return;
      const room = this.rooms[i];
      if (room.guests.includes(id)) { room.guests = room.guests.filter((g) => g !== id); return; }
      this.rooms.forEach((r) => { r.guests = r.guests.filter((g) => g !== id); });
      room.guests.push(id);
    },
    otherRoomOf(i, id) { const j = this.rooms.findIndex((r, ix) => ix !== i && r.guests.includes(id)); return j < 0 ? '' : this.roomTitle(j); },
    get guestTotal() { return this.rooms.reduce((n, r) => n + r.guests.length, 0); },
    get roomsSummary() { return this.rooms.length + (this.rooms.length === 1 ? ' room' : ' rooms') + ', ' + this.guestTotal + (this.guestTotal === 1 ? ' guest' : ' guests'); },

    async save() {
      this.error = '';
      if (!this.f.name.trim()) { this.error = 'Add the name of the place you stayed.'; return; }
      if (!this.f.check_in || !this.f.check_out) { this.error = 'Add your check-in and check-out dates.'; return; }
      if (this.nights < 1) { this.error = 'Check-out must be after check-in.'; return; }
      this.saving = true;
      try {
        const room_list = this.rooms.map((r) => ({ room_type: r.room_type, guests: r.guests }));
        const payload = { ...this.f, stars: this.f.stars || null, room_list, image_url: null };
        const link = String(this.f.image_url || '').trim();
        if (this.photo.mode === 'link' && link) {
          if (!/^https?:\/\/\S+$/i.test(link)) { this.error = 'The image link must start with http:// or https://'; this.saving = false; return; }
          payload.image_url = link; payload.clear_image_data = true;
        } else if (this.photo.mode === 'upload' && (this.photo.data || this.photo.existing)) {
          if (this.photo.data) payload.image_data = this.photo.data; // otherwise the stored photo is kept
        } else payload.clear_image_data = true;
        const body = JSON.stringify(payload);
        if (this.editId) await apiJson('api/stays/' + this.editId, { method: 'PUT', headers: JSON_HEADERS, body });
        else await apiJson('api/stays', { method: 'POST', headers: JSON_HEADERS, body });
        location.hash = '#/stays';
      } catch (e) { this.error = e.message; }
      this.saving = false;
    },
    async remove() {
      if (!this.editId || !confirm('Delete this stay?')) return;
      try { await apiJson('api/stays/' + this.editId, { method: 'DELETE' }); location.hash = '#/stays'; } catch (e) { this.error = e.message; }
    },
  };
}

/* ----------------------------------------------------------------- companions */

const AGE_GROUP_LABEL = { infant: 'Infant', child: 'Child', adult: 'Adult' };
const todayISO = () => new Date().toISOString().slice(0, 10);
// "Child, 8" for a companion with a date of birth, on the given day (default today). Empty without a DOB.
function ageTag(c, onDate) {
  if (!c || !c.date_of_birth) return '';
  const age = window.FLCore.ageOn(c.date_of_birth, onDate || todayISO());
  if (age === null) return '';
  return AGE_GROUP_LABEL[window.FLCore.ageGroup(c.date_of_birth, onDate || todayISO())] + ', ' + age;
}
// Age group at travel; no date of birth means adult.
function groupOn(c, onDate) { return window.FLCore.ageGroup(c && c.date_of_birth, onDate || todayISO()); }
// "Alex (Partner · Adult, 34)" as at the travel date.
function companionLabel(c, onDate) {
  const bits = [c.relationship, ageTag(c, onDate)].filter(Boolean);
  return c.name + (bits.length ? ' (' + bits.join(' \u00b7 ') + ')' : '');
}
// "2 adults, 1 child, 1 infant" for a party (the traveller counts as an adult).
function partyText(companions, onDate, includeMe) {
  const n = { adult: includeMe === false ? 0 : 1, child: 0, infant: 0 };
  (companions || []).forEach((c) => { n[groupOn(c, onDate)]++; });
  return [['adult', 'adult'], ['child', 'child'], ['infant', 'infant']]
    .filter(([k]) => n[k] > 0)
    .map(([k, w]) => n[k] + ' ' + (k === 'child' ? (n[k] === 1 ? 'child' : 'children') : w + (n[k] === 1 ? '' : 's'))).join(', ');
}

function companionsView() {
  return {
    companions: [], loading: true, newName: '', newRelationship: '', newDob: '', error: '',
    editId: null, edit: { name: '', relationship: '', dob: '' }, editError: '', today: todayISO(),
    async load() {
      try { this.companions = (await apiJson('api/companions')).companions; } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    get summaryLine() {
      const n = this.companions.length;
      const party = partyText(this.companions, todayISO(), false);
      return n + (n === 1 ? ' companion' : ' companions') + (party ? ' \u00b7 ' + party : '');
    },
    ageText(c) { return ageTag(c); },
    groupText(c) { return AGE_GROUP_LABEL[groupOn(c)]; },
    async add() {
      if (!this.newName.trim()) return;
      this.error = '';
      try {
        await apiJson('api/companions', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: this.newName, relationship: this.newRelationship, date_of_birth: this.newDob || null }) });
      } catch (e) { this.error = e.message; return; }
      this.newName = '';
      this.newRelationship = '';
      this.newDob = '';
      await this.load();
    },
    startEdit(c) { this.editId = c.id; this.edit = { name: c.name, relationship: c.relationship || '', dob: c.date_of_birth || '' }; this.editError = ''; },
    cancelEdit() { this.editId = null; this.editError = ''; },
    async saveEdit() {
      if (!this.edit.name.trim()) { this.editError = 'Name is required.'; return; }
      try {
        const u = await apiJson('api/companions/' + this.editId, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ name: this.edit.name, relationship: this.edit.relationship, date_of_birth: this.edit.dob || null }) });
        const i = this.companions.findIndex((c) => c.id === this.editId);
        if (i >= 0) this.companions.splice(i, 1, u);
        this.companions.sort((x, y) => x.name.localeCompare(y.name));
        this.editId = null; this.editError = '';
      } catch (e) { this.editError = e.message; }
    },
    async del(id) {
      if (!confirm('Remove this companion? They will also be removed from any flights they are on.')) return;
      await apiJson('api/companions/' + id, { method: 'DELETE' });
      this.companions = this.companions.filter((c) => c.id !== id);
    },
  };
}

/* ------------------------------------------------------------------- settings */

/* ------------------------------------------------------------ sign in / sign up */

function authView() {
  return {
    mode: 'login', username: '', password: '', confirm: '', unit: 'km', homeCountry: '',
    countries: [], error: '', busy: false, signups: true, hasUsers: true, legacyData: false,
    async load() {
      try {
        const st = await apiJson('api/auth/status');
        this.signups = st.signups; this.hasUsers = st.hasUsers; this.legacyData = st.legacyData;
        if (!st.hasUsers) this.mode = 'signup';
      } catch (e) { /* the form still works */ }
      try { this.countries = (await apiJson('api/countries')).countries; } catch (e) { this.countries = []; }
    },
    setMode(m) { this.mode = m; this.error = ''; },
    async submit() {
      this.error = '';
      const signup = this.mode === 'signup';
      if (!this.username.trim() || !this.password) { this.error = 'Enter your username and password.'; return; }
      if (signup) {
        if (this.password !== this.confirm) { this.error = 'The two passwords do not match.'; return; }
        if (!this.homeCountry) { this.error = 'Choose your home country.'; return; }
      }
      this.busy = true;
      try {
        const body = signup
          ? { username: this.username.trim(), password: this.password, distance_unit: this.unit, home_country: this.homeCountry }
          : { username: this.username.trim(), password: this.password };
        const out = await apiJson('api/auth/' + (signup ? 'signup' : 'login'), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
        this.password = ''; this.confirm = '';
        window.dispatchEvent(new CustomEvent('fl-signed-in', { detail: out.user }));
      } catch (e) {
        this.error = e.message;
      }
      this.busy = false;
    },
  };
}

function settingsView() {
  return {
    username: '',
    unit: 'km', homeCountry: '', countries: [], saved: false,
    replaceOnImport: false, backupMsg: '', backupOk: true,
    async load() {
      const [s, c, st] = await Promise.all([apiJson('api/account/settings'), apiJson('api/countries'), apiJson('api/auth/status')]);
      this.username = st.user ? st.user.username : '';
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
      if (this.replaceOnImport && !confirm('Replace your existing data with the contents of this file? Only the kinds of data in the file are replaced (flights, stays and/or packages).')) return;
      try {
        const text = await file.text();
        JSON.parse(text);
        const out = await apiJson('api/import' + (this.replaceOnImport ? '?mode=replace' : ''), { method: 'POST', headers: JSON_HEADERS, body: text });
        this.backupOk = out.skipped.length === 0;
        const parts = [[out.imported, 'flight'], [out.imported_stays, 'stay'], [out.imported_packages, 'package']].filter((x) => x[0]).map((x) => x[0] + ' ' + x[1] + (x[0] === 1 ? '' : 's'));
        this.backupMsg = 'Imported ' + (parts.length ? parts.join(', ') : 'nothing new') + '.' + (out.skipped.length ? ' Skipped ' + out.skipped.length + ': ' + out.skipped.slice(0, 3).join('; ') : '');
        this.load();
      } catch (e) {
        this.backupOk = false;
        this.backupMsg = 'Import failed: ' + e.message;
      }
    },
  };
}


/* ----------------------------------------------------------------- packages */

const gbp = (v) => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TRANSFER_KIND_LABELS = { arrival: 'Airport to hotel', departure: 'Hotel to airport', other: 'Other transfer' };

function decoratePackage(p) {
  const t = stayTint(p.name);
  return {
    ...p,
    year: p.start ? p.start.slice(0, 4) : '',
    tint: 'linear-gradient(135deg,' + t[0] + ',' + t[1] + ')',
    perPerson: p.price != null && p.travellers ? p.price / p.travellers : null,
    hotel: (p.stays || [])[0] || null,
    flightCount: (p.trips || []).reduce((n, tr) => n + tr.legs.length, 0),
    _open: false,
  };
}

function packageList() {
  const sortLabels = { newest: 'Newest', oldest: 'Oldest', longest: 'Longest holiday', price: 'Highest price' };
  const countBy = (list, fn) => {
    const m = new Map();
    list.forEach((x) => { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  const core = window.FLCore;
  return {
    packages: [], loading: true, error: '', sort: 'newest',
    yearFilter: '__all__', boardFilter: [], countryFilter: [], providerFilter: [],
    open: { year: true, board: true, country: true, provider: true },
    async load() {
      try { this.packages = (await apiJson('api/packages')).packages.map(decoratePackage); }
      catch (e) { this.error = 'Could not load packages: ' + e.message; }
      this.loading = false;
    },
    get filtersActive() { return this.yearFilter !== '__all__' || this.boardFilter.length || this.countryFilter.length || this.providerFilter.length; },
    resetFilters() { this.yearFilter = '__all__'; this.boardFilter = []; this.countryFilter = []; this.providerFilter = []; },
    get years() { return countBy(this.packages, (p) => p.year).sort((a, b) => b.name.localeCompare(a.name)); },
    get boardOptions() { return countBy(this.packages, (p) => p.board); },
    get countryOptions() { return countBy(this.packages, (p) => p.country || (p.hotel && p.hotel.country)); },
    get providerOptions() { return countBy(this.packages, (p) => p.provider); },
    get visiblePackages() {
      const out = this.packages.filter((p) => (this.yearFilter === '__all__' || p.year === this.yearFilter)
        && (!this.boardFilter.length || this.boardFilter.includes(p.board))
        && (!this.countryFilter.length || this.countryFilter.includes(p.country || (p.hotel && p.hotel.country)))
        && (!this.providerFilter.length || this.providerFilter.includes(p.provider)));
      const by = {
        newest: (a, b) => String(b.start).localeCompare(String(a.start)),
        oldest: (a, b) => String(a.start).localeCompare(String(b.start)),
        longest: (a, b) => b.nights - a.nights || String(b.start).localeCompare(String(a.start)),
        price: (a, b) => (b.price == null ? -1 : b.price) - (a.price == null ? -1 : a.price) || String(b.start).localeCompare(String(a.start)),
      }[this.sort] || (() => 0);
      return out.sort(by);
    },
    get sortLabel() { return sortLabels[this.sort] || 'Newest'; },
    get totalNights() { return this.visiblePackages.reduce((n, p) => n + p.nights, 0); },
    get totalSpent() { return this.visiblePackages.reduce((n, p) => n + (Number(p.price) || 0), 0); },
    get summaryLine() {
      const n = this.visiblePackages.length;
      return n + (n === 1 ? ' package' : ' packages') + ' · ' + this.totalNights + (this.totalNights === 1 ? ' night' : ' nights');
    },
    get newestInfo() { const p = this.visiblePackages.slice().sort((a, b) => String(b.start).localeCompare(String(a.start)))[0]; return p ? { value: p.destination || p.name, sub: fmtStayShort(p.start) + ' ' + p.year } : { value: '–', sub: '' }; },
    get longestInfo() { const p = this.visiblePackages.slice().sort((a, b) => b.nights - a.nights)[0]; return p ? { value: p.nights + (p.nights === 1 ? ' night' : ' nights'), sub: p.name } : { value: '–', sub: '' }; },
    get priciestInfo() { const p = this.visiblePackages.filter((x) => x.price != null).sort((a, b) => b.price - a.price)[0]; return p ? { value: gbp(p.price), sub: p.name } : { value: '–', sub: 'No prices yet' }; },
    fmtMoney: gbp, fmtStayDate, fmtStayShort,
    // works for a package (has nights) and for a stay inside one (nights come from its dates)
    nightsText(x) { const n = x.nights != null ? x.nights : core.stayNights(x.check_in, x.check_out); return n + (n === 1 ? ' night' : ' nights'); },
    starsArray(s) { return Array.from({ length: Math.round((s && s.stars) || 0) }, (_, i) => i); },
    initials(name) { return String(name).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); },
    tripRoute(t) { return core.airportName(t.from) + (t.type === 'return' ? ' ⇄ ' : ' → ') + core.airportName(t.to); },
    tripSub(t) {
      const airlines = [...new Set(t.legs.map((l) => l.airline).filter(Boolean))].join(', ');
      return (t.type === 'return' ? 'Return' : 'One-way') + ' · ' + t.legs.length + (t.legs.length === 1 ? ' flight' : ' flights') + (airlines ? ' · ' + airlines : '');
    },
    legLine(l) {
      const times = [l.departure_time, l.arrival_time].every(Boolean) ? ' ' + l.departure_time + ' → ' + l.arrival_time : '';
      return fmtStayShort(l.date) + ' · ' + l.airline + (l.flight_number ? ' ' + l.flight_number : '') + ' · ' + l.from_airport.iata + ' → ' + l.to_airport.iata + times;
    },
    transferText(p) {
      const n = p.transfers.length;
      if (!n) return '';
      const modes = [...new Set(p.transfers.map((t) => t.mode).filter(Boolean))].join(', ');
      return n + (n === 1 ? ' transfer' : ' transfers') + (modes ? ' · ' + modes : '');
    },
    transferLine(t) {
      const when = [t.date ? fmtStayShort(t.date) : '', t.time || ''].filter(Boolean).join(' ');
      return [TRANSFER_KIND_LABELS[t.kind] || 'Transfer', t.mode, when].filter(Boolean).join(' · ');
    },
    transferRoute(t) { return [t.from_place, t.to_place].filter(Boolean).join(' → '); },
    guestsText(s) { return s.rooms + (s.rooms === 1 ? ' room' : ' rooms'); },
  };
}

function packageForm(editId, tripKey) {
  const core = window.FLCore;
  let seq = 0;
  const dayAfter = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  return {
    editId, loading: true, saving: false, error: '', hint: '',
    boards: core.PACKAGE_BOARDS, modes: core.TRANSFER_MODES,
    f: { name: '', provider: '', destination: '', country: '', board: '', travellers: '', price: '', booking_ref: '', notes: '' },
    trips: [], stays: [], pickedTrips: [], pickedStays: [], transfers: [],
    async load() {
      try {
        const [fr, st] = await Promise.all([apiJson('api/flights'), apiJson('api/stays')]);
        const groups = new Map();
        for (const f of fr.flights) { const k = f.trip_id || f.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
        this.trips = [...groups.entries()].map(([key, legs]) => {
          legs.sort((a, b) => (a.direction === 'return') - (b.direction === 'return') || (a.leg_order || 0) - (b.leg_order || 0) || a.date.localeCompare(b.date));
          const out = legs.filter((l) => l.direction !== 'return'), back = legs.filter((l) => l.direction === 'return');
          const first = out[0] || legs[0], last = out[out.length - 1] || first;
          const dates = legs.map((l) => l.date).sort();
          return { key, legs, type: back.length ? 'return' : 'oneway', from: first.from_airport, to: last.to_airport, start: dates[0], end: dates[dates.length - 1], package_id: (legs.find((l) => l.package_id) || {}).package_id || null, package_name: (legs.find((l) => l.package_id) || {}).package_name || null, companions: first.companions || [] };
        }).sort((a, b) => b.start.localeCompare(a.start));
        this.stays = st.stays.map((s) => ({ ...s, nights: core.stayNights(s.check_in, s.check_out), place: [s.city, s.country].filter(Boolean).join(', ') }));
        if (this.editId) {
          const p = await apiJson('api/packages/' + encodeURIComponent(this.editId));
          for (const k of Object.keys(this.f)) this.f[k] = p[k] == null ? '' : String(p[k]);
          if (this.f.price !== '') this.f.price = Number(this.f.price).toFixed(2);
          this.pickedTrips = [...p.trip_keys];
          this.pickedStays = [...p.stay_ids];
          this.transfers = p.transfers.map((t) => this.newTransfer(t));
        } else if (tripKey) {
          this.startFromTrip(tripKey);
        }
      } catch (e) { this.error = 'Could not load this page: ' + e.message; }
      this.loading = false;
    },
    // "Convert to package": starts from a trip, fills in what it already knows and ticks the stays that fit its dates.
    startFromTrip(key) {
      const t = this.trips.find((x) => x.key === key);
      if (!t) { this.error = 'That trip could not be found. It may have been deleted.'; return; }
      if (t.package_id) { this.error = 'That trip is already part of the package “' + (t.package_name || 'another package') + '”.'; return; }
      this.pickedTrips = [key];
      const dest = core.airportName(t.to);
      this.f.name = dest + ' holiday';
      this.f.destination = dest;
      this.f.country = t.to.country || '';
      this.f.travellers = String(1 + (t.companions || []).length);
      const fits = this.stays.filter((s) => !s.package_id && s.check_in >= t.start && s.check_out <= dayAfter(t.end));
      this.pickedStays = fits.map((s) => s.id);
      if (fits.length) this.hint = 'We ticked ' + (fits.length === 1 ? 'a stay' : fits.length + ' stays') + ' that fall within the dates of this trip. Untick anything that does not belong.';
    },
    get freeTrips() { return this.trips.filter((t) => !t.package_id || t.package_id === this.editId); },
    get freeStays() { return this.stays.filter((s) => !s.package_id || s.package_id === this.editId).sort((a, b) => b.check_in.localeCompare(a.check_in)); },
    get busyTrips() { return this.trips.filter((t) => t.package_id && t.package_id !== this.editId).length; },
    get busyStays() { return this.stays.filter((s) => s.package_id && s.package_id !== this.editId).length; },
    isTrip(k) { return this.pickedTrips.includes(k); },
    isStay(k) { return this.pickedStays.includes(k); },
    toggleTrip(k) { this.pickedTrips = this.isTrip(k) ? this.pickedTrips.filter((x) => x !== k) : [...this.pickedTrips, k]; },
    toggleStay(k) { this.pickedStays = this.isStay(k) ? this.pickedStays.filter((x) => x !== k) : [...this.pickedStays, k]; },
    tripRoute(t) { return core.airportName(t.from) + (t.type === 'return' ? ' ⇄ ' : ' → ') + core.airportName(t.to); },
    tripSub(t) {
      const airlines = [...new Set(t.legs.map((l) => l.airline).filter(Boolean))].join(', ');
      return [fmtStayShort(t.start) + (t.end !== t.start ? ' – ' + fmtStayShort(t.end) : '') + ' ' + t.start.slice(0, 4), (t.type === 'return' ? 'Return' : 'One-way'), t.legs.length + (t.legs.length === 1 ? ' flight' : ' flights'), airlines].filter(Boolean).join(' · ');
    },
    staySub(s) { return [fmtStayShort(s.check_in) + ' – ' + fmtStayShort(s.check_out) + ' ' + s.check_out.slice(0, 4), s.nights + (s.nights === 1 ? ' night' : ' nights'), s.place].filter(Boolean).join(' · '); },

    /* ----- transfers ----- */
    newTransfer(base) {
      const b = base || {};
      return { _k: 't' + (++seq), kind: b.kind || 'arrival', mode: b.mode || 'Shared shuttle', date: b.date || '', time: b.time || '', from_place: b.from_place || '', to_place: b.to_place || '', notes: b.notes || '' };
    },
    transferTitle(t, i) { return 'Transfer ' + (i + 1) + ' · ' + (TRANSFER_KIND_LABELS[t.kind] || 'Transfer'); },
    addTransfer() {
      const has = (k) => this.transfers.some((t) => t.kind === k);
      const kind = !has('arrival') ? 'arrival' : !has('departure') ? 'departure' : 'other';
      const t = this.newTransfer({ kind });
      const trip = this.trips.find((x) => this.isTrip(x.key));
      const stay = this.stays.find((x) => this.isStay(x.id));
      const airport = trip ? core.airportName(trip.to) + ' Airport' : '';
      const hotel = stay ? stay.name : '';
      if (kind === 'arrival') { t.from_place = airport; t.to_place = hotel; t.date = stay ? stay.check_in : (trip ? trip.start : ''); }
      if (kind === 'departure') { t.from_place = hotel; t.to_place = airport; t.date = stay ? stay.check_out : (trip ? trip.end : ''); }
      this.transfers.push(t);
    },
    removeTransfer(i) { this.transfers.splice(i, 1); },
    tidyPrice() {
      const raw = String(this.f.price == null ? '' : this.f.price).trim();
      const n = Number(raw.replace(/[^0-9.\-]/g, ''));
      this.f.price = raw === '' || !Number.isFinite(n) ? '' : n.toFixed(2);
    },
    async save() {
      this.error = '';
      if (!this.f.name.trim()) { this.error = 'Give the package a name.'; return; }
      if (!this.pickedTrips.length && !this.pickedStays.length) { this.error = 'Pick at least one trip or stay to put in this package. Log them first if they are not in the lists.'; return; }
      for (let i = 0; i < this.transfers.length; i++) {
        const t = this.transfers[i];
        if (!String(t.from_place).trim() && !String(t.to_place).trim()) { this.error = 'Transfer ' + (i + 1) + ': add where it picks you up or drops you off.'; return; }
      }
      this.saving = true;
      try {
        const payload = {
          ...this.f, trip_keys: this.pickedTrips, stay_ids: this.pickedStays,
          transfers: this.transfers.map(({ _k, ...t }) => t),
        };
        await apiJson(this.editId ? 'api/packages/' + encodeURIComponent(this.editId) : 'api/packages', {
          method: this.editId ? 'PUT' : 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload),
        });
      } catch (e) {
        this.error = e.message || 'Could not save.';
        this.saving = false;
        return;
      }
      this.saving = false;
      location.hash = '#/packages';
    },
    async del() {
      if (!confirm('Delete this package? The flights and stays in it stay in your log and get their own prices back.')) return;
      try { await apiJson('api/packages/' + encodeURIComponent(this.editId), { method: 'DELETE' }); }
      catch (e) { this.error = e.message; return; }
      location.hash = '#/packages';
    },
  };
}


/* ------------------------------------------------------- stay & package details */

const hasText = (r) => r[1] != null && String(r[1]).trim() !== '';

function stayDetail(id) {
  return {
    id, s: null, companions: [], loading: true, error: '', busy: false,
    async load() {
      try {
        const [st, co] = await Promise.all([apiJson('api/stays/' + encodeURIComponent(this.id)), apiJson('api/companions')]);
        this.companions = co.companions;
        this.s = decorateStay(st);
      } catch (e) { this.error = /not found/i.test(e.message) ? 'That stay could not be found. It may have been deleted.' : 'Could not load this stay: ' + e.message; }
      this.loading = false;
    },
    get subtitle() { const s = this.s; return [s.place, fmtStayShort(s.check_in) + ' – ' + fmtStayShort(s.check_out) + ' ' + s.check_out.slice(0, 4)].filter(Boolean).join(' · '); },
    get nightsLabel() { return this.s.nights + (this.s.nights === 1 ? ' night' : ' nights'); },
    get stayFacts() {
      const s = this.s;
      return [
        ['Type', s.stay_type],
        ['Hotel class', s.stars ? s.stars + (s.stars === 1 ? ' star' : ' stars') : ''],
        ['Your rating', s.rating != null ? s.rating.toFixed(1) + ' / 10' + (s.scoreWord ? ' · ' + s.scoreWord : '') : ''],
        ['Location', s.place],
        ['Address', s.address],
      ].filter(hasText);
    },
    get dateFacts() {
      const s = this.s;
      return [['Check-in', fmtStayDate(s.check_in)], ['Check-out', fmtStayDate(s.check_out)], ['Length of stay', this.nightsLabel]];
    },
    get costFacts() {
      const s = this.s;
      return [
        ['Total cost', s.package_id ? 'Part of a package' : (s.price != null ? gbp(s.price) : '')],
        ['Per night', s.perNight != null ? gbp(s.perNight) : ''],
        ['Booking reference', s.booking_ref],
      ].filter(hasText);
    },
    guestName(gid) {
      if (gid === 'me') return 'You';
      const c = this.companions.find((x) => x.id === gid);
      if (!c) return '';
      const t = ageTag(c, this.s && this.s.check_in);
      return t ? c.name + ' (' + t + ')' : c.name;
    },
    roomGuests(r) { return (r.guests || []).map((g) => this.guestName(g)).filter(Boolean).join(', ') || '—'; },
    starsArray(s) { return Array.from({ length: Math.round(s.stars || 0) }, (_, i) => i); },
    initials(name) { return String(name).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); },
    pinMap(el) { drawPinMap(el, this.s.lat, this.s.lon, null); },
    async del() {
      const extra = this.s.package_id ? ' It is part of the package “' + this.s.package_name + '”, which keeps its other flights, stays and transfers.' : '';
      if (!confirm('Remove this stay from your log?' + extra)) return;
      this.busy = true;
      try { await apiJson('api/stays/' + encodeURIComponent(this.id), { method: 'DELETE' }); } catch (e) { this.error = e.message; this.busy = false; return; }
      location.hash = '#/stays';
    },
  };
}

function packageDetail(id) {
  const core = window.FLCore;
  return {
    id, p: null, companions: [], unit: 'km', loading: true, error: '', busy: false,
    async load() {
      try {
        const [pk, settings, co] = await Promise.all([apiJson('api/packages/' + encodeURIComponent(this.id)), apiJson('api/account/settings'), apiJson('api/companions').catch(() => ({ companions: [] }))]);
        this.companions = co.companions || [];
        this.unit = settings.distance_unit || 'km';
        this.p = decoratePackage(pk);
      } catch (e) { this.error = /not found/i.test(e.message) ? 'That package could not be found. It may have been deleted.' : 'Could not load this package: ' + e.message; }
      this.loading = false;
    },
    get subtitle() { const p = this.p; return [p.place, p.start ? fmtStayShort(p.start) + ' – ' + fmtStayShort(p.end) + ' ' + p.end.slice(0, 4) : ''].filter(Boolean).join(' · '); },
    get nightsLabel() { return this.p.nights + (this.p.nights === 1 ? ' night' : ' nights'); },
    // Everyone on the package's flights and stay rooms, grouped by age on the first day of the holiday.
    get partyLabel() {
      const p = this.p, day = p.start || todayISO(), ids = new Set();
      (p.trips || []).forEach((tr) => tr.legs.forEach((l) => (l.companions || []).forEach((c) => ids.add(c.id))));
      (p.stays || []).forEach((st) => (st.room_list || []).forEach((r) => (r.guests || []).forEach((g) => { if (g !== 'me') ids.add(g); })));
      const people = [...ids].map((id) => this.companions.find((c) => c.id === id)).filter(Boolean);
      return people.length ? partyText(people, day, true) : '';
    },
    get packageFacts() {
      const p = this.p;
      return [
        ['Holiday company', p.provider], ['Board basis', p.board], ['Destination', p.place],
        ['Travellers', p.travellers ? String(p.travellers) : ''], ['Travelling party', this.partyLabel], ['Booking reference', p.booking_ref],
      ].filter(hasText);
    },
    get dateFacts() {
      const p = this.p;
      return [['Departs', p.start ? fmtStayDate(p.start) : ''], ['Returns', p.end ? fmtStayDate(p.end) : ''], ['Length', p.nights ? this.nightsLabel : '']].filter(hasText);
    },
    get costFacts() {
      const p = this.p;
      return [['Total price', p.price != null ? gbp(p.price) : 'Not recorded'], ['Per person', p.perPerson != null ? gbp(p.perPerson) : '']].filter(hasText);
    },
    get includedFacts() {
      const p = this.p;
      const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
      return [
        ['Flights', p.flightCount ? n(p.flightCount, 'flight', 'flights') + ' in ' + n(p.trips.length, 'trip', 'trips') : ''],
        ['Stays', p.stays.length ? n(p.stays.length, 'stay', 'stays') : ''],
        ['Transfers', p.transfers.length ? n(p.transfers.length, 'transfer', 'transfers') : ''],
      ].filter(hasText);
    },
    fmtStayDate, fmtStayShort,
    tripRoute(t) { return core.airportName(t.from) + (t.type === 'return' ? ' ⇄ ' : ' → ') + core.airportName(t.to); },
    legTitle(l) { return l.airline + (l.flight_number ? ' ' + l.flight_number : '') + (l.aircraft_type ? ' · ' + l.aircraft_type : ''); },
    fmtDist(km) { if (!km) return ''; const v = this.unit === 'mi' ? km * 0.621371 : km; return Math.round(v).toLocaleString() + ' ' + this.unit; },
    nightsOf(s) { const n = core.stayNights(s.check_in, s.check_out); return n + (n === 1 ? ' night' : ' nights'); },
    transferTitle(t) { return [TRANSFER_KIND_LABELS[t.kind] || 'Transfer', t.mode].filter(Boolean).join(' · '); },
    transferWhen(t) { return [t.date ? fmtStayDate(t.date) : '', t.time || ''].filter(Boolean).join(' at '); },
    initials(name) { return String(name).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); },
    get pinStay() { return (this.p.stays || []).find((x) => x.lat != null) || null; },
    pinMap(el) { const s = this.pinStay; if (s) drawPinMap(el, s.lat, s.lon, null); },
    async del() {
      if (!confirm('Delete this package? The flights and stays in it stay in your log and get their own prices back.')) return;
      this.busy = true;
      try { await apiJson('api/packages/' + encodeURIComponent(this.id), { method: 'DELETE' }); } catch (e) { this.error = e.message; this.busy = false; return; }
      location.hash = '#/packages';
    },
  };
}
