'use strict';
/* Fails if a file the Apps Script project or the documentation set depends on is missing. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const required = [
  'README.md', 'src/appsscript.json', 'src/Code.js', 'src/Index.html', 'src/Enquiry.html', 'src/Share.html',
  '.claspignore', '.gitignore',
  'docs/01_SYSTEM_OVERVIEW.md', 'docs/02_ARCHITECTURE.md', 'docs/03_DATABASE_DICTIONARY.md',
  'docs/04_CODEBASE_REFERENCE.md', 'docs/05_MODULES_AND_WORKFLOWS.md', 'docs/06_DEPLOYMENT_AND_CONFIGURATION.md',
  'docs/07_SECURITY_AND_RISKS.md', 'docs/08_BUG_REGISTER.md', 'docs/09_AI_DEVELOPER_GUIDE.md',
  'docs/10_TESTING_AND_MAINTENANCE.md', 'docs/11_GITHUB_AND_BRANCHING_STRATEGY.md',
  'docs/12_CI_CD_AND_RELEASE_PROCESS.md', 'docs/13_ENVIRONMENTS_AND_DEPLOYMENT.md',
  'docs/14_DOMAIN_AND_PRODUCTION_READINESS.md'
];
const missing = required.filter((p) => !fs.existsSync(path.join(ROOT, p)));
// A real .clasp.json carries the production scriptId and must stay local (see .gitignore).
if (fs.existsSync(path.join(ROOT, '.clasp.json'))) missing.push('(.clasp.json must not be committed)');
try { JSON.parse(fs.readFileSync(path.join(ROOT, 'src/appsscript.json'), 'utf8')); }
catch (e) { missing.push('src/appsscript.json is not valid JSON: ' + e.message); }

if (missing.length) { console.error('check-structure FAILED:\n  ' + missing.join('\n  ')); process.exit(1); }
console.log(`check-structure: ${required.length} required paths present`);
