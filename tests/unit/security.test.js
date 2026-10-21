'use strict';
/*
 * Security regression tests for SEC-01 / SEC-02 / SEC-04 / SEC-11 (docs/07_SECURITY_AND_RISKS.md).
 * The Google services each path touches are stubbed per test by reassigning globals on the vm
 * context — server functions resolve them at call time, so a test can swap them freely.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGas } = require('../helpers/loadGas');

const SRC = path.join(__dirname, '..', '..', 'src');
const OWNER = 'owner@example.org';

function withCaller(g, { active = '', ui = false, triggers = [], props = {} } = {}) {
  g.Session = { getActiveUser: () => ({ getEmail: () => active }), getEffectiveUser: () => ({ getEmail: () => OWNER }), getScriptTimeZone: () => 'Asia/Kolkata' };
  g.SpreadsheetApp = { getUi: () => { if (!ui) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return {}; } };
  g.ScriptApp = { getProjectTriggers: () => triggers.map((id) => ({ getUniqueId: () => id })) };
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
}

test('SEC-01: requireOwnerOrSheetUi_ rejects an anonymous web caller', () => {
  const g = loadGas();
  withCaller(g, { active: '' });
  assert.throws(() => g.requireOwnerOrSheetUi_(), /only available from the spreadsheet menu/);
});

test('SEC-01: requireOwnerOrSheetUi_ rejects a signed-in non-owner in the web app', () => {
  const g = loadGas();
  withCaller(g, { active: 'someone@example.org' });
  assert.throws(() => g.requireOwnerOrSheetUi_());
});

test('SEC-01: requireOwnerOrSheetUi_ allows the spreadsheet menu and the owner', () => {
  const g = loadGas();
  withCaller(g, { active: 'editor@example.org', ui: true });
  assert.doesNotThrow(() => g.requireOwnerOrSheetUi_());
  withCaller(g, { active: OWNER.toUpperCase() });
  assert.doesNotThrow(() => g.requireOwnerOrSheetUi_());
});

test('SEC-01: guarded setters refuse anonymous callers before touching anything', () => {
  const g = loadGas();
  withCaller(g, { active: '' });
  let wrote = false;
  g.PropertiesService = { getScriptProperties: () => ({ setProperty: () => { wrote = true; }, getProperty: () => null }) };
  assert.throws(() => g.setPublicMetricsKey('x'.repeat(32)));
  assert.equal(wrote, false);
  assert.throws(() => g.recalculateAllNextFollowUps());
  assert.throws(() => g.stopMetaLeadsImportTrigger());
});

test('SEC-01: sendDailyDigest only runs for a real project trigger, the owner or the menu', () => {
  const g = loadGas();
  withCaller(g, { active: '', triggers: ['trig-123'] });
  assert.equal(g.isProjectTrigger_({ triggerUid: 'trig-123' }), true);
  assert.equal(g.isProjectTrigger_({ triggerUid: 'forged' }), false);
  assert.equal(g.isProjectTrigger_(undefined), false);
  assert.throws(() => g.sendDailyDigest({ triggerUid: 'forged' }), /only available/);
});

test('SEC-02: PIN login is off once users exist unless ALLOW_PIN_LOGIN=YES', () => {
  const g = loadGas();
  g.adminPin_ = () => '0000';
  g.anyUsersConfigured_ = () => true;
  withCaller(g, { props: {} });
  assert.equal(g.pinLoginEnabled_(), false);
  const res = g.checkPin('0000');
  assert.equal(res.ok, false, 'correct PIN is still refused while PIN login is off');
  withCaller(g, { props: { ALLOW_PIN_LOGIN: 'yes' } });
  assert.equal(g.pinLoginEnabled_(), true);
  g.anyUsersConfigured_ = () => false;
  withCaller(g, { props: {} });
  assert.equal(g.pinLoginEnabled_(), true, 'no users yet: the PIN is the only way in');
  g.adminPin_ = () => '';
  assert.equal(g.pinLoginEnabled_(), false);
  g.anyUsersConfigured_ = () => true;
  assert.equal(g.checkPin('').ok, false, 'blank ADMIN_PIN must not grant an admin session');
});

test('SEC-02: no default PIN is seeded anywhere in source', () => {
  const code = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  assert.doesNotMatch(code, /setProperty\('ADMIN_PIN',\s*'/);
  assert.doesNotMatch(code, /migrateAdminPinToProperties_/);
});

test('SEC-04: analysis share key comes from Script Properties and fails closed', () => {
  const g = loadGas();
  withCaller(g, { props: {} });
  assert.equal(g.analysisKeyOk_('anything'), false, 'unset property rejects every key');
  withCaller(g, { props: { ANALYSIS_SHARE_KEY: 'k'.repeat(20) } });
  assert.equal(g.analysisKeyOk_('k'.repeat(20)), true);
  assert.equal(g.analysisKeyOk_('wrong'), false);
  assert.equal(g.analysisKeyOk_(''), false);
});

test('SEC-11: badge() escapes the stage text', () => {
  const html = fs.readFileSync(path.join(SRC, 'utils.js.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  const out = ctx.badge('<img src=x onerror=alert(1)>');
  assert.doesNotMatch(out, /<img/);
  assert.equal(ctx.badge('Follow-up'), '<span class="badge b-Followup">Follow-up</span>');
});
