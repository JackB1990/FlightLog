/*
 * FlightLog shared logic.
 *
 * Plain JavaScript with no dependencies so the exact same code runs in the
 * Node server (require) and inside the browser (global FLCore).
 */
(function (root) {
  'use strict';

  const KM_TO_MI = 0.621371;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const toRad = (d) => (d * Math.PI) / 180;
  const round1 = (n) => Math.round(n * 10) / 10;

  function haversineKm(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(x));
  }

  function aircraftManufacturer(type) {
    if (!type) return null;
    const prefixes = ['Airbus', 'Boeing', 'Embraer', 'Bombardier', 'ATR', 'De Havilland'];
    const hit = prefixes.find((p) => type.startsWith(p));
    return hit || type.split(' ')[0];
  }

  function toBucket(map) {
    return [...map.entries()].map(([label, v]) => ({
      label,
      flights: v.flights,
      distance_km: round1(v.distance_km),
      distance_mi: round1(v.distance_km * KM_TO_MI),
    }));
  }

  function accumulate(rows, keyFn) {
    const map = new Map();
    for (const r of rows) {
      const key = keyFn(r);
      if (key === null || key === undefined) continue;
      const cur = map.get(key) || { flights: 0, distance_km: 0 };
      cur.flights += 1;
      cur.distance_km += Number(r.distance_km) || 0;
      map.set(key, cur);
    }
    return map;
  }

  function bucket(rows, keyFn) {
    return toBucket(accumulate(rows, keyFn)).sort((a, b) => b.flights - a.flights);
  }

  function orderedBucket(rows, keyFn, order) {
    const map = accumulate(rows, keyFn);
    return order.map((label) => {
      const v = map.get(label) || { flights: 0, distance_km: 0 };
      return {
        label,
        flights: v.flights,
        distance_km: round1(v.distance_km),
        distance_mi: round1(v.distance_km * KM_TO_MI),
      };
    });
  }

  function monthLabel(f) {
    const m = parseInt(String(f.date).slice(5, 7), 10);
    return m >= 1 && m <= 12 ? MONTHS[m - 1] : null;
  }

  function weekdayLabel(f) {
    const d = new Date(String(f.date).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    return WEEKDAYS[(d.getUTCDay() + 6) % 7];
  }

  /**
   * flights: array in the shape returned by GET /api/flights
   *   (each with from_airport, to_airport, companions[]).
   */
  function computeStats(flights, homeCountry) {
    const home = homeCountry || null;
    const total_flights = flights.length;
    const total_distance_km = flights.reduce((s, f) => s + (Number(f.distance_km) || 0), 0);

    const airports = new Set();
    const countries = new Set();
    for (const f of flights) {
      airports.add(f.from_airport.iata);
      airports.add(f.to_airport.iata);
      if (f.from_airport.country) countries.add(f.from_airport.country);
      if (f.to_airport.country) countries.add(f.to_airport.country);
    }

    const by_departure_home_country_airport = home
      ? bucket(flights.filter((f) => f.from_airport.country === home), (f) => `${f.from_airport.iata} — ${airportName(f.from_airport)}`)
      : [];
    const by_arrival_international_airport = home
      ? bucket(flights.filter((f) => f.to_airport.country !== home), (f) => `${f.to_airport.iata} — ${airportName(f.to_airport)}`)
      : [];

    const by_route = bucket(flights, (f) => `${f.from_airport.iata} → ${f.to_airport.iata}`);
    const by_trip_type = orderedBucket(
      flights,
      (f) => (f.from_airport.country && f.to_airport.country ? (f.from_airport.country === f.to_airport.country ? 'Domestic' : 'International') : null),
      ['Domestic', 'International']
    );
    const by_seat_class = bucket(flights, (f) => f.seat_class);
    const by_punctuality = orderedBucket(flights, (f) => (f.delay_reason ? 'Delayed' : 'On Time'), ['On Time', 'Delayed']);
    const by_delay_reason = bucket(flights.filter((f) => f.delay_reason), (f) => f.delay_reason);
    const by_month = orderedBucket(flights, monthLabel, MONTHS);
    const by_weekday = orderedBucket(flights, weekdayLabel, WEEKDAYS);

    const companionRows = [];
    for (const f of flights) for (const c of f.companions || []) companionRows.push({ label: c.name, distance_km: f.distance_km });
    const by_companion = bucket(companionRows, (r) => r.label);

    const on_time_count = flights.filter((f) => !f.delay_reason).length;
    const on_time_pct = total_flights ? Math.round((on_time_count / total_flights) * 100) : null;

    const withDist = flights.filter((f) => f.distance_km != null);
    let longest_flight = null;
    let shortest_flight = null;
    if (withDist.length) {
      const lf = withDist.reduce((a, b) => (Number(b.distance_km) > Number(a.distance_km) ? b : a));
      const sf = withDist.reduce((a, b) => (Number(b.distance_km) < Number(a.distance_km) ? b : a));
      longest_flight = { label: `${lf.from_airport.iata} → ${lf.to_airport.iata}`, date: lf.date, distance_km: round1(lf.distance_km), distance_mi: round1(lf.distance_km * KM_TO_MI) };
      shortest_flight = { label: `${sf.from_airport.iata} → ${sf.to_airport.iata}`, date: sf.date, distance_km: round1(sf.distance_km), distance_mi: round1(sf.distance_km * KM_TO_MI) };
    }

    let first_flight = null;
    let most_recent_flight = null;
    if (flights.length) {
      const sorted = [...flights].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const ff = sorted[0];
      const mf = sorted[sorted.length - 1];
      first_flight = { label: `${ff.from_airport.iata} → ${ff.to_airport.iata}`, date: ff.date };
      most_recent_flight = { label: `${mf.from_airport.iata} → ${mf.to_airport.iata}`, date: mf.date };
    }

    const years = [...new Set(flights.map((f) => parseInt(String(f.date).slice(0, 4), 10)).filter((y) => !isNaN(y)))].sort((a, b) => a - b);
    let longest_streak = years.length ? 1 : 0;
    let cur = years.length ? 1 : 0;
    for (let i = 1; i < years.length; i++) {
      cur = years[i] === years[i - 1] + 1 ? cur + 1 : 1;
      longest_streak = Math.max(longest_streak, cur);
    }

    return {
      total_flights,
      total_distance_km: round1(total_distance_km),
      total_distance_mi: round1(total_distance_km * KM_TO_MI),
      unique_airports: airports.size,
      unique_countries: countries.size,
      unique_routes: by_route.length,
      distinct_airlines: new Set(flights.map((f) => f.airline).filter(Boolean)).size,
      distinct_aircraft: new Set(flights.map((f) => f.aircraft_type).filter(Boolean)).size,
      on_time_pct,
      longest_streak,
      home_country: home,
      longest_flight,
      shortest_flight,
      first_flight,
      most_recent_flight,
      by_airline: bucket(flights, (f) => f.airline),
      by_aircraft: bucket(flights, (f) => f.aircraft_type),
      by_manufacturer: bucket(flights, (f) => aircraftManufacturer(f.aircraft_type)),
      by_year: bucket(flights, (f) => String(f.date).slice(0, 4)),
      by_departure_home_country_airport,
      by_arrival_international_airport,
      by_route,
      by_trip_type,
      by_seat_class,
      by_punctuality,
      by_delay_reason,
      by_month,
      by_weekday,
      by_companion,
    };
  }

  /**
   * Centre point per country from its airports. Longitude uses a circular
   * mean so countries that straddle the antimeridian don't average out wrong.
   */
  function countryCenters(airports) {
    const m = new Map();
    for (const a of airports) {
      if (!a.country) continue;
      const c = m.get(a.country) || { n: 0, lat: 0, s: 0, c: 0 };
      c.n += 1;
      c.lat += a.lat;
      const r = toRad(a.lon);
      c.s += Math.sin(r);
      c.c += Math.cos(r);
      m.set(a.country, c);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, c]) => ({
        name,
        lat: c.lat / c.n,
        lon: (Math.atan2(c.s / c.n, c.c / c.n) * 180) / Math.PI,
      }));
  }

  /* ------------------------------------------------------------ time zones & durations
   * Flight times are stored as local clock times at each airport, so a duration needs the
   * airport time zones (IANA names such as "Europe/London"). When an airport has no zone we
   * fall back to a longitude-based estimate and flag the result as `estimated`.
   */
  const MIN_MS = 60000;
  const DAY_MS = 86400000;
  const zoneFormats = new Map();

  function zoneFormat(tz) {
    let f = zoneFormats.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
      zoneFormats.set(tz, f);
    }
    return f;
  }

  function validTz(tz) {
    try { zoneFormat(tz); return typeof tz === 'string' && tz.length > 0; } catch (e) { return false; }
  }

  // Whole-hour guess from longitude, e.g. lon -75 -> "Etc/GMT+5" (UTC-5). Note the inverted sign of Etc/GMT zones.
  function estimateTz(lon) {
    const h = Math.round((Number(lon) || 0) / 15);
    if (h === 0) return 'Etc/GMT';
    return 'Etc/GMT' + (h > 0 ? '-' : '+') + Math.abs(h);
  }

  function resolveTz(airport) {
    if (airport && airport.tz && validTz(airport.tz)) return { tz: airport.tz, exact: true };
    return { tz: estimateTz(airport && airport.lon), exact: false };
  }

  function zoneParts(tz, utcMs) {
    const out = {};
    for (const p of zoneFormat(tz).formatToParts(new Date(utcMs))) out[p.type] = p.value;
    return out;
  }

  function offsetMinutes(tz, utcMs) {
    const p = zoneParts(tz, utcMs);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return (asUtc - Math.floor(utcMs / 1000) * 1000) / MIN_MS;
  }

  // Local date ("YYYY-MM-DD") and "HH:MM" -> UTC milliseconds, in the zone `tz`. dayOffset shifts the local date.
  function localToUtc(date, time, tz, dayOffset) {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const naive = Date.UTC(y, m - 1, d + (dayOffset || 0), hh, mm);
    const off = offsetMinutes(tz, naive);
    let t = naive - off * MIN_MS;
    const off2 = offsetMinutes(tz, t);
    if (off2 !== off) t = naive - off2 * MIN_MS;
    return t;
  }

  function localDateOf(utcMs, tz) {
    const p = zoneParts(tz, utcMs);
    return p.year.padStart(4, '0') + '-' + p.month.padStart(2, '0') + '-' + p.day.padStart(2, '0');
  }

  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
  }

  const MAX_SPEED_KMH = 1150; // no airliner averages faster; used to pick the right arrival day

  // Booked (scheduled) and actual durations for one flight. Returns minutes and absolute (UTC) times.
  function legTimes(leg) {
    const from = resolveTz(leg.from_airport);
    const to = resolveTz(leg.to_airport);
    const res = { estimated: !(from.exact && to.exact), sched: null, actual: null, depDelay: null, arrDelay: null };
    if (!leg.date) return res;
    const km = Number(leg.distance_km) || 0;
    const make = (depUtc, arrUtc) => {
      const arrDate = localDateOf(arrUtc, to.tz);
      return { depUtc, arrUtc, minutes: Math.round((arrUtc - depUtc) / MIN_MS), depDate: localDateOf(depUtc, from.tz), arrDate, dayOffset: dayDiff(leg.date, arrDate) };
    };
    // Arrival is a clock time only, so try the days around departure and take the first plausible one.
    const firstPlausible = (arrTime, depUtc) => {
      let fallback = null;
      for (let k = -1; k <= 4; k++) {
        const c = localToUtc(leg.date, arrTime, to.tz, k);
        if (c < depUtc + 10 * MIN_MS) continue;
        if (fallback === null) fallback = c;
        if (!km || km / ((c - depUtc) / 3600000) <= MAX_SPEED_KMH) return c;
      }
      return fallback;
    };
    if (leg.departure_time && leg.arrival_time) {
      const dep = localToUtc(leg.date, leg.departure_time, from.tz, 0);
      const arr = firstPlausible(leg.arrival_time, dep);
      if (arr !== null) res.sched = make(dep, arr);
    }
    if (leg.actual_departure_time || leg.actual_arrival_time) {
      const dTime = leg.actual_departure_time || leg.departure_time;
      const aTime = leg.actual_arrival_time || leg.arrival_time;
      if (dTime && aTime) {
        let dep = localToUtc(leg.date, dTime, from.tz, 0);
        if (res.sched) {
          // a delayed departure can slip past midnight: pick the day closest to the booked departure
          for (const k of [-1, 1]) {
            const c = localToUtc(leg.date, dTime, from.tz, k);
            if (Math.abs(c - res.sched.depUtc) < Math.abs(dep - res.sched.depUtc)) dep = c;
          }
        }
        let arr = null;
        if (res.sched) {
          for (let k = -1; k <= 4; k++) {
            const c = localToUtc(leg.date, aTime, to.tz, k);
            if (c < dep + 10 * MIN_MS) continue;
            if (arr === null || Math.abs(c - res.sched.arrUtc) < Math.abs(arr - res.sched.arrUtc)) arr = c;
          }
        } else {
          arr = firstPlausible(aTime, dep);
        }
        if (arr !== null) res.actual = make(dep, arr);
      }
    }
    if (res.sched && res.actual) {
      res.depDelay = Math.round((res.actual.depUtc - res.sched.depUtc) / MIN_MS);
      res.arrDelay = Math.round((res.actual.arrUtc - res.sched.arrUtc) / MIN_MS);
    }
    return res;
  }

  // Totals for a connected journey (a list of legTimes() results, in flying order).
  function journeyTimes(ts) {
    const calc = (kind) => {
      const parts = ts.map((t) => t[kind] || (kind === 'actual' ? t.sched : null));
      if (!parts.length || parts.some((x) => !x)) return null;
      const air = parts.reduce((n, x) => n + x.minutes, 0);
      const layovers = [];
      for (let i = 1; i < parts.length; i++) layovers.push(Math.round((parts[i].depUtc - parts[i - 1].arrUtc) / MIN_MS));
      const depUtc = parts[0].depUtc;
      const arrUtc = parts[parts.length - 1].arrUtc;
      return { depUtc, arrUtc, elapsed: Math.round((arrUtc - depUtc) / MIN_MS), air, layovers, layover: layovers.reduce((n, x) => n + Math.max(0, x), 0) };
    };
    return { scheduled: calc('sched'), actual: ts.some((t) => t.actual) ? calc('actual') : null };
  }

  // Whole trip: both journeys plus total flying time and time away (first departure to last arrival).
  function tripTimes(outTs, backTs) {
    const outbound = journeyTimes(outTs);
    const back = backTs && backTs.length ? journeyTimes(backTs) : null;
    const pick = (j, kind) => (j ? j[kind] : null);
    const total = (kind) => {
      const a = pick(outbound, kind);
      const b = back ? pick(back, kind) : null;
      if (!a || (back && !b)) return null;
      return { air: a.air + (b ? b.air : 0), away: b ? Math.round((b.arrUtc - a.depUtc) / MIN_MS) : null, elapsed: a.elapsed + (b ? b.elapsed : 0) };
    };
    return {
      outbound, return: back,
      scheduled: total('scheduled'),
      actual: (outbound.actual || (back && back.actual)) ? total('actual') : null,
      estimated: [...outTs, ...(backTs || [])].some((t) => t.estimated),
    };
  }

  function fmtDuration(min) {
    if (min === null || min === undefined || !Number.isFinite(min)) return '—';
    const sign = min < 0 ? '−' : '';
    const m = Math.round(Math.abs(min));
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h === 0) return sign + r + 'm';
    if (h >= 48) { const d = Math.floor(h / 24); return sign + d + 'd ' + (h % 24) + 'h ' + String(r).padStart(2, '0') + 'm'; }
    return sign + h + 'h ' + String(r).padStart(2, '0') + 'm';
  }

  // The airport's own name without the word "Airport", e.g. "Manchester Airport" -> "Manchester",
  // "Fuerteventura Airport" -> "Fuerteventura". (The city field is often a nearby town, so it is not used.)
  function airportName(a) {
    if (!a) return '';
    const raw = String(a.name || '').trim();
    const short = raw.replace(/\s+(international\s+|int'l\s+)?airport$/i, '').replace(/\s+airport\s*$/i, '').trim();
    return short || raw || String(a.city || a.iata || '');
  }

  const api = {
    KM_TO_MI, airportName, haversineKm, aircraftManufacturer, computeStats, countryCenters,
    validTz, estimateTz, resolveTz, localToUtc, localDateOf, legTimes, journeyTimes, tripTimes, fmtDuration,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FLCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
