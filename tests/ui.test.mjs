// Run with: node --test tests/ui.test.mjs
// Exercises the flight-list component logic (filters, sorting, derived fields)
// against the demo API, without needing a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function makeCtx(opts = {}) {
  const store = new Map();
  const events = [];
  const window = {
    ...opts, __events: events, dispatchEvent(e) { events.push(e); return true; },
    FLCore: require(join(root, 'shared/core.js')),
    FL_AIRPORTS: JSON.parse(readFileSync(join(root, 'server/data/airports-fallback.json'), 'utf8')),
    addEventListener() {}, scrollTo() {},
  };
  const ctx = vm.createContext({
    window, console, URL, URLSearchParams, JSON, Date, Math, Number, String, Array, Set, Map, Object, Error, Promise, Intl,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2) },
    document: { title: '' }, location: { hash: '' },
    Event: class { constructor(type) { this.type = type; } }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  });
  for (const f of ['tests/support/mock-api.js', 'frontend/data.js']) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx);
  // data.js assigns window.FL_DATA; app.js refers to the bare global
  ctx.FL_DATA = window.FL_DATA;
  vm.runInContext(readFileSync(join(root, 'frontend/app.js'), 'utf8'), ctx);
  return ctx;
}

async function makeList() {
  const ctx = await makeCtx();
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  return list;
}

test('loads, decorates and sorts flights', async () => {
  const l = await makeList();
  assert.equal(l.flights.length, 19);
  // 8 seeded trips + 1 standalone flight
  assert.equal(l.visibleItems.length, 9);
  assert.equal(l.tripCount, 8);
  assert.match(l.summaryLine, /9 journeys \(8 trips, 1 single flight\)/);
  assert.ok(l.visibleItems[0].date >= l.visibleItems[1].date);
  assert.equal(l.visibleItems[0].kind, 'flight');
  const delayed = l.flights.find((f) => f.delay_reason && f.actual_departure_time && f.actual_departure_time !== f.departure_time);
  assert.ok(delayed._depLate && delayed._depSched === delayed.departure_time);
  assert.equal(delayed._dep, delayed.actual_departure_time);
  const night = l.flights.find((f) => f.flight_number === 'EK30');
  assert.equal(night._nextDay, true);
  assert.equal(l.initials('British Airways'), 'BA');
  assert.match(l.fmtLongDate('2024-10-12'), /Sat, 12 Oct 2024/);

  l.sort = 'longest';
  const d = [...l.visibleItems.map((it) => it.distance_km)];
  assert.deepEqual(d, [...d].sort((a, b) => b - a));
  assert.equal(l.longestInfo.sub, l.routeLabel(l.visibleItems[0]));
  l.sort = 'airline';
  assert.equal(l.visibleItems[0].legs[0].airline, 'British Airways');
});

test('filters combine and reset', async () => {
  const l = await makeList();
  l.activeYear = '2024';
  assert.ok(l.visibleItems.length > 0 && l.visibleItems.every((it) => it.date.startsWith('2024')));
  l.airlineFilter = ['British Airways'];
  assert.ok(l.visibleItems.every((it) => it.legs.some((f) => f.airline === 'British Airways')));
  l.punctFilter = ['Delayed'];
  assert.equal(l.visibleItems.length, 1);
  assert.ok(l.filtersActive);
  l.resetFilters();
  assert.equal(l.visibleItems.length, 9);
  assert.ok(!l.filtersActive);
  l.classFilter = ['Business'];
  assert.ok(l.visibleItems.length >= 2 && l.visibleItems.every((it) => it.legs.some((f) => f.seat_class === 'Business')));
});

test('flight details page loads one flight with all facts', async () => {
  const ctx = await makeCtx();
  const all = vm.runInContext('flightList()', ctx);
  await all.load();
  const target = all.flights.find((f) => f.delay_reason) || all.flights[0];
  const d = vm.runInContext(`flightDetail(${JSON.stringify(target.id)})`, ctx);
  await d.load();
  assert.equal(d.error, '');
  assert.equal(d.f.id, target.id);
  assert.match(d.fmtDayDate(target.date), /^\w{3}, \d{1,2} \w{3} \d{4}$/);
  assert.ok(d.flightFacts.some((r) => r[0] === 'Airline' && r[1] === target.airline));
  assert.equal(d.routeFacts[0][1].startsWith(target.from_airport.iata), true);
  assert.ok(d.scheduleFacts.length >= 6 && d.seatFacts.length === (target.package_id ? 4 : 3));
  if (target.package_id) assert.ok(d.seatFacts.some((r) => r[0] === 'Total cost' && r[1] === 'Part of a package'));
  const missing = vm.runInContext('flightDetail("nope")', ctx);
  await missing.load();
  assert.match(missing.error, /could not be found/);
});

test('trips group legs into outbound and return journeys', async () => {
  const l = await makeList();
  const around = l.items.find((it) => it.kind === 'trip' && it.outbound.length === 2);
  assert.equal(around.type, 'return');
  assert.deepEqual([...around.outbound.map((f) => f.flight_number)], ['EK30', 'EK412']);
  assert.deepEqual([...around.inbound.map((f) => f.flight_number)], ['QF11', 'VS8']);
  assert.equal(around.origin.iata, 'LHR');
  assert.equal(around.destination.iata, 'SYD');
  assert.equal(around.date, '2024-02-17');
  assert.equal(around.endDate, '2024-03-06');
  assert.equal(around.legs.length, 4);
  assert.equal(l.tripCounts(around), '2 flights out, 2 flights back');
  assert.equal(l.tripTitle(around).includes('\u21c4'), true);
  assert.equal(l.routeLabel(around), 'LHR \u21c4 SYD');
  assert.equal(l.tripRange(around), '17 February \u2013 6 March 2024');
});

test('trip details page shows legs, connections and deletes the whole trip', async () => {
  const ctx = await makeCtx();
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  const trip = list.items.find((it) => it.kind === 'trip' && it.outbound.length === 2);
  const d = vm.runInContext(`tripDetail(${JSON.stringify(trip.key)})`, ctx);
  await d.load();
  assert.equal(d.error, '');
  assert.equal(d.sections.length, 2);
  assert.equal(d.sections[0].legs.length, 2);
  assert.match(d.title, /\u21c4/);
  assert.deepEqual([...d.sections.map((x) => x.label)], ['Outbound', 'Return']);
  assert.equal(d.fmtDayDate('2024-02-17'), 'Sat, 17 Feb 2024');
  assert.ok(d.summaryFacts.some((r) => r[0] === 'Flights' && r[1] === '4'));
  assert.ok(!d.summaryFacts.some((r) => r[0] === 'Type'), 'the Type row is gone');
  // DXB arrival 00:20 (+1) then departure 10:30 the next day... connection text is only shown when plausible
  assert.equal(typeof d.legConnection(d.sections[0], 1), 'string');
  const rows = d.detailRows(d.sections[0].legs[0]);
  assert.deepEqual([...rows.map((r) => r[0])], ['From', 'To', 'Airline', 'Flight Number', 'Aircraft Registration', 'Cabin Class', 'Seat', 'Scheduled Departure/Arrival', 'Distance']);
  const delayed = d.detailRows({ ...d.sections[0].legs[0], actual_departure_time: '15:00', actual_arrival_time: '01:00', delay_reason: 'Weather', seat_number: null, flight_number: '' });
  assert.ok(delayed.some((r) => r[0] === 'Actual Departure/Arrival' && r[1] === '15:00 \u2192 01:00'));
  assert.ok(delayed.some((r) => r[0] === 'Reason for Delay' && r[1] === 'Weather'));
  assert.ok(!delayed.some((r) => r[0] === 'Seat' || r[0] === 'Flight Number'), 'blank details are hidden');
  assert.equal(d.detailsTitle(d.sections[0]), 'Outbound Details');
  assert.equal(d.detailsTitle(d.sections[1]), 'Return Details');
  ctx.confirm = () => true;
  await d.del();
  const after = vm.runInContext('flightList()', ctx);
  await after.load();
  assert.equal(after.flights.length, 15);
  assert.equal(after.items.length, 8);
  const missing = vm.runInContext('tripDetail("nope")', ctx);
  await missing.load();
  assert.match(missing.error, /could not be found/);
});

test('add form: one way, connections, return, edit and convert', async () => {
  const ctx = await makeCtx();
  const mk = async (id) => { const f = vm.runInContext(`flightForm(${JSON.stringify(id || '')})`, ctx); await f.load(); return f; };
  const fill = (leg, from, to, airline) => { leg.ui.from.query = from; leg.ui.from.resolved = from; leg.ui.to.query = to; leg.ui.to.resolved = to; leg.airline = airline; };

  // single one-way flight -> standalone flight, no trip
  let f = await mk();
  assert.equal(f.type, 'oneway');
  assert.equal(f.legs.outbound.length, 1);
  assert.equal(f.saveLabel, 'Save Flight');
  fill(f.legs.outbound[0], 'LHR', 'AMS', 'KLM');
  await f.save();
  let list = vm.runInContext('flightList()', ctx); await list.load();
  assert.equal(list.flights.length, 20);
  const single = list.items.find((it) => it.kind === 'flight' && it.f.from_airport.iata === 'LHR' && it.f.to_airport.iata === 'AMS');
  assert.ok(single && !single.f.trip_id);

  // validation
  f = await mk();
  await f.save();
  assert.match(f.error, /choose a valid From and To/);

  // one-way with a connection -> trip
  f = await mk();
  fill(f.legs.outbound[0], 'MAN', 'DXB', 'Emirates');
  f.addLeg('outbound');
  assert.equal(f.legs.outbound.length, 2);
  assert.equal(f.legs.outbound[1].ui.from.resolved, 'DXB', 'connection starts where the previous flight ended');
  assert.equal(f.legs.outbound[1].airline, 'Emirates');
  fill(f.legs.outbound[1], 'DXB', 'SIN', 'Emirates');
  assert.equal(f.saveLabel, 'Save Trip');
  await f.save();
  list = vm.runInContext('flightList()', ctx); await list.load();
  const oneWayTrip = list.items.find((it) => it.kind === 'trip' && it.origin.iata === 'MAN' && it.destination.iata === 'SIN');
  assert.ok(oneWayTrip);
  assert.equal(oneWayTrip.type, 'oneway');
  assert.equal(oneWayTrip.legs.length, 2);

  // return trip with seeded return leg
  f = await mk();
  fill(f.legs.outbound[0], 'LHR', 'JFK', 'British Airways');
  f.legs.outbound[0].seat_class = 'Business';
  f.setType('return');
  assert.equal(f.legs.return.length, 1);
  const seed = f.legs.return[0];
  assert.equal(seed.ui.from.resolved, 'JFK');
  assert.equal(seed.ui.to.resolved, 'LHR');
  assert.equal(seed.airline, 'British Airways');
  assert.equal(seed.seat_class, 'Business');
  f.companion_ids = ['demo-companion-alex'];
  await f.save();
  list = vm.runInContext('flightList()', ctx); await list.load();
  const ret = list.items.find((it) => it.kind === 'trip' && it.type === 'return' && it.destination.iata === 'JFK' && it.legs.length === 2 && it.legs[0].seat_class === 'Business' && it.legs[0].companions.length === 1 && it.date === localTodayStr());
  assert.ok(ret, 'return trip saved with both legs and companions');

  // edit: loads both directions, add a connection to the return, save
  f = await mk(ret.key);
  assert.equal(f.type, 'return');
  assert.equal(f.legs.outbound.length, 1);
  assert.equal(f.legs.return.length, 1);
  assert.deepEqual([...f.companion_ids], ['demo-companion-alex']);
  f.addLeg('return');
  fill(f.legs.return[1], 'LHR', 'MAN', 'British Airways');
  await f.save();
  list = vm.runInContext('flightList()', ctx); await list.load();
  const edited = list.items.find((it) => it.key === ret.key);
  assert.equal(edited.legs.length, 3);
  assert.equal(edited.inbound.length, 2);

  // convert the return trip back into a single one-way flight (drops the return journey)
  f = await mk(ret.key);
  f.setType('oneway');
  await f.save();
  list = vm.runInContext('flightList()', ctx); await list.load();
  assert.ok(!list.items.find((it) => it.key === ret.key));
  const back = list.items.find((it) => it.kind === 'flight' && it.f.to_airport.iata === 'JFK' && it.f.date === localTodayStr());
  assert.ok(back && !back.f.trip_id, 'now a standalone flight');
});

function localTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

test('trip legs are always ordered outbound before return, whatever order they arrive in', async () => {
  const ctx = await makeCtx();
  const mk = (id, direction, leg_order, date) => ({ id, trip_id: 'T', direction, leg_order, date, distance_km: 1, airline: 'KLM', from_airport: { iata: 'A' }, to_airport: { iata: 'B' } });
  ctx.input = [mk('r2', 'return', 1, '2025-02-03'), mk('o2', 'outbound', 1, '2025-02-01'), mk('r1', 'return', 0, '2025-02-02'), mk('o1', 'outbound', 0, '2025-02-01')];
  const out = vm.runInContext('buildItems(input)', ctx)[0];
  assert.deepEqual([...out.legs.map((l) => l.id)], ['o1', 'o2', 'r1', 'r2']);
  assert.deepEqual([...out.outbound.map((l) => l.id)], ['o1', 'o2']);
  assert.deepEqual([...out.inbound.map((l) => l.id)], ['r1', 'r2']);
});

test('flights and trips show real durations, arrival dates and booked-vs-actual times', async () => {
  const ctx = await makeCtx();
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  const ba = list.flights.find((f) => f.flight_number === 'BA178');
  assert.equal(ba._durText, '7h 35m');
  assert.equal(ba._dayText, '');
  const ek = list.flights.find((f) => f.flight_number === 'EK30');
  assert.equal(ek._durText, '6h 10m');
  assert.equal(ek._dayText, '+1');
  const qf = list.flights.find((f) => f.flight_number === 'QF11');
  assert.equal(qf._dayOffset, 0, 'Sydney to Los Angeles lands the same calendar day');

  const trip = list.items.find((it) => it.kind === 'trip' && it.outbound.length === 2);
  const d = vm.runInContext(`tripDetail(${JSON.stringify(trip.key)})`, ctx);
  await d.load();
  const blocks = [...d.timeBlocks];
  assert.deepEqual([...blocks.map((b) => b.title)], ['Outbound Journey', 'Return Journey', 'Whole Trip']);
  const out = blocks[0].rows;
  assert.deepEqual([...out.map((r) => r[0])], ['Journey Time', 'Time In The Air', 'Connections']);
  assert.match(out[0][1], /^(\d+d )?\d+h \d{2}m$/);
  assert.equal(blocks[2].rows[1][0], 'Time Away');
  assert.ok(d.arrives(d.sections[0].legs[0]).startsWith('Sun, 18 Feb 2024'));
  assert.match(d.flightTime(d.sections[0].legs[0]), /^6h 10m$/);
  assert.match(d.legConnection(d.sections[0], 1), /^(\d+d )?\d+h \d{2}m$/);
  assert.equal(d.timesEstimated, false);

  // a recorded delay shows booked and actual flight time side by side
  const f = vm.runInContext(`flightDetail(${JSON.stringify(ba.id)})`, ctx);
  await f.load();
  assert.ok(f.scheduleFacts.some((r) => r[0] === 'Booked flight time' && r[1] === '7h 35m'));
  assert.ok(f.scheduleFacts.some((r) => r[0] === 'Arrival' && /^55m late$/.test(r[1])));
});

test('multi-flight journeys get one combined card with stops and connection boxes', async () => {
  const ctx = await makeCtx();
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  const around = list.items.find((it) => it.kind === 'trip' && it.outbound.length === 2);
  const d = vm.runInContext(`tripDetail(${JSON.stringify(around.key)})`, ctx);
  await d.load();
  assert.equal(d.hasStopover, true);
  const j = d.journeyCard(d.sections[0]);
  assert.equal(j.stops, 1);
  assert.equal(j.stopsText, '1 stop DXB');
  assert.equal(j.stopsCount, '1 stop');
  assert.equal(j.stopCodes, 'DXB');
  assert.equal(j.logos.length, 1);
  assert.equal(j.airlines, 'Emirates');
  assert.equal(j.first.from_airport.iata, 'LHR');
  assert.equal(j.last.to_airport.iata, 'SYD');
  assert.match(j.durText, /^(\d+d )?\d+h \d{2}m$/);
  assert.match(j.arrives, /^\w{3}, \d{1,2} \w{3} 2024$/);
  const c = d.connectInfo(d.sections[0].legs[0], d.sections[0].legs[1]);
  assert.equal(c.label, 'Stopover in Dubai', 'a layover of more than a day is a stopover');
  assert.equal(c.long, false);

  // a short connection is "Connect in airport"; 4h+ is flagged as a long wait
  const mk = (arrUtc, depUtc) => ({ to_airport: { iata: 'AMS' }, from_airport: { iata: 'AMS', city: 'Amsterdam' }, _t: { sched: { arrUtc, depUtc } } });
  const t0 = Date.parse('2026-10-29T08:15:00Z');
  const short = d.connectInfo(mk(t0, t0), mk(0, t0 + 130 * 60000));
  assert.equal(short.dur, '2h 10m');
  assert.equal(short.label, 'Connect in airport');
  assert.equal(short.long, false);
  const long = d.connectInfo(mk(t0, t0), mk(0, t0 + 308 * 60000));
  assert.equal(long.dur, '5h 08m');
  assert.equal(long.long, true);
  const change = d.connectInfo({ ...mk(t0, t0), to_airport: { iata: 'LGW' } }, mk(0, t0 + 200 * 60000));
  assert.equal(change.label, 'Change airport (LGW → AMS)');

  // a trip with no stopover keeps "Direct"
  const plain = list.items.find((it) => it.kind === 'trip' && it.outbound.length === 1 && it.inbound.length === 1);
  const p = vm.runInContext(`tripDetail(${JSON.stringify(plain.key)})`, ctx);
  await p.load();
  assert.equal(p.hasStopover, false);
});

test('journeys on several airlines list them and stack their logos', async () => {
  const ctx = await makeCtx();
  const d = vm.runInContext('tripDetail("x")', ctx);
  const mk = (id, airline, from, to) => ({ id, airline, _logoUrl: 'u-' + airline, _color: '#000', _colorText: '#fff', from_airport: { iata: from }, to_airport: { iata: to }, _t: { sched: null, actual: null } });
  const legs = [mk(1, 'Jet2', 'LBA', 'CDG'), mk(2, 'Etihad Airways', 'CDG', 'AUH'), mk(3, 'Etihad Airways', 'AUH', 'MAA'), mk(4, 'Scoot', 'MAA', 'SIN')];
  const j = d.journeyCard({ legs });
  assert.equal(j.airlines, 'Jet2, Etihad Airways and Scoot');
  assert.deepEqual([...j.logos.map((l) => l.airline)], ['Jet2', 'Etihad Airways', 'Scoot']);
  assert.equal(j.stopsCount, '3 stops');
  assert.equal(j.stopCodes, 'CDG, AUH, MAA');
  const two = d.journeyCard({ legs: [legs[0], legs[3]] });
  assert.equal(two.airlines, 'Jet2 and Scoot');
});

test('trip map draws every flight of the trip in one colour', async () => {
  const ctx = await makeCtx();
  const calls = [];
  const chain = { bindTooltip() { return chain; }, bindPopup() { return chain; }, addTo() { return chain; } };
  ctx.setTimeout = () => 0;
  ctx.L = {
    map: () => ({ getContainer: () => ({ classList: { add() {} } }), setView() {}, fitBounds: () => calls.push('fit'), remove: () => calls.push('remove'), invalidateSize() {} }),
    tileLayer: () => chain,
    polyline: (pts, o) => { calls.push(o.dashArray ? 'return-line' : 'out-line'); return chain; },
    circleMarker: () => { calls.push('marker'); return chain; },
    latLngBounds: () => ({}),
  };
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  const trip = list.items.find((it) => it.kind === 'trip' && it.outbound.length === 2);
  const m = vm.runInContext('makeLegMap()', ctx);
  m.init({ offsetHeight: 300 }, trip.legs);
  assert.equal(calls.filter((c) => c === 'out-line').length, 12, 'four flights, each drawn with two neighbouring world copies, none dashed');
  assert.equal(calls.filter((c) => c === 'return-line').length, 0);
  // the trip page must own a map helper (it once referenced one it never created)
  const td = vm.runInContext("tripDetail('x')", ctx);
  assert.equal(typeof td.destroy, 'function');
  assert.doesNotThrow(() => td.destroy());
  assert.equal(calls.filter((c) => c === 'marker').length, 4, 'one marker per distinct airport: LHR, DXB, SYD, LAX');
  assert.ok(calls.includes('fit'));
  m.destroy();
  assert.ok(calls.includes('remove'));
});

test('routes that cross the edge of the map window stay continuous', async () => {
  const ctx = await makeCtx();
  const pts = [[51, 170], [40, 179], [30, -178], [-33, -170]]; // wraps from +180 to -180
  const lines = vm.runInContext('continuousLines', ctx)(pts).map((l) => [...l].map((p) => [...p]));
  assert.equal(lines.length, 3);
  for (const l of lines) for (let i = 1; i < l.length; i++) assert.ok(Math.abs(l[i][1] - l[i - 1][1]) < 180, 'no jump across the map');
  assert.equal(lines[1][2][1], 182);
});

test('add form drop-downs: highlight, pick an airport, suggestions', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("flightForm('')", ctx);
  await f.load();
  assert.equal(f.hl('London <Heathrow>', 'lond'), '<b>Lond</b>on &lt;Heathrow&gt;');
  const leg = f.legs.outbound[0];
  f.openDD('k'); assert.ok(f.isOpen('k'));
  f.pickAirport(leg, 'from', { iata: 'LHR', name: 'London Heathrow Airport', city: 'London', country: 'United Kingdom' });
  assert.equal(leg.ui.from.resolved, 'LHR');
  assert.equal(leg.ui.from.query, 'London Heathrow (LHR)');
  assert.equal(f.isOpen('k'), false);
  f.clearAirport(leg, 'from');
  assert.equal(leg.ui.from.resolved, null);
  leg.airline = 'brit';
  const s = [...f.suggestions('airline', leg)];
  assert.ok(s.length > 0 && s.every((n) => n.toLowerCase().includes('brit')));
  assert.equal(f.airportSub({ name: 'London Heathrow Airport', city: 'London', country: 'United Kingdom' }), 'United Kingdom');
});

test('add form select-style drop-downs: seat class, delay reason, companions', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("flightForm('')", ctx);
  await f.load();
  const leg = f.legs.outbound[0];
  assert.equal(f.selectLabel('seat', leg), 'Not specified');
  f.pickSelect('seat', leg, { v: 'Business', label: 'Business' });
  assert.equal(leg.seat_class, 'Business');
  assert.equal(f.selectLabel('delay', leg), 'No delay');
  assert.ok(f.selectOptions('delay').length > 1);
  assert.equal(f.companionsLabel(), 'Nobody selected');
  if (f.companions.length) {
    const o = f.companionOptions()[0];
    f.toggleCompanion(o); assert.ok(f.companionsLabel().includes(o.label));
    f.toggleCompanion(o); assert.equal(f.companionsLabel(), 'Nobody selected');
  }
});

test('add form date and time pickers', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("flightForm('')", ctx);
  await f.load();
  const leg = f.legs.outbound[0];
  f.openDate('d', '2026-10-25');
  const oct = f.monthView(0), nov = f.monthView(1);
  assert.equal(oct.title, 'October 2026');
  assert.equal(nov.title, 'November 2026');
  assert.equal(oct.cells.filter(Boolean).length, 31);
  assert.equal(oct.cells.findIndex(Boolean), 3, 'Oct 1 2026 is a Thursday: three blanks, Monday first');
  assert.equal(nov.cells.findIndex(Boolean), 6, 'Nov 1 2026 is a Sunday');
  assert.ok(oct.cells.find((c) => c && c.n === 25).sel);
  f.pickDay(nov.cells.find((c) => c && c.n === 9));
  assert.equal(f.pickedDateText(), 'Mon, 9 Nov 2026');
  f.applyDate(leg, 'date');
  assert.equal(leg.date, '2026-11-09');
  f.stepMonth(-12); assert.equal(f.monthView(0).title, 'October 2025');
  f.openTime('t', '');
  f.pick.h = '09'; f.pick.min = '45';
  f.applyTime(leg, 'departure_time');
  assert.equal(leg.departure_time, '09:45');
  leg.arrival_time = '930'; f.tidyTime(leg, 'arrival_time'); assert.equal(leg.arrival_time, '09:30');
  leg.arrival_time = '9.05'; f.tidyTime(leg, 'arrival_time'); assert.equal(leg.arrival_time, '09:05');
  leg.arrival_time = '25:99'; f.tidyTime(leg, 'arrival_time'); assert.equal(leg.arrival_time, '');
});

test('price is one total per booking, kept on the first flight', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("flightForm('')", ctx);
  await f.load();
  f.setType('return');
  for (const dir of ['outbound', 'return']) {
    const l = f.legs[dir][0];
    l.ui.from.resolved = 'LHR'; l.ui.to.resolved = 'JFK'; l.date = '2026-05-01'; l.airline = 'BA';
  }
  f.price = '1,234.5'; f.tidyPrice();
  assert.equal(f.price, '1234.50');
  const p = f.buildPayload();
  assert.equal(p.legs[0].price, '1234.50');
  assert.equal(p.legs[1].price, '');
});

test('overview card shows the total cost on the right', async () => {
  const ctx = await makeCtx();
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  const priced = list.items.filter((it) => list.itemPrice(it) > 0);
  assert.ok(priced.length >= 5 && priced.length < list.items.length, 'some have a price, some are not recorded');
  const solo = list.items.find((it) => it.kind === 'flight');
  assert.equal(list.itemPrice(solo), 4120);
  assert.equal(list.fmtMoney(4120), '\u00a34,120.00');
  assert.equal(list.sideSummary(solo), 'One-way \u00b7 1 flight');
  const ret = list.items.find((it) => it.kind === 'trip' && it.type === 'return' && it.legs.length === 4);
  assert.equal(list.sideSummary(ret), 'Return trip \u00b7 4 flights');
  assert.ok(/^\d+ \w+/.test(list.sideDate(ret)));
});

test('airport names are used, not nearby town names', async () => {
  const ctx = await makeCtx();
  const core = require(join(root, 'shared/core.js'));
  assert.equal(core.airportName({ name: 'Manchester Airport', city: 'Manchester, Greater Manchester' }), 'Manchester');
  assert.equal(core.airportName({ name: 'Fuerteventura Airport', city: 'El Matorral' }), 'Fuerteventura');
  assert.equal(core.airportName({ name: 'Leeds Bradford International Airport', city: 'Yeadon' }), 'Leeds Bradford');
  assert.equal(core.airportName({ name: 'Heathrow', city: 'London' }), 'Heathrow');
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  const trip = list.items.find((it) => it.kind === 'trip');
  assert.ok(!/El Matorral|Greater/.test(list.tripTitle(trip)));
  const stats = (await (await ctx.window.FL_TEST_API.handle('api/stats', {})).json());
  assert.ok(!JSON.stringify(stats).includes('El Matorral'));
  assert.ok(JSON.stringify(stats).includes('LHR \u2014 Heathrow') || JSON.stringify(stats).includes('LHR \u2014 London Heathrow'));
});

test('trip page leaves out fields that are blank, and shows them once filled in', async () => {
  const ctx = await makeCtx();
  const api = ctx.window.FL_TEST_API;
  const list = vm.runInContext('flightList()', ctx);
  await list.load();
  // a bare one-way trip: no cabin, no times, no price, no companions
  const made = await (await api.handle('api/trips', { method: 'POST', body: JSON.stringify({ type: 'oneway', legs: [{ direction: 'outbound', from_iata: 'LHR', to_iata: 'AMS', date: '2025-03-01', airline: 'KLM' }, { direction: 'outbound', from_iata: 'AMS', to_iata: 'JFK', date: '2025-03-01', airline: 'KLM' }] }) })).json();
  const d = vm.runInContext(`tripDetail(${JSON.stringify(made.id)})`, ctx);
  await d.load();
  const labels = () => d.summaryFacts.map((r) => r[0]);
  assert.ok(!labels().includes('Cabin') && !labels().includes('Total cost'), 'blank cabin and price are hidden: ' + JSON.stringify(d.summaryFacts));
  assert.ok(labels().includes('Airlines'));
  assert.equal(d.timeBlocks.length, 0, 'no times recorded: the times section is empty');
  assert.equal(d.showBooked, false);
  assert.equal(d.t('\u2014'), '');
  // edit the trip to add the details
  await api.handle('api/trips/' + made.id, { method: 'PUT', body: JSON.stringify({ type: 'oneway', legs: [{ direction: 'outbound', from_iata: 'LHR', to_iata: 'AMS', date: '2025-03-01', airline: 'KLM', seat_class: 'Business', departure_time: '09:00', arrival_time: '11:30', price: '150' }, { direction: 'outbound', from_iata: 'AMS', to_iata: 'JFK', date: '2025-03-01', airline: 'KLM', departure_time: '13:00', arrival_time: '15:30' }] }) });
  const d2 = vm.runInContext(`tripDetail(${JSON.stringify(made.id)})`, ctx);
  await d2.load();
  const l2 = d2.summaryFacts.map((r) => r[0]);
  assert.ok(l2.includes('Cabin') && l2.includes('Total cost'));
  assert.ok(d2.timeBlocks.length > 0 && d2.showBooked && !d2.showActual, 'booked times appear, actual column stays hidden');
});

test('route map filters by airline and home airport (left of the year filter)', async () => {
  const ctx = await makeCtx();
  const m = vm.runInContext('mapView()', ctx);
  m.$nextTick = () => {};
  await m.load();
  assert.ok(m.airlineOptions.some((a) => a.name === 'British Airways'));
  assert.ok(m.homeAirportOptions.length > 0 && m.homeAirportOptions.every((o) => /^[A-Z]{3} /.test(o.label)));
  // only airports in the home country (United Kingdom) are offered
  assert.ok(!m.homeAirportOptions.some((o) => ['JFK', 'AMS', 'DXB'].includes(o.iata)));
  assert.ok(m.homeAirportOptions.some((o) => o.iata === 'LHR'));
  const all = m.activeFlights.length;
  m.airlineFilter = 'British Airways';
  assert.ok(m.activeFlights.length > 0 && m.activeFlights.length < all && m.activeFlights.every((f) => f.airline === 'British Airways'));
  m.homeAirport = 'LHR';
  assert.ok(m.activeFlights.every((f) => f.from_airport.iata === 'LHR' || f.to_airport.iata === 'LHR'));
  m.activeYear = '2024';
  assert.ok(m.activeFlights.every((f) => f.date.startsWith('2024')));
  m.homeAirport = 'MAN'; m.airlineFilter = '__all__'; m.activeYear = '__all__';
  assert.ok(m.activeFlights.every((f) => f.from_airport.iata === 'MAN' || f.to_airport.iata === 'MAN'));
  assert.ok(m.yearOptions.every((y) => y.flights.length > 0));
  assert.ok(m.mapFiltersActive);
  m.clearFilters();
  assert.ok(!m.mapFiltersActive && m.activeFlights.length === all, 'Clear filters resets airline, home airport and year');
  // template order: Airline, Home Airport, Year
  const html = readFileSync(join(root, 'frontend/index.html'), 'utf8');
  const i = (id) => html.indexOf('id="' + id + '"');
  assert.ok(i('map-airline-select') > 0 && i('map-airline-select') < i('map-home-select') && i('map-home-select') < i('map-year-select'));
});

test('login page: sign in, wrong password, sign up with country and units, sign out', async () => {
  const ctx = await makeCtx({ FL_REQUIRE_LOGIN: true });
  const shell = vm.runInContext('shell()', ctx);
  await shell.checkAuth();
  assert.equal(shell.auth, 'out');
  const v = vm.runInContext('authView()', ctx);
  await v.load();
  assert.ok(v.countries.length > 5, 'country list is available before signing in');
  v.username = 'demo'; v.password = 'wrong-pass';
  await v.submit();
  assert.match(v.error, /Incorrect/);
  v.password = 'demo1234';
  await v.submit();
  assert.equal(v.error, '');
  const ev = ctx.window.__events.find((e) => e.type === 'fl-signed-in');
  assert.equal(ev.detail.username, 'demo');
  await shell.checkAuth();
  assert.equal(shell.auth, 'in');
  assert.equal((await vm.runInContext("(async () => (await apiJson('api/flights')).flights.length)()", ctx)), 19);
  await shell.signOut();
  assert.equal(shell.auth, 'out');
  // sign up: needs home country; new account starts empty with the chosen units
  v.mode = 'signup'; v.username = 'newuser'; v.password = 'long-enough-1'; v.confirm = 'different';
  await v.submit();
  assert.match(v.error, /do not match/);
  v.confirm = 'long-enough-1';
  await v.submit();
  assert.match(v.error, /home country/i);
  v.homeCountry = 'France'; v.unit = 'mi';
  await v.submit();
  assert.equal(v.error, '');
  assert.equal((await vm.runInContext("(async () => (await apiJson('api/flights')).flights.length)()", ctx)), 0, 'a new account does not see the demo account\'s flights');
  const s = await vm.runInContext("(async () => apiJson('api/account/settings'))()", ctx);
  assert.equal(s.distance_unit, 'mi');
  assert.equal(s.home_country, 'France');
});

test('index.html tags are balanced and the route map element sits inside the map page', () => {
  const html = readFileSync(join(root, 'frontend/index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body'));
  for (const tag of ['template', 'div', 'select', 'main', 'section']) {
    const open = (body.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const close = (body.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    assert.equal(open, close, `<${tag}> tags must balance`);
  }
  const mapPage = html.slice(html.indexOf("x-if=\"route==='map'\""), html.indexOf("x-if=\"route==='stats'\""));
  assert.ok(mapPage.includes('id="map"'), 'the map element belongs to the route map page');
});

test('statistics page loads flights and settings and hands them to the stats renderer', async () => {
  const ctx = await makeCtx();
  let call = null;
  ctx.FLStats = { mount(root, flights, opts) { call = { root, n: flights.length, opts }; } };
  const s = vm.runInContext('statsView()', ctx);
  s.$refs = { statsRoot: { id: 'root' } };
  s.$nextTick = async () => {};
  await s.load();
  assert.equal(s.loading, false);
  assert.equal(s.error, '');
  assert.ok(call && call.n > 0);
  assert.equal(call.root.id, 'root');
  assert.ok(['km', 'mi'].includes(call.opts.unit));
  assert.equal(typeof call.opts.home, 'string');
});

test('stays overview: loads, decorates, filters and sorts', async () => {
  const ctx = await makeCtx();
  const l = vm.runInContext('stayList()', ctx);
  await l.load();
  const total = l.stays.length;
  assert.ok(total >= 12, 'demo has a good spread of fictional stays');
  assert.equal(l.visibleStays[0].check_in, [...l.stays].map((s) => s.check_in).sort().pop(), 'newest check-in first');
  const lis = l.stays.find((s) => s.city === 'Lisbon');
  assert.equal(lis.nights, 3);
  assert.equal(lis.perNight, 156);
  assert.equal(lis.place, 'Lisbon, Portugal');
  assert.equal(lis.scoreWord, 'Excellent');
  assert.match(l.fmtStayDate('2025-04-11'), /Fri, 11 Apr 2025/);
  assert.equal(l.nightsText({ nights: 1 }), '1 night');
  assert.equal(l.guestsText(lis), '2 guests, 1 room');
  const blank = l.stays.find((s) => s.price == null && s.rating == null);
  assert.ok(blank, 'one stay has no price or rating, to show the empty state');

  l.sort = 'rated';
  const r = l.visibleStays.filter((s) => s.rating != null).map((s) => s.rating);
  assert.deepEqual(r, [...r].sort((a, b) => b - a));
  assert.equal(l.ratedInfo.value, Math.max(...r).toFixed(1));
  l.sort = 'longest';
  const n = l.visibleStays.map((s) => s.nights);
  assert.deepEqual(n, [...n].sort((a, b) => b - a));
  assert.equal(l.longestInfo.value, n[0] + ' nights');
  l.sort = 'price';
  const p = l.visibleStays.filter((s) => s.price != null).map((s) => s.price);
  assert.deepEqual(p, [...p].sort((a, b) => b - a));
  l.sort = 'oldest';
  assert.equal(l.visibleStays[0].check_in, [...l.stays].map((s) => s.check_in).sort()[0]);

  l.yearFilter = '2024';
  assert.ok(l.visibleStays.length > 0 && l.visibleStays.every((s) => s.year === '2024'));
  l.typeFilter = ['Apartment'];
  assert.deepEqual(l.visibleStays.map((s) => s.city), ['Amsterdam']);
  assert.ok(l.filtersActive);
  l.resetFilters();
  assert.equal(l.visibleStays.length, total);
  l.starFilter = ['5'];
  assert.ok(l.visibleStays.length >= 2 && l.visibleStays.every((s) => Math.round(s.stars) === 5));
  l.resetFilters();
  l.countryFilter = ['Italy'];
  assert.deepEqual(l.visibleStays.map((s) => s.city).sort(), ['Rome', 'Siena']);
  assert.match(l.summaryLine, /2 stays · 9 nights/);
});

test('stay form: validates, saves, edits and deletes', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("stayForm('')", ctx);
  await f.save();
  assert.match(f.error, /name/i);
  f.f.name = 'Test Inn';
  await f.save();
  assert.match(f.error, /dates/i);
  f.f.check_in = '2026-06-10';
  f.checkInChanged();
  assert.equal(f.f.check_out, '2026-06-11', 'check-out follows check-in');
  assert.equal(f.nightsText, '1 night');
  f.f.check_out = '2026-06-09';
  await f.save();
  assert.match(f.error, /after check-in/);
  f.f.check_out = '2026-06-13';
  f.f.price = '£ 240';
  f.tidyPrice();
  assert.equal(f.f.price, '240.00');
  f.setStars(4);
  f.setStars(4);
  assert.equal(f.f.stars, 0, 'tapping the chosen star again clears it');
  f.setStars(3);
  await f.save();
  assert.equal(f.error, '');
  assert.equal(ctx.location.hash, '#/stays');

  const l = vm.runInContext('stayList()', ctx);
  await l.load();
  const made = l.stays.find((s) => s.name === 'Test Inn');
  assert.ok(made && made.nights === 3 && made.price === 240 && made.stars === 3);

  const e = vm.runInContext(`stayForm('${made.id}')`, ctx);
  await e.load();
  assert.equal(e.f.name, 'Test Inn');
  assert.equal(e.f.price, '240.00');
  assert.equal(e.f.stars, 3);
  e.f.name = 'Test Inn Renamed';
  await e.save();
  const l2 = vm.runInContext('stayList()', ctx);
  await l2.load();
  assert.ok(l2.stays.some((s) => s.name === 'Test Inn Renamed'));

  ctx.confirm = () => true;
  await e.remove();
  const l3 = vm.runInContext('stayList()', ctx);
  await l3.load();
  assert.equal(l3.stays.length, l.stays.length - 1);
});

test('stays pages exist in index.html and the navigation', () => {
  const html = readFileSync(join(root, 'frontend/index.html'), 'utf8');
  assert.ok(html.includes("x-if=\"route==='stays'\"") && html.includes("x-if=\"route==='stay-add'\""));
  assert.ok(html.includes('href="#/stays"'));
});

test('stay form: rooms start with you in room 1, guests move between rooms, and the rooms are saved', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("stayForm('')", ctx);
  await f.load();
  assert.equal(f.rooms.length, 1);
  assert.deepEqual(Array.from(f.rooms[0].guests), ['me'], 'the user is always the first guest of the first room');
  assert.equal(f.companions.length, 5);
  assert.equal(f.roomsSummary, '1 room, 1 guest');

  const alex = f.companions.find((c) => c.name === 'Alex').id;
  const sam = f.companions.find((c) => c.name === 'Sam').id;
  f.addRoom();
  assert.equal(f.rooms.length, 2);
  assert.equal(f.roomTitle(1), 'Room 2');
  f.toggleGuest(0, alex);
  f.toggleGuest(1, sam);
  assert.deepEqual(Array.from(f.rooms[0].guests), ['me', alex]);
  f.toggleGuest(1, alex); // moving Alex takes him out of room 1
  assert.deepEqual(Array.from(f.rooms[0].guests), ['me']);
  assert.deepEqual(Array.from(f.rooms[1].guests), [sam, alex]);
  assert.equal(f.otherRoomOf(0, alex), 'Room 2');
  f.toggleGuest(0, 'me'); // you cannot be taken out of room 1
  assert.deepEqual(Array.from(f.rooms[0].guests), ['me']);
  assert.equal(f.roomsSummary, '2 rooms, 3 guests');
  f.removeRoom(0); // room 1 cannot be removed
  assert.equal(f.rooms.length, 2);

  f.rooms[0].room_type = 'Double room';
  f.rooms[1].room_type = 'Twin room';
  f.f.name = 'Rooms Hotel';
  f.f.check_in = '2026-09-01';
  f.f.check_out = '2026-09-04';
  await f.save();
  assert.equal(f.error, '');

  const l = vm.runInContext('stayList()', ctx);
  await l.load();
  const saved = l.stays.find((s) => s.name === 'Rooms Hotel');
  assert.equal(saved.rooms, 2);
  assert.equal(saved.guests, 4 - 1, 'you, Sam and Alex');
  assert.equal(l.guestNames(saved.room_list[0]), 'You');
  assert.match(l.guestNames(saved.room_list[1], saved), /^Sam, Alex \(Adult, \d+\)$/);
  assert.equal(l.guestsText(saved), '3 guests, 2 rooms');

  const e = vm.runInContext(`stayForm('${saved.id}')`, ctx);
  await e.load();
  assert.equal(e.rooms.length, 2);
  assert.equal(e.rooms[1].room_type, 'Twin room');
  assert.deepEqual(Array.from(e.rooms[1].guests), [sam, alex]);
  e.removeRoom(1);
  await e.save();
  const l2 = vm.runInContext('stayList()', ctx);
  await l2.load();
  assert.equal(l2.stays.find((s) => s.name === 'Rooms Hotel').rooms, 1);
});

test('stay form: address search fills the pin, and the pin can be moved or removed', async () => {
  const ctx = await makeCtx();
  const f = vm.runInContext("stayForm('')", ctx);
  await f.load();
  f.f.address = 'ab';
  await f.searchAddress();
  assert.equal(f.addr.open, false, 'short text is not searched');
  f.f.address = '48 Linden Row, New York';
  await f.searchAddress(); // the demo has no internet in tests, so nothing is found
  assert.deepEqual(f.addr.results, []);
  assert.match(f.addr.msg, /No matching addresses|not available/);

  f.pickAddress({ label: 'The Linden Row Hotel, 48, Linden Row, New York, United States', name: 'The Linden Row Hotel', address: '48 Linden Row, New York, 10014', city: 'New York', country: 'United States', lat: 40.7425, lon: -74.0061 });
  assert.equal(f.f.address, '48 Linden Row, New York, 10014');
  assert.equal(f.f.lat, 40.7425);
  assert.equal(f.f.city, 'New York', 'blank city is filled in');
  assert.equal(f.f.country, 'United States');
  assert.equal(f.f.name, 'The Linden Row Hotel', 'blank name is filled in');
  assert.equal(f.pinText, '40.74250, -74.00610');
  f.f.city = 'Manhattan';
  f.pickAddress({ label: 'x', address: '1 Other St', city: 'Boston', country: 'USA', lat: 42.36, lon: -71.06 });
  assert.equal(f.f.city, 'Manhattan', 'a city you typed is kept');
  assert.equal(f.f.name, 'The Linden Row Hotel');

  f.f.check_in = '2026-09-10'; f.f.check_out = '2026-09-12';
  await f.save();
  const l = vm.runInContext('stayList()', ctx);
  await l.load();
  const s = l.stays.find((x) => x.address === '1 Other St');
  assert.ok(s && s.lat === 42.36 && s.lon === -71.06);
  const withPin = l.stays.filter((x) => x.lat != null);
  assert.ok(withPin.length >= 8, 'the demo stays have map pins');
  l.toggleMap(s);
  assert.equal(s._map, true);

  const e = vm.runInContext(`stayForm('${s.id}')`, ctx);
  await e.load();
  assert.equal(e.f.lat, 42.36);
  e.clearPin();
  await e.save();
  const l2 = vm.runInContext('stayList()', ctx);
  await l2.load();
  assert.equal(l2.stays.find((x) => x.id === s.id).lat, null);
});

test('stay form: add a photo by link or upload, keep it, switch it and remove it', async () => {
  const ctx = await makeCtx();
  const fresh = async (id = '') => { const f = vm.runInContext(`stayForm('${id}')`, ctx); await f.load(); return f; };
  const fill = (f, name) => { f.f.name = name; f.f.check_in = '2026-11-02'; f.f.check_out = '2026-11-04'; };
  const list = async () => { const l = vm.runInContext('stayList()', ctx); await l.load(); return l; };

  const f = await fresh();
  assert.equal(f.photo.mode, 'none');
  assert.equal(f.photoSrc, '');
  f.setPhotoMode('link');
  assert.equal(f.photo.mode, 'link');
  f.setPhotoMode('link');
  assert.equal(f.photo.mode, 'none', 'pressing the chosen option again turns it off');

  // link: must be http(s)
  f.setPhotoMode('link');
  f.f.image_url = 'ftp://example.com/x.jpg';
  assert.equal(f.photoSrc, '');
  fill(f, 'Linked Hotel');
  await f.save();
  assert.match(f.error, /http/);
  f.f.image_url = ' https://example.com/hotel.jpg ';
  assert.equal(f.photoSrc, 'https://example.com/hotel.jpg', 'spaces around the link are ignored');
  f.linkBroken();
  assert.match(f.photo.error, /did not load/);
  f.linkLoaded();
  assert.equal(f.photo.error, '');
  await f.save();
  assert.equal(f.error, '');
  let l = await list();
  const linked = l.stays.find((s) => s.name === 'Linked Hotel');
  assert.equal(linked.image, 'https://example.com/hotel.jpg');
  assert.equal(linked.image_source, 'link');

  // upload: the browser shrinks the photo; here the shrinking step is stood in for
  const up = await fresh();
  up.readImage = async () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  up.setPhotoMode('upload');
  await up.pickFile({ target: { files: [{ type: 'application/pdf', size: 10, name: 'a.pdf' }], value: 'x' } });
  assert.match(up.photo.error, /image file/);
  await up.pickFile({ target: { files: [{ type: 'image/jpeg', size: 99 * 1024 * 1024, name: 'huge.jpg' }], value: 'x' } });
  assert.match(up.photo.error, /very large/);
  await up.pickFile({ target: { files: [{ type: 'image/jpeg', size: 5000, name: 'room.jpg' }], value: 'x' } });
  assert.equal(up.photo.error, '');
  assert.ok(up.photoSrc.startsWith('data:image/jpeg'));
  assert.match(up.photo.info, /room\.jpg/);
  fill(up, 'Uploaded Hotel');
  await up.save();
  assert.equal(up.error, '');
  l = await list();
  const uploaded = l.stays.find((s) => s.name === 'Uploaded Hotel');
  assert.equal(uploaded.image_source, 'upload');
  assert.ok(uploaded.image.startsWith('data:image/jpeg'));

  // editing without choosing a new photo keeps the stored one
  const keep = await fresh(uploaded.id);
  assert.equal(keep.photo.mode, 'upload');
  assert.ok(keep.photoSrc);
  keep.f.name = 'Uploaded Hotel (edited)';
  await keep.save();
  l = await list();
  assert.equal(l.stays.find((s) => s.id === uploaded.id).image_source, 'upload');

  // switching to a link replaces the upload
  const sw = await fresh(uploaded.id);
  sw.setPhotoMode('link'); // pressing "Image link" while upload is chosen switches over
  assert.equal(sw.photo.mode, 'link');
  sw.f.image_url = 'https://example.com/other.jpg';
  await sw.save();
  l = await list();
  const switched = l.stays.find((s) => s.id === uploaded.id);
  assert.equal(switched.image_source, 'link');
  assert.equal(switched.image, 'https://example.com/other.jpg');

  // and removing it leaves the card without a photo
  const rm = await fresh(uploaded.id);
  rm.removePhoto();
  assert.equal(rm.photoSrc, '');
  await rm.save();
  l = await list();
  assert.equal(l.stays.find((s) => s.id === uploaded.id).image, null);
  assert.ok(l.stays.filter((s) => s.image).length >= 6, 'the demo stays have photos');
});

test('packages: overview, filters, itinerary text, and "part of a package" on flights and stays', async () => {
  const ctx = await makeCtx();
  const list = vm.runInContext('packageList()', ctx);
  await list.load();
  assert.equal(list.packages.length, 3);
  assert.equal(list.visiblePackages[0].name, 'Tenerife week', 'newest first');
  assert.equal(list.totalSpent, 2184 + 1096 + 1340);
  assert.equal(list.packages.find((p) => p.name === 'Tenerife week').perPerson, 670);
  list.boardFilter = ['All inclusive'];
  assert.deepEqual(Array.from(list.visiblePackages.map((p) => p.name)), ['Majorca summer fortnight']);
  list.resetFilters();
  list.sort = 'price';
  assert.equal(list.visiblePackages[0].name, 'Majorca summer fortnight');
  const p = list.packages.find((x) => x.name === 'Majorca summer fortnight');
  assert.equal(p.nights, 14);
  assert.equal(list.tripRoute(p.trips[0]), 'Manchester ⇄ Palma de Mallorca');
  assert.match(list.transferText(p), /^2 transfers/);
  assert.equal(list.nightsText(p.stays[0]), '14 nights');

  // flights and stays inside a package say so instead of showing a price
  const fl = vm.runInContext('flightList()', ctx);
  await fl.load();
  const packaged = fl.items.filter((it) => it.package_id);
  assert.equal(packaged.length, 3);
  assert.ok(packaged.every((it) => fl.itemPrice(it) === 0 && it.package_name));
  const sl = vm.runInContext('stayList()', ctx);
  await sl.load();
  const inPkg = sl.stays.filter((s) => s.package_id);
  assert.equal(inPkg.length, 3);
  assert.ok(inPkg.every((s) => s.perNight == null));
  assert.equal(sl.totalSpent, sl.stays.filter((s) => !s.package_id).reduce((n, s) => n + (Number(s.price) || 0), 0));
});

test('packages: convert a trip into a package, edit and delete', async () => {
  const ctx = await makeCtx();
  // demo trip 5 is Manchester-Dublin and has no package yet
  const form = vm.runInContext("packageForm('', 'demo-trip-5')", ctx);
  await form.load();
  assert.deepEqual(Array.from(form.pickedTrips), ['demo-trip-5']);
  assert.equal(form.f.name, 'Dublin holiday');
  assert.equal(form.f.country, 'Ireland');
  assert.equal(form.freeTrips.every((t) => !t.package_id), true);
  assert.equal(form.busyTrips, 3);
  form.f.price = '480';
  form.addTransfer();
  assert.equal(form.transfers[0].kind, 'arrival');
  assert.equal(form.transfers[0].from_place, 'Dublin Airport');
  form.addTransfer();
  assert.equal(form.transfers[1].kind, 'departure');
  await form.save();
  assert.equal(form.error, '');
  const list = vm.runInContext('packageList()', ctx);
  await list.load();
  const made = list.packages.find((p) => p.name === 'Dublin holiday');
  assert.ok(made);
  assert.equal(made.price, 480);
  assert.equal(made.transfers.length, 2);
  const fl = vm.runInContext('flightList()', ctx);
  await fl.load();
  assert.equal(fl.items.find((it) => it.key === 'demo-trip-5').package_name, 'Dublin holiday');

  // a trip already in a package cannot be converted again
  const again = vm.runInContext("packageForm('', 'demo-trip-5')", ctx);
  await again.load();
  assert.match(again.error, /already part of the package/);

  // the trip's edit page knows about the package
  const edit = vm.runInContext("flightForm('demo-trip-5')", ctx);
  await edit.load();
  assert.equal(edit.pkg.name, 'Dublin holiday');

  // validation, then delete frees the trip again
  const blank = vm.runInContext("packageForm('', '')", ctx);
  await blank.load();
  await blank.save();
  assert.match(blank.error, /name/i);
  blank.f.name = 'x';
  await blank.save();
  assert.match(blank.error, /at least one trip or stay/);
  const ed = vm.runInContext(`packageForm('${made.id}', '')`, ctx);
  await ed.load();
  assert.equal(ed.f.name, 'Dublin holiday');
  assert.equal(ed.transfers.length, 2);
  vm.runInContext('globalThis.confirm = () => true', ctx);
  await ed.del();
  await list.load();
  assert.equal(list.packages.some((p) => p.name === 'Dublin holiday'), false);
  await fl.load();
  assert.equal(fl.items.find((it) => it.key === 'demo-trip-5').package_id, null);
});

test('demo import: a file with only stays or packages is accepted and replace keeps the rest', async () => {
  const ctx = await makeCtx();
  const call = async (path, method, body) => { const r = await vm.runInContext('window.FL_TEST_API', ctx).handle(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
  const flightsBefore = (await call('api/flights', 'GET')).data.flights.length;
  let r = await call('api/import?mode=replace', 'POST', { stays: [{ id: 'x1', name: 'Only Hotel', check_in: '2026-01-01', check_out: '2026-01-03' }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported_stays, 1);
  assert.equal((await call('api/stays', 'GET')).data.stays.length, 1);
  assert.equal((await call('api/flights', 'GET')).data.flights.length, flightsBefore);
  r = await call('api/import', 'POST', { packages: [{ name: 'Pkg', stays: [{ name: 'Nested', check_in: '2026-02-01', check_out: '2026-02-02' }] }] });
  assert.equal(r.data.imported_packages, 1);
  const pk = (await call('api/packages', 'GET')).data.packages;
  assert.equal(pk.length, 4, 'merged with the three demo packages');
  assert.equal(pk.find((p) => p.name === 'Pkg').stays[0].name, 'Nested');
  assert.equal((await call('api/import', 'POST', { nope: 1 })).status, 400);
});

test('stay details page: facts, package link, delete', async () => {
  const ctx = await makeCtx();
  vm.runInContext('globalThis.confirm = () => true', ctx);
  const d = vm.runInContext("stayDetail('demo-stay-15')", ctx);
  await d.load();
  assert.equal(d.error, '');
  assert.equal(d.s.name, 'Hotel Playa Serena');
  assert.equal(d.s.package_name, 'Majorca summer fortnight');
  assert.equal(d.nightsLabel, '14 nights');
  assert.deepEqual(Array.from(d.costFacts.map((r) => r.join('|'))), ['Total cost|Part of a package']);
  assert.ok(d.stayFacts.some((r) => r[0] === 'Hotel class' && r[1] === '4 stars'));
  assert.equal(d.roomGuests(d.s.room_list[0]), 'You, Alex (Adult, 31), Sam');
  assert.match(d.subtitle, /Palma Nova, Spain/);

  const plain = vm.runInContext("stayDetail('demo-stay-6')", ctx);
  await plain.load();

  const missing = vm.runInContext("stayDetail('nope')", ctx);
  await missing.load();
  assert.match(missing.error, /could not be found/);

  await plain.del();
  const list = vm.runInContext('stayList()', ctx);
  await list.load();
  assert.equal(list.stays.some((s) => s.id === 'demo-stay-6'), false);
});

test('package details page: sections, totals, delete frees the flights and stay', async () => {
  const ctx = await makeCtx();
  vm.runInContext('globalThis.confirm = () => true', ctx);
  const d = vm.runInContext("packageDetail('demo-package-3')", ctx);
  await d.load();
  assert.equal(d.error, '');
  assert.equal(d.p.name, 'Tenerife week');
  assert.deepEqual(Array.from(d.packageFacts.map((r) => r[0])), ['Holiday company', 'Board basis', 'Destination', 'Travellers', 'Travelling party', 'Booking reference']);
  assert.deepEqual(Array.from(d.costFacts.map((r) => r.join('|'))), ['Total price|£1,340.00', 'Per person|£670.00']);
  assert.deepEqual(Array.from(d.includedFacts.map((r) => r[1])), ['2 flights in 1 trip', '1 stay', '3 transfers']);
  assert.equal(d.nightsOf(d.p.stays[0]), '7 nights');
  assert.match(d.transferTitle(d.p.transfers[0]), /Airport to hotel/);
  assert.equal(d.fmtDist(1000), '1,000 km');
  const missing = vm.runInContext("packageDetail('nope')", ctx);
  await missing.load();
  assert.match(missing.error, /could not be found/);
  await d.del();
  const fl = vm.runInContext('flightList()', ctx);
  await fl.load();
  assert.ok(fl.items.every((it) => it.package_name !== 'Tenerife week'));
});

test('companions page: add with a date of birth, edit it, clear it, and bad dates are refused', async () => {
  const ctx = await makeCtx();
  const v = vm.runInContext('companionsView()', ctx);
  await v.load();
  const lily = v.companions.find((c) => c.name === 'Lily');
  assert.equal(lily.date_of_birth, '2017-06-14');
  assert.equal(v.groupText(lily), 'Child');
  assert.equal(v.groupText(v.companions.find((c) => c.name === 'Theo')), 'Infant');
  assert.equal(v.groupText(v.companions.find((c) => c.name === 'Sam')), 'Adult', 'no date of birth means adult');

  v.newName = 'Jo'; v.newRelationship = 'Cousin'; v.newDob = '2010-01-01';
  await v.add();
  const jo = v.companions.find((c) => c.name === 'Jo');
  assert.equal(jo.date_of_birth, '2010-01-01');
  assert.equal(v.newDob, '');

  v.newName = 'Bad'; v.newDob = '2999-01-01';
  await v.add();
  assert.match(v.error, /date_of_birth/);
  assert.equal(v.companions.some((c) => c.name === 'Bad'), false);

  v.startEdit(jo);
  assert.equal(v.edit.dob, '2010-01-01');
  v.edit.dob = '';
  v.edit.name = 'Joanne';
  await v.saveEdit();
  assert.equal(v.editId, null);
  const after = v.companions.find((c) => c.name === 'Joanne');
  assert.equal(after.date_of_birth, null);
  assert.equal(v.groupText(after), 'Adult');
});

test('companion labels use the age on the travel date', async () => {
  const ctx = await makeCtx();
  const c = { name: 'Lily', relationship: 'Niece', date_of_birth: '2017-06-14' };
  assert.equal(vm.runInContext('companionLabel', ctx)(c, '2019-06-13'), 'Lily (Niece \u00b7 Infant, 1)');
  assert.equal(vm.runInContext('companionLabel', ctx)(c, '2019-06-14'), 'Lily (Niece \u00b7 Child, 2)');
  assert.equal(vm.runInContext('companionLabel', ctx)({ name: 'Sam' }, '2019-06-14'), 'Sam');
  const party = vm.runInContext('partyText', ctx);
  assert.equal(party([c, { date_of_birth: '2025-02-10' }, {}], '2025-12-01', true), '2 adults, 1 child, 1 infant');
});
