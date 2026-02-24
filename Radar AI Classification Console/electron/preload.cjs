const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radarRuntime', {
  getStatus: () => ipcRenderer.invoke('runtime:getStatus'),
  getLogs: () => ipcRenderer.invoke('runtime:getLogs'),
  updateConfig: (patch) => ipcRenderer.invoke('runtime:updateConfig', patch),
  onStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('runtime:status', listener);
    return () => {
      ipcRenderer.removeListener('runtime:status', listener);
    };
  },
});
