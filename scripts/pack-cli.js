// Build a standalone npm package without changing the NSIS dependency layout.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = require('../package.json');
const stage = path.join(root, '.test-artifacts', 'npm-stage-' + randomUUID());
const output = path.join(root, '.test-artifacts', 'npm');
fs.mkdirSync(stage, { recursive: true }); fs.mkdirSync(output, { recursive: true });
function copy(file, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const appFiles = files.filter(file => /^src\/.*\.(js|html|css|json)$/.test(file) || /^assets\/icon\.(svg|png|ico)$/.test(file));
for (const file of appFiles) {
  assert.ok(!/(?:^|\/)(?:\.[^/]+|[^/]*(?:auth|creds|token)[^/]*\.json)$/i.test(file), `Private file cannot ship: ${file}`);
  assert.ok(!fs.lstatSync(path.join(root, file)).isSymbolicLink(), `Symlink cannot ship: ${file}`);
  copy(file, path.join(stage, 'app', file));
}
copy('bin/quotalala.js', path.join(stage, 'bin/quotalala.js'));
const documents = ['LICENSE', 'README.md', 'README.tr.md', 'README.de.md', 'README.es.md', 'README.fr.md', 'AGENTS.md', 'RELEASE-CHECKLIST.md'];
for (const file of documents) copy(file, path.join(stage, file));
copy('assets/icon.png', path.join(stage, 'assets/icon.png'));
fs.writeFileSync(path.join(stage, 'app/package.json'), JSON.stringify({ name: source.name, version: source.version, main: source.main, productName: 'Quotalala', license: source.license }, null, 2));
const manifest = {
  name: 'quotalala', version: source.version, description: source.description,
  bin: { quotalala: 'bin/quotalala.js' }, license: source.license, author: source.author,
  repository: { type: 'git', url: 'git+https://github.com/raviwen/quotalala.git' },
  engines: source.engines, os: ['win32'], files: ['bin/', 'app/', 'assets/icon.png', 'LICENSE', 'README*.md', 'AGENTS.md', 'RELEASE-CHECKLIST.md'],
  dependencies: { electron: source.devDependencies.electron }
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
assert.ok(process.env.npm_execpath, 'Run this using npm run pack:cli.');
const report = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', stage, '--ignore-scripts', '--json', '--pack-destination', output], {
  cwd: root, env: { ...process.env, npm_config_cache: path.join(root, '.test-artifacts/npm-cache') }, encoding: 'utf8'
}));
// npm versions emit either an array or a record keyed by package name.
const packed = Array.isArray(report) ? report[0] : report.quotalala;
assert.ok(packed?.files && packed.filename, 'npm did not return a package inventory');
const expected = ['package.json', 'app/package.json', 'bin/quotalala.js', 'assets/icon.png', ...documents, ...appFiles.map(file => 'app/' + file)].sort();
assert.deepEqual(packed.files.map(file => file.path).sort(), expected, 'npm archive must contain exactly the approved application files');
fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ stage, archive: path.join(output, packed.filename) }, null, 2));
console.log(`PASS: ${packed.files.length} npm package files; no build tools, tests or user data.\nPackage: ${path.join(output, packed.filename)}\nStage: ${stage}`);
