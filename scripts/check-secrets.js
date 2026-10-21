'use strict';
/*
 * Project-specific secret guard, run in addition to gitleaks in CI. It catches the credential
 * shapes this codebase is known to have carried in source (see src/REDACTIONS.md): a hardcoded
 * analysis share key, a hardcoded default PIN, plus generic private keys / tokens / service
 * account JSON. Scans tracked text files only.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const rules = [
  [/ANALYSIS_SHARE_KEY_\s*=\s*'(?!__REDACTED)[^']+'/, 'hardcoded ANALYSIS_SHARE_KEY_ value'],
  [/setProperty\('ADMIN_PIN',\s*'(?!__REDACTED)[^']+'\)/, 'hardcoded default ADMIN_PIN'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/"type"\s*:\s*"service_account"/, 'service account key JSON'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bya29\.[0-9A-Za-z_-]{20,}/, 'Google OAuth access token'],
  [/"refresh_token"\s*:\s*"[^"]+"/, 'OAuth refresh token (.clasprc.json?)']
];

const files = execSync('git ls-files -co --exclude-standard', { cwd: ROOT }).toString().split('\n').filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|gif|ico|pdf)$/i.test(f) && f !== 'scripts/check-secrets.js');
const hits = [];
for (const f of files) {
  let text; try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
  text.split('\n').forEach((line, i) => {
    for (const [re, what] of rules) if (re.test(line)) hits.push(`${f}:${i + 1}: ${what}`);
  });
}
if (hits.length) { console.error('check-secrets FAILED:\n  ' + hits.join('\n  ')); process.exit(1); }
console.log(`check-secrets: ${files.length} file(s) scanned, no known secret patterns`);
