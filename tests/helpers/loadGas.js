'use strict';
/*
 * Loads the Apps Script server files from src/ into one Node vm context, the same way Apps Script
 * merges every top-level .gs/.js file into a single global scope. Only the Google services the
 * pure helper functions touch at load time or in the tested paths are stubbed — anything that
 * needs SpreadsheetApp, CacheService, LockService, etc. is out of scope for these unit tests and
 * is covered by the manual regression checklist (docs/10_TESTING_AND_MAINTENANCE.md) instead.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', '..', 'src');

// Top-level `const`s are script-scoped in a vm, not globals, so expose the ones tests need.
const EXPORTED_CONSTS = [
  'CONFIG', 'SHEETS', 'STAGES', 'OPEN_STAGES', 'ENQ_HEADERS', 'PEND_HEADERS', 'CUST_HEADERS',
  'FU_HEADERS', 'USER_HEADERS', 'CALL_HEADERS', 'TIMELINES', 'FOLLOWUP_INTERVAL_DAYS'
];

function utilitiesStub() {
  return {
    getUuid: () => crypto.randomUUID(),
    // Apps Script returns signed Java bytes (-128..127).
    computeDigest: (_alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest())
      .map((b) => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    formatDate: (d, _tz, pattern) => {
      const dt = new Date(d);
      const pad = (n) => String(n).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return pattern
        .replace('yyyy', dt.getFullYear())
        .replace('MMM', months[dt.getMonth()])
        .replace('MM', pad(dt.getMonth() + 1))
        .replace('dd', pad(dt.getDate()))
        .replace('HH', pad(dt.getHours()))
        .replace('mm', pad(dt.getMinutes()));
    },
    sleep: () => {}
  };
}

function loadGas() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  const code = files.map((f) => `// ---- ${f}\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n')
    + `\n;globalThis.__consts = { ${EXPORTED_CONSTS.join(', ')} };`;
  const context = {
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'Asia/Kolkata' },
    Utilities: utilitiesStub(),
    console
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'gas-bundle.js' });
  return context;
}

module.exports = { loadGas };
