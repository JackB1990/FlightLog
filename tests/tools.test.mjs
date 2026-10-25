// Run with: node --test tests/tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('build-airports converts an OurAirports-style CSV', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-csv-'));
  const header = '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';
  const rows = [
    '1,"EGLL","large_airport","London Heathrow Airport",51.4706,-0.461941,83,"EU","GB","GB-ENG","London","yes","EGLL","LHR","EGLL",,,,"Heathrow, LHR"',
    '2,"KJFK","large_airport","John F Kennedy Intl, ""JFK""",40.639801,-73.7789,13,"NA","US","US-NY","New York","yes","KJFK","JFK","KJFK",,,,',
    '3,"XX01","small_airport","No IATA Strip",1,1,0,"EU","GB","GB-ENG","Nowhere","no",,,,,,,',
    '4,"EGZZ","closed","Closed Field",52,0,0,"EU","GB","GB-ENG","Gone","no","EGZZ","ZZZ",,,,,',
    '5,"EGHH","small_airport","Duplicate LHR small",51,0,0,"EU","GB","GB-ENG","Dup","no",,"LHR",,,,,',
  ];
  const csv = join(dir, 'a.csv');
  const out = join(dir, 'a.json');
  writeFileSync(csv, [header, ...rows].join('\n') + '\n');
  const r = spawnSync(process.execPath, [join(root, 'tools/build-airports.mjs'), csv, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(data.map((d) => d[0]), ['JFK', 'LHR']);
  const lhr = data.find((d) => d[0] === 'LHR');
  assert.equal(lhr[2], 'London Heathrow Airport');
  assert.equal(lhr[4], 'United Kingdom');
  assert.equal(data.find((d) => d[0] === 'JFK')[2], 'John F Kennedy Intl, "JFK"');
  rmSync(dir, { recursive: true, force: true });
});

test('FL_PASSWORD turns on basic auth (health stays open)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-auth-'));
  const port = 3800 + Math.floor(Math.random() * 90);
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server/index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, FL_PASSWORD: 's3cret', FL_USER: 'jack' },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal((await fetch(base + '/api/health')).status, 200);
    const denied = await fetch(base + '/api/flights');
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate') || '', /Basic/);
    assert.equal((await fetch(base + '/')).status, 401);
    const good = 'Basic ' + Buffer.from('jack:s3cret').toString('base64');
    assert.equal((await fetch(base + '/api/flights', { headers: { Authorization: good } })).status, 200);
    const bad = 'Basic ' + Buffer.from('jack:wrong').toString('base64');
    assert.equal((await fetch(base + '/api/flights', { headers: { Authorization: bad } })).status, 401);
  } finally {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
