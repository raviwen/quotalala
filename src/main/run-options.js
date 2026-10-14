const LIMITS = Object.freeze({ subtasks: 8, attemptsPerTask: 2, calls: 20, coordinationRounds: 3, contextExcerpt: 1600, minTimeout: 1000, maxTimeout: 1800000 });
function runOptions(value = {}) {
  const mode = value.mode ?? 'coordinated';
  const agent = value.agent ?? 'codex', level = value.level ?? 'hafif';
  const timeout = value.timeout ?? 180000;
  if (!['coordinated', 'economic'].includes(mode) || !['claude', 'codex', 'gemini'].includes(agent) || !['hafif', 'orta', 'güçlü'].includes(level)
    || !Number.isInteger(timeout) || timeout < LIMITS.minTimeout || timeout > LIMITS.maxTimeout) throw new Error('Invalid execution options.');
  return { mode, agent, level, timeout, previewPlan: value.previewPlan === true, verify: value.verify === true };
}
function cancelled() { return Object.assign(new Error('Cancelled'), { cancelled: true }); }
function checkCancelled(context) { if (context.signal?.aborted) throw cancelled(); }
module.exports = { LIMITS, runOptions, cancelled, checkCancelled };
