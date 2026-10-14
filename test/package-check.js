const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
if (!process.argv[2]) throw new Error('Provide the built app.asar path.');
const archive = path.resolve(process.argv[2]);
const names = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
assert.ok(!names.some(file => /(?:^|\/)(?:test|\.test-artifacts|\.quotalala|\.claude|\.codex)(?:\/|$)|\.env|auth\.json|token.*\.json|creds.*\.json/i.test(file)), 'Local/test/credential files must not be packaged');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
  .filter(file => /^(src|assets)\//.test(file) || ['LICENSE', 'README.md'].includes(file));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
for (const file of files) assert.equal(hash(asar.extractFile(archive, file.split('/').join(path.sep))), hash(fs.readFileSync(path.join(root, file))), `Packaged file differs: ${file}`);
const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
const source = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const key of ['name', 'version', 'main', 'license']) assert.equal(pkg[key], source[key], `Packaged metadata differs: ${key}`);
console.log(`PASS: ${files.length} packaged source/assets/license files match current contents; no tests, local history or recognizable credential files.`);
