const test = require('node:test');
const assert = require('node:assert/strict');
const { createClaudeStream } = require('../src/main/claude-stream');
const wire = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';

test('Claude stream decodes split events, streams text/tools once and never exposes thinking', () => {
  const chunks = [], sessions = [];
  const parser = createClaudeStream({ onChunk: chunk => chunks.push(chunk.text), onSession: id => sessions.push(id) });
  const output = wire([
    { type: 'system', subtype: 'init', session_id: 'session-1', model: 'fixture' },
    { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'PRIVATE REASONING' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Inspecting project' } } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Inspecting project' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Permission denied' }] } },
    { type: 'result', session_id: 'session-1', result: '{"status":"completed"}', is_error: false }
  ]);
  for (let i = 0; i < output.length; i += 13) parser.push({ stream: 'stdout', text: output.slice(i, i + 13) });
  const result = parser.finish({ code: 0, stderr: '' });
  assert.equal(result.stdout, '{"status":"completed"}');
  assert.equal(result.sessionId, 'session-1');
  assert.equal(result.code, 0);
  assert.ok(sessions.includes('session-1'));
  assert.equal(chunks.join('').split('Inspecting project').length - 1, 1);
  assert.match(chunks.join(''), /Read: README.md/);
  assert.match(chunks.join(''), /Permission denied/);
  assert.ok(!chunks.join('').includes('PRIVATE REASONING'));
});

test('timeout retains partial text and early session; incomplete streams and denied tools cannot pass', () => {
  const parser = createClaudeStream();
  parser.push({ stream: 'stdout', text: wire([{ type: 'system', subtype: 'init', session_id: 'early' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Partial work' }] } }]) });
  assert.deepEqual(parser.finish({ code: -999, stderr: 'Timeout', timedOut: true }), { code: -999, stderr: 'Timeout', timedOut: true, stdout: 'Partial work', sessionId: 'early' });
  assert.equal(createClaudeStream().finish({ code: 0 }).code, 1);
  const denied = createClaudeStream();
  denied.push({ stream: 'stdout', text: wire([{ type: 'result', result: 'Done', permission_denials: [{ tool_name: 'Write' }] }]) });
  assert.equal(denied.finish({ code: 0 }).code, 1);
});

test('Claude adapter keeps prompts on stdin, streams before exit, and uses canonical result', async t => {
  const agent = require('../src/main/agents/claude');
  const execute = agent.execute;
  t.after(() => { agent.execute = execute; });
  const chunks = [];
  agent.execute = async (args, input, options) => {
    assert.ok(args.includes('stream-json') && args.includes('--verbose') && args.includes('--include-partial-messages'));
    assert.ok(!args.includes('fixture prompt'));
    assert.equal(input, 'fixture prompt\n');
    options.onChunk({ stream: 'stdout', text: wire([{ type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }] } }]) });
    assert.match(chunks.join(''), /Working/);
    options.onChunk({ stream: 'stdout', text: wire([{ type: 'result', result: 'Final', session_id: 'fixture-session' }]) });
    return { code: 0, stdout: 'raw protocol should not leak', stderr: '' };
  };
  const result = await agent.runPrompt('fixture prompt', { onChunk: chunk => chunks.push(chunk.text) });
  assert.equal(result.stdout, 'Final');
  assert.equal(result.sessionId, 'fixture-session');
  assert.equal(agent.getRunArgs('', { healthTest: true }).includes('stream-json'), false);
});
