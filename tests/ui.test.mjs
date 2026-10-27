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
  assert.ok(d.scheduleFacts.length >= 6 && d.seatFacts.length === 3);
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
  assert.ok(priced.length >= 6 && priced.length < list.items.length, 'some have a price, some are not recorded');
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
