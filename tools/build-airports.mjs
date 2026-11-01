// Converts the OurAirports airports.csv into the compact JSON the server loads.
// Usage: node build-airports.mjs <airports.csv> <airports.json>
// Output rows: [iata, icao, name, city, country, lat, lon, tz]
// tz is an IANA zone looked up from the coordinates with the optional `tz-lookup` package (null if unavailable).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let tzlookup = null;
try { tzlookup = createRequire(import.meta.url)('tz-lookup'); } catch { /* optional */ }
const zoneFor = (lat, lon) => { try { return tzlookup ? tzlookup(lat, lon) : null; } catch { return null; } };

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('usage: node build-airports.mjs <airports.csv> <airports.json>');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code) => {
  try { return regions.of(code) || code; } catch { return code; }
};

const rank = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4 };
const [header, ...data] = parseCsv(readFileSync(inFile, 'utf8'));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const need of ['type', 'name', 'latitude_deg', 'longitude_deg', 'iso_country', 'municipality', 'icao_code', 'iata_code', 'ident']) {
  if (!(need in col)) throw new Error(`airports.csv is missing the "${need}" column`);
}

const best = new Map();
for (const r of data) {
  const iata = (r[col.iata_code] || '').trim().toUpperCase();
  const type = r[col.type];
  if (!/^[A-Z0-9]{3}$/.test(iata) || type === 'closed') continue;
  const lat = Number(r[col.latitude_deg]);
  const lon = Number(r[col.longitude_deg]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const prev = best.get(iata);
  const score = rank[type] ?? 5;
  if (prev && prev.score <= score) continue;
  best.set(iata, {
    score,
    row: [
      iata,
      (r[col.icao_code] || r[col.ident] || '').trim().toUpperCase() || null,
      r[col.name].trim(),
      (r[col.municipality] || '').trim() || null,
      countryName((r[col.iso_country] || '').trim()),
      Math.round(lat * 1e5) / 1e5,
      Math.round(lon * 1e5) / 1e5,
      zoneFor(lat, lon),
    ],
  });
}

const out = [...best.values()].map((v) => v.row).sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(outFile, JSON.stringify(out));
console.log(`wrote ${out.length} airports to ${outFile} (${out.filter((r) => r[7]).length} with time zones${tzlookup ? '' : '; tz-lookup not installed'})`);
