const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
process.env.QUOTALALA_DATA_DIR = path.resolve('.test-artifacts', 'models-' + randomUUID());
const models = require('../src/main/models');
const { parseModelHelp, discoverModels } = require('../src/main/capabilities');
const defaults = require('../src/main/default-models.json');
const entry = (name, level = 'orta', extra = {}) => ({ agent: 'codex', name, source: 'mock explicit model list', levels: { [level]: { cost: 3 } }, ...extra });

test('help parser reads wrapped Claude examples and model choices only, deduplicating names', () => {
  const output = `Options:
  --fallback-model <model>  Example: 'ignore-fallback'
  --model <model>  Provide an alias for the latest model (e.g.
                  'mock-small', 'mock-large', or 'mock-small') or a full name.
  --effort <level>  choices: low, medium, high
  --tools <tools>  Example: 'ignore-tools'`;
  assert.deepEqual(parseModelHelp('claude', output).map(m => m.name), ['mock-small', 'mock-large']);
  const codex = '\x1b[32m  -m, --model <MODEL>\x1b[0m\n      [possible values: mock-stable, mock-beta]\n\n  --sandbox <MODE>\n      [possible values: read-only, workspace-write]';
  const parsed = parseModelHelp('codex', codex);
  assert.deepEqual(parsed.map(m => m.name), ['mock-stable', 'mock-beta']);
  assert.equal(parsed[1].preview, true);
  assert.ok(parsed.every(m => m.verified && m.source === 'codex --help'));
  assert.deepEqual(parseModelHelp('codex', '  --model <MODEL>\n    Model to use\n  -p <PROFILE>  Example: "ignore-profile"'), []);
});

test('ambiguous prose, generic flags, errors, JSON, and unsupported agents are not model catalogs', () => {
  for (const output of [null, '', '--model <MODEL>\n    Model the agent should use',
    'Use mock-imagined for coding.\n--effort choices: high, low',
    '{"models":[{"id":"mock-json"}]}', 'Error: unknown model mock-missing']) {
    assert.deepEqual(parseModelHelp('codex', output), []);
  }
  assert.deepEqual(parseModelHelp('gemini', '--model choices: mock'), []);
});

test('discovery is help-only, keeps fallback entries, and never guesses tiers for new names', async () => {
  const catalog = [entry('mock-known'), entry('mock-fallback', 'hafif')];
  const calls = [];
  const result = await discoverModels({ id: 'codex', command: 'codex', execute: async (...args) => {
    calls.push(args); return { code: 0, stdout: '  --model <MODEL>\n    [possible values: mock-known, mock-new-preview]' };
  } }, { defaults: catalog });
  assert.deepEqual(calls[0][0], ['--help']);
  assert.equal(calls[0][1], '');
  assert.equal(calls[0][2].timeout, 10000);
  assert.equal(calls.length, 1);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.discovered.length, 2);
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].source, 'codex --help');
  assert.equal(result.models[1].source, catalog[1].source);
  assert.equal(catalog[0].source, 'mock explicit model list');
  const preview = await discoverModels({ id: 'codex', execute: async () => ({ code: 0, stdout: '  --model <MODEL> preview choices: mock-known' }) }, { defaults: catalog });
  assert.equal(preview.models[0].preview, true);
});

test('failed, thrown, cancelled, and name-free discovery retain defaults without writing models.json', async () => {
  const file = path.join(process.env.QUOTALALA_DATA_DIR, 'models.json');
  const before = fs.readFileSync(file, 'utf8');
  for (const execute of [async () => { throw new Error('missing'); },
    async () => ({ code: -999, stderr: 'timeout', stdout: '--model choices: mock-invalid' }),
    async () => ({ code: 0, stdout: '--model <MODEL>\n    Model to use' })]) {
    const result = await models.discoverModels({ id: 'codex', execute });
    assert.deepEqual(result.models, defaults.filter(m => m.agent === 'codex'));
    assert.deepEqual(result.discovered, []);
    assert.equal(result.requiresApproval, true);
  }
  const controller = new AbortController(); controller.abort();
  assert.deepEqual((await discoverModels({ id: 'codex', execute: () => { throw new Error('must not probe when cancelled'); } }, { signal: controller.signal })).discovered, []);
  await discoverModels({ id: 'gemini', execute: () => { throw new Error('must not probe Gemini'); } });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('duplicate validation rejects saves; legacy loading merges disjoint tiers without rewriting disk', () => {
  const duplicate = [entry('gpt-6.1-sol', 'orta', { source: path.win32.join('C:/', 'Users', 'fixture', '.codex', 'models_cache.json') + ':8' }), entry('gpt-6.1-sol', 'güçlü')];
  duplicate[0].levels.orta.thinking = 'medium';
  duplicate[1].levels['güçlü'].thinking = 'high';
  duplicate[1].levels['güçlü'].cost = 5;
  assert.throws(() => models.validateModels(duplicate), /Duplicate model/);
  assert.throws(() => models.saveModels(duplicate), /Duplicate model/);
  const file = path.join(process.env.QUOTALALA_DATA_DIR, 'models.json');
  fs.writeFileSync(file, JSON.stringify(duplicate));
  const before = fs.readFileSync(file, 'utf8');
  const normalized = models.getModels();
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].levels.orta.thinking, 'medium');
  assert.equal(normalized[0].levels['güçlü'].thinking, 'high');
  assert.ok(!normalized[0].source.includes('C:\\Users'));
  assert.equal(models.getModelByLevel('codex', 'güçlü').params.thinking, 'high');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => models.normalizeModels([entry('mock'), entry('mock', 'orta', { levels: { orta: { cost: 8 } } })]), /Conflicting duplicate/);
});

test('default catalog is unique, verified, portable, and uses medium/high effort on one Sol entry', () => {
  models.validateModels(defaults);
  assert.ok(defaults.every(m => m.verified && !m.preview && !/\b[A-Za-z]:[\\/]/.test(m.source)));
  const sol = defaults.filter(m => m.name === 'gpt-6.1-sol');
  assert.equal(sol.length, 1);
  assert.equal(sol[0].levels.orta.thinking, 'medium');
  assert.equal(sol[0].levels['güçlü'].thinking, 'high');
  const old = models.getModels;
  try {
    models.getModels = () => [entry('mock-unverified'), entry('mock-preview', 'orta', { verified: true, preview: true }), ...defaults];
    assert.equal(models.getModelByLevel('codex').name, 'gpt-6.1-sol');
    assert.equal(models.getModelByLevel('codex', 'güçlü').params.thinking, 'high');
    models.getModels = () => [entry('mock-unverified')];
    assert.equal(models.getModelByLevel('codex'), null);
  } finally { models.getModels = old; }
  assert.equal(models.normalizeModels([entry('mock-custom')])[0].verified, false);
});

test('Gemini defaults match supplied agy evidence and encode effort in model IDs without extra flags', () => {
  const evidence = new Set(fs.readFileSync(path.join(__dirname, 'fixtures/agy-models.txt'), 'utf8').trim().split(/\r?\n/).map(line => line.split(/\s+/)[0]));
  const geminiModels = defaults.filter(model => model.agent === 'gemini');
  assert.equal(geminiModels.length, 3);
  assert.ok(geminiModels.every(model => evidence.has(model.name)));
  assert.ok(!evidence.has('gemini-3.8-flash'));
  const agent = require('../src/main/agents/gemini');
  const saved = { getModels: models.getModels, capabilities: agent.capabilities };
  try {
    models.getModels = () => defaults;
    agent.capabilities = { available: true, stdin: true, model: true, print: true };
    for (const [level, effort] of [['hafif', 'low'], ['orta', 'medium'], ['güçlü', 'high']]) {
      const chosen = models.getModelByLevel('gemini', level);
      assert.equal(chosen.name, `gemini-3.8-flash-${effort}`);
      assert.deepEqual(chosen.params, {});
      const args = agent.getRunArgs('fixture', { model: chosen.name, ...chosen.params });
      assert.deepEqual(args, ['-p', '--model', chosen.name]);
    }
    // The old family-only name is still unverified; loading must not silently
    // substitute or persist a new user selection.
    const legacy = models.normalizeModels([{ ...entry('gemini-3.8-flash', 'hafif'), agent: 'gemini' }]);
    assert.equal(legacy[0].verified, false);
  } finally { models.getModels = saved.getModels; agent.capabilities = saved.capabilities; }
});
