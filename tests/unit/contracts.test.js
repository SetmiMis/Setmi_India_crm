'use strict';
/*
 * Static contract checks between the files of the Apps Script project — the things that break at
 * runtime (not at save time) when a function or HTML file is renamed:
 *   - every google.script.run.<fn>() the client calls exists as a public server function
 *   - every <?!= include('x') ?> points at an existing HTML file
 *   - every Sales FMS menu item and trigger handler points at an existing function
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const serverFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
const htmlFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
const server = serverFiles.map(read).join('\n');

const declared = new Set([...server.matchAll(/^function\s+(\w+)\s*\(/gm)].map((m) => m[1]));
const isPublic = (fn) => declared.has(fn) && !fn.endsWith('_');

// Walks google.script.run.withX(...).withY(...).fnName( and returns fnName, skipping the handler
// arguments by paren depth (string literals are skipped so a ')' inside a message doesn't count).
function runTargets(src) {
  const out = [];
  let idx = 0;
  while ((idx = src.indexOf('google.script.run', idx)) >= 0) {
    let i = idx + 'google.script.run'.length;
    for (;;) {
      while (/\s/.test(src[i])) i++;
      if (src[i] !== '.') break;
      i++;
      while (/\s/.test(src[i])) i++;
      const id = /^\w+/.exec(src.slice(i));
      if (!id) break;
      i += id[0].length;
      if (!id[0].startsWith('with')) { out.push(id[0]); break; }
      while (/\s/.test(src[i])) i++;
      if (src[i] !== '(') break;
      let depth = 0;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === '`') {
          for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
        } else if (c === '(') depth++;
        else if (c === ')' && --depth === 0) { i++; break; }
      }
    }
    idx = i;
  }
  return out;
}

test('client google.script.run calls resolve to public server functions', () => {
  const missing = [];
  let calls = 0;
  for (const f of htmlFiles) {
    for (const fn of runTargets(read(f))) {
      calls++;
      if (!isPublic(fn)) missing.push(`${f}: ${fn}`);
    }
  }
  assert.ok(calls > 40, `parse sanity check (found ${calls} calls)`);
  assert.deepEqual(missing, []);
});

test('include() targets exist', () => {
  const names = new Set(htmlFiles.map((f) => f.replace(/\.html$/, '')));
  const missing = [];
  for (const f of htmlFiles) {
    for (const m of read(f).matchAll(/include\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!names.has(m[1])) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('doGet templates exist', () => {
  const code = read('Code.js');
  const missing = [...code.matchAll(/createTemplateFromFile\('([^']+)'\)/g)]
    .map((m) => m[1]).filter((n) => !htmlFiles.includes(n + '.html'));
  assert.deepEqual(missing, []);
});

test('menu items and trigger handlers point at existing functions', () => {
  const menuFns = [...read('Code.js').matchAll(/\.addItem\('[^']*',\s*'(\w+)'\)/g)].map((m) => m[1]);
  const triggerFns = [...server.matchAll(/newTrigger\('(\w+)'\)/g)].map((m) => m[1]);
  assert.ok(menuFns.length > 10, 'menu parse sanity check');
  const missing = [...menuFns, ...triggerFns].filter((fn) => !declared.has(fn));
  assert.deepEqual(missing, []);
});

// SEC-01 guard. Every top-level function without a trailing `_` is callable anonymously through
// google.script.run, so each one must authenticate (requireAuth_), be restricted to the
// spreadsheet menu / owner (requireOwnerOrSheetUi_), check a share/metrics key, or be listed here
// on purpose. Adding a name to this list is a security decision — say why in the PR.
const ANONYMOUS_BY_DESIGN = {
  doGet: 'web app entry point',
  include: 'template helper; returns bundled client HTML only',
  onOpen: 'builds the spreadsheet menu; getUi() throws in web context',
  calculateFollowupStatus: 'pure date helper, no data access',
  getConfigMeta: 'login page needs enums, team list, gate flags',
  getTeam: 'Lead By dropdown on the public field form',
  getEnquiryLink: 'returns the public field-form URL',
  checkPhoneDuplicate: 'public field form repeat warning (aggregate only; see SEC-07)',
  submitFieldEnquiry: 'public field form; lands in Pending Approvals',
  login: 'issues a session',
  checkPin: 'issues a session (disabled once users exist, SEC-02)',
  requestPasswordReset: 'login page "Forgot password?"'
};
// Public wrappers whose auth lives in the helper they delegate to.
const DELEGATED_AUTH = { omsMarkPiSent: 'omsOrderAction_', omsRecordPayment: 'omsOrderAction_' };

function bodyOf(fn) {
  const m = new RegExp(`^function\\s+${fn}\\s*\\([^)]*\\)\\s*\\{`, 'm').exec(server);
  let i = m.index + m[0].length, depth = 1;
  while (depth && i < server.length) { const c = server[i++]; if (c === '{') depth++; else if (c === '}') depth--; }
  return server.slice(m.index, i);
}

test('SEC-01: every public server function authenticates, is guarded, or is anonymous by design', () => {
  const unguarded = [];
  for (const fn of declared) {
    if (!isPublic(fn) || ANONYMOUS_BY_DESIGN[fn]) continue;
    const body = bodyOf(fn);
    if (DELEGATED_AUTH[fn]) {
      assert.ok(body.includes(DELEGATED_AUTH[fn] + '('), `${fn} must delegate to ${DELEGATED_AUTH[fn]}`);
      assert.ok(bodyOf(DELEGATED_AUTH[fn]).includes('requireAuth_('), `${DELEGATED_AUTH[fn]} must authenticate`);
      continue;
    }
    if (/requireAuth_\(|requireOwnerOrSheetUi_\(|analysisKeyOk_\(/.test(body)) continue;
    unguarded.push(fn);
  }
  assert.deepEqual(unguarded, []);
});

test('manifest keeps the documented web app settings', () => {
  const manifest = JSON.parse(read('appsscript.json'));
  assert.equal(manifest.timeZone, 'Asia/Kolkata');
  assert.equal(manifest.runtimeVersion, 'V8');
  // Documented as-is (see docs/07_SECURITY_AND_RISKS.md); a change here is a deliberate,
  // reviewed decision, so this test must be updated in the same PR.
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
});
