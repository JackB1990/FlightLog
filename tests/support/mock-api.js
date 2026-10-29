/*
 * TEST FIXTURE ONLY (not shipped in the app or the Docker image).
 * An in-memory copy of the /api/* endpoints, with sample flights, so the UI tests
 * can run without a server or a browser.
 * Expects globals: FLCore (shared/core.js) and FL_AIRPORTS (array of
 * [iata, icao, name, city, country, lat, lon]).
 */
(function () {
  'use strict';

  const KEY = 'flightlog-demo-v10';
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
    const data = {
      settings: { distance_unit: 'km', home_country: 'United Kingdom' },
      companions: [
        { id: alex, name: 'Alex', relationship: 'Partner', date_of_birth: '1992-03-18' },
        { id: sam, name: 'Sam', relationship: 'Friend', date_of_birth: null },
        { id: mum, name: 'Mum', relationship: 'Family', date_of_birth: '1961-09-02' },
        { id: uid(), name: 'Lily', relationship: 'Niece', date_of_birth: '2017-06-14' },
        { id: uid(), name: 'Theo', relationship: 'Nephew', date_of_birth: '2025-02-10' },
      ],
      customAirports: [],
      stays: [
        { id: 'demo-stay-1', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmNmIyNmIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNlMDY2NjYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjE1OCIgY3k9Ijk2IiByPSI0NiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuODUiLz48cmVjdCB4PSIyMCIgeT0iMjA1IiB3aWR0aD0iNTQiIGhlaWdodD0iMTk1IiBmaWxsPSIjNmQ0YzQxIi8+PHJlY3QgeD0iMzAiIHk9IjIxOSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMCIgeT0iMjQ1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjUwIiB5PSIyNDUiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzAiIHk9IjI3MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MCIgeT0iMjcxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjUwIiB5PSIyOTciIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTAiIHk9IjM0OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI3OSIgeT0iMjYzIiB3aWR0aD0iNzAiIGhlaWdodD0iMTM3IiBmaWxsPSIjNmQ0YzQxIi8+PHJlY3QgeD0iODkiIHk9IjI3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjkiIHk9IjI3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMDkiIHk9IjMyOSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjkiIHk9IjM1NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNTMiIHk9IjEyOCIgd2lkdGg9Ijc2IiBoZWlnaHQ9IjI3MiIgZmlsbD0iIzZkNGM0MSIvPjxyZWN0IHg9IjE4MyIgeT0iMTQyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE4MyIgeT0iMTY4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIwMyIgeT0iMTk0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE4MyIgeT0iMjIwIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE2MyIgeT0iMjQ2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE4MyIgeT0iMjQ2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE2MyIgeT0iMjcyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIwMyIgeT0iMjcyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE4MyIgeT0iMjk4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE2MyIgeT0iMzI0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIwMyIgeT0iMzI0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE2MyIgeT0iMzc2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIwMyIgeT0iMzc2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIzNSIgeT0iMTcwIiB3aWR0aD0iODMiIGhlaWdodD0iMjMwIiBmaWxsPSIjNmQ0YzQxIi8+PHJlY3QgeD0iMjQ1IiB5PSIxODQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjg1IiB5PSIxODQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA1IiB5PSIxODQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjQ1IiB5PSIyMzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjY1IiB5PSIyMzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjg1IiB5PSIyMzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA1IiB5PSIyMzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjY1IiB5PSIyNjIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjg1IiB5PSIyNjIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA1IiB5PSIyNjIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjY1IiB5PSIyODgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjg1IiB5PSIzMTQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjg1IiB5PSIzNDAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA1IiB5PSIzNDAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjY1IiB5PSIzNjYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA1IiB5PSIzNjYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzI3IiB5PSIxMjkiIHdpZHRoPSI4NiIgaGVpZ2h0PSIyNzEiIGZpbGw9IiM2ZDRjNDEiLz48cmVjdCB4PSIzMzciIHk9IjE0MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjE0MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNzciIHk9IjE0MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzOTciIHk9IjE0MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjE2OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjE2OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjE5NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjE5NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNzciIHk9IjE5NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzOTciIHk9IjE5NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjI0NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjI3MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjI3MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNzciIHk9IjI3MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjI5OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjI5OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzOTciIHk9IjI5OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjMyNSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjMyNSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNzciIHk9IjMyNSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzOTciIHk9IjMyNSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjM1MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNzciIHk9IjM1MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzOTciIHk9IjM1MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzciIHk9IjM3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNTciIHk9IjM3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNzciIHk9IjM3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzOTciIHk9IjM3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MjAiIHk9IjI0MyIgd2lkdGg9IjY2IiBoZWlnaHQ9IjE1NyIgZmlsbD0iIzZkNGM0MSIvPjxyZWN0IHg9IjQzMCIgeT0iMjU3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MCIgeT0iMjgzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQzMCIgeT0iMzA5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MCIgeT0iMzA5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MCIgeT0iMzA5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MCIgeT0iMzM1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MCIgeT0iMzM1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQzMCIgeT0iMzYxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MCIgeT0iMzg3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5OCIgeT0iMTY5IiB3aWR0aD0iNTEiIGhlaWdodD0iMjMxIiBmaWxsPSIjNmQ0YzQxIi8+PHJlY3QgeD0iNTI4IiB5PSIyMDkiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTI4IiB5PSIyMzUiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTA4IiB5PSIyNjEiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTI4IiB5PSIyNjEiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTA4IiB5PSIyODciIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTI4IiB5PSIyODciIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTI4IiB5PSIzMTMiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTA4IiB5PSIzMzkiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTA4IiB5PSIzNjUiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTUzIiB5PSIyMTUiIHdpZHRoPSI4NyIgaGVpZ2h0PSIxODUiIGZpbGw9IiM2ZDRjNDEiLz48cmVjdCB4PSI2MDMiIHk9IjIyOSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MDMiIHk9IjI1NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MjMiIHk9IjI1NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1NjMiIHk9IjI4MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1ODMiIHk9IjI4MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MjMiIHk9IjI4MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1NjMiIHk9IjMwNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1ODMiIHk9IjMwNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MjMiIHk9IjMwNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1NjMiIHk9IjMzMyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1ODMiIHk9IjMzMyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1NjMiIHk9IjM1OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1ODMiIHk9IjM1OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MDMiIHk9IjM1OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1ODMiIHk9IjM4NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MDMiIHk9IjM4NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48L3N2Zz4=', name: "Harbourview Lodge", city: "Lisbon", country: "Portugal", address: "Rua das Flores 12, Lisboa", lat: 38.7101, lon: -9.1425, stay_type: "Hotel", stars: 4, rating: 8.6, check_in: '2025-04-11', check_out: '2025-04-14', room_type: "Superior double room", rooms: 1, guests: 2, room_list: [{ room_type: "Superior double room", guests: ['me', alex] }], price: 468, booking_ref: null, notes: "Walkable to the old town. Breakfast was excellent." },
        { id: 'demo-stay-2', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM2ZmE4ZGMiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjZmUyZjMiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjUzMSIgY3k9IjEyMCIgcj0iNDYiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjg1Ii8+PHJlY3QgeT0iMjcwIiB3aWR0aD0iNjQwIiBoZWlnaHQ9IjEzMCIgZmlsbD0iIzFiN2ZhOCIvPjxyZWN0IHk9IjI3MCIgd2lkdGg9IjY0MCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuNCIvPjxyZWN0IHg9IjEyMCIgeT0iMTYwIiB3aWR0aD0iNDAwIiBoZWlnaHQ9IjExMCIgZmlsbD0iI2U4ZDViMCIvPjxyZWN0IHg9IjE0MCIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNDAiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMTc4IiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE3OCIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyMTYiIHk9IjE3NiIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjE2IiB5PSIyMTQiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI1NCIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNTQiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjkyIiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI5MiIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzAiIHk9IjE3NiIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzMwIiB5PSIyMTQiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM2OCIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNjgiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDA2IiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQwNiIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0NDQiIHk9IjE3NiIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDQ0IiB5PSIyMTQiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ4MiIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0ODIiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHBhdGggZD0iTTcwIDMwMCBxMTAgLTkwIDQwIC0xMzAgTTExMCAxNzAgcS00MCAtMjAgLTY0IDEwIE0xMTAgMTcwIHE0MCAtMjYgNzAgNCIgc3Ryb2tlPSIjMWQ1YzNhIiBzdHJva2Utd2lkdGg9IjciIGZpbGw9Im5vbmUiLz48L3N2Zz4=', name: "Casa Azul Beach Resort", city: "Caleta de Fuste", country: "Spain", address: "Avenida del Castillo 5, Caleta de Fuste", lat: 28.3926, lon: -13.8601, stay_type: "Resort", stars: 4, rating: 7.9, check_in: '2025-02-08', check_out: '2025-02-15', room_type: "Double room", rooms: 1, guests: 2, room_list: [{ room_type: "Double room", guests: ['me', alex] }], price: 1124.5, booking_ref: null, notes: null },
        { id: 'demo-stay-3', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMxYzJiNGEiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM2YTRjOTMiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjIxMSIgY3k9Ijk3IiByPSI0NiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuODUiLz48cmVjdCB4PSIyMCIgeT0iMjM3IiB3aWR0aD0iODQiIGhlaWdodD0iMTYzIiBmaWxsPSIjMmIyYjNhIi8+PHJlY3QgeD0iMzAiIHk9IjI1MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI5MCIgeT0iMjUxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjMwIiB5PSIyNzciIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNzAiIHk9IjI3NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI5MCIgeT0iMjc3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjUwIiB5PSIzMDMiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iOTAiIHk9IjMwMyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MCIgeT0iMzI5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjMwIiB5PSIzNTUiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iOTAiIHk9IjM1NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI3MCIgeT0iMzgxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjkwIiB5PSIzODEiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMTEyIiB5PSIxMTgiIHdpZHRoPSI4MCIgaGVpZ2h0PSIyODIiIGZpbGw9IiMyYjJiM2EiLz48cmVjdCB4PSIxNDIiIHk9IjE1OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjIiIHk9IjE4NCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjIiIHk9IjIxMCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNDIiIHk9IjIxMCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNjIiIHk9IjIxMCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNDIiIHk9IjIzNiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjIiIHk9IjI2MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNDIiIHk9IjI2MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNjIiIHk9IjI2MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjIiIHk9IjI4OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxMjIiIHk9IjM2NiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyMDUiIHk9IjI0NCIgd2lkdGg9Ijg2IiBoZWlnaHQ9IjE1NiIgZmlsbD0iIzJiMmIzYSIvPjxyZWN0IHg9IjIzNSIgeT0iMjU4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIxNSIgeT0iMjg0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIzNSIgeT0iMjg0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIxNSIgeT0iMzEwIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI1NSIgeT0iMzEwIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI3NSIgeT0iMzEwIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIxNSIgeT0iMzM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI3NSIgeT0iMzM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIzNSIgeT0iMzYyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI3NSIgeT0iMzYyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI1NSIgeT0iMzg4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI5OSIgeT0iMjUxIiB3aWR0aD0iNTAiIGhlaWdodD0iMTQ5IiBmaWxsPSIjMmIyYjNhIi8+PHJlY3QgeD0iMzA5IiB5PSIyNjUiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzI5IiB5PSIyNjUiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA5IiB5PSIzMTciIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzI5IiB5PSIzMTciIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzA5IiB5PSIzNjkiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzI5IiB5PSIzNjkiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzU1IiB5PSIxNzQiIHdpZHRoPSI3NCIgaGVpZ2h0PSIyMjYiIGZpbGw9IiMyYjJiM2EiLz48cmVjdCB4PSIzNjUiIHk9IjE4OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzODUiIHk9IjE4OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzODUiIHk9IjI0MCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDUiIHk9IjI0MCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzODUiIHk9IjI2NiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDUiIHk9IjI2NiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzODUiIHk9IjI5MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDUiIHk9IjI5MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNjUiIHk9IjMxOCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzODUiIHk9IjMxOCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNjUiIHk9IjM0NCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNjUiIHk9IjM3MCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDUiIHk9IjM3MCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0NDMiIHk9IjExNSIgd2lkdGg9IjcyIiBoZWlnaHQ9IjI4NSIgZmlsbD0iIzJiMmIzYSIvPjxyZWN0IHg9IjQ5MyIgeT0iMTI5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMTU1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMTgxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MyIgeT0iMTgxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMjA3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MyIgeT0iMjA3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5MyIgeT0iMjA3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMjMzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5MyIgeT0iMjMzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMjU5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5MyIgeT0iMjU5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5MyIgeT0iMjg1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMzExIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5MyIgeT0iMzExIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMzM3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MyIgeT0iMzM3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ1MyIgeT0iMzYzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MyIgeT0iMzYzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ5MyIgeT0iMzYzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ3MyIgeT0iMzg5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjUyMSIgeT0iMTg0IiB3aWR0aD0iNTUiIGhlaWdodD0iMjE2IiBmaWxsPSIjMmIyYjNhIi8+PHJlY3QgeD0iNTUxIiB5PSIxOTgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTUxIiB5PSIyMjQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTUxIiB5PSIyNTAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTUxIiB5PSIyNzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTUxIiB5PSIzMjgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTUxIiB5PSIzNTQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTg2IiB5PSIxMzgiIHdpZHRoPSI2OCIgaGVpZ2h0PSIyNjIiIGZpbGw9IiMyYjJiM2EiLz48cmVjdCB4PSI2MTYiIHk9IjE1MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MzYiIHk9IjE1MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1OTYiIHk9IjE3OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MTYiIHk9IjE3OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MzYiIHk9IjE3OCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MTYiIHk9IjIwNCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MzYiIHk9IjIwNCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1OTYiIHk9IjI1NiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1OTYiIHk9IjI4MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MTYiIHk9IjMwOCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MzYiIHk9IjMwOCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1OTYiIHk9IjMzNCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MTYiIHk9IjMzNCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MzYiIHk9IjMzNCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI2MTYiIHk9IjM2MCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1OTYiIHk9IjM4NiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48L3N2Zz4=', name: "The Linden Row Hotel", city: "New York", country: "United States", address: "48 Linden Row, New York", lat: 40.7425, lon: -74.0061, stay_type: "Hotel", stars: 4, rating: 9.1, check_in: '2024-10-03', check_out: '2024-10-07', room_type: "Double room", rooms: 1, guests: 2, room_list: [{ room_type: "Double room", guests: ['me', alex] }], price: 1380, booking_ref: "LR-48213", notes: "Great view over the river." },
        { id: 'demo-stay-4', name: "Canal House Apartments", city: "Amsterdam", country: "Netherlands", address: "Keizersgracht 210, Amsterdam", lat: 52.3738, lon: 4.8832, stay_type: "Apartment", stars: null, rating: 8.2, check_in: '2024-05-17', check_out: '2024-05-19', room_type: "Apartment", rooms: 1, guests: 2, room_list: [{ room_type: "Apartment", guests: ['me', sam] }], price: 295.2, booking_ref: null, notes: null },
        { id: 'demo-stay-5', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZmI4OGMiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNkZTYyNjIiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjQwOCIgY3k9Ijc2IiByPSI0NiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuODUiLz48cmVjdCB5PSIyNzAiIHdpZHRoPSI2NDAiIGhlaWdodD0iMTMwIiBmaWxsPSIjMWI3ZmE4Ii8+PHJlY3QgeT0iMjcwIiB3aWR0aD0iNjQwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii40Ii8+PHJlY3QgeD0iMTIwIiB5PSIxNjAiIHdpZHRoPSI0MDAiIGhlaWdodD0iMTEwIiBmaWxsPSIjZjFlMGM1Ii8+PHJlY3QgeD0iMTQwIiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE0MCIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIxNzgiIHk9IjE3NiIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMTc4IiB5PSIyMTQiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjIxNiIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyMTYiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjU0IiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjI1NCIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyOTIiIHk9IjE3NiIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjkyIiB5PSIyMTQiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjMzMCIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMzAiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzY4IiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM2OCIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDYiIHk9IjE3NiIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDA2IiB5PSIyMTQiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ0NCIgeT0iMTc2IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0NDQiIHk9IjIxNCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDgyIiB5PSIxNzYiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQ4MiIgeT0iMjE0IiB3aWR0aD0iMjIiIGhlaWdodD0iMjIiIGZpbGw9IiNmZmQ5NzgiLz48cGF0aCBkPSJNNzAgMzAwIHExMCAtOTAgNDAgLTEzMCBNMTEwIDE3MCBxLTQwIC0yMCAtNjQgMTAgTTExMCAxNzAgcTQwIC0yNiA3MCA0IiBzdHJva2U9IiMxZDVjM2EiIHN0cm9rZS13aWR0aD0iNyIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==', name: "Palm Crescent Resort & Spa", city: "Dubai", country: "United Arab Emirates", address: "Crescent Road, Palm Jumeirah, Dubai", lat: 25.1306, lon: 55.1171, stay_type: "Resort", stars: 5, rating: 9.4, check_in: '2023-12-27', check_out: '2024-01-02', room_type: "Suite", rooms: 2, guests: 3, room_list: [{ room_type: "Suite", guests: ['me', alex] }, { room_type: "Single room", guests: [mum] }], price: 3910, booking_ref: null, notes: "Water park access included." },
        { id: 'demo-stay-6', name: "Backpackers' Rest", city: "Berlin", country: "Germany", address: "Rosenthaler Strasse 18, Berlin", lat: 52.5296, lon: 13.4017, stay_type: "Hostel", stars: null, rating: 6.8, check_in: '2023-09-02', check_out: '2023-09-04', room_type: "Twin room", rooms: 1, guests: 2, room_list: [{ room_type: "Twin room", guests: ['me', sam] }], price: 148, booking_ref: null, notes: null },
        { id: 'demo-stay-7', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM4ZWNhZTYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNlOWY1ZGIiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjI1NSIgY3k9IjEyMCIgcj0iNDYiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjg1Ii8+PHJlY3QgeT0iMzAwIiB3aWR0aD0iNjQwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzRhN2E0YSIvPjxwb2x5Z29uIHBvaW50cz0iMTUwLDMwMCAxNTAsMjAwIDMyMCwxMjAgNDkwLDIwMCA0OTAsMzAwIiBmaWxsPSIjYTg4NTZiIi8+PHBvbHlnb24gcG9pbnRzPSIxMzAsMjA1IDMyMCwxMDUgNTEwLDIwNSA0OTAsMjEwIDMyMCwxMjUgMTUwLDIxMCIgZmlsbD0iIzVhM2IyYSIvPjxyZWN0IHg9IjI5MCIgeT0iMjMwIiB3aWR0aD0iNjAiIGhlaWdodD0iNzAiIGZpbGw9IiM1YTNiMmEiLz48cmVjdCB4PSIxOTAiIHk9IjIyMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDAwIiB5PSIyMjAiIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgZmlsbD0iI2ZmZDk3OCIvPjxwb2x5Z29uIHBvaW50cz0iNDAsMzAwIDcwLDIwMCAxMDAsMzAwIiBmaWxsPSIjMjQ1YzM0Ii8+PHBvbHlnb24gcG9pbnRzPSI1NDAsMzAwIDU3NSwxODAgNjEwLDMwMCIgZmlsbD0iIzI0NWMzNCIvPjwvc3ZnPg==', name: "Oakwood Guest House", city: "Edinburgh", country: "United Kingdom", address: "7 Oakwood Terrace, Edinburgh", lat: 55.9486, lon: -3.2, stay_type: "Guest house", stars: 3, rating: 8.8, check_in: '2025-08-22', check_out: '2025-08-25', room_type: "Double room", rooms: 1, guests: 2, room_list: [{ room_type: "Double room", guests: ['me', alex] }], price: 372, booking_ref: null, notes: "Lovely cooked breakfast." },
        { id: 'demo-stay-8', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmOWM3ODQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmY2Y1YzciLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjIwNiIgY3k9IjgzIiByPSI0NiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuODUiLz48cmVjdCB5PSIzMDAiIHdpZHRoPSI2NDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjNGE3YTRhIi8+PHBvbHlnb24gcG9pbnRzPSIxNTAsMzAwIDE1MCwyMDAgMzIwLDEyMCA0OTAsMjAwIDQ5MCwzMDAiIGZpbGw9IiNkOWEwNjYiLz48cG9seWdvbiBwb2ludHM9IjEzMCwyMDUgMzIwLDEwNSA1MTAsMjA1IDQ5MCwyMTAgMzIwLDEyNSAxNTAsMjEwIiBmaWxsPSIjNWEzYjJhIi8+PHJlY3QgeD0iMjkwIiB5PSIyMzAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI3MCIgZmlsbD0iIzVhM2IyYSIvPjxyZWN0IHg9IjE5MCIgeT0iMjIwIiB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDAiIHk9IjIyMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjZmZkOTc4Ii8+PHBvbHlnb24gcG9pbnRzPSI0MCwzMDAgNzAsMjAwIDEwMCwzMDAiIGZpbGw9IiMyNDVjMzQiLz48cG9seWdvbiBwb2ludHM9IjU0MCwzMDAgNTc1LDE4MCA2MTAsMzAwIiBmaWxsPSIjMjQ1YzM0Ii8+PC9zdmc+', name: "Villa Serena", city: "Siena", country: "Italy", address: "Strada di Pescaia 3, Siena", lat: 43.3186, lon: 11.3306, stay_type: "Villa", stars: null, rating: 9.0, check_in: '2025-06-14', check_out: '2025-06-21', room_type: "Family room", rooms: 3, guests: 4, room_list: [{ room_type: "Family room", guests: ['me', alex] }, { room_type: "Twin room", guests: [sam, mum] }, { room_type: "Single room", guests: [] }], price: 1890, booking_ref: "VS-2291", notes: "Pool, olive trees and a very long table." },
        { id: 'demo-stay-9', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMwYjEzMmIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMzYTUwNmIiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjMyNyIgY3k9Ijk5IiByPSI0NiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuODUiLz48cmVjdCB4PSIyMCIgeT0iMjAyIiB3aWR0aD0iNzMiIGhlaWdodD0iMTk4IiBmaWxsPSIjMWMyNTQxIi8+PHJlY3QgeD0iMzAiIHk9IjIxNiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI3MCIgeT0iMjE2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjMwIiB5PSIyNDIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNzAiIHk9IjI0MiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI3MCIgeT0iMjY4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjMwIiB5PSIyOTQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNzAiIHk9IjI5NCIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MCIgeT0iMzIwIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjcwIiB5PSIzMjAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMzAiIHk9IjM0NiIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MCIgeT0iMzQ2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjcwIiB5PSIzNzIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iOTgiIHk9IjIxOCIgd2lkdGg9IjY4IiBoZWlnaHQ9IjE4MiIgZmlsbD0iIzFjMjU0MSIvPjxyZWN0IHg9IjE0OCIgeT0iMjMyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEwOCIgeT0iMjU4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEyOCIgeT0iMjU4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE0OCIgeT0iMjU4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEwOCIgeT0iMjg0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE0OCIgeT0iMjg0IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE0OCIgeT0iMzEwIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEwOCIgeT0iMzM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEyOCIgeT0iMzM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE0OCIgeT0iMzM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEwOCIgeT0iMzYyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE0OCIgeT0iMzYyIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjEyOCIgeT0iMzg4IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjE3MyIgeT0iMjY4IiB3aWR0aD0iNzEiIGhlaWdodD0iMTMyIiBmaWxsPSIjMWMyNTQxIi8+PHJlY3QgeD0iMjAzIiB5PSIyODIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMTgzIiB5PSIzMDgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjIzIiB5PSIzMDgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMTgzIiB5PSIzMzQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjAzIiB5PSIzMzQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjIzIiB5PSIzMzQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjIzIiB5PSIzNjAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjIzIiB5PSIzODYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iMjUyIiB5PSIxMTUiIHdpZHRoPSI4NSIgaGVpZ2h0PSIyODUiIGZpbGw9IiMxYzI1NDEiLz48cmVjdCB4PSIyNjIiIHk9IjE1NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMDIiIHk9IjE1NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjE4MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyODIiIHk9IjE4MSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjIwNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjIzMyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMDIiIHk9IjIzMyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMjIiIHk9IjIzMyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjI1OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMjIiIHk9IjI1OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyODIiIHk9IjI4NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMDIiIHk9IjI4NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMjIiIHk9IjI4NSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjMxMSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMDIiIHk9IjMxMSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMjIiIHk9IjMxMSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjMzNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyODIiIHk9IjMzNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMDIiIHk9IjMzNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjM2MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyODIiIHk9IjM2MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIyNjIiIHk9IjM4OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzMDIiIHk9IjM4OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSIzNDkiIHk9IjEyNyIgd2lkdGg9IjczIiBoZWlnaHQ9IjI3MyIgZmlsbD0iIzFjMjU0MSIvPjxyZWN0IHg9IjM1OSIgeT0iMTQxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM5OSIgeT0iMTQxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM3OSIgeT0iMTY3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM5OSIgeT0iMTY3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM3OSIgeT0iMTkzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM5OSIgeT0iMjE5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM1OSIgeT0iMjQ1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM3OSIgeT0iMjQ1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM5OSIgeT0iMjQ1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM5OSIgeT0iMjcxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM1OSIgeT0iMjk3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM5OSIgeT0iMjk3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM1OSIgeT0iMzIzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM1OSIgeT0iMzQ5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM3OSIgeT0iMzQ5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjM3OSIgeT0iMzc1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjQyOCIgeT0iMTE4IiB3aWR0aD0iNjciIGhlaWdodD0iMjgyIiBmaWxsPSIjMWMyNTQxIi8+PHJlY3QgeD0iNDU4IiB5PSIxMzIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIxMzIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIxNTgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDU4IiB5PSIxNTgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIxNTgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDU4IiB5PSIxODQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIyMTAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDU4IiB5PSIyMTAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIyMTAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIyMzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIyMzYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIyNjIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDU4IiB5PSIyNjIiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIyODgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIyODgiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIzMTQiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIzNDAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDU4IiB5PSIzNDAiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDM4IiB5PSIzNjYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNDc4IiB5PSIzNjYiIHdpZHRoPSI5IiBoZWlnaHQ9IjEzIiBmaWxsPSIjZmZkOTc4Ii8+PHJlY3QgeD0iNTAzIiB5PSIyMTMiIHdpZHRoPSI1NCIgaGVpZ2h0PSIxODciIGZpbGw9IiMxYzI1NDEiLz48cmVjdCB4PSI1MzMiIHk9IjIyNyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MzMiIHk9IjI1MyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MTMiIHk9IjI3OSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MTMiIHk9IjMwNSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MTMiIHk9IjMzMSIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1MTMiIHk9IjM1NyIgd2lkdGg9IjkiIGhlaWdodD0iMTMiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI1NjQiIHk9IjExMSIgd2lkdGg9IjUyIiBoZWlnaHQ9IjI4OSIgZmlsbD0iIzFjMjU0MSIvPjxyZWN0IHg9IjU5NCIgeT0iMTUxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU3NCIgeT0iMTc3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU5NCIgeT0iMTc3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU5NCIgeT0iMjAzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU3NCIgeT0iMjI5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU5NCIgeT0iMjI5IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU3NCIgeT0iMjU1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU5NCIgeT0iMjU1IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU3NCIgeT0iMjgxIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU3NCIgeT0iMzA3IiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjxyZWN0IHg9IjU3NCIgeT0iMzMzIiB3aWR0aD0iOSIgaGVpZ2h0PSIxMyIgZmlsbD0iI2ZmZDk3OCIvPjwvc3ZnPg==', name: "Skyline Tower Hotel", city: "Tokyo", country: "Japan", address: "2-1 Nishi-Shinjuku, Tokyo", lat: 35.6896, lon: 139.6917, stay_type: "Hotel", stars: 5, rating: 9.2, check_in: '2025-10-04', check_out: '2025-10-09', room_type: "Twin room", rooms: 1, guests: 2, room_list: [{ room_type: "Twin room", guests: ['me', alex] }], price: 1675, booking_ref: null, notes: "Floor 38. Incredible views at night." },
        { id: 'demo-stay-10', image_data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDAgNDAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNhMmQyZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNlYWY0ZmYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjQwMCIgZmlsbD0idXJsKCNnKSIvPjxjaXJjbGUgY3g9IjM4MiIgY3k9IjYyIiByPSI0NiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIuODUiLz48cmVjdCB5PSIzMDAiIHdpZHRoPSI2NDAiIGhlaWdodD0iMTAwIiBmaWxsPSIjNGE3YTRhIi8+PHBvbHlnb24gcG9pbnRzPSIxNTAsMzAwIDE1MCwyMDAgMzIwLDEyMCA0OTAsMjAwIDQ5MCwzMDAiIGZpbGw9IiM4YjVlM2MiLz48cG9seWdvbiBwb2ludHM9IjEzMCwyMDUgMzIwLDEwNSA1MTAsMjA1IDQ5MCwyMTAgMzIwLDEyNSAxNTAsMjEwIiBmaWxsPSIjNWEzYjJhIi8+PHJlY3QgeD0iMjkwIiB5PSIyMzAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI3MCIgZmlsbD0iIzVhM2IyYSIvPjxyZWN0IHg9IjE5MCIgeT0iMjIwIiB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNmZmQ5NzgiLz48cmVjdCB4PSI0MDAiIHk9IjIyMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjZmZkOTc4Ii8+PHBvbHlnb24gcG9pbnRzPSI0MCwzMDAgNzAsMjAwIDEwMCwzMDAiIGZpbGw9IiMyNDVjMzQiLz48cG9seWdvbiBwb2ludHM9IjU0MCwzMDAgNTc1LDE4MCA2MTAsMzAwIiBmaWxsPSIjMjQ1YzM0Ii8+PC9zdmc+', name: "Maple & Pine Cabin", city: "Banff", country: "Canada", address: "Tunnel Mountain Road, Banff", lat: 51.1784, lon: -115.5708, stay_type: "Other", stars: null, rating: 8.4, check_in: '2024-02-16', check_out: '2024-02-20', room_type: "Apartment", rooms: 2, guests: 4, room_list: [{ room_type: "Apartment", guests: ['me', alex] }, { room_type: "Double room", guests: [sam, mum] }], price: 986.4, booking_ref: null, notes: "Hot tub on the deck." },
        { id: 'demo-stay-11', name: "Sunset Bay Hotel", city: "Phuket", country: "Thailand", address: null, lat: null, lon: null, stay_type: "Hotel", stars: 3, rating: 7.1, check_in: '2024-11-20', check_out: '2024-11-27', room_type: "Double room", rooms: 1, guests: 2, room_list: [{ room_type: "Double room", guests: ['me', alex] }], price: 640, booking_ref: null, notes: null },
        { id: 'demo-stay-12', name: "The Grand Meridian", city: "Paris", country: "France", address: "12 Rue de Rivoli, Paris", lat: 48.8566, lon: 2.3522, stay_type: "Hotel", stars: 5, rating: 8.9, check_in: '2026-03-12', check_out: '2026-03-15', room_type: "Suite", rooms: 1, guests: 2, room_list: [{ room_type: "Suite", guests: ['me', alex] }], price: 1245, booking_ref: null, notes: null },
        { id: 'demo-stay-13', name: "Stazione Rooms", city: "Rome", country: "Italy", address: null, lat: null, lon: null, stay_type: "Guest house", stars: 2, rating: 5.8, check_in: '2023-04-07', check_out: '2023-04-09', room_type: "Double room", rooms: 1, guests: 2, room_list: [{ room_type: "Double room", guests: ['me', sam] }], price: 119, booking_ref: null, notes: "Basic, but a short walk from the station." },
        { id: 'demo-stay-14', name: "Riverside Inn", city: "York", country: "United Kingdom", address: null, lat: null, lon: null, stay_type: "Hotel", stars: 3, rating: null, check_in: '2026-07-03', check_out: '2026-07-04', room_type: "Double room", rooms: 1, guests: 2, room_list: [{ room_type: "Double room", guests: ['me', alex] }], price: null, booking_ref: null, notes: null },
      ],
      flights,
    };
    // Three package holidays built from existing demo trips plus their own (fictional) hotels and transfers.
    const photo = (id) => (data.stays.find((x) => x.id === id) || {}).image_data;
    const room = (type, guests) => [{ room_type: type, guests }];
    const pkgStay = (id, extra) => ({ id, stars: null, rating: null, stay_type: 'Hotel', address: null, lat: null, lon: null, price: null, booking_ref: null, notes: null, image_url: null, image_data: null, ...extra });
    data.stays.push(
      pkgStay('demo-stay-15', { name: 'Hotel Playa Serena', city: 'Palma Nova', country: 'Spain', stars: 4, rating: 8.0, check_in: '2023-08-05', check_out: '2023-08-19', room_type: 'Family room', rooms: 1, guests: 3, room_list: room('Family room', ['me', alex, sam]), image_data: photo('demo-stay-2') }),
      pkgStay('demo-stay-16', { name: 'Quinta do Mar Apartments', city: 'Albufeira', country: 'Portugal', stay_type: 'Apartment', stars: 3, rating: 7.6, check_in: '2026-01-10', check_out: '2026-01-17', room_type: 'Apartment', rooms: 1, guests: 3, room_list: room('Apartment', ['me', alex, sam]) }),
      pkgStay('demo-stay-17', { name: 'Costa Adeje Palms', city: 'Costa Adeje', country: 'Spain', stay_type: 'Resort', stars: 4, rating: 8.7, check_in: '2026-07-02', check_out: '2026-07-09', room_type: 'Double room', rooms: 1, guests: 2, room_list: room('Double room', ['me', alex]), image_data: photo('demo-stay-5') }),
    );
    [3, 15, 17].forEach((n) => { flights[n - 1].price = null; });
    [4, 16, 18].forEach((n) => { flights[n - 1].price = null; });
    const link = (nums, pkg) => nums.forEach((n) => { flights[n - 1].package_id = pkg; });
    link([3, 4], 'demo-package-1'); link([15, 16], 'demo-package-2'); link([17, 18], 'demo-package-3');
    data.stays.find((x) => x.id === 'demo-stay-15').package_id = 'demo-package-1';
    data.stays.find((x) => x.id === 'demo-stay-16').package_id = 'demo-package-2';
    data.stays.find((x) => x.id === 'demo-stay-17').package_id = 'demo-package-3';
    const T = (kind, mode, date, time, from_place, to_place, notes) => ({ id: uid(), kind, mode, date, time, from_place, to_place, notes: notes || null });
    data.packages = [
      { id: 'demo-package-1', name: 'Majorca summer fortnight', provider: 'Jet2holidays', destination: 'Palma Nova', country: 'Spain', board: 'All inclusive', travellers: 3, price: 2184, booking_ref: 'J2H-48215', notes: 'Kids club was great. Ask for a sea view next time.', created_at: '2023-06-01T00:00:00Z',
        transfers: [T('arrival', 'Coach', '2023-08-05', '10:40', 'Palma Airport (PMI)', 'Hotel Playa Serena', '45 minutes, one stop'), T('departure', 'Coach', '2023-08-19', '08:30', 'Hotel Playa Serena', 'Palma Airport (PMI)')] },
      { id: 'demo-package-2', name: 'Algarve winter sun', provider: 'easyJet holidays', destination: 'Albufeira', country: 'Portugal', board: 'Self catering', travellers: 3, price: 1096, booking_ref: 'EJH-77031', notes: null, created_at: '2025-11-02T00:00:00Z',
        transfers: [T('arrival', 'Private car', '2026-01-10', '14:00', 'Faro Airport (FAO)', 'Quinta do Mar Apartments'), T('departure', 'Private car', '2026-01-17', '11:30', 'Quinta do Mar Apartments', 'Faro Airport (FAO)')] },
      { id: 'demo-package-3', name: 'Tenerife week', provider: 'Jet2holidays', destination: 'Costa Adeje', country: 'Spain', board: 'Half board', travellers: 2, price: 1340, booking_ref: 'J2H-90377', notes: 'Ferry day trip to La Gomera on day 4.', created_at: '2026-03-14T00:00:00Z',
        transfers: [T('arrival', 'Shared shuttle', '2026-07-02', '11:15', 'Tenerife South Airport (TFS)', 'Costa Adeje Palms'), T('other', 'Ferry', '2026-07-05', '09:00', 'Los Cristianos port', 'San Sebastian de La Gomera', 'Day trip'), T('departure', 'Shared shuttle', '2026-07-09', '07:50', 'Costa Adeje Palms', 'Tenerife South Airport (TFS)')] },
    ];
    return data;
  }

  /* -------------------------------------------------------------------- state */

  // Accounts live in the browser only (demo/test fixture, so passwords are not hashed). `state` is the signed-in user's data.
  let state;
  let db;
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode: stay in memory */ } }
  function freshDb() { return { users: [{ username: 'demo', password: 'demo1234', data: seed() }], session: null }; }
  function loadDb() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.users)) return d; }
    } catch (e) { /* fall through to seed */ }
    return freshDb();
  }
  function useSession(name) {
    db.session = name;
    const u = db.users.find((x) => x.username.toLowerCase() === String(name).toLowerCase());
    state = u ? u.data : null;
  }
  db = loadDb();
  // Tests start signed in; the public demo sets window.FL_REQUIRE_LOGIN so the login page shows first.
  if (!window.FL_REQUIRE_LOGIN && !db.session) db.session = 'demo';
  useSession(db.session);
  persist();

  const baseAirports = new Map();
  for (const r of window.FL_AIRPORTS) baseAirports.set(r[0], { iata: r[0], icao: r[1], name: r[2], city: r[3], country: r[4], lat: r[5], lon: r[6], tz: r[7] || null });
  const allAirports = () => [...baseAirports.values(), ...(state ? state.customAirports : []).filter((a) => !baseAirports.has(a.iata))];
  const getAirport = (iata) => baseAirports.get(String(iata || '').toUpperCase()) || state.customAirports.find((a) => a.iata === String(iata || '').toUpperCase());

  /* ----------------------------------------------------------------- helpers */

  function airportOut(a) { return { iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon, tz: a.tz || null }; }

  const packageName = (id) => { const p = (state.packages || []).find((x) => x.id === id); return p ? p.name : null; };

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
        package_id: f.package_id || null, package_name: f.package_id ? packageName(f.package_id) : null,
        from_airport: airportOut(getAirport(f.from_iata)),
        to_airport: airportOut(getAirport(f.to_iata)),
        companions: (f.companion_ids || []).map((id) => state.companions.find((c) => c.id === id)).filter(Boolean)
          .map((c) => ({ id: c.id, name: c.name, relationship: c.relationship, date_of_birth: c.date_of_birth || null })).sort((a, b) => a.name.localeCompare(b.name)),
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
    const pkgId = rows.map((r) => r.package_id).find(Boolean) || null;
    return {
      trip_id: rows[0].trip_id || null,
      type: rows.some((r) => r.direction === 'return') ? 'return' : 'oneway',
      package_id: pkgId, package_name: pkgId ? packageName(pkgId) : null,
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
    const pkgId = existing.map((r) => r.package_id).find(Boolean);
    if (pkgId) state.flights.forEach((f) => { if (keep.has(f.id)) f.package_id = pkgId; });
    persist();
    return tripId || first;
  }

  /* ------------------------------------------------------------------ router */

  const publicUser = (u) => ({ username: u.username, distance_unit: u.data.settings.distance_unit, home_country: u.data.settings.home_country });
  const currentUser = () => db.users.find((x) => x.username.toLowerCase() === String(db.session || '').toLowerCase()) || null;

  function auth(method, pathname, body) {
    const b = body || {};
    if (pathname === '/api/auth/status') {
      const u = currentUser();
      return [200, { authenticated: !!u, user: u ? publicUser(u) : null, signups: true, hasUsers: true, legacyData: false }];
    }
    if (pathname === '/api/auth/logout') { db.session = null; state = null; persist(); return [200, { ok: true }]; }
    if (pathname === '/api/auth/login') {
      const u = db.users.find((x) => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
      if (!u || u.password !== String(b.password || '')) throw new HttpError(401, 'Incorrect username or password.');
      useSession(u.username); persist();
      return [200, { user: publicUser(u) }];
    }
    if (pathname === '/api/auth/signup') {
      const username = String(b.username || '').trim();
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, 'Username must be 3\u201332 characters: letters, numbers, dots, dashes or underscores.');
      if (String(b.password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
      if (!['km', 'mi'].includes(b.distance_unit)) throw new HttpError(400, 'Choose miles or kilometres.');
      if (!str(b.home_country)) throw new HttpError(400, 'Choose your home country.');
      if (db.users.some((x) => x.username.toLowerCase() === username.toLowerCase())) throw new HttpError(409, 'That username is already taken.');
      const u = { username, password: String(b.password), data: { settings: { distance_unit: b.distance_unit, home_country: str(b.home_country) }, companions: [], customAirports: [], stays: [], packages: [], flights: [] } };
      db.users.push(u); useSession(username); persist();
      return [201, { user: publicUser(u) }];
    }
    throw new HttpError(404, 'Not found');
  }

  function route(method, pathname, query, body) {
    if (pathname === '/api/health') return [200, { ok: true }];
    if (pathname.startsWith('/api/auth/')) return auth(method, pathname, body);
    if (pathname === '/api/countries' && method === 'GET' && !state) return [200, { countries: core.countryCenters([...baseAirports.values()]) }];
    if (!state) throw new HttpError(401, 'Please sign in.');

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

    if (pathname === '/api/geocode' && method === 'GET') {
      const q = String(query.get('q') || '').trim();
      if (q.length < 4 || typeof fetch !== 'function') return Promise.resolve([200, { results: [] }]);
      // The public demo asks OpenStreetMap's Nominatim straight from the browser; offline it just finds nothing.
      return fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=' + encodeURIComponent(q))
        .then((r) => r.json())
        .then((rows) => [200, { results: rows.map((r) => {
          const a = r.address || {};
          const street = [a.house_number, a.road || a.pedestrian].filter(Boolean).join(' ');
          return { label: r.display_name, name: r.name || null, address: [street, a.city || a.town || a.village, a.postcode].filter(Boolean).join(', ') || String(r.display_name).split(',').slice(0, 3).join(','),
            city: a.city || a.town || a.village || null, country: a.country || null, lat: Number(r.lat), lon: Number(r.lon) };
        }) }])
        .catch(() => [502, { error: 'Address search is not available right now. You can still type the address in by hand.' }]);
    }

    state.stays = state.stays || [];
    const stayOut = (st) => {
      const mine = new Set(state.companions.map((c) => c.id));
      const list = core.cleanRooms((st.room_list || []).map((r) => ({ ...r, guests: (r.guests || []).filter((g) => g === 'me' || mine.has(g)) })), st);
      const { image_data, ...rest } = st;
      return { ...rest, package_id: st.package_id || null, package_name: st.package_id ? packageName(st.package_id) : null, room_list: list, rooms: list.length, guests: list.reduce((n, r) => n + r.guests.length, 0), image: image_data || st.image_url || null, image_source: image_data ? 'upload' : (st.image_url ? 'link' : null), has_upload: !!image_data };
    };
    const cleanStayMock = (b, existing) => {
      let c; try { c = core.cleanStay(b); } catch (e) { throw new HttpError(e.status || 400, e.message); }
      b = b || {};
      if (typeof b.image_data === 'string' && b.image_data) {
        if (!/^data:image\/(jpeg|png|webp|svg\+xml);base64,/.test(b.image_data)) throw new HttpError(400, 'The photo must be a JPEG, PNG or WebP image.');
        c.image_data = b.image_data; c.image_url = null;
      } else if (c.image_url || b.clear_image_data === true) c.image_data = null;
      else c.image_data = existing ? existing.image_data || null : null;
      const mine = new Set(state.companions.map((x) => x.id));
      c.room_list = c.room_list.map((r) => ({ ...r, guests: r.guests.filter((g) => g === 'me' || mine.has(g)) }));
      c.guests = c.room_list.reduce((n, r) => n + r.guests.length, 0);
      return c;
    };


    /* packages: see server/index.js for the model */
    state.packages = state.packages || [];
    const tripOf = (key) => tripRows(key);
    const buildPackage = (p) => {
      const mine = state.flights.filter((f) => f.package_id === p.id);
      const all = listFlights().filter((f) => f.package_id === p.id);
      const trips = new Map();
      for (const f of all) { const k = f.trip_id || f.id; if (!trips.has(k)) trips.set(k, { key: k, legs: [] }); trips.get(k).legs.push(f); }
      const tripList = [...trips.values()].map((t) => {
        t.legs.sort((a, b) => (a.direction === 'return') - (b.direction === 'return') || a.leg_order - b.leg_order || a.date.localeCompare(b.date));
        const out = t.legs.filter((l) => l.direction !== 'return'), back = t.legs.filter((l) => l.direction === 'return');
        return { key: t.key, type: back.length ? 'return' : 'oneway', legs: t.legs, from: out[0].from_airport, to: out[out.length - 1].to_airport, date: t.legs[0].date, distance_km: t.legs.reduce((n, l) => n + (l.distance_km || 0), 0) };
      }).sort((a, b) => a.date.localeCompare(b.date));
      const st = state.stays.filter((x) => x.package_id === p.id).map(stayOut).sort((a, b) => a.check_in.localeCompare(b.check_in));
      const tr = (p.transfers || []).map((t) => ({ ...t }));
      const dates = [...mine.map((f) => f.date), ...st.flatMap((x) => [x.check_in, x.check_out]), ...tr.map((t) => t.date).filter(Boolean)].sort();
      const start = dates[0] || null, end = dates[dates.length - 1] || null, hotel = st[0] || null;
      const { transfers, ...rest } = p;
      return { ...rest, start, end, nights: start && end ? core.stayNights(start, end) : 0, trips: tripList, stays: st, transfers: tr,
        trip_keys: tripList.map((t) => t.key), stay_ids: st.map((x) => x.id), image: (st.find((x) => x.image) || {}).image || null,
        place: [p.destination || (hotel && hotel.city), p.country || (hotel && hotel.country)].filter(Boolean).join(', ') };
    };
    const writePackageMock = (id, b) => {
      let c; try { c = core.cleanPackage(b); } catch (e) { throw new HttpError(e.status || 400, e.message); }
      if (id && !state.packages.some((x) => x.id === id)) throw new HttpError(404, 'Package not found');
      const trips = c.trip_keys.map((k) => {
        const rows = tripOf(k);
        if (!rows.length) throw new HttpError(400, 'One of the chosen trips could not be found.');
        if (rows.some((r) => r.package_id && r.package_id !== id)) throw new HttpError(400, 'A chosen trip is already part of another package.');
        return rows;
      });
      c.stay_ids.forEach((sid) => {
        const r = state.stays.find((x) => x.id === sid);
        if (!r) throw new HttpError(400, 'One of the chosen stays could not be found.');
        if (r.package_id && r.package_id !== id) throw new HttpError(400, 'A chosen stay is already part of another package.');
      });
      if (!trips.length && !c.stay_ids.length) throw new HttpError(400, 'A package needs at least one trip or stay. Log them first, then pick them here.');
      const row = { name: c.name, provider: c.provider, destination: c.destination, country: c.country, board: c.board, travellers: c.travellers, price: c.price, booking_ref: c.booking_ref, notes: c.notes, transfers: c.transfers.map((t) => ({ id: uid(), ...t })) };
      if (!id) { id = uid(); state.packages.push({ id, created_at: new Date().toISOString(), ...row }); }
      else Object.assign(state.packages.find((x) => x.id === id), row);
      state.flights.forEach((f) => { if (f.package_id === id) f.package_id = null; });
      state.stays.forEach((x) => { if (x.package_id === id) x.package_id = null; });
      trips.forEach((rows) => rows.forEach((r) => { r.package_id = id; }));
      state.stays.forEach((x) => { if (c.stay_ids.includes(x.id)) x.package_id = id; });
      persist();
      return id;
    };

    if (pathname === '/api/packages') {
      if (method === 'GET') return [200, { packages: state.packages.map(buildPackage) }];
      if (method === 'POST') return [201, { id: writePackageMock(null, body) }];
      throw new HttpError(405, 'Method not allowed');
    }
    m = pathname.match(/^\/api\/packages\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const p = state.packages.find((x) => x.id === id);
      if (!p) throw new HttpError(404, 'Package not found');
      if (method === 'GET') return [200, buildPackage(p)];
      if (method === 'PUT') { writePackageMock(id, body); return [200, { id }]; }
      if (method === 'DELETE') {
        state.flights.forEach((f) => { if (f.package_id === id) f.package_id = null; });
        state.stays.forEach((x) => { if (x.package_id === id) x.package_id = null; });
        state.packages = state.packages.filter((x) => x.id !== id);
        persist();
        return [204, null];
      }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/stays') {
      if (method === 'GET') return [200, { stays: state.stays.map(stayOut).sort((a, b) => b.check_in.localeCompare(a.check_in)) }];
      if (method === 'POST') { const id = uid(); state.stays.push({ id, ...cleanStayMock(body) }); persist(); return [201, { id }]; }
      throw new HttpError(405, 'Method not allowed');
    }

    m = pathname.match(/^\/api\/stays\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const st = state.stays.find((x) => x.id === id);
      if (!st) throw new HttpError(404, 'Stay not found');
      if (method === 'GET') return [200, stayOut(st)];
      if (method === 'PUT') { Object.assign(st, cleanStayMock(body, st)); persist(); return [200, { id }]; }
      if (method === 'DELETE') { state.stays = state.stays.filter((x) => x.id !== id); persist(); return [204, null]; }
      throw new HttpError(405, 'Method not allowed');
    }

    if (pathname === '/api/companions') {
      if (method === 'GET') return [200, { companions: [...state.companions].sort((a, b) => a.name.localeCompare(b.name)) }];
      if (method === 'POST') {
        const name = str((body || {}).name, 100);
        if (!name) throw new HttpError(400, 'name is required');
        const dob = core.cleanDob((body || {}).date_of_birth);
        if (dob === undefined) throw new HttpError(400, 'date_of_birth must be a valid past date (YYYY-MM-DD)');
        const c = { id: uid(), name, relationship: str((body || {}).relationship, 60), date_of_birth: dob };
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
        if ('date_of_birth' in (body || {})) {
          const dob = core.cleanDob(body.date_of_birth);
          if (dob === undefined) throw new HttpError(400, 'date_of_birth must be a valid past date (YYYY-MM-DD)');
          c.date_of_birth = dob;
        }
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
        stays: state.stays.map((st) => ({ ...stayOut(st), ...(st.image_data ? { image_data: st.image_data } : {}) })),
        packages: (state.packages || []).map((p) => ({ id: p.id, name: p.name, provider: p.provider, destination: p.destination, country: p.country, board: p.board, travellers: p.travellers, price: p.price, booking_ref: p.booking_ref, notes: p.notes, transfers: (p.transfers || []).map(({ id, ...t }) => t) })),
      }];
    }

    if (pathname === '/api/import' && method === 'POST') {
      const data = body;
      if (!data || typeof data !== 'object' || !['flights', 'stays', 'packages'].some((k) => Array.isArray(data[k]))) throw new HttpError(400, 'This does not look like a FlightLog file (no "flights", "stays" or "packages" list).');
      const hasFlights = Array.isArray(data.flights), hasStays = Array.isArray(data.stays), hasPackages = Array.isArray(data.packages);
      if (query.get('mode') === 'replace') {
        if (hasPackages) { state.packages = []; state.flights.forEach((f) => { f.package_id = null; }); (state.stays || []).forEach((x) => { x.package_id = null; }); }
        if (hasFlights) { state.flights = []; state.companions = []; }
        if (hasStays) state.stays = [];
      }
      state.packages = state.packages || [];
      const packageMap = new Map();
      let importedPackages = 0;
      for (const a of Array.isArray(data.airports) ? data.airports : []) {
        if (a && a.iata && a.name && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) && !getAirport(a.iata)) {
          state.customAirports.push({ iata: String(a.iata).toUpperCase(), icao: str(a.icao, 4), name: String(a.name), city: str(a.city), country: str(a.country), lat: Number(a.lat), lon: Number(a.lon), tz: a.tz && core.validTz(a.tz) ? String(a.tz) : null });
        }
      }
      for (const c of Array.isArray(data.companions) ? data.companions : []) {
        if (c && c.id && c.name && !state.companions.some((x) => x.id === String(c.id))) state.companions.push({ id: String(c.id), name: String(c.name).slice(0, 100), relationship: str(c.relationship, 60), date_of_birth: core.cleanDob(c.date_of_birth) || null });
      }
      let imported = 0;
      let importedStays = 0;
      const skipped = [];
      state.stays = state.stays || [];
      const importStay = (raw, forcePkg) => {
        const c = cleanStayMock(raw);
        const id = raw && raw.id ? String(raw.id).slice(0, 64) : uid();
        const i = state.stays.findIndex((x) => x.id === id);
        const pid = forcePkg || (raw.package_id && packageMap.get(String(raw.package_id))) || null;
        if (i >= 0) state.stays[i] = { id, ...c, package_id: pid }; else state.stays.push({ id, ...c, package_id: pid });
      };
      for (const raw of Array.isArray(data.packages) ? data.packages : []) {
        try {
          if (!raw || typeof raw !== 'object') continue;
          const c = core.cleanPackage({ ...raw, trip_keys: [], stay_ids: [] });
          const id = raw.id ? String(raw.id).slice(0, 64) : uid();
          const row = { id, created_at: new Date().toISOString(), name: c.name, provider: c.provider, destination: c.destination, country: c.country, board: c.board, travellers: c.travellers, price: c.price, booking_ref: c.booking_ref, notes: c.notes, transfers: c.transfers.map((t) => ({ id: uid(), ...t })) };
          const i = state.packages.findIndex((x) => x.id === id);
          if (i >= 0) state.packages[i] = row; else state.packages.push(row);
          packageMap.set(raw.id ? String(raw.id) : id, id); importedPackages += 1;
          for (const st of Array.isArray(raw.stays) ? raw.stays : []) {
            try { importStay(st, id); importedStays += 1; } catch (e) { skipped.push('stay ' + (st && st.name ? st.name : '?') + ': ' + e.message); }
          }
        } catch (e) { skipped.push('package ' + (raw && raw.name ? raw.name : '?') + ': ' + e.message); }
      }
      for (const raw of data.flights || []) {
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
          row.package_id = raw.package_id && packageMap.get(String(raw.package_id)) || null;
          const i = state.flights.findIndex((x) => x.id === id);
          if (i >= 0) state.flights[i] = row; else state.flights.push(row);
          imported += 1;
        } catch (e) {
          skipped.push((raw && raw.date ? raw.date : '?') + ': ' + e.message);
        }
      }
      for (const raw of hasStays ? data.stays : []) {
        try { importStay(raw); importedStays += 1; } catch (e) { skipped.push('stay ' + (raw && raw.name ? raw.name : '?') + ': ' + e.message); }
      }
      if (data.settings && ['km', 'mi'].includes(data.settings.distance_unit)) state.settings.distance_unit = data.settings.distance_unit;
      if (data.settings && data.settings.home_country) state.settings.home_country = String(data.settings.home_country);
      persist();
      return [200, { imported, imported_stays: importedStays, imported_packages: importedPackages, skipped }];
    }

    throw new HttpError(404, 'Not found');
  }

  async function handle(path, opts) {
    const method = String(opts.method || 'GET').toUpperCase();
    const url = new URL(path, 'http://demo.local/');
    let body;
    try { body = opts.body ? JSON.parse(opts.body) : undefined; } catch (e) { return respond(400, { error: 'Invalid JSON body' }); }
    try {
      const out = await route(method, url.pathname, url.searchParams, body);
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
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } db = freshDb(); useSession(window.FL_REQUIRE_LOGIN ? null : 'demo'); persist(); },
  };
})();
