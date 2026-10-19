// Pure activity projections and fake desktop notifications; no CLI or OS toasts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');
process.env.QUOTALALA_DATA_DIR = path.resolve('.test-artifacts', 'room-' + randomUUID());
const { project } = require('../src/shared/team-room');
const { TaskNotifications, showNotification } = require('../src/main/task-notifications');
const { HistoryStore } = require('../src/main/storage');
const agents = { claude: { enabled: true, status: 'idle' }, codex: { enabled: true, status: 'idle' }, gemini: { enabled: false, status: 'idle' } };
test('board failure remains visible in the room and running desks show actual output', () => {
  const task = { id: 'board-fixture', agent: 'claude', status: 'running', title: 'Write document', liveOutput: '[tool] Read: README.md', updatedAt: new Date().toISOString() };
  assert.match(project({ agents, boardTasks: [task] }).lastMessage.text, /Read: README/);
  const failed = project({ agents, boardTasks: [{ ...task, status: 'failed', history: [{ text: 'Timeout: 180000ms' }] }] });
  assert.equal(failed.desks.find(desk => desk.id === 'claude').status, 'blocked');
  assert.match(failed.lastMessage.text, /Timeout/);
  assert.equal(failed.active, false);
});
const event = (type, agent = 'claude', extra = {}) => ({ id: randomUUID(), timestamp: new Date().toISOString(), type, agent, ...extra });
const desk = (model, id) => model.desks.find(item => item.id === id);
function turn(activities, outputs = [], status = 'running', mode = 'coordinated') { return { activities, outputs, status, options: { mode } }; }

test('the idle room has no fabricated work and never activates disabled Gemini', () => {
  const model = project({ agents });
  assert.equal(desk(model, 'claude').status, 'idle'); assert.equal(desk(model, 'gemini').status, 'disabled');
  assert.ok(model.desks.every(item => !item.animated)); assert.equal(model.lastMessage, null);
});

test('actual assignment, question, Claude reply and resumption drive the room in order', () => {
  const activities = [event('session_started'), event('task_assigned', 'codex', { step: 1, taskTitle: 'Adapter' })];
  let model = project({ agents, turn: turn(activities), live: true });
  assert.equal(desk(model, 'codex').status, 'working'); assert.equal(desk(model, 'codex').animated, true);
  activities.push(event('agent_question', 'codex', { toAgent: 'claude', output: 'Which adapter?' }));
  model = project({ agents, turn: turn(activities), live: true });
  assert.equal(desk(model, 'codex').status, 'waiting'); assert.equal(desk(model, 'codex').animated, false);
  assert.equal(desk(model, 'claude').message.text, 'Which adapter?');
  activities.push(event('coordinator_reply', 'claude', { toAgent: 'codex', output: 'Use SQLite.' }));
  model = project({ agents, turn: turn(activities), live: true });
  assert.equal(desk(model, 'codex').status, 'reply'); assert.equal(model.lastMessage.from, 'claude');
  activities.push(event('task_assigned', 'codex', { step: 1 }));
  model = project({ agents, turn: turn(activities), live: true }); assert.equal(desk(model, 'codex').animated, true);
});

test('Economic mode animates only its assigned worker and approval pauses work', () => {
  const active = turn([event('session_started'), event('task_assigned', 'codex')], [], 'running', 'economic');
  const model = project({ agents, turn: active, live: true });
  assert.equal(desk(model, 'claude').animated, false); assert.equal(desk(model, 'codex').animated, true);
  const approval = project({ agents, turn: active, live: true, approval: true });
  assert.equal(approval.approval, true); assert.equal(desk(approval, 'claude').status, 'approval');
  assert.ok(approval.desks.every(item => !item.animated));
});

test('cancellation stops animation while preserving completed work and the conversation', () => {
  const activities = [event('task_assigned', 'codex'), event('task_completed', 'codex'), event('agent_question', 'claude', { toAgent: 'codex', output: 'Check the result?' }), event('session_finished', undefined, { status: 'cancelled' })];
  const model = project({ agents, turn: turn(activities, [{ agent: 'codex', success: true }]), live: true });
  assert.equal(desk(model, 'codex').status, 'completed'); assert.equal(desk(model, 'claude').status, 'cancelled');
  assert.equal(model.active, false); assert.ok(model.desks.every(item => !item.animated)); assert.equal(model.lastMessage.text, 'Check the result?');
});

test('history is visibly archived; an interrupted assignment never appears to be working or complete', () => {
  const model = project({ agents, turn: turn([event('task_assigned', 'codex')]), live: false });
  assert.equal(model.archive, true); assert.equal(desk(model, 'codex').status, 'interrupted'); assert.equal(desk(model, 'codex').animated, false);
  const failed = project({ agents, turn: turn([event('session_started'), event('planning_failed')], [], 'failed') });
  assert.equal(desk(failed, 'claude').status, 'blocked');
});

test('disabled peers stay off even if a recorded incoming question names them', () => {
  const model = project({ agents, turn: turn([event('agent_question', 'codex', { toAgent: 'gemini', output: 'Can you research?' })]), live: true });
  assert.equal(desk(model, 'gemini').status, 'disabled'); assert.equal(desk(model, 'gemini').animated, false); assert.equal(agents.gemini.enabled, false);
});

test('health checks are shown as checks and never confused with task execution', () => {
  const model = project({ agents: { ...agents, claude: { enabled: true, status: 'testing' } } });
  assert.equal(desk(model, 'claude').status, 'checking'); assert.equal(desk(model, 'claude').animated, false);
});

test('a failed attempt stays blocked after another agent completes the handoff', () => {
  const model = project({ agents, turn: turn([event('task_assigned', 'claude'), event('task_failed', 'claude'), event('task_assigned', 'codex'), event('task_completed', 'codex')], [{ agent: 'codex', success: true }], 'completed') });
  assert.equal(desk(model, 'claude').status, 'blocked'); assert.equal(desk(model, 'codex').status, 'completed');
});

function notifications() {
  const state = { foreground: false, enabled: true, language: 'tr', sent: [], focused: [] };
  const service = new TaskNotifications({ send: (title, body, click) => state.sent.push({ title, body, click }), getSettings: () => ({ notificationsEnabled: state.enabled }), isForeground: () => state.foreground, getLanguage: () => state.language, focus: target => state.focused.push(target) });
  return { state, service };
}
const finished = (status = 'completed', turnId = 'turn-one') => ({ sessionId: 'session-one', turnId, activity: { type: 'session_finished', status, output: 'PRIVATE OUTPUT' } });

test('agent-to-agent traffic and automatic retries do not create desktop notification noise', () => {
  const { service, state } = notifications();
  for (const type of ['agent_question', 'coordinator_reply', 'task_failed', 'agent_switched', 'coordination_completed']) service.consume('session:activity', { sessionId: 'session-one', turnId: 'turn-one', activity: { type } });
  assert.equal(state.sent.length, 0);
});

test('background completion is sent once with private content omitted and clicking selects only the correct session', () => {
  const { service, state } = notifications();
  service.consume('session:activity', finished()); service.consume('session:activity', finished());
  assert.equal(state.sent.length, 1); assert.ok(!state.sent[0].body.includes('PRIVATE OUTPUT'));
  state.sent[0].click(); assert.deepEqual(state.focused, [{ sessionId: 'session-one', turnId: 'turn-one', kind: 'completed' }]);
});

test('approval notifications are deduplicated per approval and their body never contains the plan', () => {
  const { service, state } = notifications();
  const value = { runId: 'approval-one', sessionId: 'session-one', turnId: 'turn-one', plan: { prompt: 'PRIVATE PROMPT' } };
  service.consume('session:approval', value); service.consume('session:approval', value);
  service.consume('session:approval', { ...value, runId: 'approval-two' });
  assert.equal(state.sent.length, 2); assert.ok(state.sent.every(item => !item.body.includes('PRIVATE PROMPT')));
  state.sent[0].click(); assert.equal(state.focused[0].kind, 'approval');
});

test('focused, muted and cancelled tasks remain quiet; language follows the UI', () => {
  const { service, state } = notifications();
  state.foreground = true; service.consume('session:activity', finished());
  state.foreground = false; service.consume('session:activity', finished()); // No late replay of a visible result.
  state.enabled = false; service.consume('session:activity', finished('failed', 'turn-two'));
  state.enabled = true; service.consume('session:activity', finished('cancelled', 'turn-three'));
  assert.equal(state.sent.length, 0);
  state.language = 'en'; service.consume('session:activity', finished('partial', 'turn-four'));
  assert.match(state.sent[0].title, /attention/);
});

test('blocked and failed tasks notify for attention while notification failures never fail work', () => {
  const { service, state } = notifications();
  service.consume('session:activity', finished('blocked')); assert.equal(state.sent.length, 1);
  service.send = () => { throw new Error('OS notification unavailable'); };
  assert.doesNotThrow(() => service.consume('session:activity', finished('failed', 'turn-two')));
  service.getSettings = () => { throw new Error('Settings temporarily inaccessible'); };
  assert.doesNotThrow(() => service.consume('session:activity', finished('failed', 'turn-three')));
});

test('the native notification adapter is silent, handles unsupported systems and wires click events', () => {
  let created, clicks = 0;
  class FakeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; created = this; }
    show() { this.shown = true; }
  }
  assert.equal(showNotification(FakeNotification, { title: 'Ready', body: 'Result', icon: 'fixture', click: () => clicks++ }), true);
  assert.equal(created.options.silent, true); assert.equal(created.shown, true); created.emit('click'); assert.equal(clicks, 1);
  assert.doesNotThrow(() => created.emit('failed', 'Unavailable'));
  FakeNotification.isSupported = () => false; assert.equal(showNotification(FakeNotification, {}), false);
});

test('task notification preferences persist without altering Gemini risk acceptance or execution options', () => {
  const store = new HistoryStore(path.join(process.env.QUOTALALA_DATA_DIR, 'settings'));
  assert.equal(store.getSettings().notificationsEnabled, true); store.saveSettings({ notificationsEnabled: false });
  assert.equal(new HistoryStore(store.root).getSettings().notificationsEnabled, false);
  assert.equal(store.getSettings().geminiEnabled, false); assert.equal(store.getSettings().mode, 'coordinated');
  store.saveSettings({ saveHistory: false }); assert.equal(store.getSettings().notificationsEnabled, false);
});
