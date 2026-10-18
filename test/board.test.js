const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { randomUUID } = require('crypto');
const { TaskBoard } = require('../src/main/task-board');

const root = path.resolve('.test-artifacts', 'board-' + randomUUID());

test('add -> list -> reload simulation retains tasks with atomic persistence', () => {
  const cwd = path.join(root, 'project-a');
  const board1 = new TaskBoard(cwd, root);
  const created = board1.add('Build feature A\nDetails here');

  assert.equal(created.status, 'queued');
  assert.equal(created.title, 'Build feature A');
  assert.equal(created.request, 'Build feature A\nDetails here');
  assert.equal(board1.list().length, 1);

  // Simulate reload with a new TaskBoard instance
  const board2 = new TaskBoard(cwd, root);
  const listed = board2.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(listed[0].title, 'Build feature A');
});

test('invalid status throws error', () => {
  const cwd = path.join(root, 'project-invalid-status');
  const board = new TaskBoard(cwd, root);
  const task = board.add('Task for status testing');

  assert.throws(() => {
    board.setStatus(task.id, 'flying_high');
  }, /Invalid status: flying_high/);

  assert.throws(() => {
    board.update(task.id, { status: 'non_existent_status' });
  }, /Invalid status: non_existent_status/);
});

test('running and planning tasks become queued on startup recovery', () => {
  const cwd = path.join(root, 'project-recovery');
  const board1 = new TaskBoard(cwd, root);
  const t1 = board1.add('Task 1');
  const t2 = board1.add('Task 2');
  const t3 = board1.add('Task 3');

  board1.setStatus(t1.id, 'running', 'Running worker');
  board1.setStatus(t2.id, 'planning', 'Claude analyzing');
  board1.setStatus(t3.id, 'needs_user', 'Waiting for answer');

  // Simulate app restart
  const board2 = new TaskBoard(cwd, root);
  const recovered1 = board2.get(t1.id);
  const recovered2 = board2.get(t2.id);
  const untouched3 = board2.get(t3.id);

  assert.equal(recovered1.status, 'queued');
  assert.equal(recovered2.status, 'queued');
  assert.equal(untouched3.status, 'needs_user');

  const lastHistory1 = recovered1.history[recovered1.history.length - 1];
  assert.equal(lastHistory1.text, 'Uygulama kapandı, görev yeniden kuyruğa alındı');
  assert.equal(lastHistory1.type, 'status');

  const lastHistory2 = recovered2.history[recovered2.history.length - 1];
  assert.equal(lastHistory2.text, 'Uygulama kapandı, görev yeniden kuyruğa alındı');
});

test('history cap of 200 items is enforced', () => {
  const cwd = path.join(root, 'project-history-cap');
  const board = new TaskBoard(cwd, root);
  const task = board.add('Long history task');

  for (let i = 0; i < 250; i++) {
    board.addHistory(task.id, 'note', `Note entry #${i}`);
  }

  const updated = board.get(task.id);
  assert.equal(updated.history.length, 200);
  assert.equal(updated.history[updated.history.length - 1].text, 'Note entry #249');
  assert.equal(updated.history[0].text, 'Note entry #50');
});
