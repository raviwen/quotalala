// All team members are mock CLIs; no account, credential or network access.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { randomUUID } = require('crypto');
const root = path.resolve('.test-artifacts', 'team-' + randomUUID());
process.env.QUOTALALA_DATA_DIR = root;
const { HistoryStore } = require('../src/main/storage');
const { SessionRunner } = require('../src/main/session-runner');
const coordinator = require('../src/main/coordinator');
const quota = require('../src/main/quota');
const agents = require('../src/main/agents');
const { decision, workerMessage } = require('../src/main/team-protocol');
const { LIMITS } = require('../src/main/run-options');
const response = value => ({ code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '', durationMs: 1 });
const task = (agent = 'codex', prompt = 'Implement the assigned change') => ({ agent, prompt, title: prompt, level: 'hafif', rationale: 'Focused work' });
const worker = (status, message, toAgent = 'claude') => response({ protocol: 'worker-v1', status, message, toAgent });
const done = () => response({ action: 'finish', reason: 'Results are sufficient', result: 'Final synthesis; no independent tests claimed.' });
function fixture(t, name, { tasks = [task()], act, gemini = false, emit = () => {} }) {
  const oldState = structuredClone(quota.getState());
  const originals = agents.getAllAgents().map(agent => ({ agent, runPrompt: agent.runPrompt, capabilities: agent.capabilities, execute: agent.execute }));
  const calls = [];
  for (const { agent } of originals) {
    quota.state.agents[agent.id].enabled = agent.id !== 'gemini' || gemini; quota.state.agents[agent.id].status = 'idle';
    agent.capabilities = { noTools: true, resume: true, available: true, stdin: true };
    agent.execute = async () => { throw new Error('Live CLI must not be used'); };
    agent.runPrompt = async (prompt, options) => {
      calls.push({ agent: agent.id, prompt, options });
      if (options.reason === 'Planlama') return response({ summary: 'Team plan', subtasks: tasks });
      if (options.reason === 'Proje hafızasını güncelleme') return response('Updated project memory');
      return act(agent.id, prompt, options, calls);
    };
  }
  t.after(() => { quota.state = oldState; for (const { agent, ...values } of originals) Object.assign(agent, values); });
  const store = new HistoryStore(path.join(root, name));
  if (gemini) store.saveSettings({ geminiEnabled: true, geminiRiskAccepted: true });
  const runner = new SessionRunner({ store, coordinator, emit });
  const run = extra => runner.run({ cwd: process.cwd(), prompt: 'Build a feature and explain what was checked', ...extra });
  return { runner, store, calls, run };
}

test('Claude receives batched results and finishes with one management call and no extra synthesis', async t => {
  const f = fixture(t, 'batch', { tasks: [task('codex', 'Implementation'), task('claude', 'Documentation')], act: (id, prompt, options) => options.phase === 'coordination' ? done() : worker('completed', 'Result ' + options.step) });
  const result = await f.run();
  assert.equal(result.session.status, 'completed'); assert.equal(result.session.turns[0].plan.workflow, 'managed-v1');
  assert.deepEqual(f.calls.map(call => call.options.reason), ['Planlama', 'Focused work', 'Focused work', 'Koordinasyon kararı', 'Proje hafızasını güncelleme']);
  const management = f.calls.find(call => call.options.phase === 'coordination');
  assert.match(management.prompt, /Result 1/); assert.match(management.prompt, /Result 2/);
  assert.equal(management.options.level, 'hafif'); assert.equal(management.options.resumeId, undefined);
  assert.equal(result.session.turns[0].teamState.round, 1);
});

test('an agent asks Claude, receives a concrete answer and completes without a user transporting messages', async t => {
  let attempts = 0, decisions = 0;
  const f = fixture(t, 'question', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++decisions === 1 ? response({ action: 'continue', reason: 'Answer the design question', messages: [{ step: 1, toAgent: 'codex', content: 'Use the existing SQLite adapter.' }] }) : done();
    if (++attempts === 1) return worker('needs_input', 'Which database adapter should I use?');
    assert.match(prompt, /Use the existing SQLite adapter/); return worker('completed', 'Adapter implemented');
  } });
  const result = await f.run(), turn = result.session.turns[0];
  assert.equal(result.session.status, 'completed'); assert.equal(attempts, 2); assert.equal(decisions, 2);
  assert.equal(turn.teamState.attempts[1], 2); assert.equal(turn.outputs.length, 1);
  assert.ok(turn.activities.some(event => event.type === 'agent_question' && event.toAgent === 'claude'));
  assert.ok(turn.activities.some(event => event.type === 'coordinator_reply' && event.toAgent === 'codex'));
  assert.equal(turn.activities.filter(event => event.type === 'task_completed').length, 1);
});

test('Claude routes a peer consultation to explicitly enabled Gemini and forwards only relevant output to Codex', async t => {
  let round = 0, codex = 0, gemini = 0;
  const f = fixture(t, 'peer', { gemini: true, act: (id, prompt, options) => {
    if (options.phase === 'coordination') {
      round++;
      if (round === 1) return response({ action: 'continue', reason: 'Ask the peer for the format', tasks: [{ ...task('gemini', 'Recommend the existing date format'), sourceSteps: [1] }] });
      if (round === 2) return response({ action: 'continue', reason: 'Forward the peer answer', messages: [{ step: 1, toAgent: 'codex', content: 'Follow Gemini’s format recommendation.', sourceSteps: [2] }] });
      return done();
    }
    if (id === 'gemini') { gemini++; assert.match(prompt, /Which date format/); return worker('completed', 'Use ISO 8601'); }
    if (++codex === 1) return worker('needs_input', 'Which date format fits this project?', 'gemini');
    assert.match(prompt, /Use ISO 8601/); return worker('completed', 'Date formatting implemented');
  } });
  const result = await f.run(); assert.equal(result.session.status, 'completed'); assert.equal(gemini, 1); assert.equal(codex, 2); assert.equal(round, 3);
  assert.ok(result.session.turns[0].activities.some(event => event.type === 'output_transferred' && event.fromAgent === 'gemini' && event.toAgent === 'codex'));
});

test('a concrete revision is a new task; completed work is retained and never automatically rerun', async t => {
  let round = 0; const steps = [];
  const f = fixture(t, 'revision', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++round === 1 ? response({ action: 'continue', reason: 'Cover an identified edge case', tasks: [{ ...task('codex', 'Add the missing empty-input guard'), revisionOf: 1, sourceSteps: [1] }] }) : done();
    steps.push(options.step); return worker('completed', 'Implemented step ' + options.step);
  } });
  const result = await f.run(); assert.equal(result.session.status, 'completed'); assert.deepEqual(steps, [1, 2]);
  assert.equal(result.session.turns[0].plan.subtasks[1].revisionOf, 1); assert.equal(result.session.turns[0].outputs.length, 2);
});

test('manager validation rejects unavailable peers, completed-task replies, fake references and no-progress loops', () => {
  const plan = { subtasks: [{ ...task(), step: 1 }] }, outputs = [{ step: 1, success: true, output: 'Done' }];
  const env = { plan, outputs, attempts: {}, available: id => id !== 'gemini', parsePlan: coordinator.parsePlan };
  const parse = value => decision(JSON.stringify(value), env);
  assert.throws(() => parse({ action: 'continue', reason: 'No progress' }), /progress/);
  assert.throws(() => parse({ action: 'continue', reason: 'Ask disabled peer', tasks: [task('gemini')] }), /unavailable/);
  assert.throws(() => parse({ action: 'continue', reason: 'Repeat', messages: [{ step: 1, toAgent: 'codex', content: 'Again' }] }), /reply/);
  assert.throws(() => parse({ action: 'continue', reason: 'Bad source', tasks: [{ ...task(), sourceSteps: [99] }] }), /source/);
  assert.throws(() => parse({ action: 'finish', reason: 'No result' }), /result/);
  assert.throws(() => workerMessage('{"protocol":"worker-v1","status":"completed"}'), /response/);
  const normalized = parse({ action: 'continue', reason: 'Revision', tasks: [{ ...task(), model: 'invented-model', sourceSteps: [1] }] });
  assert.notEqual(normalized.tasks[0].model, 'invented-model');
});

test('malformed management never dispatches more work and preserves successful output', async t => {
  let work = 0;
  const f = fixture(t, 'invalid', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return response('not JSON');
    work++; return worker('completed', 'Preserved implementation');
  } });
  const result = await f.run(); assert.equal(work, 1); assert.equal(result.session.status, 'partial');
  assert.equal(result.session.turns[0].outputs[0].output, 'Preserved implementation'); assert.equal(result.session.turns[0].result.stopReason, 'coordination_failed');
});

test('coordination stops at three management rounds and resuming a budget-stopped workflow makes no more CLI calls', async t => {
  let rounds = 0, work = 0;
  const f = fixture(t, 'limit', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return response({ action: 'continue', reason: 'Extra focused work ' + (++rounds), tasks: [task('codex', 'Different work ' + rounds)] });
    work++; return worker('completed', 'Work ' + work);
  } });
  const first = await f.run(); assert.equal(rounds, LIMITS.coordinationRounds); assert.equal(work, 4);
  assert.equal(first.session.status, 'partial'); assert.equal(first.session.turns[0].result.stopReason, 'coordination_limit');
  const count = f.calls.length; await f.run({ sessionId: first.session.id, resume: true }); assert.equal(f.calls.length, count);
});

test('cancelling during management preserves a pending question and resumes with Claude’s answer rather than repeating the question', async t => {
  let requestedResolve, cancelledOnce = false, workers = 0, decisions = 0;
  const requested = new Promise(resolve => { requestedResolve = resolve; });
  const f = fixture(t, 'resume-question', { act: async (id, prompt, options) => {
    if (options.phase === 'coordination') {
      decisions++;
      if (!cancelledOnce) {
        requestedResolve(); await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
        cancelledOnce = true; return { code: -998, cancelled: true, stdout: 'Partial manager response', stderr: '', durationMs: 1 };
      }
      return workers === 1 ? response({ action: 'continue', reason: 'Answer saved question', messages: [{ step: 1, toAgent: 'codex', content: 'Use the existing adapter.' }] }) : done();
    }
    return ++workers === 1 ? worker('needs_input', 'Which adapter?') : worker('completed', 'Implemented');
  } });
  const pending = f.run(); await requested; f.runner.cancel(); const first = await pending;
  assert.equal(first.session.status, 'cancelled'); assert.equal(first.session.turns[0].outputs[0].status, 'awaiting_input');
  const result = await f.run({ sessionId: first.session.id, resume: true });
  assert.equal(result.session.status, 'completed'); assert.equal(workers, 2); assert.equal(decisions, 3);
  assert.equal(f.calls.filter(call => call.options.reason === 'Planlama').length, 1);
});

test('follow-up plan approval is editable and cannot use stale approval IDs', async t => {
  let round = 0, workers = 0;
  const approvals = []; let notify;
  const nextApproval = async count => { if (approvals.length >= count) return approvals[count - 1]; await new Promise(resolve => { notify = resolve; }); return approvals[count - 1]; };
  const f = fixture(t, 'approval', { emit: (channel, data) => { if (channel === 'session:approval') { approvals.push(data); notify?.(); } }, act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++round === 1 ? response({ action: 'continue', reason: 'A needed follow-up', tasks: [task('codex', 'Proposed follow-up')] }) : done();
    workers++; return worker('completed', 'Done ' + options.step);
  } });
  const pending = f.run({ options: { previewPlan: true } });
  const first = await nextApproval(1); f.runner.approvePlan(first);
  const second = await nextApproval(2);
  assert.equal(workers, 1); assert.notEqual(first.runId, second.runId);
  assert.throws(() => f.runner.approvePlan(first), /matching/);
  const edited = structuredClone(second); edited.plan.subtasks[0].prompt = 'User-edited follow-up'; f.runner.approvePlan(edited);
  const result = await pending; assert.equal(result.session.status, 'completed');
  assert.match(f.calls.find(call => call.options.step === 2).prompt, /User-edited follow-up/);
});

test('cancelling follow-up approval keeps the decision and resumes it without a new management call', async t => {
  let decisions = 0, workers = 0, signalApproval;
  const approvals = []; const approved = new Promise(resolve => { signalApproval = resolve; });
  let runner;
  const f = fixture(t, 'cancel-follow-up', { emit: (channel, data) => {
    if (channel !== 'session:approval') return;
    approvals.push(data);
    if (approvals.length === 1) queueMicrotask(() => runner.approvePlan(data));
    else signalApproval(data);
  }, act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++decisions === 1 ? response({ action: 'continue', reason: 'Add focused follow-up', tasks: [task('codex', 'Missing edge case')] }) : done();
    workers++; return worker('completed', 'Done ' + options.step);
  } }); runner = f.runner;
  const pending = f.run({ options: { previewPlan: true } }); await approved; runner.cancel(); const first = await pending;
  assert.equal(first.session.status, 'cancelled'); assert.equal(workers, 1); assert.equal(decisions, 1);
  const resumedApproval = new Promise(resolve => { signalApproval = resolve; });
  const resumed = f.run({ sessionId: first.session.id, resume: true }); const request = await resumedApproval;
  assert.equal(decisions, 1); runner.approvePlan(request);
  assert.equal((await resumed).session.status, 'completed'); assert.equal(workers, 2); assert.equal(decisions, 2);
});

test('an explicit resume can recover a transient management failure without redoing a successful worker', async t => {
  let management = 0, workers = 0;
  const f = fixture(t, 'transient-manager', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++management === 1 ? response('invalid management JSON') : done();
    workers++; return worker('completed', 'Saved change');
  } });
  const first = await f.run(); assert.equal(first.session.status, 'partial');
  const second = await f.run({ sessionId: first.session.id, resume: true });
  assert.equal(second.session.status, 'completed'); assert.equal(workers, 1); assert.equal(management, 2);
});

test('only bounded relevant excerpts are sent and no native transcript is resumed for managed calls', async t => {
  let round = 0;
  const f = fixture(t, 'bounded-context', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') {
      assert.ok(!prompt.includes('TAIL-MUST-NOT-BE-SHARED'));
      return ++round === 1 ? response({ action: 'continue', reason: 'Review only the relevant excerpt', tasks: [{ ...task('claude', 'Explain the implementation'), sourceSteps: [1] }] }) : done();
    }
    if (options.step === 2) { assert.ok(!prompt.includes('TAIL-MUST-NOT-BE-SHARED')); return worker('completed', 'Explained'); }
    return worker('completed', 'x'.repeat(5000) + 'TAIL-MUST-NOT-BE-SHARED');
  } });
  const result = await f.run(); assert.equal(result.session.status, 'completed');
  assert.ok(f.calls.every(call => call.options.resumeId === undefined));
});

test('the global call budget reserves the final call for Claude and never starts a worker past the cap', async t => {
  const f = fixture(t, 'global-budget', { act: (id, prompt, options) => { assert.equal(options.phase, 'coordination'); return done(); } });
  const plan = { workflow: 'managed-v1', subtasks: [{ ...task(), step: 1 }] };
  const context = { cwd: process.cwd(), prompt: 'Work', calls: LIMITS.calls - 1, options: {}, log: () => {} };
  const result = await coordinator.executePlan(plan, context);
  assert.equal(context.calls, LIMITS.calls); assert.equal(f.calls.length, 1); assert.equal(result.success, false);
});

test('identical failed work is blocked across management-created tasks without another worker call', async t => {
  let rounds = 0, workers = 0;
  const f = fixture(t, 'repeated-failure', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++rounds === 1 ? response({ action: 'continue', reason: 'Try the same operation', tasks: [task()] }) : done();
    workers++; return worker('failed', 'Operation could not be completed');
  } });
  const result = await f.run(); assert.equal(workers, 1); assert.equal(result.session.status, 'failed');
  assert.equal(result.session.turns[0].outputs[1].status, 'blocked');
});

test('a resumed worker keeps its CLI session and receives only the new instruction', async t => {
  let workerRuns = 0, decisions = 0;
  const f = fixture(t, 'worker-resume', { act: (id, prompt, options) => {
    if (options.phase === 'coordination') return ++decisions === 1
      ? response({ action: 'continue', reason: 'Answer the design question', messages: [{ step: 1, toAgent: 'codex', content: 'Use the existing SQLite adapter.' }] })
      : done();
    workerRuns++;
    if (workerRuns === 1) return { ...worker('needs_input', 'Which adapter?'), sessionId: 'sess-worker-1' };
    assert.equal(options.resumeId, 'sess-worker-1');
    assert.ok(!/PROJE HAFIZASI/.test(prompt), 'a resumed prompt must not resend memory');
    assert.match(prompt, /Use the existing SQLite adapter/);
    return { ...worker('completed', 'Adapter implemented'), sessionId: 'sess-worker-1' };
  } });
  const result = await f.run(), turn = result.session.turns[0];
  assert.equal(result.session.status, 'completed'); assert.equal(workerRuns, 2);
  assert.equal(turn.teamState.workerSessions[1], 'sess-worker-1');
  assert.equal(turn.teamState.replies[1], 1);
  assert.ok(f.calls.every(call => call.options.resumeId === 'sess-worker-1' || call.options.resumeId === undefined));
});
