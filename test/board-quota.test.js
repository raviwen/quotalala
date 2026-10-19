const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

const root = path.resolve('.test-artifacts', 'quota-test-' + randomUUID());
process.env.QUOTALALA_DATA_DIR = root;

const quota = require('../src/main/quota');
const agents = require('../src/main/agents');
const { TaskBoard } = require('../src/main/task-board');
const { BoardRunner } = require('../src/main/board-runner');

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
    quota.state.agents[agent.id].lastError = null;
    quota.state.agents[agent.id].rateLimitedUntil = null;
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

test('quota error transitions task to waiting_quota and sets resumeAt without handing to other agent', async t => {
  const testDir = path.join(root, 'repo-quota-wait');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  setupMockAgents(t, (agentId, prompt) => {
    if (prompt.includes('Kullanıcının görevini anla')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Heavy task',
          agent: 'codex',
          level: 'hafif',
          workerPrompt: 'Do heavy work',
          question: null
        })
      };
    }
    if (prompt.includes('Sadece bu görevi yap')) {
      // Return 429 quota error
      return {
        code: 1,
        stdout: '',
        stderr: 'Error: 429 rate limit reached. quota exhausted'
      };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Run heavy task');
  const runner = new BoardRunner({ cwd: testDir, root, board });

  await runner.runTaskPipeline(task.id);

  const updatedTask = board.get(task.id);
  assert.equal(updatedTask.status, 'waiting_quota');
  assert.equal(updatedTask.agent, 'codex'); // NOT handed to other agent!
  assert.ok(updatedTask.resumeAt);

  // When quota.getAgent(agent).rateLimitedUntil is missing, resumeAt should be ~30 minutes in future
  const diffMs = new Date(updatedTask.resumeAt).getTime() - Date.now();
  assert.ok(diffMs >= 29 * 60 * 1000 && diffMs <= 31 * 60 * 1000, `resumeAt diff ${diffMs}ms should be ~30m`);

  const lastHistory = updatedTask.history[updatedTask.history.length - 1];
  assert.match(lastHistory.text, /Kota doldu/);
});

test('quota error uses rateLimitedUntil if set and in future, or now + 30m if missing/past', async t => {
  const testDir = path.join(root, 'repo-quota-resume-calc');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  setupMockAgents(t, (agentId, prompt) => {
    if (prompt.includes('Kullanıcının görevini anla')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          title: 'Task for resume calculation',
          agent: 'codex',
          level: 'hafif',
          workerPrompt: 'Do work',
          question: null
        })
      };
    }
    return {
      code: 1,
      stdout: '',
      stderr: 'Error: 429 rate limit exceeded'
    };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Resume test task');
  const runner = new BoardRunner({ cwd: testDir, root, board });

  // 1) When rateLimitedUntil is null/past:
  quota.state.agents.codex.rateLimitedUntil = null;
  await runner.runTaskPipeline(task.id);
  let resTask = board.get(task.id);
  let diff = new Date(resTask.resumeAt).getTime() - Date.now();
  assert.ok(diff >= 29 * 60 * 1000 && diff <= 31 * 60 * 1000);

  // 2) When rateLimitedUntil is set to a future timestamp:
  const futureTime = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  quota.state.agents.codex.rateLimitedUntil = futureTime;
  task.status = 'queued';
  board.update(task.id, { status: 'queued' });
  await runner.runTaskPipeline(task.id);
  resTask = board.get(task.id);
  assert.equal(resTask.resumeAt, futureTime);
});

test('checkWaitingQuotaTasks advances waiting task when resumeAt has passed, using same cliSessionId', async t => {
  const testDir = path.join(root, 'repo-quota-advance');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  const workerCalls = [];

  setupMockAgents(t, (agentId, prompt, options) => {
    if (prompt.includes('Sadece bu görevi yap')) {
      workerCalls.push({ prompt, resumeId: options.resumeId });
      return { code: 0, stdout: 'Worker finished successfully', sessionId: 'sess-persisted-999' };
    }
    if (prompt.includes('Ajanın tamamladığı işi')) {
      return { code: 0, stdout: JSON.stringify({ decision: 'approve', message: 'Done' }) };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Quota task');
  const pastTime = new Date(Date.now() - 5000).toISOString();

  board.update(task.id, {
    agent: 'codex',
    level: 'hafif',
    workerPrompt: 'Initial prompt',
    cliSessionId: 'sess-persisted-999',
    status: 'waiting_quota',
    resumeAt: pastTime
  });

  const runner = new BoardRunner({ cwd: testDir, root, board });

  // Simulate quota check advancing time
  await runner.checkWaitingQuotaTasks(Date.now());

  let taskAfterCheck = board.get(task.id);
  assert.equal(taskAfterCheck.status, 'queued');
  assert.equal(taskAfterCheck.workerPrompt, 'Initial prompt', 'resume must keep the original worker instruction');

  // Now run tick to execute
  await runner.tick();

  const finalTask = board.get(task.id);
  assert.equal(finalTask.status, 'ready_to_merge');
  assert.equal(workerCalls.length, 1);
  assert.equal(workerCalls[0].resumeId, 'sess-persisted-999');
  assert.match(workerCalls[0].prompt, /Initial prompt/);
  assert.match(workerCalls[0].prompt, /Sadece bu görevi yap/);
});

test('session not found error clears cliSessionId and retries with worktree notice', async t => {
  const testDir = path.join(root, 'repo-session-lost');
  fs.mkdirSync(testDir, { recursive: true });
  git(['init'], testDir);
  git(['config', 'user.email', 'test@local'], testDir);
  git(['config', 'user.name', 'Test'], testDir);
  fs.writeFileSync(path.join(testDir, 'init.txt'), 'init\n');
  git(['add', 'init.txt'], testDir);
  git(['commit', '-m', 'Init'], testDir);

  const workerCalls = [];

  setupMockAgents(t, (agentId, prompt, options) => {
    if (prompt.includes('İş bitince değişikliklerini bu branch\'e commit et')) {
      workerCalls.push({ prompt, resumeId: options.resumeId });
      if (options.resumeId === 'old-stale-session') {
        return {
          code: 1,
          stdout: '',
          stderr: 'Error: session not found or conversation does not exist'
        };
      }
      return {
        code: 0,
        stdout: 'Recovered from worktree',
        sessionId: 'new-fresh-session'
      };
    }
    if (prompt.includes('Ajanın tamamladığı işi')) {
      return { code: 0, stdout: JSON.stringify({ decision: 'approve', message: 'OK' }) };
    }
    return { code: 0, stdout: 'OK' };
  });

  const board = new TaskBoard(testDir, root);
  const task = board.add('Task with lost session');
  board.update(task.id, {
    agent: 'codex',
    level: 'hafif',
    workerPrompt: 'Do some work',
    cliSessionId: 'old-stale-session',
    status: 'running'
  });

  const runner = new BoardRunner({ cwd: testDir, root, board });
  await runner.runTaskPipeline(task.id);

  assert.equal(workerCalls.length, 2);
  assert.equal(workerCalls[0].resumeId, 'old-stale-session');
  assert.equal(workerCalls[1].resumeId, undefined);
  assert.match(workerCalls[1].prompt, /Önceki oturum bulunamadı\. Worktree'deki mevcut değişikliklere bak/);

  const finalTask = board.get(task.id);
  assert.equal(finalTask.status, 'ready_to_merge');
  assert.equal(finalTask.cliSessionId, 'new-fresh-session');
});
