// Hard defaults for a single run. Users may raise or lower the task budgets from
// Settings; every value is clamped to a safe range so a bad setting cannot make a
// run explode into unbounded CLI calls.
const DEFAULT_LIMITS = Object.freeze({
  subtasks: 8,
  attemptsPerTask: 2,
  repliesPerTask: 2,
  calls: 20,
  coordinationRounds: 3,
  contextExcerpt: 1600,
  minTimeout: 1000,
  maxTimeout: 1800000
});
const LIMIT_BOUNDS = Object.freeze({
  subtasks: [1, 20],
  attemptsPerTask: [1, 5],
  repliesPerTask: [0, 5],
  calls: [5, 60],
  coordinationRounds: [1, 8],
  contextExcerpt: [400, 8000],
  minTimeout: [1000, 60000],
  maxTimeout: [60000, 3600000]
});
// Mutable so a saved override can apply process-wide without threading it through every module.
const LIMITS = { ...DEFAULT_LIMITS };
function clampLimit(key, value) {
  const [min, max] = LIMIT_BOUNDS[key];
  const numeric = Number(value);
  return Number.isInteger(numeric) ? Math.min(Math.max(numeric, min), max) : DEFAULT_LIMITS[key];
}
function sanitizeLimits(overrides = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULT_LIMITS)) result[key] = clampLimit(key, overrides?.[key]);
  return result;
}
function applyLimits(overrides = {}) {
  Object.assign(LIMITS, sanitizeLimits(overrides));
  return { ...LIMITS };
}
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
module.exports = { LIMITS, DEFAULT_LIMITS, LIMIT_BOUNDS, runOptions, sanitizeLimits, applyLimits, cancelled, checkCancelled };
