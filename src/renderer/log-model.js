(function (root) {
  const icons = { info: 'ℹ', success: '✓', warning: '⚠', error: '✕' };
  function normalize(value) {
    const item = typeof value === 'string' ? { text: value } : value;
    return { timestamp: new Date().toISOString(), level: 'info', agent: null, ...item, text: String(item.text || '') };
  }
  function filter(entries, level = 'all', agent = 'all') { return entries.filter(item => (level === 'all' || item.level === level) && (agent === 'all' || item.agent === agent)); }
  function text(entries) { return entries.map(item => `${item.timestamp} [${item.level}]${item.agent ? ' [' + item.agent + ']' : ''} ${item.text}`).join('\n'); }
  function errorKey(item) { return ['quota', 'auth', 'not_found', 'other'].includes(item.errorType) ? item.errorType : 'other'; }
  const api = { icons, normalize, filter, text, errorKey };
  if (typeof module !== 'undefined') module.exports = api;
  else root.LogModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
