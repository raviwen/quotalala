// Redact recognizable secrets before anything is persisted by Quotalala.
function redact(text) {
  return String(text)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/(\bBearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:[\w-]*(?:api[_-]?key|token|secret|password|authorization)[\w-]*)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\r\n}]+)/gi, '$1"[REDACTED]"');
}
function sanitize(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)/i.test(key) ? '[REDACTED]' : sanitize(item)]));
  }
  return value;
}
module.exports = { redact, sanitize };
