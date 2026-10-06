#!/usr/bin/env node
// generate-property-pages.mjs — build the static property-snapshot pages in /p/.
//
// Run manually (node >= 20, zero deps):   node tools/generate-property-pages.mjs
// Output is committed to the repo; the GitHub Pages deploy stays build-free.
//
// Selection: from each Philadelphia ZIP, the properties holding an ACTIVE
// rental license (business_licenses, licensetype='Rental'), ordered by open
// L&I violation count, ~6-7 per ZIP, capped at TARGET_TOTAL pages. Pages are
// neutral public-record snapshots: verbatim City statuses, no owner names,
// no scores, no rankings.
//
// Fails loudly (nonzero exit, no partial output) on any HTTP or schema error
// so upstream schema drift never silently ships wrong pages. The per-property
// 311 count is the one soft failure: it renders as "unavailable", never 0.

import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "p");
const SITEMAP = path.join(ROOT, "sitemap.xml");
const CARTO = "https://phl.carto.com/api/v2/sql";

const TARGET_TOTAL = 300;
const PER_ZIP = 7;          // fetch up to this many per ZIP...
const PER_ZIP_BASE = 6;     // ...guarantee this many; extras fill to TARGET_TOTAL
const MAX_VIOLATIONS_SHOWN = 10;
const DELAY_MS = 200;

const ZIPS = [
  "19102","19103","19104","19106","19107","19111","19112","19114","19115","19116",
  "19118","19119","19120","19121","19122","19123","19124","19125","19126","19127",
  "19128","19129","19130","19131","19132","19133","19134","19135","19136","19137",
  "19138","19139","19140","19141","19142","19143","19144","19145","19146","19147",
  "19148","19149","19150","19151","19152","19153","19154"
];

const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);
const SNAPSHOT_HUMAN = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlStr = (s) => String(s).replace(/'/g, "''");
const esc = (s) => String(s ?? "").trim().replace(/\s+/g, " ")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const jsonEsc = (s) => JSON.stringify(String(s ?? "")).slice(1, -1);

async function carto(q) {
  const url = `${CARTO}?q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Carto HTTP ${res.status} for: ${q.slice(0, 120)}...`);
  const j = await res.json();
  if (!Array.isArray(j.rows)) throw new Error(`Carto returned no rows array for: ${q.slice(0, 120)}...`);
  return j.rows;
}

function requireFields(row, fields, ctx) {
  for (const f of fields) if (!(f in row)) throw new Error(`Schema drift: field "${f}" missing in ${ctx}`);
}

// ---- 1. candidate selection: active rental licenses per ZIP, by open-violation count
async function selectCandidates() {
  const perZip = new Map();
  for (const zip of ZIPS) {
    const rows = await carto(
      `SELECT bl.opa_account_num, min(bl.address) AS address, min(bl.zip) AS zip, count(v.cartodb_id) AS open_ct ` +
      `FROM business_licenses bl ` +
      `LEFT JOIN violations v ON v.opa_account_num = bl.opa_account_num AND v.violationstatus = 'OPEN' ` +
      `WHERE bl.licensetype = 'Rental' AND bl.licensestatus = 'Active' ` +
      `AND bl.zip LIKE '${zip}%' AND bl.opa_account_num IS NOT NULL AND bl.address IS NOT NULL ` +
      `GROUP BY 1 ORDER BY open_ct DESC, 1 LIMIT ${PER_ZIP + 5}`
    );
    if (rows.length) requireFields(rows[0], ["opa_account_num", "address", "zip", "open_ct"], "candidate query");
    const picks = rows
      .filter((r) => /^\d{6,12}$/.test(String(r.opa_account_num)))
      .slice(0, PER_ZIP)
      .map((r) => ({ opa: String(r.opa_account_num), address: String(r.address), zip5: String(r.zip).slice(0, 5), openCt: Number(r.open_ct) }));
    perZip.set(zip, picks);
    console.log(`  ${zip}: ${picks.length} candidates (top open_ct ${picks[0]?.openCt ?? 0})`);
    await sleep(DELAY_MS);
  }
  // Base quota per ZIP, then fill remaining slots with the highest-violation extras.
  const seen = new Set();
  const take = (p) => { if (!seen.has(p.opa)) { seen.add(p.opa); return true; } return false; };
  const base = [], extras = [];
  for (const picks of perZip.values()) {
    picks.slice(0, PER_ZIP_BASE).filter(take).forEach((p) => base.push(p));
    picks.slice(PER_ZIP_BASE).filter(take).forEach((p) => extras.push(p));
  }
  extras.sort((a, b) => b.openCt - a.openCt);
  const selected = base.concat(extras.slice(0, Math.max(0, TARGET_TOTAL - base.length))).slice(0, TARGET_TOTAL);
  console.log(`Selected ${selected.length} properties (${base.length} base + ${selected.length - base.length} extras).`);
  return selected;
}

// ---- 2. bulk detail queries, chunked
function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function fetchLicenses(opas) {
  const byOpa = new Map();
  for (const chunk of chunks(opas, 100)) {
    const list = chunk.map((o) => `'${o}'`).join(",");
    const rows = await carto(
      `SELECT opa_account_num, licensenum, licensestatus, expirationdate, numberofunits ` +
      `FROM business_licenses WHERE licensetype = 'Rental' AND licensestatus = 'Active' ` +
      `AND opa_account_num IN (${list})`
    );
    if (rows.length) requireFields(rows[0], ["opa_account_num", "licensenum", "licensestatus", "expirationdate"], "license query");
    for (const r of rows) {
      const k = String(r.opa_account_num);
      const prev = byOpa.get(k);
      if (!prev || String(r.expirationdate || "") > String(prev.expirationdate || "")) byOpa.set(k, r);
    }
    await sleep(DELAY_MS);
  }
  return byOpa;
}

async function fetchViolations(opas) {
  const byOpa = new Map();
  for (const chunk of chunks(opas, 100)) {
    const list = chunk.map((o) => `'${o}'`).join(",");
    const rows = await carto(
      `SELECT opa_account_num, casenumber, violationdate, violationcode, violationcodetitle ` +
      `FROM violations WHERE violationstatus = 'OPEN' AND opa_account_num IN (${list}) ` +
      `ORDER BY violationdate DESC`
    );
    if (rows.length) requireFields(rows[0], ["opa_account_num", "casenumber", "violationdate", "violationcode", "violationcodetitle"], "violation query");
    for (const r of rows) {
      const k = String(r.opa_account_num);
      if (!byOpa.has(k)) byOpa.set(k, []);
      if (byOpa.get(k).length < MAX_VIOLATIONS_SHOWN) byOpa.get(k).push(r);
    }
    await sleep(DELAY_MS);
  }
  return byOpa;
}

// 311 is matched by address pattern (the 311 feed has no OPA numbers) — the one
// soft-fail lookup: null means "unavailable" on the page, never 0.
async function fetch311Count(address) {
  const tokens = String(address).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!tokens.length) return null;
  const pat = "%" + tokens.join("%") + "%";
  try {
    const rows = await carto(
      `SELECT COUNT(*) AS ct FROM public_cases_fc ` +
      `WHERE UPPER(address) LIKE '${sqlStr(pat)}' AND requested_datetime >= NOW() - INTERVAL '12 months'`
    );
    return rows.length ? Number(rows[0].ct) : null;
  } catch (e) {
    console.warn(`  311 lookup failed for ${address}: ${e.message}`);
    return null;
  }
}

// ---- 3. page templates
function fmtDate(v) {
  if (!v) return "—";
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : esc(String(v));
}

function propertyPage(p) {
  const title = `${p.address}, Philadelphia ${p.zip5} — L&I Violations, Rental License & 311 Records | 4PHILLY`;
  const complaints311 = p.count311 == null ? "unavailable" : String(p.count311);
  const desc = `Snapshot ${SNAPSHOT_DATE}: ${p.violations.length} open L&I violation${p.violations.length === 1 ? "" : "s"}, active rental license, ${complaints311 === "unavailable" ? "311 count unavailable" : complaints311 + " 311 complaints (12 mo)"} at ${p.address}, Philadelphia ${p.zip5}. Records change daily.`;
  const url = `https://4philly.net/p/${p.opa}.html`;
  const lic = p.license;
  const violRows = p.violations.map((v) =>
    `      <tr><td>${esc(v.casenumber)}</td><td>${fmtDate(v.violationdate)}</td><td>${esc(v.violationcode)}</td><td>${esc(v.violationcodetitle)}</td></tr>`
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script>(function(){try{if(localStorage.getItem('4p-theme')==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();</script>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://4philly.net/og-image.png?v=4.2">
<meta property="og:image:alt" content="4PHILLY — Philadelphia property record">
<meta property="og:site_name" content="4PHILLY">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
<meta name="twitter:image" content="https://4philly.net/og-image.png?v=4.2">
<meta name="twitter:image:alt" content="4PHILLY — Philadelphia property record">
<link rel="canonical" href="${url}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "name": "${jsonEsc(title)}",
      "url": "${url}",
      "dateModified": "${SNAPSHOT_DATE}",
      "description": "${jsonEsc(desc)}",
      "about": {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "${jsonEsc(p.address)}",
          "addressLocality": "Philadelphia",
          "addressRegion": "PA",
          "postalCode": "${jsonEsc(p.zip5)}"
        }
      },
      "isBasedOn": [
        "https://opendataphilly.org/datasets/licenses-and-inspections-code-violations/",
        "https://opendataphilly.org/datasets/licenses-and-inspections-business-licenses/"
      ],
      "isPartOf": { "@type": "WebSite", "name": "4PHILLY", "url": "https://4philly.net/" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "4PHILLY", "item": "https://4philly.net/" },
        { "@type": "ListItem", "position": 2, "name": "Property record snapshots", "item": "https://4philly.net/p/" },
        { "@type": "ListItem", "position": 3, "name": "${jsonEsc(p.address)}", "item": "${url}" }
      ]
    }
  ]
}
</script>
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
<style>
  :root{color-scheme:light;--bg:#ffffff;--panel:#f6f7f9;--panel-2:#eceef2;--line:#d8dde4;--ink:#14171a;--ink-dim:#474e57;--ink-mute:#5d6570;--accent:#1550e0;--accent-rgb:21 80 224;--accent-soft:#0f3fb3;--accent-fill:#1550e0;--accent-fill-hover:#0f3fb3;--on-accent:#ffffff}
  html[data-theme="dark"]{color-scheme:dark;--bg:#111214;--panel:#161819;--panel-2:#1c1e20;--line:#2a2c2e;--ink:#ececec;--ink-dim:#9a9a9a;--ink-mute:#666;--accent:#ffb000;--accent-rgb:255 176 0;--accent-soft:#ffd166;--accent-fill:#ffb000;--accent-fill-hover:#ffbe2e;--on-accent:#1a1100}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif;font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-decoration:none;border-bottom:1px dotted rgb(var(--accent-rgb) / .4)}
  a:hover{color:var(--accent-soft)}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 80px}
  .brand{font-weight:800;font-size:22px;letter-spacing:-.02em;margin-bottom:28px}
  .brand span{color:var(--accent)}
  .brand a{border:none;color:var(--ink)}
  .snap{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:4px;padding:12px 16px;font-size:.9em;color:var(--ink-dim);margin:0 0 24px}
  h1{font-weight:800;font-size:1.7em;line-height:1.25;letter-spacing:-.01em;margin:0 0 4px}
  h2{font-weight:800;font-size:1.15em;margin:2em 0 .5em;border-top:1px solid var(--line);padding-top:1.2em}
  .opa{font-family:ui-monospace,monospace;font-size:.85em;color:var(--ink-mute);margin:0 0 20px}
  .cta{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px;text-align:center;margin:1.8em 0}
  .cta .btn{display:inline-block;background:var(--accent-fill);color:var(--on-accent);font-weight:700;padding:12px 26px;border-radius:3px;border:none;margin-top:8px}
  .cta .btn:hover{background:var(--accent-fill-hover)}
  table{width:100%;border-collapse:collapse;margin:1em 0;font-size:.9em}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--ink-dim);font-family:ui-monospace,monospace;font-size:.75em;text-transform:uppercase;letter-spacing:.08em}
  .disc{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:12px 16px;font-size:.85em;color:var(--ink-dim);margin:2em 0}
  .foot{font-family:ui-monospace,monospace;font-size:.8em;color:var(--ink-mute);margin-top:3em}
  dl{margin:1em 0}
  dt{color:var(--ink-dim);font-family:ui-monospace,monospace;font-size:.75em;text-transform:uppercase;letter-spacing:.08em;margin-top:10px}
  dd{margin:2px 0 0}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><a href="https://4philly.net/">4<span>PHILLY</span></a></div>

  <div class="snap"><b>Snapshot of Philadelphia public records as of ${SNAPSHOT_HUMAN}.</b> Records change daily — always check the live record before relying on anything here.</div>

  <h1>${esc(p.address)}, Philadelphia, PA ${esc(p.zip5)}</h1>
  <p class="opa">OPA account number: ${esc(p.opa)}</p>

  <div class="cta">
    <div>See today's live City record for this address</div>
    <a class="btn" href="https://4philly.net/#opa=${esc(p.opa)}">View the live record on 4PHILLY →</a>
    <div style="margin-top:10px;font-size:.85em"><a href="https://atlas.phila.gov/" target="_blank" rel="noopener">Verify at atlas.phila.gov</a></div>
  </div>

  <h2>Rental license (at snapshot)</h2>
  <dl>
    <dt>Status</dt><dd>${esc(lic?.licensestatus ?? "Active")}</dd>
    <dt>License number</dt><dd>${esc(lic?.licensenum ?? "—")}</dd>
    <dt>Expiration date</dt><dd>${fmtDate(lic?.expirationdate)}</dd>
    <dt>Units covered</dt><dd>${esc(lic?.numberofunits ?? "—")}</dd>
  </dl>

  <h2>Open L&amp;I violations (at snapshot)</h2>
${p.violations.length ? `  <p>${p.violations.length === MAX_VIOLATIONS_SHOWN ? `The ${MAX_VIOLATIONS_SHOWN} most recent open violations` : `${p.violations.length} open violation${p.violations.length === 1 ? "" : "s"}`} recorded in the City's open data at snapshot time. Statuses are shown verbatim as the City records them.</p>
  <table>
    <thead><tr><th>Case number</th><th>Date</th><th>Code</th><th>Title</th></tr></thead>
    <tbody>
${violRows}
    </tbody>
  </table>` : `  <p>No open violations recorded in the City's open data at snapshot time.</p>`}

  <h2>311 complaints (last 12 months, at snapshot)</h2>
  <p>${p.count311 == null ? "Count unavailable at snapshot time — check the live record." : `${p.count311} complaint${p.count311 === 1 ? "" : "s"} matched to this address in the public Philly311 feed. 311 records are matched by address pattern (the feed carries no parcel ID), so this count is approximate.`}</p>

  <div class="disc"><b>4PHILLY is an independent, non-governmental tool.</b> It is not operated, affiliated with, or endorsed by the City of Philadelphia. Everything above is a point-in-time copy of public City of Philadelphia records, shown verbatim without commentary; it is not a statement about any person, and an entry here is not proof of current conditions. Verify directly at <a href="https://atlas.phila.gov/" target="_blank" rel="noopener">atlas.phila.gov</a>.</div>

  <p class="foot"><a href="./">← All property snapshots</a> · <a href="/">Search any address</a> · <a href="/blog/">Guides &amp; articles</a></p>
</div>
</body>
</html>
`;
}

function hubPage(props) {
  const byZip = new Map();
  for (const p of props) {
    if (!byZip.has(p.zip5)) byZip.set(p.zip5, []);
    byZip.get(p.zip5).push(p);
  }
  const sections = [...byZip.keys()].sort().map((zip) => {
    const items = byZip.get(zip)
      .slice().sort((a, b) => a.address.localeCompare(b.address))
      .map((p) => `      <li><a href="${p.opa}.html">${esc(p.address)}</a></li>`).join("\n");
    return `    <h2 id="zip-${zip}">${zip}</h2>\n    <ul>\n${items}\n    </ul>`;
  }).join("\n");

  const desc = `Snapshots of public Philadelphia records — rental license, open L&I violations, 311 counts — for ${props.length} licensed rentals sampled from every ZIP. Snapshot ${SNAPSHOT_DATE}.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script>(function(){try{if(localStorage.getItem('4p-theme')==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();</script>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>Philadelphia Property Record Snapshots | 4PHILLY</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="Philadelphia Property Record Snapshots | 4PHILLY">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://4philly.net/p/">
<meta property="og:image" content="https://4philly.net/og-image.png?v=4.2">
<meta property="og:image:alt" content="4PHILLY — Philadelphia property record">
<meta property="og:site_name" content="4PHILLY">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
<meta name="twitter:image" content="https://4philly.net/og-image.png?v=4.2">
<meta name="twitter:image:alt" content="4PHILLY — Philadelphia property record">
<link rel="canonical" href="https://4philly.net/p/">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "Philadelphia Property Record Snapshots",
  "url": "https://4philly.net/p/",
  "dateModified": "${SNAPSHOT_DATE}",
  "description": "${jsonEsc(desc)}",
  "isPartOf": { "@type": "WebSite", "name": "4PHILLY", "url": "https://4philly.net/" }
}
</script>
<link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
<style>
  :root{color-scheme:light;--bg:#ffffff;--panel:#f6f7f9;--panel-2:#eceef2;--line:#d8dde4;--ink:#14171a;--ink-dim:#474e57;--ink-mute:#5d6570;--accent:#1550e0;--accent-rgb:21 80 224;--accent-soft:#0f3fb3;--accent-fill:#1550e0;--accent-fill-hover:#0f3fb3;--on-accent:#ffffff}
  html[data-theme="dark"]{color-scheme:dark;--bg:#111214;--panel:#161819;--panel-2:#1c1e20;--line:#2a2c2e;--ink:#ececec;--ink-dim:#9a9a9a;--ink-mute:#666;--accent:#ffb000;--accent-rgb:255 176 0;--accent-soft:#ffd166;--accent-fill:#ffb000;--accent-fill-hover:#ffbe2e;--on-accent:#1a1100}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,sans-serif;font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
  a{color:var(--accent);text-decoration:none;border-bottom:1px dotted rgb(var(--accent-rgb) / .4)}
  a:hover{color:var(--accent-soft)}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 80px}
  .brand{font-weight:800;font-size:22px;letter-spacing:-.02em;margin-bottom:28px}
  .brand span{color:var(--accent)}
  .brand a{border:none;color:var(--ink)}
  h1{font-weight:800;font-size:1.9em;line-height:1.2;margin:0 0 12px}
  h2{font-weight:800;font-size:1.05em;margin:1.8em 0 .4em;color:var(--accent);font-family:ui-monospace,monospace}
  ul{padding-left:1.3em;margin:.3em 0;columns:2;column-gap:28px}
  li{margin:.25em 0;break-inside:avoid;font-size:.92em}
  @media (max-width:560px){ul{columns:1}}
  .dek{font-size:1.05em;color:var(--ink-dim);margin:0 0 20px}
  .disc{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:4px;padding:12px 16px;font-size:.88em;color:var(--ink-dim);margin:1.6em 0}
  .cta{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px;text-align:center;margin:1.8em 0}
  .cta .btn{display:inline-block;background:var(--accent-fill);color:var(--on-accent);font-weight:700;padding:12px 26px;border-radius:3px;border:none;margin-top:8px}
  .cta .btn:hover{background:var(--accent-fill-hover)}
  .foot{font-family:ui-monospace,monospace;font-size:.8em;color:var(--ink-mute);margin-top:3em}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><a href="https://4philly.net/">4<span>PHILLY</span></a></div>

  <h1>Philadelphia Property Record Snapshots</h1>
  <p class="dek">Point-in-time copies of public City of Philadelphia records for ${props.length} rental properties holding an active rental license — sampled automatically from every Philadelphia ZIP code, ordered here by address only. Snapshot taken ${SNAPSHOT_HUMAN}.</p>

  <div class="disc"><b>These are static snapshots, not live data.</b> Every figure on these pages is a verbatim copy of the City's open data as of the snapshot date; records change daily. For today's record on any address — including any address not listed here — use the live lookup. 4PHILLY is an independent, non-governmental tool; verify anything that matters at <a href="https://atlas.phila.gov/" target="_blank" rel="noopener">atlas.phila.gov</a>.</div>

  <div class="cta">
    <div>Need a different address, or today's data?</div>
    <a class="btn" href="https://4philly.net/">Search any Philadelphia address live</a>
  </div>

${sections}

  <p class="foot"><a href="/">4philly.net home</a> · <a href="/blog/">Guides &amp; articles</a> · <a href="/privacy.html">Privacy Policy</a></p>
</div>
</body>
</html>
`;
}

// ---- 4. sitemap block rewrite
async function updateSitemap(props) {
  const BEGIN = "<!-- BEGIN generated: property pages (tools/generate-property-pages.mjs) -->";
  const END = "<!-- END generated: property pages -->";
  const xml = await readFile(SITEMAP, "utf8");
  const start = xml.indexOf(BEGIN), end = xml.indexOf(END);
  if (start === -1 || end === -1) throw new Error("sitemap.xml is missing the generated-block markers");
  // Property snapshot pages carry <meta name="robots" content="noindex,follow">,
  // so they are deliberately kept OUT of the sitemap — a sitemap should list only
  // pages intended for indexing. The block is left empty but the markers remain
  // so this function keeps working on future runs.
  void props;
  const next = xml.slice(0, start + BEGIN.length) + "\n  " + xml.slice(end);
  await writeFile(SITEMAP, next);
}

// ---- main
console.log(`Snapshot date: ${SNAPSHOT_DATE}`);
console.log("Selecting candidates (active rental license, per ZIP)...");
const selected = await selectCandidates();
if (selected.length === 0) throw new Error("No candidates selected — aborting");

const opas = selected.map((p) => p.opa);
console.log("Fetching license details...");
const licenses = await fetchLicenses(opas);
console.log("Fetching open violations...");
const violations = await fetchViolations(opas);

console.log("Fetching 311 counts (per address)...");
const props = [];
for (const p of selected) {
  const count311 = await fetch311Count(p.address);
  props.push({ ...p, license: licenses.get(p.opa) ?? null, violations: violations.get(p.opa) ?? [], count311 });
  if (props.length % 25 === 0) console.log(`  ${props.length}/${selected.length}`);
  await sleep(DELAY_MS);
}

// Every selected property was chosen for holding an Active license; if the
// detail query no longer agrees, the data moved under us — fail rather than
// publish a page claiming a license we can't show.
const missingLic = props.filter((p) => !p.license);
if (missingLic.length > props.length * 0.1) {
  throw new Error(`${missingLic.length} selected properties lost their Active license between queries — data inconsistency, aborting`);
}
const final = props.filter((p) => p.license);

console.log(`Writing ${final.length} pages to p/ ...`);
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
for (const p of final) await writeFile(path.join(OUT_DIR, `${p.opa}.html`), propertyPage(p));
await writeFile(path.join(OUT_DIR, "index.html"), hubPage(final));
await updateSitemap(final);
console.log(`Done: ${final.length} property pages + hub written; sitemap.xml updated.`);
