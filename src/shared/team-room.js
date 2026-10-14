(function (root) {
  const ids = ['claude', 'codex', 'gemini'];
  const messages = new Set(['agent_question', 'coordinator_reply', 'output_transferred']);
  function project({ agents = {}, turn = null, live = false, approval = false } = {}) {
    const desks = Object.fromEntries(ids.map(id => [id, { id, enabled: agents[id]?.enabled === true, status: 'idle', taskTitle: '', message: null, participated: false }]));
    let lastMessage = null, ended = null;
    for (const event of turn?.activities || []) {
      const desk = desks[event.agent];
      if (event.type === 'session_started' && turn.options?.mode !== 'economic') { desks.claude.status = 'coordinating'; desks.claude.participated = true; }
      if (desk && ['task_assigned', 'coordination_started', 'final_review_started'].includes(event.type)) {
        desk.status = event.type === 'task_assigned' ? 'working' : 'coordinating'; desk.taskTitle = event.taskTitle || ''; desk.participated = true;
      }
      if (desk && ['task_completed', 'final_review_completed'].includes(event.type)) desk.status = 'completed';
      if (desk && event.type === 'coordination_completed') desk.status = 'idle';
      if (desk && ['task_failed', 'planning_failed', 'coordination_failed', 'final_review_failed'].includes(event.type)) desk.status = 'blocked';
      if (desk && event.type === 'task_blocked') { desk.status = 'blocked'; desk.participated = true; }
      if (desk && event.type === 'agent_question') { desk.status = 'waiting'; desk.participated = true; }
      if (event.type === 'coordinator_reply' && desks[event.toAgent]) desks[event.toAgent].status = 'reply';
      if (messages.has(event.type)) {
        const from = event.fromAgent || event.agent, to = event.toAgent || (event.type === 'agent_question' ? 'claude' : null);
        if (desks[from] && desks[to]) {
          const message = { id: event.id, type: event.type, from, to, text: String(event.output ?? event.input ?? ''), taskTitle: event.taskTitle || '', timestamp: event.timestamp };
          desks[from].message = message; desks[to].message = message; lastMessage = message;
        }
      }
      if (event.type === 'session_finished') ended = event.status;
    }
    const status = ended || turn?.status;
    const active = live && !['completed', 'cancelled', 'failed', 'partial', 'blocked', 'interrupted'].includes(status);
    for (const desk of Object.values(desks)) {
      if (!desk.enabled && active || !desk.enabled && !desk.participated) desk.status = 'disabled';
      else if (!active && turn) {
        const outputs = (turn.outputs || turn.result?.outputs || []).filter(output => output.agent === desk.id);
        if (desk.participated || outputs.length) {
          const last = outputs.at(-1);
          if (last?.success || desk.status === 'completed') desk.status = 'completed';
          else if (status === 'cancelled') desk.status = 'cancelled';
          else if (!status || ['interrupted', 'running', 'awaiting_approval'].includes(status)) desk.status = 'interrupted';
          else if (desk.status === 'blocked' || last && !last.success || ['failed', 'blocked', 'partial'].includes(status)) desk.status = 'blocked';
          else desk.status = 'idle';
        }
      } else if (active && approval && desk.status !== 'disabled') {
        if (desk.id === 'claude') desk.status = 'approval';
        else if (['working', 'coordinating', 'reply'].includes(desk.status)) desk.status = 'waiting';
      } else if (!turn && desk.enabled) {
        if (agents[desk.id]?.status === 'testing') desk.status = 'checking';
        else if (['limited', 'missing', 'unauthenticated', 'error'].includes(agents[desk.id]?.status)) desk.status = 'unavailable';
      }
      desk.animated = active && ['working', 'coordinating'].includes(desk.status);
    }
    return { desks: ids.map(id => desks[id]), lastMessage, active, archive: !!turn && !live, approval: active && approval,
      status: active ? approval ? 'approval' : 'live' : turn ? status || 'archive' : 'idle' };
  }
  const api = { project, ids };
  if (typeof module !== 'undefined') module.exports = api;
  else root.TeamRoomModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
