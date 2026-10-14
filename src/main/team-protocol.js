const { LIMITS } = require('./run-options');
function jsonObject(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const value = JSON.parse(cleaned);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value;
}
function workerMessage(text) {
  let value;
  try { value = jsonObject(text); } catch {
    if (/"protocol"\s*:\s*"worker-v1"/.test(text)) throw new Error('Invalid worker response.');
    return { status: 'completed', message: text };
  }
  if (value.protocol !== 'worker-v1') return { status: 'completed', message: text };
  if (!['completed', 'needs_input', 'failed', 'blocked'].includes(value.status) || typeof value.message !== 'string' || !value.message.trim()
    || value.message.length > 100000 || value.toAgent !== undefined && !['claude', 'codex', 'gemini'].includes(value.toAgent)) throw new Error('Invalid worker response.');
  return { status: value.status, message: value.message, toAgent: value.toAgent || 'claude' };
}
function sourceSteps(value, knownSteps) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3 || value.some(step => !Number.isInteger(step) || !knownSteps.includes(step))) throw new Error('Invalid context source steps.');
  return [...new Set(value)];
}
function decision(text, { plan, outputs, attempts, available, parsePlan }) {
  const value = jsonObject(text), known = plan.subtasks.map(task => task.step);
  if (!['continue', 'finish', 'blocked'].includes(value.action) || typeof value.reason !== 'string' || value.reason.length > 2000) throw new Error('Invalid coordination decision.');
  const tasks = value.tasks ?? [], messages = value.messages ?? [];
  if (!Array.isArray(tasks) || !Array.isArray(messages) || plan.subtasks.length + tasks.length > LIMITS.subtasks || messages.length > LIMITS.subtasks) throw new Error('Coordination task limit exceeded.');
  if (value.action !== 'continue' && (tasks.length || messages.length)) throw new Error('A terminal decision cannot dispatch work.');
  if (value.action === 'finish' && (typeof value.result !== 'string' || !value.result.trim() || value.result.length > 50000)) throw new Error('A final decision requires a result.');
  const newTasks = tasks.length ? parsePlan(JSON.stringify({ subtasks: tasks.map(({ id, ...task }) => task) })).subtasks.map((task, index) => {
    if (!available(task.agent)) throw new Error(`Agent unavailable: ${task.agent}`);
    const sources = sourceSteps(tasks[index].sourceSteps, outputs.map(item => item.step));
    const revisionOf = tasks[index].revisionOf;
    if (revisionOf !== undefined && !known.includes(revisionOf)) throw new Error('Invalid revision step.');
    return { ...task, step: plan.subtasks.length + index + 1, sourceSteps: sources, ...(revisionOf ? { revisionOf } : {}) };
  }) : [];
  const seen = new Set();
  const replies = messages.map(message => {
    const task = plan.subtasks.find(item => item.step === message.step);
    if (!task || seen.has(task.step) || message.toAgent !== task.agent || !available(task.agent) || outputs.some(item => item.step === task.step && item.success)
      || (attempts[task.step] || 0) >= LIMITS.attemptsPerTask || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 4000) throw new Error('Invalid coordinator reply.');
    seen.add(task.step);
    return { step: task.step, toAgent: task.agent, content: message.content, sourceSteps: sourceSteps(message.sourceSteps, outputs.map(item => item.step)) };
  });
  if (value.action === 'continue' && !newTasks.length && !replies.length) throw new Error('Coordination made no progress.');
  return { action: value.action, reason: value.reason, result: value.result || '', tasks: newTasks, messages: replies };
}
module.exports = { jsonObject, workerMessage, sourceSteps, decision };
