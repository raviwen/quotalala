// A local view of existing activity events. This view never starts agent work.
(function (root) {
  const names = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
  const glyphs = { claude: '✳', codex: '›_', gemini: '✦' };
  function node(tag, className, text) {
    const value = document.createElement(tag); value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  class TeamRoomView {
    constructor({ scene, t, onInspect, onDetails }) {
      Object.assign(this, { scene, t, onInspect, onDetails }); this.desks = new Map(); this.lastMessageId = null;
      const decor = node('div', 'office-decor'); decor.setAttribute('aria-hidden', 'true');
      const window = node('div', 'office-window'); window.append(node('i', 'window-moon'), node('i', 'window-hill'));
      const board = node('div', 'office-board'); this.boardText = node('span', 'office-board-label'); board.append(node('span', 'board-pin'), this.boardText);
      const plant = node('div', 'office-plant'); plant.append(node('i', 'leaf leaf-one'), node('i', 'leaf leaf-two'), node('i', 'leaf leaf-three'), node('i', 'plant-pot'));
      decor.append(window, board, plant); scene.append(decor);
      const stations = node('div', 'office-stations'); scene.append(stations);
      for (const id of TeamRoomModel.ids) {
        const station = node('article', `office-station office-${id}`); station.id = `room-${id}`; station.dataset.agent = id;
        const bubble = node('button', 'office-bubble'); bubble.type = 'button'; bubble.setAttribute('aria-controls', 'roomMessageDetails');
        const bubbleIcon = node('span', 'bubble-icon'); bubbleIcon.setAttribute('aria-hidden', 'true');
        const bubbleText = node('span', 'bubble-text'); bubble.append(bubbleIcon, bubbleText);
        const work = node('div', 'office-work'); work.setAttribute('aria-hidden', 'true');
        const chair = node('div', 'office-chair');
        const person = node('div', 'office-person');
        const head = node('div', 'person-head'); head.append(node('span', 'person-face', glyphs[id]), node('span', 'person-eye eye-left'), node('span', 'person-eye eye-right'));
        person.append(node('div', 'person-body'), node('div', 'person-arm arm-left'), node('div', 'person-arm arm-right'), head);
        const table = node('div', 'office-table');
        const monitor = node('div', 'office-monitor'); monitor.append(node('div', 'monitor-screen', glyphs[id]), node('div', 'monitor-foot'));
        const keyboard = node('div', 'office-keyboard'); keyboard.append(node('i', ''), node('i', ''), node('i', ''));
        table.append(monitor, keyboard, node('div', 'office-mug'), node('div', 'office-notepad'));
        work.append(chair, person, table);
        const label = node('div', 'office-name'); label.append(node('strong', '', names[id]));
        const role = node('span', 'office-role'); label.append(role);
        const status = node('span', 'office-status'); status.dataset.status = 'idle';
        const details = node('button', 'office-details'); details.type = 'button'; details.addEventListener('click', () => this.onDetails(id));
        bubble.addEventListener('click', () => { const message = this.desks.get(id).message; if (message) this.onInspect(message); });
        station.append(bubble, work, label, status, details); stations.append(station);
        this.desks.set(id, { station, bubble, bubbleIcon, bubbleText, role, status, details, message: null });
      }
    }
    update(model) {
      const t = this.t; this.boardText.textContent = t('roomBoard');
      this.scene.classList.toggle('room-archive', model.archive);
      this.scene.dataset.mode = model.archive ? 'archive' : model.active ? 'live' : 'idle';
      for (const desk of model.desks) {
        const ui = this.desks.get(desk.id); ui.message = desk.message;
        ui.station.dataset.status = desk.status;
        ui.station.classList.toggle('is-working', desk.animated);
        ui.station.classList.toggle('is-offline', desk.status === 'disabled');
        ui.status.textContent = t('room_status_' + desk.status); ui.status.dataset.status = desk.status;
        ui.role.textContent = t(desk.id === 'claude' ? 'roomLead' : desk.id === 'codex' ? 'roomBuilder' : 'roomResearch');
        ui.details.textContent = t('agentDetails'); ui.details.setAttribute('aria-label', `${names[desk.id]} • ${t('agentDetails')}`);
        ui.bubble.disabled = !desk.message;
        ui.bubbleIcon.textContent = desk.message ? desk.message.type === 'agent_question' ? '?' : desk.message.type === 'coordinator_reply' ? '↳' : '↗' : desk.status === 'disabled' ? '·' : '…';
        ui.bubbleText.textContent = desk.message ? desk.message.text.replace(/\s+/g, ' ').slice(0, 100) : t(desk.status === 'disabled' ? 'roomClosedBubble' : 'roomIdleBubble');
        ui.bubble.title = desk.message ? `${names[desk.message.from]} → ${names[desk.message.to]} • ${t('roomOpenMessage')}` : t('room_status_' + desk.status);
        ui.station.setAttribute('aria-label', `${names[desk.id]}, ${ui.status.textContent}${desk.taskTitle ? ', ' + desk.taskTitle : ''}`);
      }
      const route = document.getElementById('roomDelivery');
      const message = model.lastMessage;
      document.getElementById('roomLatestMessage').disabled = !message;
      document.getElementById('roomRouteText').textContent = message ? `${names[message.from]} → ${names[message.to]} · ${t(message.type === 'agent_question' ? 'roomQuestion' : message.type === 'coordinator_reply' ? 'roomReply' : 'roomHandoff')}` : t('roomNoMessages');
      const identity = message ? `${message.id}:${message.timestamp}` : null;
      if (model.active && identity && identity !== this.lastMessageId) {
        route.classList.remove('is-fresh'); void route.offsetWidth; route.classList.add('is-fresh');
      }
      if (!model.active) route.classList.remove('is-fresh');
      this.lastMessageId = identity;
      const statusText = t(model.archive ? 'roomArchive' : model.approval ? 'roomNeedsApproval' : model.active ? 'roomLive' : 'roomIdle');
      if (document.getElementById('roomStatus').textContent !== statusText) document.getElementById('roomStatus').textContent = statusText;
      document.getElementById('roomStatus').classList.toggle('is-live', model.active);
      document.getElementById('roomLatestMessage').onclick = () => { if (message) this.onInspect(message); };
    }
  }
  root.TeamRoomView = TeamRoomView;
})(window);
