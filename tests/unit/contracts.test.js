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

test('manifest keeps the documented web app settings', () => {
  const manifest = JSON.parse(read('appsscript.json'));
  assert.equal(manifest.timeZone, 'Asia/Kolkata');
  assert.equal(manifest.runtimeVersion, 'V8');
  // Documented as-is (see docs/07_SECURITY_AND_RISKS.md); a change here is a deliberate,
  // reviewed decision, so this test must be updated in the same PR.
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
});
