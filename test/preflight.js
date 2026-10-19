// Read-only checks of files eligible for Git, never credential files or user history.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
const privateName = /(?:^|\/)(?:node_modules|release|\.test-artifacts|\.quotalala|\.claude|\.codex|\.gemini|\.agy|\.antigravity)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|auth\.json|[^/]*(?:creds|credentials|token)[^/]*\.json)$/i;
for (const file of files) assert.ok(!privateName.test(file), `Private/local file is eligible for Git: ${file}`);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.deepEqual(pkg.devDependencies, lock.packages[''].devDependencies, 'package.json and lockfile must agree');
assert.deepEqual(pkg.engines, lock.packages[''].engines, 'Node requirements must agree');
for (const [name, version] of Object.entries(pkg.devDependencies)) assert.equal(lock.packages[`node_modules/${name}`].version, version, `Dependency ${name} must be pinned to its tested version`);
assert.ok(pkg.build.files.includes('LICENSE'), 'Distributions must include the MIT license');
assert.equal(pkg.build.win.target[0], 'nsis');
const ico = fs.readFileSync(path.join(root, 'assets/icon.ico'));
assert.equal(ico.readUInt16LE(2), 1, 'Windows icon must be an ICO');
assert.ok(Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + index * 16] || 256).some(size => size >= 256), 'Windows installer icon must include a 256px frame');
const translations = ['tr', 'en'].map(lang => JSON.parse(fs.readFileSync(path.join(root, `src/renderer/i18n/${lang}.json`), 'utf8')));
assert.deepEqual(Object.keys(translations[0]).sort(), Object.keys(translations[1]).sort(), 'TR/EN keys must match');
let syntaxCount = 0;
for (const file of files.filter(file => /\.js$/.test(file))) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' }); syntaxCount++;
}
const secret = /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9_]{25,}|github_pat_[A-Za-z0-9_]{25,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
for (const file of files.filter(file => /\.(?:js|json|md|yml|yaml)$/.test(file))) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!secret.test(source), `Recognizable secret found in ${file}; value suppressed`);
  assert.ok(!/C:\\+Users\\+[A-Za-z0-9_-]+\\/i.test(source), `Personal Windows path found in ${file}`);
}
const models = JSON.parse(fs.readFileSync(path.join(root, 'src/main/default-models.json'), 'utf8'));
assert.ok(models.every(model => model.source && model.name && model.verified === true), 'Only source-verified default models may ship');
const agyNames = new Set(fs.readFileSync(path.join(root, 'test/fixtures/agy-models.txt'), 'utf8').trim().split(/\r?\n/).map(line => line.split(/\s+/)[0]));
assert.ok(models.filter(model => model.agent === 'gemini').every(model => agyNames.has(model.name)), 'Gemini defaults must match the supplied agy models evidence');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
for (const file of files.filter(file => /^README(?:\.[a-z]{2})?\.md$/.test(file))) {
  const markdown = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:https?:|#)/.test(target)) continue;
    assert.ok(fs.existsSync(path.join(root, target.split('#')[0])), `Broken README link in ${file}: ${target}`);
  }
}
for (const file of files.filter(file => /^assets\/screenshots\/.*\.png$/.test(file))) {
  assert.equal(fs.readFileSync(path.join(root, file)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Screenshot must be a PNG: ${file}`);
}
const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map(match => match[1]);
for (const key of keys) assert.ok(translations.every(data => typeof data[key] === 'string'), `Missing translation: ${key}`);
console.log(`PASS: ${files.length} Git candidate files, ${syntaxCount} JavaScript syntax checks, pinned lockfile, ${Object.keys(translations[0]).length} TR/EN keys, license/package inputs and recognizable-secret scan.`);
