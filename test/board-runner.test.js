const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

const root = path.resolve('.test-artifacts', 'runner-' + randomUUID());
process.env.QUOTALALA_DATA_DIR = root;

const quota = require('../src/main/quota');
const agents = require('../src/main/agents');
const { TaskBoard } = require('../src/main/task-board');
const { BoardRunner } = require('../src/main/board-runner');
const { HistoryStore } = require('../src/main/storage');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
}

function setupMockAgents(t, act) {
  const oldState = structuredClone(quota.getState());
  const originals = agents.getAllAgents().map(agent => ({
    agent,
    runPrompt: agent.runPrompt,
    capabilities: agent.capabilities,
    execute: agent.execute
  }));
  const calls = [];

  for (const { agent } of originals) {
    quota.state.agents[agent.id].enabled = true;
    quota.state.agents[agent.id].status = 'idle';
    agent.capabilities = { noTools: true, resume: true, available: true, stdin: true };
    agent.execute = async () => { throw new Error('Live CLI must not be used'); };
    agent.runPrompt = async (prompt, options) => {
      calls.push({ agent: agent.id, prompt, options });
      return act(agent.id, prompt, options, calls);
    };
  }

  t.after(() => {
    quota.state = oldState;
    for (const { agent, ...values } of originals) Object.assign(agent, values);
  });

  return { calls };
}

test('board streams planning, worker process and partial failure with redaction, persistence and early resume ID', async t => {
  const testDir = path.join(root, 'stream-fixture'); fs.mkdirSync(testDir, { recursive: true });
  const secret = 'sk-proj-' + 'x'.repeat(32);
  setupMockAgents(t, (id, prompt, options) => {
    assert.equal(options.cwd, testDir);
    assert.equal(options.timeout, 420000);
    if (options.reason === 'Pano görev planlama') {
      options.onChunk({ stream: 'stdout', text: 'Planning now\n' });
      return { code: 0, stdout: JSON.stringify({ title: 'Streaming fixture', agent: 'claude', level: 'hafif', workerPrompt: 'Inspect only', question: null }) };
    }
    options.onStart({ pid: 12345, executable: 'fixture-cli' });
    options.onSession('early-session');
    options.onChunk({ stream: 'stdout', text: 'Partial work\n' + secret.slice(0, 12) });
    options.onChunk({ stream: 'stdout', text: secret.slice(12) });
    return { code: -999, stdout: 'Partial work', stderr: 'Timeout: fixture', timedOut: true };
  });
  const board = new TaskBoard(testDir, root), task = board.add('Inspect project');
  const store = new HistoryStore(root); store.saveSettings({ timeout: 420000 });
  const events = [];
  const runner = new BoardRunner({ cwd: testDir, root, board, store, emit: (channel, payload) => events.push({ channel, payload }) });
  await runner.runTaskPipeline(task.id);
  const saved = board.get(task.id);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.cliSessionId, 'early-session');
  assert.match(saved.liveOutput, /Planning now/);
  assert.match(saved.liveOutput, /PID 12345/);
  assert.match(saved.liveOutput, /Partial work/);
  assert.match(saved.liveOutput, /Timeout/);
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.ok(!JSON.stringify(saved).includes(secret));
  const streams = events.filter(event => event.channel === 'board:stream');
  assert.ok(streams.length > 2);
  assert.ok(streams.every(event => event.payload.cwd === testDir && event.payload.chunk.replace));
  // Reopening a board retains diagnostics; no CLI is invoked.
  assert.match(new TaskBoard(testDir, root).get(task.id).liveOutput, /Partial work/);
});

test('intake produces valid JSON -> worker runs -> review approves -> ready_to_merge', async t => {
  const testDir = path.join(root, 'repo-happy');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  const { calls } = setupMockAgents(t, (agentId, prompt, options) => {
    if (prompt.includes('Sen Quotalala Görev Panosu baş operatörü Claude\'sun') && prompt.includes('Kullanıcının görevini anla')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Implement feature X',
          agent: 'codex',
          level: 'hafif',
          workerPrompt: 'Create feature.js',
          question: null
        })
      };
    }
    if (prompt.includes('Sadece bu görevi yap. İş bitince değişikliklerini bu branch\'e commit et.')) {
      assert.equal(agentId, 'codex');
      return {
        code: 0,
        stdout: 'Feature X implemented in feature.js',
        sessionId: 'codex-sess-123'
      };
    }
    if (prompt.includes('Ajanın tamamladığı işi ve diff çıktısını incele')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          decision: 'approve',
          message: 'Looks good and verified'
        })
      };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Add feature X to project');
  const runner = new BoardRunner({ cwd: testDir, root, board });

  await runner.runTaskPipeline(task.id);

  const finalTask = board.get(task.id);
  assert.equal(finalTask.status, 'ready_to_merge');
  assert.equal(finalTask.agent, 'codex');
  assert.equal(finalTask.cliSessionId, 'codex-sess-123');
  assert.match(finalTask.result, /Feature X implemented/);
});

test('Claude intake returns invalid JSON -> task fails with no retry', async t => {
  const testDir = path.join(root, 'repo-invalid-json');
  fs.mkdirSync(testDir, { recursive: true });

  setupMockAgents(t, () => ({
    code: 0,
    stdout: 'Sorry, I cannot give JSON right now.'
  }));

  const board = new TaskBoard(testDir, root);
  const task = board.add('Some request');
  const runner = new BoardRunner({ cwd: testDir, root, board });

  await runner.runTaskPipeline(task.id);

  const finalTask = board.get(task.id);
  assert.equal(finalTask.status, 'failed');
  assert.match(finalTask.history[finalTask.history.length - 1].text, /geçersiz JSON/);
});

test('two tasks run concurrently up to limit 2; third remains queued', async t => {
  const testDir = path.join(root, 'repo-concurrency');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  let runningCount = 0;
  let maxConcurrent = 0;

  setupMockAgents(t, async (agentId, prompt) => {
    if (prompt.includes('Kullanıcının görevini anla')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Task title',
          agent: 'codex',
          level: 'hafif',
          workerPrompt: 'Do work',
          question: null
        })
      };
    }
    if (prompt.includes('Sadece bu görevi yap')) {
      runningCount++;
      if (runningCount > maxConcurrent) maxConcurrent = runningCount;
      await new Promise(r => setTimeout(r, 200));
      runningCount--;
      return { code: 0, stdout: 'Done', sessionId: 'sess-abc' };
    }
    if (prompt.includes('Ajanın tamamladığı işi')) {
      return { code: 0, stdout: JSON.stringify({ decision: 'approve', message: 'OK' }) };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const t1 = board.add('Req 1');
  const t2 = board.add('Req 2');
  const t3 = board.add('Req 3');

  const runner = new BoardRunner({ cwd: testDir, root, board });
  await runner.tick();

  assert.equal(maxConcurrent, 2);
  const currentTasks = board.list();
  const third = currentTasks.find(t => t.id === t3.id);
  // Third task was not executed in the first tick of 2 slots
  assert.equal(third.status, 'queued');

  // Stop runner and cancel active tasks so they don't leak into subsequent tests
  runner.stop();
});

test('Claude review requests revise -> re-calls same agent with same cliSessionId', async t => {
  const testDir = path.join(root, 'repo-revise');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  let reviewCount = 0;
  const workerCalls = [];

  setupMockAgents(t, (agentId, prompt, options) => {
    if (prompt.includes('Kullanıcının görevini anla')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Fix issue',
          agent: 'codex',
          level: 'hafif',
          workerPrompt: 'Initial prompt',
          question: null
        })
      };
    }
    if (prompt.includes('Sadece bu görevi yap')) {
      workerCalls.push({ agentId, prompt, resumeId: options.resumeId });
      return { code: 0, stdout: 'Worker output', sessionId: 'codex-persistent-id' };
    }
    if (prompt.includes('Ajanın tamamladığı işi')) {
      reviewCount++;
      if (reviewCount === 1) {
        return {
          code: 0,
          stdout: JSON.stringify({
            decision: 'revise',
            message: 'Please add unit tests as well'
          })
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          decision: 'approve',
          message: 'All tests added and verified'
        })
      };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Fix bug in repo');
  const runner = new BoardRunner({ cwd: testDir, root, board });

  await runner.runTaskPipeline(task.id);

  assert.equal(workerCalls.length, 2);
  assert.equal(workerCalls[0].resumeId, undefined);
  assert.equal(workerCalls[1].resumeId, 'codex-persistent-id');
  assert.match(workerCalls[1].prompt, /Please add unit tests as well/);

  const finalTask = board.get(task.id);
  assert.equal(finalTask.status, 'ready_to_merge');
});

test('needs_user -> board.answer -> continues with same session ID', async t => {
  const testDir = path.join(root, 'repo-ask-user');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  const workerCalls = [];

  setupMockAgents(t, (agentId, prompt, options) => {
    if (prompt.includes('Kullanıcının görevini anla')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Database integration',
          agent: 'codex',
          level: 'hafif',
          workerPrompt: 'Integrate DB',
          question: null
        })
      };
    }
    if (prompt.includes('Sadece bu görevi yap')) {
      workerCalls.push({ prompt, resumeId: options.resumeId });
      return { code: 0, stdout: 'Worker done', sessionId: 'sess-user-123' };
    }
    if (prompt.includes('Ajanın tamamladığı işi')) {
      if (workerCalls.length === 1) {
        return {
          code: 0,
          stdout: JSON.stringify({
            decision: 'ask_user',
            message: 'Should we use Postgres or SQLite?'
          })
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          decision: 'approve',
          message: 'Postgres implemented'
        })
      };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Setup DB');
  const runner = new BoardRunner({ cwd: testDir, root, board });

  await runner.runTaskPipeline(task.id);

  let currentTask = board.get(task.id);
  assert.equal(currentTask.status, 'needs_user');
  assert.equal(currentTask.question, 'Should we use Postgres or SQLite?');

  // User answers
  await runner.answer(task.id, 'Use SQLite');

  currentTask = board.get(task.id);
  assert.equal(currentTask.status, 'ready_to_merge');
  assert.equal(workerCalls.length, 2);
  assert.equal(workerCalls[1].resumeId, 'sess-user-123');
  assert.match(workerCalls[1].prompt, /Use SQLite/);
});
