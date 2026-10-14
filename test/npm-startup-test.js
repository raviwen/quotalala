// Exercise the packed app via launcher arguments; all data remains in the repo.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const stage = process.argv[2];
if (!stage) throw new Error('Provide the generated npm stage directory.');
const { launchOptions } = require(path.resolve(stage, 'bin/quotalala.js'));
const project = path.resolve('.test-artifacts', 'npm İ-' + randomUUID().slice(0, 8));
fs.mkdirSync(project, { recursive: true });
const { args, options } = launchOptions([], { cwd: project, appDir: require.resolve('./startup-test') });
const child = spawn(require('electron'), args, { ...options, detached: false, stdio: 'inherit', env: {
  ...options.env, QUOTALALA_TEST_APP_DIR: path.resolve(stage, 'app')
} });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
