// All agent responses are mocks. Process fixtures run Node only, never subscription CLIs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const root = path.resolve('.test-artifacts', 'execution-' + randomUUID());
process.env.QUOTALALA_DATA_DIR = root;
const { HistoryStore, writeJSON } = require('../src/main/storage');
const { SessionRunner } = require('../src/main/session-runner');
const coordinator = require('../src/main/coordinator');
const quota = require('../src/main/quota');
const models = require('../src/main/models');
const agents = require('../src/main/agents');
const { runWithStdin } = require('../src/main/cli-locator');
const { runOptions, LIMITS } = require('../src/main/run-options');
const { evaluateTask } = require('../src/main/task-outcome');
const task = (step = 1, prompt = 'Explain this concept') => ({ step, prompt, title: 'Task ' + step, agent: 'codex', level: 'hafif', rationale: 'Small task' });
const plan = (...subtasks) => ({ summary: 'Mock plan', subtasks });
function mockAgents(t, handler) {
  const state = structuredClone(quota.getState());
  const originals = agents.getAllAgents().map(agent => ({ agent, runPrompt: agent.runPrompt, capabilities: agent.capabilities }));
  for (const { agent } of originals) {
    quota.state.agents[agent.id].enabled = agent.id !== 'gemini'; quota.state.agents[agent.id].status = 'idle';
    agent.capabilities = { resume: true, noTools: true };
    agent.runPrompt = (prompt, options) => options.reason === 'Koordinasyon kararı' ? ok(JSON.stringify({ action: 'finish', reason: 'Mock tasks evaluated', result: 'Useful result' })) : handler(agent.id, prompt, options);
  }
  t.after(() => { quota.state = state; for (const { agent, runPrompt, capabilities } of originals) Object.assign(agent, { runPrompt, capabilities }); });
}
function runnerFor(name, implementation = coordinator, emit = () => {}) {
  const store = new HistoryStore(path.join(root, name));
  return { store, runner: new SessionRunner({ store, coordinator: implementation, emit }) };
}
const ok = stdout => ({ code: 0, stdout, stderr: '', durationMs: 1 });

test('economic mode makes exactly one successful worker call and no planning, synthesis, verification or memory calls', async t => {
  const calls = [];
  mockAgents(t, (id, prompt, options) => { calls.push({ id, prompt, options }); return ok('Useful answer'); });
  const { store, runner } = runnerFor('economic');
  const result = await runner.run({ prompt: 'Explain a concept', cwd: process.cwd(), options: { mode: 'economic', agent: 'codex', level: 'hafif', verify: true, timeout: 1234 } });
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 'codex'); assert.equal(calls[0].options.timeout, 1234);
  assert.equal(result.session.status, 'completed'); assert.equal(store.memory(process.cwd()).summary, '');
  assert.equal(result.session.turns[0].outputs[0].verifiedStatus, 'unverified');
});

test('failed and unchanged sessions never trigger a memory call; new successful information remains capped at 2000', async () => {
  let memoryCalls = 0, fail = false;
  const { store, runner } = runnerFor('memory', {
    planSubtasks: async () => plan(task()),
    executePlan: async (value, context) => { context.onOutput({ step: 1, success: !fail, output: 'Same information' }); return { status: fail ? 'failed' : 'completed', finalResult: 'Same information' }; },
    updateMemory: async () => { memoryCalls++; return 'x'.repeat(3000); }
  });
  const first = await runner.run({ prompt: 'One', cwd: process.cwd() });
  assert.equal(memoryCalls, 1); assert.equal(store.memory(process.cwd()).summary.length, 2000);
  await runner.run({ prompt: 'Again', cwd: process.cwd(), sessionId: first.session.id }); assert.equal(memoryCalls, 1);
  await runner.run({ prompt: 'Same result in a new session', cwd: process.cwd() }); assert.equal(memoryCalls, 1);
  fail = true; await runner.run({ prompt: 'Fail', cwd: process.cwd() }); assert.equal(memoryCalls, 1);
});

test('cancel persists partial output and completed steps, starts no queued task, releases lock and resumes only missing steps', async t => {
  let runner, first = true, startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const calls = [];
  mockAgents(t, async (id, prompt, options) => {
    calls.push({ id, step: options.step, reason: options.reason });
    if (options.reason === 'Planlama') return ok(JSON.stringify(plan(task(1, 'First task'), task(2, 'Second task'), task(3, 'Third task'))));
    if (options.step === 2 && first) {
      options.onChunk({ stream: 'stdout', text: 'Partial output\n' }); startedResolve();
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      return { code: -998, cancelled: true, stdout: 'Partial output', stderr: '', durationMs: 1 };
    }
    return ok('Result for ' + (options.step || options.reason));
  });
  const setup = runnerFor('cancel-resume'); runner = setup.runner;
  const pending = runner.run({ prompt: 'Work', cwd: process.cwd() });
  await started; assert.equal(runner.cancel(), true);
  const result = await pending; assert.equal(runner.busy, false); assert.equal(result.session.status, 'cancelled');
  const turn = result.session.turns[0]; assert.equal(turn.outputs[0].success, true); assert.equal(turn.outputs[1].output, 'Partial output');
  assert.equal(turn.outputs[1].status, 'cancelled'); assert.ok(turn.stream.some(chunk => chunk.text.includes('Partial')));
  assert.ok(!calls.some(c => c.step === 3)); assert.ok(!calls.some(c => c.reason === 'Proje hafızasını güncelleme'));
  first = false; const before = calls.length;
  const resumed = await runner.run({ prompt: 'Continue work', cwd: process.cwd(), sessionId: result.session.id, resume: true });
  assert.equal(resumed.session.status, 'completed'); assert.equal(resumed.session.turns.at(-1).outputs.length, 3);
  assert.deepEqual(calls.slice(before).filter(c => c.step).map(c => c.step), [2, 3]);
  assert.ok(!calls.slice(before).some(c => c.reason === 'Planlama'));
});

test('pending plans require matching approval, reject disabled agents and invented levels, and execute edited prompts only', async t => {
  const called = [];
  mockAgents(t, (id, prompt, options) => { called.push({ id, prompt, options }); return options.reason === 'Planlama' ? ok(JSON.stringify(plan(task(1), task(2)))) : ok('Result'); });
  let approvalResolve;
  const approval = new Promise(resolve => { approvalResolve = resolve; });
  const { runner } = runnerFor('approval', coordinator, (channel, data) => { if (channel === 'session:approval') approvalResolve(data); });
  const pending = runner.run({ prompt: 'Work', cwd: process.cwd(), options: { previewPlan: true } });
  const request = await approval;
  assert.equal(called.length, 1);
  assert.throws(() => runner.approvePlan({ runId: 'stale', plan: request.plan }), /matching/);
  assert.throws(() => runner.approvePlan({ ...request, plan: plan({ ...task(), agent: 'gemini' }) }), /unavailable/);
  assert.throws(() => runner.approvePlan({ ...request, plan: plan({ ...task(), level: 'invented' }) }), /level/);
  runner.approvePlan({ ...request, plan: plan({ ...task(), prompt: 'Edited prompt', model: 'invented-model' }) });
  const result = await pending;
  assert.equal(result.session.status, 'completed'); assert.equal(result.session.turns[0].plan.subtasks.length, 1);
  assert.match(called.find(c => c.options.step === 1).prompt, /Edited prompt/);
  assert.notEqual(called.find(c => c.options.step === 1).options.model, 'invented-model');
});

test('cancelling plan approval consumes only the planner call', async t => {
  let calls = 0, approveResolve;
  mockAgents(t, () => { calls++; return ok(JSON.stringify(plan(task()))); });
  const approval = new Promise(resolve => { approveResolve = resolve; });
  const { runner } = runnerFor('cancel-plan', coordinator, channel => { if (channel === 'session:approval') approveResolve(); });
  const pending = runner.run({ prompt: 'Work', cwd: process.cwd(), options: { previewPlan: true } });
  await approval; runner.cancel(); const result = await pending;
  assert.equal(result.session.status, 'cancelled'); assert.equal(calls, 1); assert.equal(runner.busy, false);
});

test('task retries include model fallback in the same two-attempt budget and repeated failures are skipped', async t => {
  let workerCalls = 0;
  mockAgents(t, (id, prompt, options) => {
    if (options.phase === 'task') { workerCalls++; return { code: 1, stdout: '', stderr: 'model not available', durationMs: 1 }; }
    return ok('Failure summary');
  });
  const context = { cwd: process.cwd(), prompt: 'Work', options: {}, log: () => {} };
  const result = await coordinator.executePlan(plan(task(1, 'Same failed operation'), task(2, 'Same failed operation')), context);
  assert.equal(workerCalls, 2); assert.equal(result.outputs[1].status, 'blocked');
  assert.throws(() => coordinator.parsePlan(JSON.stringify(plan(...Array.from({ length: LIMITS.subtasks + 1 }, () => task())))));
  assert.throws(() => runOptions({ timeout: 0 })); assert.throws(() => runOptions({ timeout: 1800001 }));
});

test('timeout preserves partial results and never hands the same task to another agent', async t => {
  const calls = [];
  mockAgents(t, (id, prompt, options) => { calls.push(id); return { code: -999, timedOut: true, stdout: 'Partial', stderr: 'Timeout', durationMs: 1 }; });
  const { runner } = runnerFor('timeout-worker');
  const result = await runner.run({ prompt: 'Work', cwd: process.cwd(), options: { mode: 'economic' } });
  assert.deepEqual(calls, ['codex']); assert.equal(result.session.status, 'failed'); assert.equal(result.session.turns[0].outputs[0].output, 'Partial');
});

test('optional verification records real command events without promoting synthesis to independent testing', async t => {
  let checks = 0;
  mockAgents(t, (id, prompt, options) => {
    if (options.reason === 'Optional verification') { checks++; return { ...ok('Checked'), executedChecks: [{ command: 'npm test', exitCode: 0 }] }; }
    return ok('Answer');
  });
  const result = await coordinator.executePlan(plan(task()), { cwd: process.cwd(), prompt: 'Work', options: { verify: true }, log: () => {} });
  assert.equal(checks, 1); assert.equal(result.verification.independentTests, false);
  assert.deepEqual(result.verification.evidence.executedChecks, [{ command: 'npm test', exitCode: 0 }]);
  assert.equal(evaluateTask(ok('Unable to inspect any files')).status, 'failed');
  assert.equal(evaluateTask(ok('General explanation'), { requiresFileEvidence: false }).status, 'completed');
  assert.equal(evaluateTask(ok('Looks fine'), { requiresFileEvidence: true }).status, 'failed');
  assert.equal(require('../src/main/task-outcome').requiresFileEvidence({ prompt: 'Kod incelemesi nedir?' }), false);
});

test('interrupted sessions recover without agent calls and summary listing never reloads full output records', () => {
  const store = new HistoryStore(path.join(root, 'recovery'));
  const session = store.create(process.cwd(), 'Interrupted');
  session.turns.push({ status: 'running', outputs: [{ step: 1, success: true, output: 'Saved' }], plan: plan(task(), task(2)) });
  store.save(session); store.recoverInterrupted();
  assert.equal(store.list()[0].status, 'interrupted'); assert.equal(store.open(session.id).turns[0].outputs[0].output, 'Saved');
  store.open = () => { throw new Error('Full output loaded'); };
  assert.equal(store.list().length, 1); assert.deepEqual(store.recentActivities(process.cwd()), []);
  assert.equal(fs.readdirSync(path.join(store.root, 'sessions')).filter(name => name.endsWith('.tmp')).length, 0);
  writeJSON(path.join(root, 'atomic.json'), { one: 1 }); writeJSON(path.join(root, 'atomic.json'), { two: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'atomic.json'))), { two: 2 });
});

test('local process fixture streams before exit, kills its descendant tree and retains stdout on cancellation', async () => {
  const controller = new AbortController(); let pid, readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const script = "const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log('CHILD:'+child.pid);setInterval(()=>{},1000);";
  const pending = runWithStdin(process.execPath, ['-e', script], '', { signal: controller.signal, timeout: 10000, onChunk: chunk => {
    const match = chunk.text.match(/CHILD:(\d+)/); if (match) { pid = Number(match[1]); readyResolve(); }
  } });
  await ready; controller.abort(); const result = await pending;
  assert.equal(result.cancelled, true); assert.equal(result.code, -998); assert.match(result.stdout, /CHILD:/);
  for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { return; } await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Descendant process remained alive');
});

test('local timeout fixture ends promptly with partial stdout and pre-aborted work never spawns', async () => {
  const result = await runWithStdin(process.execPath, ['-e', "console.log('Started');setInterval(()=>{},1000)"], '', { timeout: 500 });
  assert.equal(result.timedOut, true); assert.equal(result.code, -999); assert.match(result.stdout, /Started/); assert.ok(result.durationMs < 6500);
  const controller = new AbortController(); controller.abort();
  assert.equal((await runWithStdin('must-never-spawn', [], '', { signal: controller.signal })).cancelled, true);
});

test('inactivity timeout resets on stdout chunks and allows longer active tasks', async () => {
  const script = "let count=0;const i=setInterval(()=>{process.stdout.write('step ');if(++count===3){clearInterval(i);console.log('done');}},100);";
  const result = await runWithStdin(process.execPath, ['-e', script], '', { timeout: 250 });
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /done/);
});

test('split recognizable secrets never pass through live IPC unredacted', async t => {
  const secret = 'sk-proj-' + 'x'.repeat(30), emitted = [];
  mockAgents(t, (id, prompt, options) => {
    options.onChunk({ stream: 'stdout', text: secret.slice(0, 15) });
    options.onChunk({ stream: 'stdout', text: secret.slice(15) + '\n' });
    return ok('Safe result');
  });
  const { runner } = runnerFor('stream-redaction', coordinator, (channel, data) => { if (channel === 'session:stream') emitted.push(data); });
  const result = await runner.run({ prompt: 'Work', cwd: process.cwd(), options: { mode: 'economic' } });
  assert.ok(emitted.length); assert.ok(!JSON.stringify(emitted).includes(secret)); assert.ok(!JSON.stringify(result.session).includes(secret));
});

test('live IPC receives stdout without waiting for a newline or process completion', async t => {
  let streamedResolve, finishResolve;
  const streamed = new Promise(resolve => { streamedResolve = resolve; });
  const finish = new Promise(resolve => { finishResolve = resolve; });
  mockAgents(t, async (id, prompt, options) => {
    options.onChunk({ stream: 'stdout', text: 'Output before completion' });
    await finish; return ok('Completed');
  });
  const { runner } = runnerFor('no-newline', coordinator, (channel, data) => { if (channel === 'session:stream') streamedResolve(data); });
  const pending = runner.run({ prompt: 'Work', cwd: process.cwd(), options: { mode: 'economic' } });
  try { const chunk = await streamed; assert.equal(chunk.text, 'Output before completion'); assert.equal(runner.busy, true); }
  finally { finishResolve(); }
  assert.equal((await pending).session.status, 'completed');
});

test('stale summary after an interrupted atomic save is rebuilt from the session record', () => {
  const store = new HistoryStore(path.join(root, 'stale-summary'));
  const session = store.create(process.cwd(), 'Old title'); session.status = 'completed'; store.save(session);
  session.title = 'Changed title after crash'; session.status = 'running'; session.turns.push({ status: 'running', outputs: [] });
  writeJSON(store.sessionPath(session.id), session);
  store.recoverInterrupted();
  assert.equal(store.list()[0].title, session.title); assert.equal(store.list()[0].status, 'interrupted');
  fs.writeFileSync(path.join(store.root, 'settings.json'), JSON.stringify({ timeout: -1, mode: 'invalid' }));
  assert.equal(store.getSettings().timeout, 180000);
});

test('unsuccessful optional verification preserves synthesis, successful tasks and command evidence', async t => {
  mockAgents(t, (id, prompt, options) => options.reason === 'Optional verification'
    ? { code: 1, stdout: 'Test failed', stderr: 'Test failed', durationMs: 1, executedChecks: [{ command: 'npm test', exitCode: 1 }] }
    : ok('Useful result'));
  const result = await coordinator.executePlan(plan(task()), { cwd: process.cwd(), prompt: 'Work', options: { verify: true }, log: () => {} });
  assert.equal(result.status, 'partial'); assert.equal(result.outputs[0].success, true); assert.equal(result.finalResult, 'Useful result');
  assert.equal(result.verification.status, 'failed'); assert.equal(result.verification.evidence.executedChecks[0].exitCode, 1);
});
