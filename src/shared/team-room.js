(function (root) {
  const ids = ['claude', 'codex', 'gemini'];
  const messages = new Set(['agent_question', 'coordinator_reply', 'output_transferred']);
  // A speech bubble is for humans: skip the raw process header and keep the
  // last meaningful output lines instead of a PID/path prefix.
  function boardText(task, fallback) {
    const result = typeof task.result === 'string' ? task.result.trim() : '';
    if (result) return result;
    const lines = String(task.liveOutput || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !/^\[process\]/i.test(line))
      .slice(-3);
    return lines.join(' ') || fallback;
  }
  function project({ agents = {}, turn = null, live = false, approval = false, boardTasks = [] } = {}) {
    const desks = Object.fromEntries(ids.map(id => [id, { id, enabled: agents[id]?.enabled === true, status: 'idle', taskTitle: '', message: null, participated: false }]));
    let lastMessage = null, ended = null;

    // Check active board tasks
    const activeBoardTasks = (boardTasks || []).filter(t => ['planning', 'running', 'review', 'needs_user', 'awaiting_approval'].includes(t.status));
    const boardIsActive = activeBoardTasks.length > 0;
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
      // A disabled desk is only rendered as "disabled" when it never took part
      // (or while the session is live); past participation keeps its outcome.
      if ((!desk.enabled && active) || (!desk.enabled && !desk.participated)) desk.status = 'disabled';
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

    // Overlay board tasks when room is otherwise idle or when board tasks are running
    if (!live && boardIsActive) {
      for (const bt of activeBoardTasks) {
        if (bt.status === 'planning' || bt.status === 'review') {
          if (desks.claude && desks.claude.enabled) {
            desks.claude.status = 'coordinating';
            desks.claude.animated = true;
            desks.claude.taskTitle = bt.title || bt.request?.slice(0, 40) || '';
            const msg = {
              id: 'board-plan-' + bt.id,
              type: 'coordinator_decision',
              from: 'claude',
              to: 'codex',
              text: bt.status === 'planning' ? 'Görevi inceliyorum ve planlıyorum...' : 'Sonuçları kontrol ediyorum...',
              taskTitle: desks.claude.taskTitle
            };
            desks.claude.message = msg;
            lastMessage = msg;
          }
        } else if (bt.status === 'running') {
          const workerAgent = bt.agent && desks[bt.agent] ? bt.agent : 'codex';
          if (desks[workerAgent] && desks[workerAgent].enabled) {
            desks[workerAgent].status = 'working';
            desks[workerAgent].animated = true;
            desks[workerAgent].taskTitle = bt.title || bt.request?.slice(0, 40) || '';
            const msg = {
              id: 'board-run-' + bt.id,
              type: 'output_transferred',
              from: workerAgent,
              to: 'claude',
              text: boardText(bt, bt.title ? `${bt.title} üzerinde çalışıyorum...` : 'Görevi yerine getiriyorum...'),
              taskTitle: desks[workerAgent].taskTitle
            };
            desks[workerAgent].message = msg;
            lastMessage = msg;
          }
        } else if (bt.status === 'awaiting_approval') {
          if (desks.claude && desks.claude.enabled) {
            desks.claude.status = 'approval';
            desks.claude.animated = false;
            desks.claude.taskTitle = bt.title || bt.request?.slice(0, 40) || '';
            const msg = {
              id: 'board-approval-' + bt.id,
              type: 'coordinator_decision',
              from: 'claude',
              to: bt.agent && desks[bt.agent] ? bt.agent : 'codex',
              text: 'Plan hazır, kullanıcı onayı bekleniyor...',
              taskTitle: desks.claude.taskTitle
            };
            desks.claude.message = msg;
            lastMessage = msg;
          }
        } else if (bt.status === 'needs_user') {
          const workerAgent = bt.agent && desks[bt.agent] ? bt.agent : 'claude';
          // Surface the pending question even when the desk is disabled: the
          // user still owes an answer and must see it in the room.
          if (desks[workerAgent]) {
            desks[workerAgent].status = 'waiting';
            desks[workerAgent].animated = false;
            const msg = {
              id: 'board-q-' + bt.id,
              type: 'agent_question',
              from: workerAgent,
              to: 'claude',
              text: bt.question || 'Kullanıcıdan cevap bekleniyor.',
              taskTitle: bt.title || ''
            };
            desks[workerAgent].message = msg;
            lastMessage = msg;
          }
        }
      }
    }

    if (!live && !boardIsActive) {
      const seen = new Set();
      for (const task of [...boardTasks].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))) {
        const id = task.agent || 'claude', desk = desks[id];
        if (!desk?.enabled || seen.has(id)) continue;
        seen.add(id);
        const status = { failed: 'blocked', cancelled: 'cancelled', merged: 'completed', ready_to_merge: 'completed', waiting_quota: 'waiting' }[task.status];
        if (!status) continue;
        desk.status = status; desk.animated = false; desk.participated = true; desk.taskTitle = task.title || '';
        desk.message = { id: `board-end-${task.id}`, from: id, to: 'claude', type: 'output_transferred', taskTitle: desk.taskTitle,
          text: task.history?.at(-1)?.text || boardText(task, task.status) || task.status };
        if (!lastMessage) lastMessage = desk.message;
      }
    }
    const effectiveActive = active || (!live && boardIsActive);
    return { desks: ids.map(id => desks[id]), lastMessage, active: effectiveActive, archive: !!turn && !live && !boardIsActive, approval: active && approval,
      status: effectiveActive ? (approval ? 'approval' : 'live') : (turn ? status || 'archive' : 'idle') };
  }
  const api = { project, ids };
  if (typeof module !== 'undefined') module.exports = api;
  else root.TeamRoomModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
