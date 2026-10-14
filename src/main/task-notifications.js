const copy = {
  tr: { approval: ['Bir kararın gerekiyor', 'Görev planı onayını bekliyor. Açmak için tıkla.'], completed: ['Ekip işi bitirdi', 'Görev sonucu hazır. İncelemek için tıkla.'], partial: ['Ekip senden kontrol bekliyor', 'Çalışmanın bazı adımları eksik kaldı. İncelemek için tıkla.'], failed: ['Ekip bir engelle karşılaştı', 'Çalışma tamamlanamadı. Ayrıntıları açmak için tıkla.'] },
  en: { approval: ['Your decision is needed', 'A task plan is waiting for your approval. Click to open.'], completed: ['The team has finished', 'Your task result is ready. Click to review.'], partial: ['The team needs your attention', 'Some steps remain incomplete. Click to review.'], failed: ['The team encountered a blocker', 'The task could not be completed. Click to see the details.'] }
};
const activeNotifications = new Set();
class TaskNotifications {
  constructor({ send, getSettings, isForeground, getLanguage, focus }) { Object.assign(this, { send, getSettings, isForeground, getLanguage, focus }); this.seen = new Set(); }
  consume(channel, payload) {
    let kind, key;
    if (channel === 'session:approval') { kind = 'approval'; key = `approval:${payload.runId}`; }
    else if (channel === 'session:activity' && payload.activity?.type === 'session_finished') {
      const status = payload.activity.status;
      if (status === 'cancelled') return;
      kind = status === 'completed' ? 'completed' : status === 'partial' ? 'partial' : ['failed', 'blocked', 'interrupted'].includes(status) ? 'failed' : null;
      key = `finished:${payload.sessionId}:${payload.turnId}`;
    }
    if (!kind || !payload.sessionId || !payload.turnId || this.seen.has(key)) return;
    this.seen.add(key); if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value);
    try {
      if (this.getSettings().notificationsEnabled === false || this.isForeground()) return;
      const [title, body] = (copy[this.getLanguage()] || copy.tr)[kind];
      const target = { sessionId: payload.sessionId, turnId: payload.turnId, kind };
      this.send(title, body, () => this.focus(target));
    } catch { /* Desktop notification failures must never interrupt a task. */ }
  }
}
function showNotification(Notification, { title, body, icon, click }) {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body, icon, silent: true });
  const release = () => activeNotifications.delete(notification);
  notification.on('click', () => { release(); try { click(); } catch {} }); notification.on('close', release); notification.on('failed', release);
  if (activeNotifications.size >= 20) { const oldest = activeNotifications.values().next().value; activeNotifications.delete(oldest); oldest.close?.(); }
  activeNotifications.add(notification);
  try { notification.show(); } catch (error) { release(); throw error; }
  return true;
}
module.exports = { TaskNotifications, showNotification };
