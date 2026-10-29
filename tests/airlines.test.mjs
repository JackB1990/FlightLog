import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'frontend/data.js'), 'utf8'), ctx);
const AIRLINES = ctx.window.FL_DATA.AIRLINES;

test('airline list: names are unique and every entry is well formed', () => {
  const names = AIRLINES.map((a) => a.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  for (const a of AIRLINES) {
    assert.ok(a.name && /^#[0-9A-F]{6}$/i.test(a.color), a.name);
    assert.ok(/^[A-Z0-9]{2}$/.test(a.code), 'every airline needs a verified IATA code: ' + a.name + ' ' + a.code);
  }
});

test('airline list: well-known airlines are unchanged and the verified additions are present', () => {
  const byName = new Map(AIRLINES.map((a) => [a.name, a]));
  const ba = byName.get('British Airways');
  assert.deepEqual([ba.code, ba.color, ba.color2], ['BA', '#01295c', '#E21836']);
  const ryanair = byName.get('Ryanair');
  assert.deepEqual([ryanair.code, ryanair.color, ryanair.color2], ['FR', '#073590', '#F7C800']);
  assert.ok(AIRLINES.length > 380);
  assert.equal(AIRLINES.findIndex((a) => a.name === 'British Airways') < 100, true);
  for (const n of ['Hainan Airlines', 'Volotea', 'Hawaiian Airlines', 'Aeroflot', 'Zipair']) assert.ok(byName.has(n), n);
  assert.equal(byName.get('Hawaiian Airlines').code, 'HA');
});

test('bundled airline logos: every mapped file exists, belongs to a listed airline', async () => {
  const { existsSync } = await import('node:fs');
  const map = ctx.window.FL_DATA.LOCAL_LOGOS;
  assert.ok(Object.keys(map).length >= 60);
  const byName = new Map(AIRLINES.map((a) => [a.name, a]));
  for (const [name, file] of Object.entries(map)) {
    assert.ok(byName.has(name), 'unknown airline ' + name);
    assert.ok(existsSync(join(root, 'frontend', file)), file);
  }
});
