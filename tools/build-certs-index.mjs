// Builds data/certs/*.json: a static fallback for the L&I BUILDING_CERTS layer
// (the live ArcGIS FeatureServer has been returning "Invalid URL" since Oct 2026).
//
//   node tools/build-certs-index.mjs [path/to/certs.csv] [path/to/summary.csv]
//
// With no args it downloads both exports from the City's ArcGIS Hub.
// Output: one shard per street, data/certs/<STREET_SLUG>.json =
//   { r: [cert rows (page field names, dates as epoch ms)], b: { bin: {type: status} } }
// Each row carries its house number in `address`; the client filters with houseNumsMatch.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { certStreetKey } from '../lib/matching.mjs';

const HUB = 'https://hub.arcgis.com/api/v3/datasets';
const CERTS_URL = `${HUB}/0d5f1b98872b4444aea641792be7d12b_0/downloads/data?format=csv&spatialRefId=3857&where=1%3D1`;
const SUMMARY_URL = `${HUB}/fbfce1de2fa747748cedae5ede54da60_0/downloads/data?format=csv&spatialRefId=3857&where=1%3D1`;
const OUT = new URL('../data/certs/', import.meta.url).pathname;

async function load(arg, url) {
  if (arg) return readFileSync(arg, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.text();
}

// Minimal RFC-4180 parser (the contractor address field contains newlines).
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length === head.length)
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const toMs = s => {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/\//g, '-').replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isFinite(t) ? t : null;
};
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== ''));

const [certsCsv, summaryCsv] = await Promise.all([
  load(process.argv[2], CERTS_URL), load(process.argv[3], SUMMARY_URL),
]);
const certs = parseCsv(certsCsv);
const summary = parseCsv(summaryCsv);
if (certs.length < 50000) throw new Error(`certs export suspiciously small: ${certs.length} rows`);

const sumByBin = new Map();
for (const s of summary) {
  const st = {};
  for (const k of Object.keys(s)) {
    const m = k.match(/^(.+)_status$/);
    if (m && s[k]) st[m[1]] = s[k];
  }
  if (Object.keys(st).length) sumByBin.set(s.structure_id, st);
}

const shards = new Map();
let skipped = 0;
for (const r of certs) {
  const { file } = certStreetKey(r.address);
  if (!file) { skipped++; continue; }
  const row = clean({
    buildingcertnumber: r.buildingcertnumber,
    buildingcerttype: r.buildingcerttype,
    inspectiondate: toMs(r.inspectiondate),
    inspectionresult: r.inspectionresult,
    expirationdate: toMs(r.expirationdate),
    unit_num: r.unit_num,
    contractorname: (r.contractorname || '').split(/\r?\n/)[0].trim(),
    address: r.address,
    bin: r.bin,
  });
  if (!shards.has(file)) shards.set(file, { r: [], b: {} });
  const sh = shards.get(file);
  sh.r.push(row);
  const s = r.bin ? sumByBin.get(r.bin) : null;
  if (s) sh.b[r.bin] = s;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [file, obj] of shards) {
  if (!Object.keys(obj.b).length) delete obj.b;
  const body = JSON.stringify(obj);
  bytes += body.length;
  writeFileSync(`${OUT}${file}.json`, body);
}
writeFileSync(`${OUT}meta.json`, JSON.stringify({
  generated: new Date().toISOString(), source: 'City of Philadelphia L&I BUILDING_CERTS + BUILDING_CERT_SUMMARY (ArcGIS Hub export)',
  certRows: certs.length, summaryRows: summary.length, shards: shards.size, skipped,
}));
console.log(`certs=${certs.length} summary=${summary.length} skipped=${skipped} shards=${shards.size} bytes=${bytes}`);
