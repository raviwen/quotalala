const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { HistoryStore } = require('../src/main/storage');
const { sanitize, redact } = require('../src/main/privacy');
const { errorType } = require('../src/main/events');
const { HealthService } = require('../src/main/health');
const { SessionRunner } = require('../src/main/session-runner');
const LogModel = require('../src/renderer/log-model');
const { launchOptions } = require('../bin/quotalala');
const root = path.resolve('.test-artifacts', 'unit-' + randomUUID());
process.env.QUOTALALA_DATA_DIR = path.join(root, 'quota');

test('npm launcher uses the caller folder even without project markers and rejects Electron flags', () => {
  const cwd = path.join(root, 'Project with spaces & Unicode İ'); fs.mkdirSync(cwd, { recursive: true });
  const env = { ELECTRON_RUN_AS_NODE: '1', KEEP: 'yes' };
  const result = launchOptions([], { cwd, env, appDir: '/app' });
  assert.deepEqual(result.args, ['/app', '--project', fs.realpathSync(cwd)]);
  assert.equal(result.options.cwd, fs.realpathSync(cwd));
  assert.equal(result.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(result.options.env.KEEP, 'yes');
  assert.equal(result.options.shell, undefined);
  assert.throws(() => launchOptions(['--no-sandbox'], { cwd }), /Usage/);
  const child = path.join(cwd, 'nested'); fs.mkdirSync(child);
  assert.equal(launchOptions(['--project', 'nested'], { cwd }).options.cwd, fs.realpathSync(child));
  assert.equal(launchOptions(['nested'], { cwd }).options.cwd, fs.realpathSync(child));
  assert.throws(() => launchOptions(['--project'], { cwd }), /Usage/);
  assert.throws(() => launchOptions(['missing'], { cwd }));
});

test('secret masking preserves useful diagnostics and masks nested credentials', () => {
  const secret = 'sk-proj-' + 'a'.repeat(40);
  const masked = sanitize({ text: `quota error ${secret} Bearer xyz123`, nested: { access_token: 'private-value' }, raw: 'API_KEY="secret with spaces"\ntoken: abcdef\ncode: 429' });
  assert.equal(masked.nested.access_token, '[REDACTED]');
  assert.ok(!JSON.stringify(masked).includes(secret));
  assert.ok(!masked.raw.includes('secret with spaces'));
  assert.match(masked.raw, /code: 429/);
  assert.match(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature'), /REDACTED/);
});
test('sessions are separate records, grouped by project, full output persisted masked', () => {
  const store = new HistoryStore(path.join(root, 'sessions-test'));
  const session = store.create(process.cwd(), 'Short goal');
  session.turns.push({ prompt: 'Goal', outputs: [{ output: 'x'.repeat(500) + ' token=secret' }] });
  store.save(session);
  assert.equal(store.list()[0].cwd, process.cwd());
  assert.ok(store.open(session.id).turns[0].outputs[0].output.length > 500);
  assert.ok(!fs.readFileSync(store.sessionPath(session.id), 'utf8').includes('token=secret'));
  store.rename(session.id, 'Renamed'); assert.equal(store.open(session.id).title, 'Renamed');
  assert.throws(() => store.open('../../auth.json'), /Invalid session/);
  store.saveMemory(process.cwd(), 'x'.repeat(3000)); assert.equal(store.memory(process.cwd()).summary.length, 2000);
  store.saveSettings({ saveHistory: false });
  const ignored = store.create(process.cwd(), 'Not saved'); store.save(ignored);
  assert.equal(store.list().length, 1);
  store.saveMemory(process.cwd(), 'Not automatically saved'); assert.equal(store.memory(process.cwd()).summary.length, 2000);
  assert.throws(() => store.saveSettings({ geminiEnabled: true }), /risk acceptance/);
  assert.equal(store.saveSettings({ geminiEnabled: true, geminiRiskAccepted: true }).geminiEnabled, true);
  // No cleanup/delete: repository policy requires user permission before deleting files.
});
test('health cards and logs share committed state; failure cannot keep spinner running', async () => {
  const state = { agents: { claude: { enabled: true }, codex: { enabled: true }, gemini: { enabled: false } } };
  const events = [];
  const quota = { getState: () => state, getAgent: id => state.agents[id], setAgentStatus: (id, status, details = {}) => Object.assign(state.agents[id], { status }, details) };
  let geminiCalls = 0;
  const service = new HealthService({ quota, models: { getModelByLevel: () => ({ name: 'mock-light' }) }, emit: (channel, data) => events.push({ channel, data: structuredClone(data) }), agents: [
    { id: 'claude', runHealthTest: async () => ({ healthy: true, message: 'OK', version: 'v1' }) },
    { id: 'codex', runHealthTest: async () => { throw new Error('login required'); } },
    { id: 'gemini', runHealthTest: async () => { geminiCalls++; } }
  ] });
  const snapshot = await service.run();
  assert.equal(snapshot.healthRunning, false); assert.equal(geminiCalls, 0);
  const successLog = events.find(e => e.channel === 'stream:log' && e.data.agent === 'claude');
  assert.equal(successLog.data.state.agents.claude.health.healthy, true);
  assert.equal(snapshot.agents.codex.status, 'unauthenticated');
  assert.equal(events.at(-1).data.healthRunning, false);
  assert.equal(events.find(e => e.channel === 'stream:log' && e.data.agent === 'codex').data.errorType, 'auth');
});
test('log levels and combined agent filters select the same rows for copying', () => {
  const logs = [
    { text: 'OK', level: 'success', agent: 'claude' },
    { text: 'quota exceeded', level: 'error', agent: 'codex' },
    { text: 'fallback', level: 'warning', agent: 'codex' },
    { text: 'missing CLI', level: 'error', agent: 'gemini' }
  ].map(LogModel.normalize);
  assert.equal(LogModel.filter(logs, 'error', 'codex').length, 1);
  assert.match(LogModel.text(LogModel.filter(logs, 'warning', 'codex')), /fallback/);
  assert.equal(errorType('spawn agy ENOENT'), 'not_found');
  assert.equal(errorType('usage quota 429'), 'quota'); assert.equal(errorType('login expired'), 'auth');
});
test('mock end-to-end records prompt, plan, outputs and memory, then resumes exact session', async () => {
  const store = new HistoryStore(path.join(root, 'e2e'));
  let resumed, contextMemory;
  const coordinator = {
    planSubtasks: async (prompt, context) => { contextMemory = context.memory; resumed = context.cliSessions.claude; context.cliSessions.claude = 'mock-native-id'; return { summary: 'OK', subtasks: [{ step: 1, agent: 'claude', prompt }] }; },
    executePlan: async (plan, context) => { const output = { step: 1, agent: 'claude', output: 'OK', success: true }; context.onOutput(output); return { plan, outputs: [output], finalResult: 'OK', success: true }; },
    updateMemory: async () => 'Project: mock. Last work: OK. Open tasks: none.'
  };
  const runner = new SessionRunner({ store, coordinator, emit: () => {} });
  const first = await runner.run({ prompt: 'OK', cwd: process.cwd() });
  assert.equal(first.session.status, 'completed'); assert.equal(store.list().length, 1);
  assert.equal(store.open(first.session.id).turns[0].result.finalResult, 'OK');
  assert.match(store.memory(process.cwd()).summary, /Last work/);
  await runner.run({ prompt: 'Again', cwd: process.cwd(), sessionId: first.session.id });
  assert.equal(store.open(first.session.id).turns.length, 2); assert.equal(resumed, 'mock-native-id'); assert.match(contextMemory, /Project/);
});
test('failed synthesis retains partial outputs; memory failure preserves previous summary', async () => {
  const store = new HistoryStore(path.join(root, 'failure'));
  store.saveMemory(process.cwd(), 'previous memory');
  const runner = new SessionRunner({ store, coordinator: {
    planSubtasks: async () => ({ subtasks: [] }),
    executePlan: async (plan, context) => { context.onOutput({ step: 1, output: 'completed worker output', success: true }); throw new Error('synthesis failed'); },
    updateMemory: async () => { throw new Error('quota exceeded'); }
  }, emit: () => {} });
  const result = await runner.run({ prompt: 'OK', cwd: process.cwd() });
  assert.equal(result.session.status, 'failed'); assert.equal(result.session.turns[0].outputs.length, 1);
  assert.equal(result.memory.summary, 'previous memory'); assert.equal(runner.busy, false);
});
test('native resume arguments use only verified capabilities and stdin', () => {
  const claude = require('../src/main/agents/claude'), codex = require('../src/main/agents/codex'), gemini = require('../src/main/agents/gemini');
  claude.capabilities = codex.capabilities = { resume: true };
  assert.ok(claude.getRunArgs('SECRET PROMPT', { resumeId: 'id' }).includes('--resume'));
  assert.deepEqual(codex.getRunArgs('SECRET PROMPT', { resumeId: 'id' }).slice(0, 3), ['exec', 'resume', 'id']);
  assert.equal(codex.getRunArgs('SECRET PROMPT', {}).at(-1), '-');
  assert.ok(!claude.getRunArgs('SECRET PROMPT', {}).includes('SECRET PROMPT'));
  assert.throws(() => gemini.getRunArgs('SECRET PROMPT', {}), /stdin/);
});
test('preview-only catalog does not silently become a default model', () => {
  const models = require('../src/main/models');
  const old = models.getModels;
  try { models.getModels = () => [{ agent: 'claude', name: 'mock-preview', preview: true, level: 'hafif', cost: 1 }]; assert.equal(models.getModelByLevel('claude', 'hafif'), null); }
  finally { models.getModels = old; }
});

test('memory generation preserves the native task conversation ID', async () => {
  const coordinator = require('../src/main/coordinator');
  const agent = require('../src/main/agents/claude');
  const saved = agent.runPrompt;
  agent.capabilities = { resume: true, noTools: true };
  const context = { cwd: process.cwd(), cliSessions: { claude: 'task-session' }, log: () => {}, memory: '' };
  let options;
  try {
    agent.runPrompt = async (prompt, opts) => { options = opts; return { code: 0, stdout: 'Project summary', sessionId: 'memory-session', durationMs: 1 }; };
    await coordinator.updateMemory(context, { prompt: 'OK', status: 'completed', outputs: [], result: { finalResult: 'OK' } });
    assert.equal(context.cliSessions.claude, 'task-session'); assert.equal(options.resumeId, undefined);
  } finally { agent.runPrompt = saved; }
});
test('Windows batch CLI preserves empty arguments, spaces and stdin without shell interpolation', { skip: process.platform !== 'win32' }, async () => {
  const dir = path.join(root, 'CLI with spaces'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixture.cjs'), "let input='';process.stdin.on('data',data=>input+=data);process.stdin.on('end',()=>console.log(JSON.stringify({args:process.argv.slice(2),input})));", 'utf8');
  fs.writeFileSync(path.join(dir, 'fixture.cmd'), '@echo off\r\nnode "%~dp0fixture.cjs" %*\r\n', 'utf8');
  const { runWithStdin } = require('../src/main/cli-locator');
  const result = await runWithStdin(path.join(dir, 'fixture.cmd'), ['--tools', '', 'value with spaces'], 'prompt & $() stays on stdin\n');
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout); assert.deepEqual(data.args, ['--tools', '', 'value with spaces']); assert.match(data.input, /prompt & \$\(\)/);
  const unsafe = await runWithStdin(path.join(dir, 'fixture.cmd'), ['bad&argument'], ''); assert.equal(unsafe.code, -1);
});

test('enabled Gemini verifies help once and sends no prompt in argv', async () => {
  const agent = require('../src/main/agents/gemini');
  const { discover } = require('../src/main/capabilities');
  const saved = { execute: agent.execute, capabilities: agent.capabilities };
  let calls = 0;
  try {
    agent.capabilities = null;
    agent.execute = async args => { calls++; assert.deepEqual(args, ['--help']); return { code: 0, stdout: '-p, --print  Headless output from stdin\n--model <model>\n--effort <level>' }; };
    await discover(agent); await discover(agent);
    const args = agent.getRunArgs('DO NOT EXPOSE THIS PROMPT', { model: 'mock', thinking: 'low' });
    assert.equal(calls, 1); assert.ok(!args.includes('DO NOT EXPOSE THIS PROMPT')); assert.ok(args.includes('--model'));
  } finally { Object.assign(agent, saved); }
});
test('unavailable health-test model falls back once to the default', async () => {
  const BaseAgent = require('../src/main/agents/base-agent');
  const agent = new BaseAgent({ id: 'claude' });
  agent.getVersion = async () => 'mock'; agent.checkAuth = async () => ({ loggedIn: true });
  const calls = [];
  agent.runPrompt = async (prompt, options) => { calls.push(options); return options.model ? { code: 1, stdout: '', stderr: 'model not available', durationMs: 1 } : { code: 0, stdout: 'OK', stderr: '', durationMs: 1 }; };
  const result = await agent.runHealthTest(() => {}, { model: 'mock-light' });
  assert.equal(result.healthy, true); assert.equal(result.modelFallback, true); assert.equal(calls.length, 2); assert.equal(calls[1].model, undefined);
});

test('project activity context is capped at 20 headings and prioritizes the continued session', async () => {
  const store = new HistoryStore(path.join(root, 'activity-context'));
  const { activityEntry } = require('../src/main/events');
  const project = store.create(process.cwd(), 'Prior session');
  project.turns = [{ activities: Array.from({ length: 25 }, (_, index) => ({ ...activityEntry({ type: 'task_completed', agent: 'codex', taskTitle: `Task ${index}`, input: 'PRIVATE INPUT', output: 'LONG PRIVATE OUTPUT' }), timestamp: new Date(1000 + index).toISOString() })) }];
  store.save(project);
  const other = store.create(path.join(process.cwd(), 'other-project'), 'Unrelated project');
  other.turns = [{ activities: [activityEntry({ type: 'task_completed', taskTitle: 'UNRELATED' })] }]; store.save(other);
  const contexts = [];
  const runner = new SessionRunner({ store, emit: () => {}, coordinator: {
    planSubtasks: async (prompt, context) => { contexts.push({ recent: context.recentActivity, resume: context.resumeTimeline, memory: context.memory }); return { subtasks: [{ step: 1, agent: 'codex', prompt }] }; },
    executePlan: async () => ({ success: true, finalResult: 'OK' }), updateMemory: async () => 'Project summary'
  } });
  await runner.run({ prompt: 'New goal', cwd: process.cwd() });
  assert.equal(contexts[0].recent.length, 20); assert.match(contexts[0].recent[0], /Task 5/); assert.equal(contexts[0].resume.length, 0);
  assert.ok(!JSON.stringify(contexts[0]).includes('PRIVATE')); assert.ok(!JSON.stringify(contexts[0]).includes('UNRELATED'));
  await runner.run({ prompt: 'Continue', cwd: process.cwd(), sessionId: project.id });
  assert.equal(contexts[1].resume.length, 20); assert.equal(contexts[1].recent.length, 0);
  assert.match(contexts[1].resume.at(-1), /Task 24/);
  const saved = store.open(project.id); assert.ok(saved.turns.at(-1).activities.some(event => event.type === 'plan_created'));
  assert.ok(saved.turns.at(-1).activities.some(event => event.type === 'session_finished'));
});

test('coordinator persists assignments, quota switches, transfers and final review without live CLIs', async () => {
  const coordinator = require('../src/main/coordinator'), quota = require('../src/main/quota'), models = require('../src/main/models');
  const agents = require('../src/main/agents');
  const store = new HistoryStore(path.join(root, 'activity-flow'));
  const savedState = structuredClone(quota.getState());
  const savedModel = models.getModelByLevel;
  const originals = agents.getAllAgents().map(agent => ({ agent, runPrompt: agent.runPrompt, capabilities: agent.capabilities }));
  let plannerInput, codexCalls = 0;
  const token = 'sk-proj-' + 'x'.repeat(30);
  try {
    models.getModelByLevel = (id, level) => ({ name: `mock-${id}-${level}`, level, params: {} });
    for (const { agent } of originals) {
      quota.state.agents[agent.id].enabled = agent.id !== 'gemini'; quota.state.agents[agent.id].status = 'idle';
      agent.capabilities = { resume: true, noTools: true };
      agent.runPrompt = async (prompt, options) => {
        if (options.reason === 'Koordinasyon kararı') return { code: 0, stdout: JSON.stringify({ action: 'finish', reason: 'Mock review', result: `OK ${token}` }), stderr: '', durationMs: 1 };
        if (agent.id === 'codex') { codexCalls++; return { code: 1, stdout: '', stderr: 'quota exceeded', durationMs: 1 }; }
        if (options.reason === 'Planlama') {
          plannerInput = prompt;
          return { code: 0, stdout: JSON.stringify({ summary: 'Two tasks', subtasks: [
            { step: 1, title: 'API routes', agent: 'codex', level: 'orta', rationale: 'Coding work', prompt: 'Build routes' },
            { step: 2, title: 'Review routes', agent: 'claude', level: 'hafif', rationale: 'Review', prompt: 'Review', needsPreviousOutput: true }
          ] }), durationMs: 1 };
        }
        return { code: 0, stdout: `OK ${token}`, sessionId: 'mock-native', durationMs: 1 };
      };
    }
    const runner = new SessionRunner({ store, coordinator, emit: () => {} });
    const first = await runner.run({ prompt: 'Work', cwd: process.cwd() });
    assert.equal(first.session.status, 'completed'); assert.equal(codexCalls, 1);
    const events = store.open(first.session.id).turns[0].activities;
    for (const type of ['plan_created', 'task_assigned', 'task_failed', 'agent_switched', 'task_completed', 'output_transferred', 'final_review_started', 'final_review_completed']) assert.ok(events.some(event => event.type === type), type);
    const assigned = events.find(event => event.type === 'task_assigned');
    assert.equal(assigned.agent, 'codex'); assert.equal(assigned.model, 'mock-codex-orta'); assert.equal(assigned.level, 'orta'); assert.equal(assigned.reason, 'Coding work');
    assert.equal(events.find(event => event.type === 'agent_switched').cause, 'quota');
    assert.ok(events.some(event => event.type === 'output_transferred' && event.toAgent === 'claude' && event.sourceStep === 1));
    assert.ok(events.find(event => event.type === 'task_completed').assignmentId);
    assert.ok(!JSON.stringify(events).includes(token));
    const final = events.find(event => event.type === 'final_review_completed'); assert.match(final.output, /REDACTED/);
    await runner.run({ prompt: 'Continue', cwd: process.cwd(), sessionId: first.session.id });
    assert.match(plannerInput, /DEVAM EDİLEN OTURUMUN ZAMAN ÇİZELGESİ/);
    assert.match(plannerInput, /API routes/); assert.ok(!plannerInput.includes('quota exceeded')); assert.ok(!plannerInput.includes(token));
  } finally {
    models.getModelByLevel = savedModel; quota.state = savedState;
    for (const { agent, runPrompt, capabilities } of originals) Object.assign(agent, { runPrompt, capabilities });
  }
});

test('final review failure is recorded as failure, never completed', async () => {
  const coordinator = require('../src/main/coordinator'), agent = require('../src/main/agents/claude'), quota = require('../src/main/quota');
  const original = agent.runPrompt, originalCapabilities = agent.capabilities, originalState = structuredClone(quota.getState());
  const { activityEntry } = require('../src/main/events'); const events = [];
  try {
    quota.state.agents.claude.enabled = true;
    agent.capabilities = { resume: true, noTools: true };
    agent.runPrompt = async () => ({ code: 1, stdout: '', stderr: 'quota exceeded', durationMs: 1 });
    await assert.rejects(() => coordinator.executePlan({ subtasks: [] }, { cwd: process.cwd(), prompt: 'Review', log: () => {}, activity: value => { const event = activityEntry(value); events.push(event); return event; } }), /quota/);
    assert.ok(events.some(event => event.type === 'final_review_started'));
    assert.ok(events.some(event => event.type === 'final_review_failed'));
    assert.ok(!events.some(event => event.type === 'final_review_completed'));
  } finally { agent.runPrompt = original; agent.capabilities = originalCapabilities; quota.state = originalState; }
});

test('normal CLI exit does not count an unreadable project as reviewed', () => {
  const { evaluateTask } = require('../src/main/task-outcome');
  const output = 'İnceleme gerçekleştirilemedi. Proje dosyalarını okuyamadım. Get-ChildItem -Name blocked by policy.';
  assert.deepEqual(evaluateTask({ code: 0, stdout: output }, { requiresFileEvidence: true }), { status: 'blocked', cause: 'policy' });
  assert.equal(evaluateTask({ code: 0, stdout: 'Everything looks good.' }, { requiresFileEvidence: true }).status, 'failed');
  assert.equal(evaluateTask({ code: 0, stdout: 'OK' }).status, 'completed');
  assert.equal(evaluateTask({ stdout: 'Earlier attempt failed; now see src/app.js:12.', toolChecksAvailable: true, successfulFileCommands: 1, toolFailures: [{ policyBlocked: true }] }, { requiresFileEvidence: true }).status, 'completed');
});

test('Codex preserves denied tool execution while keeping only the final answer', async () => {
  const agent = require('../src/main/agents/codex'); const original = agent.execute;
  try {
    agent.execute = async () => ({ code: 0, stderr: '', durationMs: 1, stdout: [
      { type: 'item.completed', item: { type: 'agent_message', text: 'I will inspect files.' } },
      { type: 'item.completed', item: { type: 'command_execution', command: 'rg --files', exit_code: 1, status: 'failed', aggregated_output: 'blocked by policy' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Could not read any files.' } }
    ].map(JSON.stringify).join('\n') });
    const result = await agent.runPrompt('Review', {});
    assert.equal(result.stdout, 'Could not read any files.'); assert.equal(result.toolFailures[0].policyBlocked, true); assert.equal(result.successfulFileCommands, 0);
  } finally { agent.execute = original; }
});

test('shared file-policy failure blocks remaining reviews without more worker calls', async () => {
  const coordinator = require('../src/main/coordinator'), agents = require('../src/main/agents'), quota = require('../src/main/quota');
  const originalState = structuredClone(quota.getState());
  const originals = agents.getAllAgents().map(agent => ({ agent, runPrompt: agent.runPrompt, capabilities: agent.capabilities }));
  const events = []; const { activityEntry } = require('../src/main/events'); let workers = 0;
  try {
    for (const { agent } of originals) {
      quota.state.agents[agent.id].enabled = agent.id !== 'gemini'; quota.state.agents[agent.id].status = 'idle';
      agent.capabilities = { resume: true, noTools: true };
      agent.runPrompt = async (prompt, options) => {
        if (options.phase === 'task') { workers++; return { code: 0, stdout: 'Klasöre erişim engellendi; inceleme yapılamadı. blocked by policy', stderr: '', durationMs: 1, toolChecksAvailable: true, toolFailures: [{ policyBlocked: true }], successfulFileCommands: 0 }; }
        return { code: 0, stdout: 'İnceleme yapılamadı.', stderr: '', durationMs: 1 };
      };
    }
    const before = quota.getAgent('codex').jobsCompleted;
    const result = await coordinator.executePlan({ subtasks: [1, 2, 3].map(step => ({ step, title: `Review ${step}`, agent: 'codex', level: 'hafif', prompt: 'Projeyi salt okunur incele', rationale: 'Review' })) }, {
      cwd: process.cwd(), prompt: 'Review project', log: () => {}, onOutput: () => {}, activity: value => { const event = activityEntry(value); events.push(event); return event; }
    });
    assert.equal(workers, 1); assert.equal(result.status, 'blocked'); assert.equal(result.success, false);
    assert.ok(result.outputs.every(output => !output.success && output.status === 'blocked'));
    assert.equal(quota.getAgent('codex').jobsCompleted, before);
    assert.equal(events.filter(event => event.type === 'task_blocked').length, 3);
    assert.ok(!events.some(event => event.type === 'task_completed'));
  } finally { quota.state = originalState; for (const { agent, runPrompt, capabilities } of originals) Object.assign(agent, { runPrompt, capabilities }); }
});

test('active workspace persists and launch folder overrides previous project without per-task paths', () => {
  const { WorkspaceManager, launchProject } = require('../src/main/workspace');
  const location = path.join(root, 'workspace-test'), a = path.join(location, 'Project A'), b = path.join(location, 'Project B');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'README.md'), 'Project B', 'utf8');
  const manager = new WorkspaceManager(location);
  assert.equal(manager.get().cwd, null); assert.throws(() => manager.requireProject(), /Open a project/);
  manager.open(a); assert.equal(manager.requireProject(), fs.realpathSync(a));
  const reopened = new WorkspaceManager(location);
  reopened.initialize(['quotalala.exe'], { packaged: true, cwd: location });
  assert.equal(reopened.get().cwd, fs.realpathSync(a));
  reopened.initialize(['quotalala.exe', '--project', b], { packaged: true, cwd: location });
  assert.equal(reopened.get().cwd, fs.realpathSync(b)); assert.equal(reopened.get().recentProjects.length, 2);
  assert.equal(launchProject(['quotalala.exe'], { packaged: true, cwd: b }), fs.realpathSync(b));
  assert.equal(launchProject(['quotalala.exe', a], { packaged: true, cwd: b }), fs.realpathSync(a));
  assert.throws(() => launchProject(['quotalala.exe', '--project'], { packaged: true, cwd: b }), /requires a directory/);
  const failed = new WorkspaceManager(location);
  failed.initialize(['quotalala.exe', '--project', path.join(location, 'missing')], { packaged: true, cwd: location });
  assert.equal(failed.get().cwd, null); assert.ok(failed.get().error);
});

test('opening a folder shows only that project’s Quotalala conversations', () => {
  const store = new HistoryStore(path.join(root, 'filtered-projects'));
  const a = store.create(process.cwd(), 'This project'), b = store.create(path.join(process.cwd(), 'another-project'), 'Another project');
  store.save(a); store.save(b);
  assert.equal(store.list().length, 2); assert.deepEqual(store.list(process.cwd()).map(item => item.id), [a.id]);
});

test('corrupt local settings, workspace and memory cannot crash startup or exceed memory budget', () => {
  const dir = path.join(root, 'corrupt-data'); fs.mkdirSync(dir, { recursive: true });
  const { projectKey } = require('../src/main/storage'), { WorkspaceManager } = require('../src/main/workspace');
  const store = new HistoryStore(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), 'null'); fs.writeFileSync(path.join(dir, 'workspace.json'), 'null');
  assert.equal(store.getSettings().geminiEnabled, false); assert.equal(new WorkspaceManager(dir).get().cwd, null);
  const memoryDir = path.join(dir, 'memory'); fs.mkdirSync(memoryDir);
  const file = path.join(memoryDir, `${projectKey(process.cwd())}.json`);
  fs.writeFileSync(file, JSON.stringify({ summary: 'x'.repeat(9000) })); assert.equal(store.memory(process.cwd()).summary.length, 2000);
  fs.writeFileSync(file, JSON.stringify({ summary: { invalid: true } })); assert.equal(store.memory(process.cwd()).summary, '');
});

test('model catalog validation rejects malformed JSON structures and unsafe names', () => {
  const models = require('../src/main/models');
  assert.throws(() => models.validateModels({ agent: 'codex' }));
  assert.throws(() => models.validateModels([{ agent: 'codex', name: 'model&command', source: 'fixture', level: 'hafif', cost: 1 }]));
  assert.throws(() => models.validateModels([{ agent: 'codex', name: '--unexpected-flag', source: 'fixture', level: 'hafif', cost: 1 }]));
  assert.throws(() => models.validateModels([{ agent: 'codex', name: 'mock', source: 'fixture', levels: { hafif: { cost: -1 } } }]));
  assert.deepEqual(models.validateModels([]), []);
});

test('a settings read failure never leaves the session runner locked', async () => {
  const store = new HistoryStore(path.join(root, 'settings-failure'));
  store.getSettings = () => { throw new Error('Settings access denied'); };
  const runner = new SessionRunner({ store, coordinator: {}, emit: () => {} });
  await assert.rejects(() => runner.run({ prompt: 'OK', cwd: process.cwd() }), /Settings access denied/);
  assert.equal(runner.busy, false);
});

test('health test cannot treat an incidental substring as an OK response', async () => {
  const BaseAgent = require('../src/main/agents/base-agent'), agent = new BaseAgent({ id: 'claude' });
  agent.getVersion = async () => 'mock'; agent.checkAuth = async () => ({ loggedIn: true });
  agent.runPrompt = async () => ({ code: 0, stdout: 'not okay; could not run', stderr: '', durationMs: 1 });
  assert.equal((await agent.runHealthTest()).healthy, false);
});

test('failed local persistence consumes no CLI quota and releases the session lock', async () => {
  const store = new HistoryStore(path.join(root, 'write-failure'));
  store.save = () => { throw new Error('Disk is read-only'); };
  let calls = 0;
  const runner = new SessionRunner({ store, coordinator: { planSubtasks: async () => { calls++; }, updateMemory: async () => { calls++; } }, emit: () => {} });
  await assert.rejects(() => runner.run({ prompt: 'OK', cwd: process.cwd() }), /Local history could not be saved/);
  assert.equal(calls, 0); assert.equal(runner.busy, false);
});
