'use strict';
/*
 * Syntax-checks every Apps Script server file (src/*.js) and every inline <script> block in the
 * HTML templates. Template scriptlets (<?= ?>, <?!= ?>) are replaced with a placeholder first,
 * since they are evaluated server-side by HtmlService before the browser ever sees the code.
 * Exits non-zero on the first file with a syntax error.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
let failures = 0, checked = 0;

function check(label, code) {
  checked++;
  try { new vm.Script(code, { filename: label }); }
  catch (e) { failures++; console.error(`SYNTAX ERROR in ${label}: ${e.message}`); }
}

for (const f of fs.readdirSync(SRC).sort()) {
  const full = path.join(SRC, f);
  if (f.endsWith('.js')) check(f, fs.readFileSync(full, 'utf8'));
  if (f.endsWith('.html')) {
    const html = fs.readFileSync(full, 'utf8');
    let i = 0;
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const body = m[1].replace(/<\?!?=?[\s\S]*?\?>/g, 'null');
      check(`${f}#script${++i}`, body);
    }
  }
}
console.log(`check-syntax: ${checked} file(s)/block(s) checked, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
