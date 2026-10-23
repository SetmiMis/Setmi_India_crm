'use strict';
// Cross-platform test runner: sets the business time zone (the legacy tests format dates in
// Asia/Kolkata) without POSIX-only "TZ=… cmd" syntax, so `npm test` works on Windows too.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'tests', 'unit');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, TZ: 'Asia/Kolkata' } });
process.exit(r.status ?? 1);
