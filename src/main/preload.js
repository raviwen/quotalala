const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => callback => {
  const subscription = (event, data) => callback(data);
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
};
contextBridge.exposeInMainWorld('quotalalaAPI', {
  getState: invoke('state:get'), runHealthCheck: invoke('health:run'), testAgent: invoke('health:run'),
  getSettings: invoke('settings:get'), saveSettings: invoke('settings:save'),
  getModels: invoke('models:get'), saveModels: invoke('models:save'),
  cancelSession: invoke('session:cancel'), approvePlan: invoke('session:approve'),
  onStream: listen('session:stream'), onApproval: listen('session:approval'), onWorkspace: listen('workspace:changed'),
  onSessionFocus: listen('session:focus'),
  runSession: invoke('session:run'), listSessions: invoke('sessions:list'), openSession: invoke('sessions:open'),
  renameSession: invoke('sessions:rename'), deleteSession: invoke('sessions:delete'), clearHistory: invoke('sessions:clear'),
  getMemory: invoke('memory:get'), saveMemory: invoke('memory:save'), resetMemory: invoke('memory:reset'),
  getWorkspace: invoke('workspace:get'), openWorkspace: invoke('workspace:open'),
  chooseFolder: invoke('folder:choose'), copy: invoke('clipboard:copy'), textMenu: invoke('text:menu'), setLanguage: invoke('language:set'),
  onLog: listen('stream:log'), onState: listen('state:update'), onPlan: listen('session:plan'),
  onOutput: listen('session:output'), onActivity: listen('session:activity'), onSelectAll: listen('text:select-all'),
  listBoard: invoke('board:list'), addBoardTask: invoke('board:add'), answerBoardTask: invoke('board:answer'),
  cancelBoardTask: invoke('board:cancel'), mergeBoardTask: invoke('board:merge'), retryBoardTask: invoke('board:retry'),
  onBoardChanged: listen('board:changed'), onBoardStream: listen('board:stream')
});
