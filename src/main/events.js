const { randomUUID } = require('crypto');
const { sanitize } = require('./privacy');
const { format } = require('../shared/activity');
function errorType(raw) {
  // Transient overload ("capacity"/"overloaded") is not a quota limit: parking the
  // task for 30 minutes would be wrong, so it is reported as a normal error instead.
  if (/quota|rate.?limit|\b429\b|exhausted|usage limit/i.test(raw)) return 'quota';
  if (/unauth|auth|required.*login|log.?in|sign.?in|401|403|credential|expired.*token/i.test(raw)) return 'auth';
  if (/ENOENT|not found|not recognized|cannot find|kurulu değil/i.test(raw)) return 'not_found';
  return 'other';
}
function logEntry(value, defaults = {}) {
  const entry = typeof value === 'string' ? { text: value } : value;
  return sanitize({ id: randomUUID(), timestamp: new Date().toISOString(), level: 'info', agent: null, ...defaults, ...entry });
}
function failure(agent, raw, text) {
  return logEntry({ level: 'error', agent, text: text || raw, errorType: errorType(raw), raw });
}
function activityEntry(value) {
  const event = sanitize({ ...value, id: randomUUID(), timestamp: new Date().toISOString() });
  event.title = format(event);
  return sanitize(event);
}
module.exports = { errorType, logEntry, failure, activityEntry };
