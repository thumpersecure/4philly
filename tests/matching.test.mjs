import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asDateMs, dateKey, haversineM,
  normalizeAddr, addrLooksSame, scoreAddressMatch, houseNumsMatch,
  compareLicenseField, ADDR_ABBR,
  buildViolationDist, normStatus, statusHistogram,
  mergeCartoOnlyLicenses
} from '../lib/matching.mjs';

// ---------------------------------------------------------------------------
// Dates: the core "match when they don't match" / "drift when they don't drift"
// regressions caused by Eclipse epoch-ms vs Carto ISO strings.
// ---------------------------------------------------------------------------

test('dateKey: the same record matches across Eclipse epoch-ms and Carto timestamptz', () => {
  // Eclipse epoch-ms carries Eastern wall-clock time re-labeled as UTC; Carto
  // strings are the true instant (timestamptz), 4-5h later. The same record's
  // two representations must produce the same key.
  const eclipseMs = Date.UTC(2023, 4, 1); // wall time 2023-05-01 00:00
  assert.equal(dateKey(eclipseMs), '2023-05-01');
  assert.equal(dateKey('2023-05-01T04:00:00Z'), '2023-05-01'); // true instant (EDT, +4h)
  assert.equal(dateKey('2023-05-01'), '2023-05-01');           // date-only passthrough
  assert.equal(dateKey(eclipseMs), dateKey('2023-05-01T04:00:00Z'));
  assert.equal(dateKey(eclipseMs), dateKey('2023-05-01'));
});

test('dateKey: live regression — evening license timestamp is one day, not DRIFT', () => {
  // Verified against both live APIs (business license 950248): Eclipse
  // 1777415716000 (= 2026-04-28T22:35:16 wall time labeled Z) vs Carto
  // '2026-04-29T02:35:16Z'. UTC-only keying split these across two days and
  // rendered a false DRIFT pill for ~1.3% of license dates.
  assert.equal(dateKey(1777415716000), '2026-04-28');
  assert.equal(dateKey('2026-04-29T02:35:16Z'), '2026-04-28');
  assert.equal(dateKey(1777415716000), dateKey('2026-04-29T02:35:16Z'));
});

test('dateKey: genuinely different days do NOT collapse to a false match', () => {
  const apr30 = Date.UTC(2023, 3, 30);
  assert.equal(dateKey(apr30), '2023-04-30');
  assert.notEqual(dateKey(apr30), dateKey('2023-05-01T12:00:00Z'));
});

test('dateKey: missing/invalid -> null (two bad dates are not a match)', () => {
  assert.equal(dateKey(null), null);
  assert.equal(dateKey(''), null);
  assert.equal(dateKey('not-a-date'), null);
  assert.equal(asDateMs('garbage'), null);
});

// ---------------------------------------------------------------------------
// License field comparison
// ---------------------------------------------------------------------------

test('compareLicenseField: date fields match across number vs ISO string', () => {
  // Same record as stored by each source: Eclipse wall-time-as-UTC number,
  // Carto true instant (EST, +5h in January).
  const ms = Date.UTC(2024, 0, 15);
  const r = compareLicenseField(ms, '2024-01-15T05:00:00Z', { isDate: true });
  assert.equal(r.status, 'match');
});

test('compareLicenseField: raw status drift is flagged (Eclipse Inactive vs lagging Carto Active)', () => {
  const r = compareLicenseField('Inactive', 'Active', {});
  assert.equal(r.status, 'drift');
  assert.equal(r.same, false);
});

test('compareLicenseField: same raw status (any case) matches', () => {
  const r = compareLicenseField('Active', 'ACTIVE', {});
  assert.equal(r.status, 'match');
});

test('compareLicenseField: units compared numerically (163 vs "163.0" is a match)', () => {
  const r = compareLicenseField(163, '163.0', { isUnits: true });
  assert.equal(r.status, 'match');
});

test('compareLicenseField: differing units drift', () => {
  const r = compareLicenseField(2, '3', { isUnits: true });
  assert.equal(r.status, 'drift');
});

test('compareLicenseField: one side absent -> ABSENT, not match', () => {
  const r = compareLicenseField('RENTAL', null, {});
  assert.equal(r.status, 'absent');
});

test('compareLicenseField: both records present but field empty on both -> agree (match)', () => {
  const r = compareLicenseField('', '', { hasE: true, hasC: true });
  assert.equal(r.status, 'match');
});

test('compareLicenseField: field empty because a whole record is missing -> neutral, not match', () => {
  const r = compareLicenseField('', '', { hasE: true, hasC: false });
  assert.equal(r.status, 'neutral');
  assert.equal(r.same, false);
});

// ---------------------------------------------------------------------------
// Violation distribution / TOTAL logic
// ---------------------------------------------------------------------------

test('buildViolationDist: case/whitespace variants bucket together (no false OTHER match)', () => {
  const { eDist, cDist } = buildViolationDist(
    [{ violationstatus: 'open' }, { violationstatus: 'OPEN ' }],
    [{ violationstatus: 'OPEN', ct: '2' }]
  );
  assert.equal(eDist.OPEN, 2);
  assert.equal(cDist.OPEN, 2);
  assert.equal(eDist.OTHER, 0);
  assert.equal(cDist.OTHER, 0);
});

test('buildViolationDist: equal totals but redistributed statuses is NOT a TOTAL match', () => {
  const eAll = [
    ...Array(80).fill({ violationstatus: 'OPEN' }),
    ...Array(20).fill({ violationstatus: 'CLOSED' })
  ];
  const cartoDist = [
    { violationstatus: 'OPEN', ct: '60' },
    { violationstatus: 'CLOSED', ct: '40' }
  ];
  const r = buildViolationDist(eAll, cartoDist);
  assert.equal(r.eTotal, 100);
  assert.equal(r.cTotal, 100);
  assert.equal(r.totalMatch, false);
});

test('buildViolationDist: identical distributions DO match', () => {
  const eAll = [
    ...Array(5).fill({ violationstatus: 'OPEN' }),
    ...Array(3).fill({ violationstatus: 'COMPLIED' })
  ];
  const cartoDist = [
    { violationstatus: 'OPEN', ct: '5' },
    { violationstatus: 'COMPLIED', ct: '3' }
  ];
  const r = buildViolationDist(eAll, cartoDist);
  assert.equal(r.totalMatch, true);
});

test('buildViolationDist: Eclipse truncation forces non-match', () => {
  const eAll = Array(2000).fill({ violationstatus: 'OPEN' });
  const cartoDist = [{ violationstatus: 'OPEN', ct: '2000' }];
  const r = buildViolationDist(eAll, cartoDist);
  assert.equal(r.eTruncated, true);
  assert.equal(r.totalMatch, false);
});

test('buildViolationDist: explicit eTruncated flag catches sub-2000 server caps', () => {
  // Server maxRecordCount = 1000: exactly 1000 rows returned but MORE exist.
  // The length heuristic (>=2000) would miss this; the real flag must not.
  const eAll = Array(1000).fill({ violationstatus: 'OPEN' });
  const cartoDist = [{ violationstatus: 'OPEN', ct: '1000' }];
  assert.equal(buildViolationDist(eAll, cartoDist).totalMatch, true, 'heuristic alone sees a false match');
  const r = buildViolationDist(eAll, cartoDist, { eTruncated: true });
  assert.equal(r.eTruncated, true);
  assert.equal(r.totalMatch, false);
});

test('buildViolationDist: a complete >2000-row page is NOT falsely truncated when flag says so', () => {
  const eAll = Array(3000).fill({ violationstatus: 'OPEN' });
  const cartoDist = [{ violationstatus: 'OPEN', ct: '3000' }];
  const r = buildViolationDist(eAll, cartoDist, { eTruncated: false });
  assert.equal(r.eTruncated, false);
  assert.equal(r.totalMatch, true);
});

test('statusHistogram: case/whitespace variants bucket to the real status, not OTHER', () => {
  const h = statusHistogram([
    { violationstatus: 'complied' },
    { violationstatus: 'COMPLIED ' },
    { violationstatus: ' open' },
    { violationstatus: null },
    { violationstatus: 'WEIRD' }
  ]);
  assert.equal(h.COMPLIED, 2);
  assert.equal(h.OPEN, 1);
  assert.equal(h.OTHER, 2); // null + unknown "WEIRD"
});

test('normStatus normalizes case and whitespace', () => {
  assert.equal(normStatus(' open '), 'OPEN');
  assert.equal(normStatus(null), '');
});

// ---------------------------------------------------------------------------
// Geo + address
// ---------------------------------------------------------------------------

test('haversineM: ~111m per 0.001 deg latitude', () => {
  const d = haversineM(39.95, -75.16, 39.951, -75.16);
  assert.ok(Math.abs(d - 111) < 3, `expected ~111m, got ${d}`);
});

test('haversineM: adjacent rowhouse-scale distance is small', () => {
  const d = haversineM(39.95, -75.16, 39.95005, -75.16005);
  assert.ok(d < 30, `expected <30m, got ${d}`);
});

test('normalizeAddr strips unit tokens and punctuation', () => {
  assert.equal(normalizeAddr('1234 Market St., Apt 5B'), '1234 MARKET ST');
});

test('normalizeAddr tolerates null/undefined', () => {
  assert.equal(normalizeAddr(null), '');
  assert.equal(normalizeAddr(undefined), '');
});

test('ADDR_ABBR is one-way (spelled-out -> abbreviation only)', () => {
  assert.equal(ADDR_ABBR.STREET, 'ST');
  assert.equal(ADDR_ABBR.NORTH, 'N');
  // Reverse mappings must NOT exist: N->NORTH would turn a mixed input like
  // "1500 N Broad Street" into "%1500%NORTH%BROAD%ST%", which matches no OPA
  // record (OPA stores "N"), so the lookup returned nothing.
  assert.equal(ADDR_ABBR.ST, undefined);
  assert.equal(ADDR_ABBR.N, undefined);
});

test('addrLooksSame: same address with suffix variants matches', () => {
  assert.equal(addrLooksSame('123 N Main St', '123 N Main Street'), true);
});

test('addrLooksSame: different house number does not match', () => {
  assert.equal(addrLooksSame('123 Main St', '456 Main St'), false);
});

test('addrLooksSame: same number different street does not match', () => {
  assert.equal(addrLooksSame('123 Main St', '123 Walnut St'), false);
});

// Directional-aware matching: N/S/E/W are distinct streets in Philadelphia's
// grid. A saved "123 N Main St" must NOT be treated as the same property as a
// re-numbered "123 S Main St" during stale-OPA re-resolution.
test('addrLooksSame: conflicting directional (N vs S) does NOT match', () => {
  assert.equal(addrLooksSame('123 N Main St', '123 S Main St'), false);
  assert.equal(addrLooksSame('123 E 12th St', '123 W 12th St'), false);
});

test('addrLooksSame: matching directional (abbrev vs spelled) still matches', () => {
  assert.equal(addrLooksSame('123 N Main St', '123 North Main Street'), true);
});

test('addrLooksSame: one side omitting the directional is tolerated', () => {
  assert.equal(addrLooksSame('123 Main St', '123 N Main St'), true);
});

// ---------------------------------------------------------------------------
// Address relevance scoring (drives auto-select vs confirm)
// ---------------------------------------------------------------------------

test('scoreAddressMatch: exact full address scores high (auto-select threshold)', () => {
  assert.ok(scoreAddressMatch('315 N 12th St', '315 N 12TH ST') >= 0.9);
});

test('scoreAddressMatch: house-number mismatch is a hard reject (0)', () => {
  assert.equal(scoreAddressMatch('12 Main St', '1234 MAIN ST'), 0);
});

test('scoreAddressMatch: same number different street stays below auto-select', () => {
  assert.ok(scoreAddressMatch('123 Main St', '123 WALNUT ST') < 0.9);
});

test('scoreAddressMatch: wrong directional is penalized below auto-select', () => {
  assert.ok(scoreAddressMatch('123 N Main St', '123 S MAIN ST') < 0.9);
});

test('scoreAddressMatch: conflicting directional is a hard reject (0), never auto-selects', () => {
  assert.equal(scoreAddressMatch('123 N Main St', '123 S MAIN ST'), 0);
  assert.equal(scoreAddressMatch('123 E 12th St', '123 W 12TH ST'), 0);
});

test('scoreAddressMatch: candidate omitting the directional still scores (not rejected)', () => {
  // Input has "N", candidate omits it: no directional credit, but no rejection.
  assert.ok(scoreAddressMatch('123 N Main St', '123 MAIN ST') > 0);
});

test('scoreAddressMatch: matching directional with full name scores high', () => {
  assert.ok(scoreAddressMatch('123 North Main St', '123 N MAIN ST') >= 0.9);
});

// ---- Philadelphia hyphenated range addresses (e.g. "315-23 N 12TH ST") ----

test('houseNumsMatch: base number matches its range and vice versa', () => {
  assert.ok(houseNumsMatch('315', '315-23'));
  assert.ok(houseNumsMatch('315-23', '315'));
  assert.ok(houseNumsMatch('315-23', '315-23'));
});

test('houseNumsMatch: number inside the range matches, outside does not', () => {
  assert.ok(houseNumsMatch('319', '315-23'));   // 319 is within 315..323
  assert.ok(!houseNumsMatch('400', '315-23'));  // 400 is outside
  assert.ok(!houseNumsMatch('310', '315-23'));  // 310 is below the range
});

test('houseNumsMatch: opposite side of the street (parity) never matches', () => {
  assert.ok(!houseNumsMatch('315', '314-22'));  // odd vs even range
  assert.ok(!houseNumsMatch('314-22', '315'));
  assert.ok(houseNumsMatch('316', '314-22'));
  assert.ok(scoreAddressMatch('315 N 12th', '314-22 N 12TH ST') === 0);
});

test('addrLooksSame: typed base number matches ranged OPA parcel', () => {
  assert.ok(addrLooksSame('315 N 12th St', '315-23 N 12TH ST'));
  assert.ok(addrLooksSame('315-23 N 12th St', '315 N 12th St'));
});

test('scoreAddressMatch: ranged parcel auto-selects for the base number', () => {
  assert.ok(scoreAddressMatch('315 N 12th', '315-23 N 12TH ST') >= 0.9);
  assert.ok(scoreAddressMatch('315-23 N 12th St', '315 N 12TH ST') >= 0.9);
});

test('scoreAddressMatch: number INSIDE a range still auto-selects', () => {
  // "319" is inside the 315..323 parcel (same odd side) — a real match (the
  // hundred-block fallback depends on this), scoring just under an exact-base match.
  assert.ok(scoreAddressMatch('319 N 12th St', '315-23 N 12TH ST') >= 0.9);
  // "318" is within the numeric span but on the even (opposite) side: no match.
  assert.equal(scoreAddressMatch('318 N 12th St', '315-23 N 12TH ST'), 0);
});

test('scoreAddressMatch: exact parcel out-ranks a neighboring range that contains the number', () => {
  const exact = scoreAddressMatch('315 N 12th St', '315 N 12TH ST');
  const containing = scoreAddressMatch('315 N 12th St', '313-17 N 12TH ST'); // contains 315
  assert.ok(containing > 0.9, 'containing range must still auto-select');
  assert.ok(exact > containing, 'exact house number must sort above the range parcel');
});

test('range fix does not weaken wrong-number / wrong-street rejection', () => {
  assert.equal(scoreAddressMatch('12 Main St', '1234 Main St'), 0);
  assert.ok(!addrLooksSame('315 N 12th St', '400-10 N 12th St')); // ranges disjoint
});

// ---------------------------------------------------------------------------
// License cross-reference: Eclipse can omit licenses that Carto still has
// (Rental 602204 at OPA 881519440), which made 4PHILLY say "none on file".
// ---------------------------------------------------------------------------

test('mergeCartoOnlyLicenses: appends Carto rows Eclipse lacks, tagged, without touching Eclipse rows', () => {
  const e = [{ licensenum: '783153', licensetype: 'Food', licensestatus: 'Active' }];
  const c = [
    { licensenum: '783153', licensetype: 'Food', licensestatus: 'Inactive' }, // in both: Eclipse wins
    { licensenum: '602204', licensetype: 'Rental', licensestatus: 'Active' }, // Carto only
    { licensenum: ' 602204 ', licensetype: 'Rental', licensestatus: 'Active' }, // dup of the above
    { licensetype: 'Rental' } // no number: cannot pair, skipped
  ];
  const out = mergeCartoOnlyLicenses(e, c);
  assert.equal(out.length, 2);
  assert.equal(out[0], e[0]);
  assert.equal(out[0].licensestatus, 'Active');
  assert.equal(out[0]._cartoOnly, undefined);
  assert.equal(out[1].licensenum, '602204');
  assert.equal(out[1]._cartoOnly, true);
});

test('mergeCartoOnlyLicenses: tolerates empty or non-array inputs', () => {
  assert.deepEqual(mergeCartoOnlyLicenses(null, undefined), []);
  assert.equal(mergeCartoOnlyLicenses([], [{ licensenum: '1' }]).length, 1);
  assert.equal(mergeCartoOnlyLicenses([{ licensenum: '1' }], []).length, 1);
});
