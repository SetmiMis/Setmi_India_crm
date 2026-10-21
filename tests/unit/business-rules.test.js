'use strict';
/*
 * Characterization tests: they pin down what the CURRENT production code does, so a future change
 * that alters a business rule fails loudly instead of silently. Tests marked "KNOWN ISSUE" assert
 * today's (defective) behavior on purpose; an approved fix must update them together with
 * docs/08_BUG_REGISTER.md.
 *
 * Run with: npm test   (TZ is pinned to Asia/Kolkata, the project time zone in appsscript.json)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('../helpers/loadGas');

const g = loadGas();
const C = g.__consts;

test('pipeline stages and open stages', () => {
  assert.deepEqual(Array.from(C.STAGES), ['New', 'Quoted', 'Follow-up', 'Won', 'Lost', 'Dispatched', 'Closed']);
  assert.deepEqual(Array.from(C.OPEN_STAGES), ['New', 'Quoted', 'Follow-up']);
});

test('gradeFor_: Qty x Timeline matrix', () => {
  assert.equal(g.gradeFor_(600, 'Immediate'), 'A');
  assert.equal(g.gradeFor_(600, 'Fortnight'), 'A');
  assert.equal(g.gradeFor_(600, 'Just Exploring'), 'B');
  assert.equal(g.gradeFor_(100, 'Immediate'), 'A');
  assert.equal(g.gradeFor_(100, 'Fortnight'), 'B');
  assert.equal(g.gradeFor_(100, 'Just Exploring'), 'C');
  assert.equal(g.gradeFor_(10, 'Immediate'), 'B');
  assert.equal(g.gradeFor_(10, 'Fortnight'), 'C');
  assert.equal(g.gradeFor_(0, 'Immediate'), '', 'blank until both qty and timeline are known');
  assert.equal(g.gradeFor_(50, 'Someday'), '');
});

test('phoneKey_: last 10 digits, punctuation stripped', () => {
  assert.equal(g.phoneKey_('+91 90000 00001'), '9000000001');
  assert.equal(g.phoneKey_('09000000001'), '9000000001');
  assert.equal(g.phoneKey_(''), '');
});

test('normalizeState_ / fuzzyNormalizeState_', () => {
  assert.deepEqual({ ...g.normalizeState_('west bengal(india)') }, { iso: 'IN-WB', name: 'West Bengal' });
  assert.deepEqual({ ...g.normalizeState_('TN') }, { iso: 'IN-TN', name: 'Tamil Nadu' });
  assert.equal(g.normalizeState_('Surat'), null);
  assert.deepEqual({ ...g.fuzzyNormalizeState_('Maharshtra') }, { iso: 'IN-MH', name: 'Maharashtra' });
  assert.equal(g.fuzzyNormalizeState_('Pune'), null, 'short/unrelated names must not fuzzy-match');
});

test('follow-up scheduling: working days skip Sunday; Hot=1, Warm=2, Cold=6', () => {
  assert.equal(g.addWorkingDays_('2026-10-17', 1), '2026-10-19'); // Sat -> Mon
  assert.equal(g.computeNextFollowUp_('Hot', '2026-10-19'), '2026-10-20');
  assert.equal(g.computeNextFollowUp_('Warm', '2026-10-19'), '2026-10-21');
  assert.equal(g.computeNextFollowUp_('Cold', '2026-10-19'), '2026-10-26');
  assert.equal(g.computeNextFollowUp_('Unknown', '2026-10-19'), '2026-10-21', 'unknown priority falls back to Warm');
});

test('calculateFollowupStatus buckets', () => {
  const today = g.todayStr_();
  assert.equal(g.calculateFollowupStatus(''), 'No Follow-up');
  assert.equal(g.calculateFollowupStatus(today), 'Today');
  assert.equal(g.calculateFollowupStatus(g.addDaysStr_(today, 1)), 'Tomorrow');
  assert.equal(g.calculateFollowupStatus(g.addDaysStr_(today, 5)), 'Upcoming');
  assert.equal(g.calculateFollowupStatus(g.addDaysStr_(today, -1)), 'Overdue');
});

test('newIdFromRows_: zero-padded max+1', () => {
  const rows = [['EnqID'], ['SETMI-ENQ-0007'], ['SETMI-ENQ-0012'], ['']];
  assert.equal(g.newIdFromRows_('SETMI-ENQ-', rows, 0), 'SETMI-ENQ-0013');
});

test('KNOWN ISSUE BUG-005: newIdFromRows_ wraps to 0000 after 9999 (duplicate IDs)', () => {
  const rows = [['EnqID'], ['SETMI-ENQ-9999']];
  assert.equal(g.newIdFromRows_('SETMI-ENQ-', rows, 0), 'SETMI-ENQ-0000');
});

test('num_ / weightVal_', () => {
  assert.equal(g.num_('₹1,200.50'), 1200.5);
  assert.equal(g.num_('abc'), 0);
  assert.equal(g.weightVal_(''), '', 'blank weight stays blank, not 0');
  assert.equal(g.weightVal_('12kg'), 12);
});

test('analysisProduct_ maps free text to product labels', () => {
  assert.equal(g.analysisProduct_('metal_push_to_on_switches'), 'Metal Push Button Switches');
  assert.equal(g.analysisProduct_('GX16 aviation'), 'Circular Connectors');
  assert.equal(g.analysisProduct_('IP68 SP series'), 'Waterproof Circular Connectors');
  assert.equal(g.analysisProduct_('something else'), 'Other');
  assert.equal(g.analysisProduct_(''), 'Unknown');
});

test('password hashing: salted SHA-256 round trip', () => {
  const h = g.hashPassword_('secret1');
  assert.match(h, /^[0-9a-f-]{36}:[0-9a-f]{64}$/);
  assert.equal(g.verifyPassword_('secret1', h), true);
  assert.equal(g.verifyPassword_('wrong', h), false);
  assert.equal(g.verifyPassword_('secret1', 'garbage'), false);
});

test('rowToObj_ formats date columns and maps legacy Owner -> LeadBy', () => {
  const map = g.colMapFromRow_(['EnqID', 'EnqDate', 'Owner', 'Notes']);
  const o = g.rowToObj_(['SETMI-ENQ-0001', new Date(2026, 9, 5), 'Rep A', null], map);
  assert.equal(o.EnqDate, '2026-10-05');
  assert.equal(o.LeadBy, 'Rep A');
  assert.equal(o.Notes, '');
});
