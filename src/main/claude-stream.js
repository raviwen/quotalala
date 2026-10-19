// Decode Claude Code stream-json without exposing thinking text or raw protocol.
function createClaudeStream({ onChunk = () => {}, onSession = () => {} } = {}) {
  let pending = '', result = null, text = '', partial = false, sessionId;
  const send = value => { if (value) onChunk({ stream: 'stdout', text: value }); };
  function event(value) {
    if (value.session_id) { sessionId = value.session_id; onSession(sessionId); }
    if (value.type === 'system' && value.subtype === 'init') send(`[CLI] Claude • ${value.model || 'default'}\n`);
    if (value.type === 'stream_event') {
      const update = value.event;
      if (update?.type === 'content_block_start' && update.content_block?.type === 'thinking') send('[CLI] Thinking…\n');
      if (update?.type === 'content_block_delta' && update.delta?.type === 'text_delta') {
        partial = true; text += update.delta.text || ''; send(update.delta.text);
      }
    }
    if (value.type === 'assistant') {
      for (const block of value.message?.content || []) {
        if (block.type === 'text' && !partial) { text += block.text || ''; send(block.text); }
        if (block.type === 'tool_use') {
          const input = block.input || {};
          const detail = input.file_path || input.path || input.command || input.pattern || input.query || input.url || '';
          send(`\n[tool] ${block.name}: ${String(detail).slice(0, 600)}\n`);
        }
      }
      partial = false;
    }
    if (value.type === 'user') for (const block of value.message?.content || []) {
      if (block.type === 'tool_result') {
        const detail = block.is_error && typeof block.content === 'string' ? ': ' + block.content.slice(0, 500) : '';
        send(`[tool] ${block.is_error ? 'Failed' : 'Completed'}${detail}\n`);
      }
    }
    if (value.type === 'result') {
      result = value;
      send(`\n[CLI] ${value.is_error ? 'Failed' : 'Finished'}\n`);
    }
  }
  function line(value) { try { event(JSON.parse(value)); } catch { /* Ignore non-JSON diagnostics. */ } }
  return {
    push(chunk) {
      if (chunk.stream === 'stderr') { onChunk(chunk); return; }
      pending += chunk.text || '';
      let end;
      while ((end = pending.indexOf('\n')) !== -1) { line(pending.slice(0, end)); pending = pending.slice(end + 1); }
      if (pending.length > 4 * 1024 * 1024) pending = ''; // Bound malformed/no-newline diagnostics.
    },
    finish(response) {
      if (pending.trim()) line(pending);
      const output = result?.result ?? text;
      const errors = Array.isArray(result?.errors) ? result.errors.join('\n') : '';
      const denied = result?.permission_denials?.length ? 'CLI permission denied. Review tool permissions in the official Claude CLI.' : '';
      return { ...response, stdout: output, sessionId: sessionId || response.sessionId,
        code: response.code !== 0 ? response.code : (!result || result.is_error || denied ? 1 : 0),
        stderr: [response.stderr, errors, denied, !result && response.code === 0 ? 'Claude stream ended without a final result.' : ''].filter(Boolean).join('\n') };
    }
  };
}
module.exports = { createClaudeStream };
