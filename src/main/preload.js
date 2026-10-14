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
  runSession: invoke('session:run'), listSessions: invoke('sessions:list'), openSession: invoke('sessions:open'),
  renameSession: invoke('sessions:rename'), deleteSession: invoke('sessions:delete'), clearHistory: invoke('sessions:clear'),
  getMemory: invoke('memory:get'), saveMemory: invoke('memory:save'), resetMemory: invoke('memory:reset'),
  getWorkspace: invoke('workspace:get'), openWorkspace: invoke('workspace:open'),
  chooseFolder: invoke('folder:choose'), copy: invoke('clipboard:copy'), textMenu: invoke('text:menu'), setLanguage: invoke('language:set'),
  onLog: listen('stream:log'), onState: listen('state:update'), onPlan: listen('session:plan'),
  onOutput: listen('session:output'), onActivity: listen('session:activity'), onSelectAll: listen('text:select-all')
});
