(function (root) {
  const labels = {
    activity_session_started: 'Oturum başladı',
    activity_plan_created: 'Claude işi {count} parçaya böldü',
    activity_planning_failed: 'Claude planı oluşturamadı',
    activity_task_assigned: '{agent}: {taskTitle} ({level})',
    activity_task_completed: '{agent}: {taskTitle} tamamlandı',
    activity_task_failed: '{agent}: {taskTitle} hata verdi',
    activity_task_blocked: '{agent}: {taskTitle} engellendi',
    activity_output_transferred: '{fromAgent} → {toAgent}: {taskTitle} çıktısı aktarıldı',
    activity_agent_switched: '{fromAgent} → {toAgent}: {taskTitle} için ajan değiştirildi ({cause})',
    activity_model_changed: '{agent}: {taskTitle} için CLI varsayılan modeline geçildi',
    activity_final_review_started: 'Claude son kontrolü başlattı',
    activity_final_review_completed: 'Claude son kontrolü tamamladı',
    activity_final_review_failed: 'Claude son kontrolü tamamlayamadı',
    activity_session_finished: 'Oturum sona erdi ({status})',
    activity_cause_quota: 'kota', activity_cause_auth: 'giriş gerekli', activity_cause_not_found: 'CLI bulunamadı',
    activity_cause_other: 'hata', activity_cause_unavailable: 'ajan kullanılamıyor',
    session_completed: 'tamamlandı', session_partial: 'kısmen tamamlandı', session_failed: 'başarısız', session_blocked: 'engellendi',
    hafif: 'hafif', orta: 'orta', güçlü: 'güçlü', defaultModel: 'CLI varsayılanı'
  };
  const translate = key => labels[key] || key;
  const agentName = id => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }[id] || id || '—');
  function format(event, t = translate) {
    const key = 'activity_' + event.type;
    const template = t(key);
    if (template === key) return String(event.title || event.type || '').slice(0, 240);
    const values = {
      agent: agentName(event.agent), fromAgent: agentName(event.fromAgent), toAgent: agentName(event.toAgent),
      taskTitle: String(event.taskTitle || '').replace(/\s+/g, ' ').slice(0, 120),
      level: t(event.level || 'defaultModel'), count: event.count || 0,
      cause: t('activity_cause_' + (event.cause || 'unavailable')), status: t('session_' + event.status)
    };
    return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match).slice(0, 240);
  }
  function forSession(session) { return (session.turns || []).flatMap(turn => turn.activities || []); }
  // The coordinator gets short headings only, never event payloads or outputs.
  function headlines(events, limit = 20) {
    if (limit <= 0) return [];
    return events.slice(-Math.min(20, limit)).map(event => String(event.title || format(event)).replace(/\s+/g, ' ').slice(0, 240));
  }
  const api = { format, forSession, headlines };
  if (typeof module !== 'undefined') module.exports = api;
  else root.ActivityModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
