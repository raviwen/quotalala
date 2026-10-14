// Opt-in only: one short real coordinated flow, no health checks or model sweeps.
const assert = require('node:assert/strict');
if (!process.argv.includes('--approved')) throw new Error('Explicit user approval is required for the real CLI test.');
const coordinator = require('../src/main/coordinator');
// Keep every phase of this optional diagnostic on the light tier.
const models = require('../src/main/models');
const resolveModel = models.getModelByLevel.bind(models);
models.getModelByLevel = (agentId) => resolveModel(agentId, 'hafif');
const { HistoryStore } = require('../src/main/storage');
const { SessionRunner } = require('../src/main/session-runner');
const store = new HistoryStore();
if (!store.getSettings().saveHistory) throw new Error('History saving is disabled. No settings will be changed for the test.');
const runner = new SessionRunner({ store, coordinator, emit: (channel, data) => {
  if (channel === 'stream:log') console.log(`[${data.level}] ${data.agent || 'system'}: ${data.text.slice(0, 300)}`);
} });
runner.run({ cwd: process.cwd(), prompt: 'Kısa doğrulama testi. Yalnızca bir hafif alt görev oluştur: Claude sadece OK yazsın. Dosya veya komut çalıştırma. Nihai yanıt sadece OK olsun.' }).then(result => {
  assert.equal(result.session.status, 'completed');
  assert.ok(store.list().some(session => session.id === result.session.id));
  assert.ok(store.open(result.session.id).turns[0].result.finalResult.includes('OK'));
  assert.ok(result.memory.summary.length > 0);
  assert.ok(result.memory.summary.length <= 2000);
  console.log(JSON.stringify({ status: result.session.status, sessionId: result.session.id, historyVisible: true, memoryLength: result.memory.summary.length, nativeSessions: Object.keys(result.session.cliSessions) }, null, 2));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
