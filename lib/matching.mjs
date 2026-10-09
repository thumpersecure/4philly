// Pure matching/comparison helpers for 4PHILLY.
//
// These mirror the inline implementations in index.html (which is a deliberately
// single-file PWA and therefore cannot import this module at runtime). They exist
// so the drift/date/address/proximity logic that decides whether two records
// "match" can be unit-tested in isolation. When you change the corresponding
// logic in index.html, keep this module in sync — tests/matching.test.mjs guards
// the behavior that previously produced false "match" results.

// ---- Dates ----

// Eclipse returns epoch-ms numbers; Carto returns date strings.
export function asDateMs(value) {
  if (value == null || value === '') return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const PHILLY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Canonical calendar-day key for cross-source comparison. The two sources
// encode the SAME underlying timestamp differently: Eclipse epoch-ms numbers
// carry Eastern wall-clock time re-labeled as UTC, while Carto ISO strings are
// the true instant (Postgres timestamptz) — e.g. license 950248 is
// 1777415716000 (= 2026-04-28T22:35:16 "Z") in Eclipse and
// '2026-04-29T02:35:16Z' in Carto. Keying both by the UTC day split every
// Eastern-evening timestamp across two days and flagged false DRIFT. So:
// numbers keep the UTC day, ISO timestamp strings are keyed by the
// Philadelphia calendar day, and date-only strings pass through unchanged.
// Returns null for missing or unparseable values (so two invalid dates are
// NOT a false "match").
export function dateKey(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    const parts = PHILLY_DATE_FORMAT.formatToParts(d);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  }
  const ms = asDateMs(value);
  if (ms === null) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---- Geo ----

// Great-circle distance in meters. Used instead of Math.hypot on raw lat/lng,
// which mis-weights longitude vs latitude at Philadelphia's latitude.
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---- Address ----

// One-way: spelled-out -> the abbreviated form OPA's `location` field uses
// ("1500 N BROAD ST"). Must NOT be bidirectional — mapping N->NORTH would turn
// a mixed input like "1500 N Broad Street" into "%1500%NORTH%BROAD%ST%", which
// matches no record (OPA stores "N"), so the lookup returned nothing.
export const ADDR_ABBR = {
  STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', BOULEVARD: 'BLVD',
  DRIVE: 'DR', COURT: 'CT', LANE: 'LN', PLACE: 'PL',
  TERRACE: 'TER', PARKWAY: 'PKWY', SQUARE: 'SQ', CIRCLE: 'CIR',
  HIGHWAY: 'HWY', PLAZA: 'PLZ', ALLEY: 'ALY', PIKE: 'PIKE',
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W'
};

export function normalizeAddr(raw) {
  return String(raw || '').trim().toUpperCase()
    .replace(/[.,#%_]/g, '')
    .replace(/\b(APT|UNIT|STE|SUITE|FL|FLOOR|RM|ROOM)\b\s*\w*/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Tokens that are street suffixes or directionals rather than the street name.
const SUFFIX_DIR_TOKENS = new Set([
  'ST', 'STREET', 'AVE', 'AVENUE', 'RD', 'ROAD', 'BLVD', 'BOULEVARD',
  'DR', 'DRIVE', 'CT', 'COURT', 'LN', 'LANE', 'PL', 'PLACE',
  'N', 'S', 'E', 'W', 'NORTH', 'SOUTH', 'EAST', 'WEST'
]);

// Philadelphia stores many parcels as a hyphenated range, e.g. "315-23 N 12TH ST"
// meaning the block 315 through 323. A renter almost always types just the base
// number ("315 N 12th"), so a range token and its base (or any number falling
// inside the range) should be treated as the same house number. Returns true when
// the two leading house-number tokens refer to the same parcel.
export function houseNumsMatch(a, b) {
  if (a === b) return true;
  // Parse a token into a numeric range [lo, hi]. "315-23" → [315, 323];
  // "315" → [315, 315]. The high side of a Philly range shares the leading
  // digits of the low side ("315-23" is 315..323, not 315..23).
  const toRange = t => {
    const m = /^(\d+)(?:-(\d+))?[A-Z]?$/.exec(t || '');
    if (!m) return null;
    const lo = parseInt(m[1], 10);
    if (m[2] == null) return [lo, lo];
    let hiStr = m[2];
    // Expand the abbreviated high end using the low end's leading digits:
    // 315-23 → hi "23" becomes "323"; 1200-4 → "1204".
    if (hiStr.length < m[1].length) hiStr = m[1].slice(0, m[1].length - hiStr.length) + hiStr;
    return [lo, Math.max(lo, parseInt(hiStr, 10))];
  };
  const ra = toRange(a), rb = toRange(b);
  if (!ra || !rb) return false;
  // Odd and even numbers are opposite sides of the street, so a range only
  // covers numbers of its own parity ("314-22" never contains 315).
  if (ra[0] % 2 !== rb[0] % 2) return false;
  // Same parcel if the ranges overlap (covers base-vs-range and range-vs-range).
  return ra[0] <= rb[1] && rb[0] <= ra[1];
}

// Conservative same-property check: the house number must match AND the addresses
// must share at least one actual street-name token (suffix/directional tokens like
// ST or N don't count, so "123 Main St" does NOT match "123 Walnut St").
export function addrLooksSame(a, b) {
  const na = normalizeAddr(a || ''), nb = normalizeAddr(b || '');
  if (!na || !nb) return false;
  const ta = na.split(' ').filter(Boolean), tb = nb.split(' ').filter(Boolean);
  if (!ta.length || !tb.length || !houseNumsMatch(ta[0], tb[0])) return false;
  // A contradicting directional means a different street: in Philadelphia's grid
  // "N 12TH ST" and "S 12TH ST" (or "E"/"W" pairs) are entirely distinct streets
  // that share a house number and a name token. If BOTH addresses carry a
  // directional and they disagree, they are NOT the same property. (One side
  // omitting the directional is tolerated — it may just be abbreviated away.)
  const dirA = new Set(ta.filter(t => DIR_CANON[t]).map(t => DIR_CANON[t]));
  const dirB = new Set(tb.filter(t => DIR_CANON[t]).map(t => DIR_CANON[t]));
  if (dirA.size && dirB.size && ![...dirA].some(d => dirB.has(d))) return false;
  const nameA = ta.slice(1).filter(t => !SUFFIX_DIR_TOKENS.has(t));
  const nameB = new Set(tb.slice(1).filter(t => !SUFFIX_DIR_TOKENS.has(t)));
  if (!nameA.length || !nameB.size) return false;
  return nameA.some(t => nameB.has(t));
}

// Directional tokens canonicalized to a single form for comparison.
export const DIR_CANON = { N: 'N', NORTH: 'N', S: 'S', SOUTH: 'S', E: 'E', EAST: 'E', W: 'W', WEST: 'W' };

// Score how well a candidate OPA location matches the typed address (0..1). A
// typed house number that disagrees with the candidate leading number is a hard
// reject (returns 0) so "12 Main St" cannot match "1234 Main St".
export function scoreAddressMatch(input, loc) {
  const dropSD = t => !SUFFIX_DIR_TOKENS.has(t);
  const ti = normalizeAddr(input).split(' ').filter(Boolean);
  const tl = normalizeAddr(loc).split(' ').filter(Boolean);
  if (!ti.length || !tl.length) return 0;
  // Leading token is a house number if it's digits, an optional trailing letter,
  // or a Philadelphia hyphenated range ("315-23"). houseNumsMatch handles ranges.
  const isHouseNum = t => /^\d+(?:-\d+)?[A-Z]?$/.test(t);
  const inNum = isHouseNum(ti[0]) ? ti[0] : null;
  const locNum = isHouseNum(tl[0]) ? tl[0] : null;
  let score = 0;
  if (inNum) {
    if (locNum && houseNumsMatch(inNum, locNum)) {
      // Same base number = exact; a range that merely CONTAINS the typed number
      // scores slightly under exact so the true parcel out-ranks a neighboring
      // range parcel, while still clearing the 0.9 auto-select bar.
      score += parseInt(inNum, 10) === parseInt(locNum, 10) ? 0.5 : 0.45;
    } else return 0;
  }
  const nameI = ti.slice(inNum ? 1 : 0).filter(dropSD);
  const setL = new Set(tl.slice(locNum ? 1 : 0).filter(dropSD));
  if (nameI.length) score += 0.3 * (nameI.filter(t => setL.has(t)).length / nameI.length);
  else score += 0.3;
  const dirI = ti.filter(t => DIR_CANON[t]).map(t => DIR_CANON[t]);
  const dirL = new Set(tl.filter(t => DIR_CANON[t]).map(t => DIR_CANON[t]));
  if (dirI.length) {
    if (dirL.size) {
      // Both sides name a directional. Agreement earns the directional weight; a
      // conflict ("N" vs "S") is a different street entirely — hard reject so a
      // wrong-quadrant parcel can never out-rank or auto-select.
      if (dirI.every(d => dirL.has(d))) score += 0.2;
      else return 0;
    }
    // Candidate omits the directional: no credit, but not a rejection.
  } else score += 0.2;
  return Math.min(1, score);
}

// ---- License drift field comparison ----

// Compare a single license field between Eclipse (eRaw) and Carto (cRaw).
// Returns { status: 'match'|'drift'|'absent'|'neutral', same:boolean }.
export function compareLicenseField(eRaw, cRaw, { isDate = false, isUnits = false, hasE = true, hasC = true } = {}) {
  let eKey, cKey;
  if (isDate) {
    eKey = hasE ? dateKey(eRaw) : null;
    cKey = hasC ? dateKey(cRaw) : null;
  } else if (isUnits) {
    const en = (eRaw == null || eRaw === '') ? null : Number(eRaw);
    const cn = (cRaw == null || cRaw === '') ? null : Number(cRaw);
    eKey = (en == null || Number.isNaN(en)) ? null : String(en);
    cKey = (cn == null || Number.isNaN(cn)) ? null : String(cn);
    if (!hasE) eKey = null;
    if (!hasC) cKey = null;
  } else {
    eKey = (!hasE || eRaw == null || String(eRaw).trim() === '') ? null : String(eRaw).trim().toUpperCase();
    cKey = (!hasC || cRaw == null || String(cRaw).trim() === '') ? null : String(cRaw).trim().toUpperCase();
  }
  const bothPresent = hasE && hasC;
  const eAbsent = eKey === null, cAbsent = cKey === null;
  if (eAbsent && cAbsent) {
    return { status: bothPresent ? 'match' : 'neutral', same: bothPresent };
  }
  if (eAbsent !== cAbsent) {
    return { status: 'absent', same: false };
  }
  const same = eKey === cKey;
  return { status: same ? 'match' : 'drift', same };
}

// ---- Violation drift distribution ----

export const KNOWN_VIOLATION_STATUSES = [
  'OPEN', 'COMPLIED', 'COMPEXCP', 'CMPLY', 'CLOSED', 'CLOSEDCASE', 'RESOLVE',
  'DEMOLISH', 'SVN ISSUED', 'CVN ISSUED', 'WARNING ISSUED', 'STOP WORK', 'ERROR'
];

export function normStatus(s) {
  return String(s == null ? '' : s).trim().toUpperCase();
}

// Bucket a single source's violation rows into a canonical status histogram,
// normalizing case/whitespace so "open", "OPEN " and "OPEN" all count as OPEN
// (and, critically, so "Complied" is counted as real compliance rather than
// silently dropped into OTHER). Unknown/null statuses fall into OTHER.
export function statusHistogram(rows, knownStatuses = KNOWN_VIOLATION_STATUSES) {
  rows = Array.isArray(rows) ? rows : [];
  const dist = { OTHER: 0 };
  knownStatuses.forEach(s => dist[s] = 0);
  rows.forEach(v => {
    const s = normStatus(v && v.violationstatus);
    if (s && dist[s] !== undefined) dist[s]++; else dist.OTHER++;
  });
  return dist;
}

// eAll: array of Eclipse violation rows (each with .violationstatus)
// cartoDist: array of Carto rows ({ violationstatus, ct })
// opts.eTruncated: pass the REAL server truncation flag (exceededTransferLimit)
//   when known. Defaults to the legacy length heuristic, which is only correct
//   when the server's maxRecordCount is exactly 2000 — pass the flag explicitly
//   when the service caps lower (e.g. 1000) so a truncated page can't be read as
//   a complete, matching count.
export function buildViolationDist(eAll, cartoDist, opts = {}) {
  eAll = Array.isArray(eAll) ? eAll : [];
  cartoDist = Array.isArray(cartoDist) ? cartoDist : [];
  const eDist = statusHistogram(eAll);
  const cDist = { OTHER: 0 }; KNOWN_VIOLATION_STATUSES.forEach(s => cDist[s] = 0);
  cartoDist.forEach(r => { const s = normStatus(r.violationstatus); const n = Number(r.ct) || 0; if (s && cDist[s] !== undefined) cDist[s] += n; else cDist.OTHER += n; });
  const eTotal = Object.values(eDist).reduce((a, b) => a + b, 0);
  const cTotal = Object.values(cDist).reduce((a, b) => a + b, 0);
  const eTruncated = opts.eTruncated !== undefined
    ? !!opts.eTruncated
    : (eAll.length >= 2000 || !!eAll._truncated);
  const allBuckets = [...KNOWN_VIOLATION_STATUSES, 'OTHER'];
  const totalMatch = eTotal === cTotal && !eTruncated && allBuckets.every(s => eDist[s] === cDist[s]);
  return { eDist, cDist, eTotal, cTotal, eTruncated, totalMatch };
}

// ---- License cross-reference ----

// Eclipse (the live L&I feed) can silently omit license rows that the Carto
// open-data mirror still has (e.g. OPA 881519440: Rental 602204 is in Carto
// but absent from Eclipse and from L&I's own property-history list). Append
// every Carto row whose license number Eclipse does not return, tagged
// `_cartoOnly`, so a real license is not reported as "none on file". Eclipse
// rows are never replaced or altered — Eclipse stays authoritative wherever
// both sources have the license. Carto rows with no license number cannot be
// paired and are skipped.
export function mergeCartoOnlyLicenses(eRows, cRows) {
  const e = (Array.isArray(eRows) ? eRows : []).filter(Boolean);
  const seen = new Set(e.map(r => String(r.licensenum || '').trim().toUpperCase()).filter(Boolean));
  const extra = [];
  for (const r of Array.isArray(cRows) ? cRows : []) {
    const num = String(r?.licensenum || '').trim().toUpperCase();
    if (!num || seen.has(num)) continue;
    seen.add(num);
    extra.push({ ...r, _cartoOnly: true });
  }
  return e.concat(extra);
}
