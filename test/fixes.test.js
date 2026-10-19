const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const root = path.resolve('.test-artifacts', 'fixes-' + randomUUID());
process.env.QUOTALALA_DATA_DIR = path.join(root, 'quota');

const { writeJSON } = require('../src/main/storage');
const models = require('../src/main/models');
const quota = require('../src/main/quota');
const agents = require('../src/main/agents');
const { invoke } = require('../src/main/coordinator');
const { HealthService } = require('../src/main/health');
const { TaskBoard } = require('../src/main/task-board');
const { BoardRunner } = require('../src/main/board-runner');
const { HistoryStore } = require('../src/main/storage');

test('writeJSON removes the temporary file when rename keeps failing', () => {
  const dir = path.join(root, 'eprmdir');
  fs.mkdirSync(dir, { recursive: true });
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
  try {
    assert.throws(() => writeJSON(path.join(dir, 'target.json'), { ok: true }), /locked/);
    const leftovers = fs.readdirSync(dir).filter(name => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'failed rename must not leave .tmp files behind');
  } finally {
    fs.renameSync = realRename;
  }
});

test('missing tier falls back to the nearest cheaper level before a more expensive one', () => {
  const list = [{ agent: 'claude', name: 'tiermodel', levels: { 'orta': { cost: 3 }, 'güçlü': { cost: 5 } }, source: 'test catalog', verified: true }];
  assert.equal(models.saveModels(list), true);
  // Requested "hafif" does not exist: falling up to "güçlü" (cost 5) violates the
  // cost-saving rule, so "orta" (cost 3) must be picked first.
  const light = models.getModelByLevel('claude', 'hafif');
  assert.equal(light.level, 'orta');
  const strong = models.getModelByLevel('claude', 'güçlü');
  assert.equal(strong.level, 'güçlü');
});

test('internal call/attempt limit errors are not recorded as agent quota failures', async () => {
  const before = quota.getAgent('claude').status;
  const context = {
    calls: 20, // session call budget exhausted
    signal: new AbortController().signal,
    cwd: root,
    prompt: 'test',
    options: {},
    memory: '',
    activity: () => {},
    log: () => {},
    publish: () => {},
    flushStream: () => {},
    onChunk: () => {}
  };
  await assert.rejects(() => invoke('claude', 'prompt', 'hafif', context), error => error.limitExceeded === true);
  assert.equal(quota.getAgent('claude').status, before, 'agent must stay out of the error state');
  assert.equal(quota.getAgent('claude').lastError, null);
});

test('health check rejects a second run while one is already running', async () => {
  const stubQuota = {
    getAgent: () => ({ enabled: true }),
    setAgentStatus: () => {},
    getState: () => ({ agents: {} }),
    extractRenewalTime: () => new Date()
  };
  const neverRunningAgent = { id: 'claude', runHealthTest: () => new Promise(() => {}) };
  const service = new HealthService({ agents: [neverRunningAgent], quota: stubQuota, models: { getModelByLevel: () => null }, emit: () => {} });
  const first = service.run();
  try {
    await assert.rejects(() => service.run(), /already running/);
  } finally {
    service.running = false; // let the abandoned stub go without touching state
  }
});

test('waiting-quota resume keeps the original worker instruction and the user answer is appended', async () => {
  const cwd = path.join(root, 'board-project');
  fs.mkdirSync(cwd, { recursive: true });
  const store = new HistoryStore(root);
  const board = new TaskBoard(cwd, root);
  const task = board.add('Original request text');
  board.update(task.id, { workerPrompt: 'ORIGINAL INSTRUCTION', status: 'waiting_quota', resumeAt: new Date(Date.now() - 1000).toISOString() });
  const runner = new BoardRunner({ cwd, root, board, emit: () => {}, store });
  runner.tick = async () => {}; // never spawn a real CLI from this unit test
  await runner.checkWaitingQuotaTasks(Date.now() + 10);
  const resumed = board.get(task.id);
  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.workerPrompt, 'ORIGINAL INSTRUCTION', 'resume must not overwrite the original instruction');

  // User answering an intake question must keep the request text.
  const questionTask = board.add('Second ask');
  board.update(questionTask.id, { status: 'needs_user', cliSessionId: 'session-1', agent: 'codex', workerPrompt: 'WORKER TASK' });
  await runner.answer(questionTask.id, 'user says hi');
  const answered = board.get(questionTask.id);
  assert.equal(answered.status, 'queued');
  assert.ok(answered.workerPrompt.startsWith('WORKER TASK'), 'answer must be appended, not replace the instruction');
  assert.ok(answered.workerPrompt.includes('user says hi'));
});

test('task budgets are clamped to safe ranges and applied from saved settings', () => {
  const store = new HistoryStore(path.join(root, 'limits'));
  const { LIMITS, DEFAULT_LIMITS, applyLimits } = require('../src/main/run-options');
  const saved = store.saveSettings({ limits: { subtasks: 999, calls: 1, repliesPerTask: -5, coordinationRounds: 4 } });
  assert.equal(saved.limits.subtasks, 20, 'subtasks clamps to the maximum');
  assert.equal(saved.limits.calls, 5, 'calls clamps to the minimum');
  assert.equal(saved.limits.repliesPerTask, 0, 'reply rounds clamp to the minimum');
  assert.equal(saved.limits.coordinationRounds, 4);
  assert.equal(LIMITS.subtasks, 20);
  assert.equal(LIMITS.calls, 5);
  // Leave the process-wide limits at their defaults for the remaining tests.
  applyLimits({});
  assert.deepEqual({ ...LIMITS }, { ...DEFAULT_LIMITS });
});
