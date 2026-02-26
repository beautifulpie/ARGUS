const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radarRuntime', {
  getStatus: () => ipcRenderer.invoke('runtime:getStatus'),
  getLogs: () => ipcRenderer.invoke('runtime:getLogs'),
  updateConfig: (patch) => ipcRenderer.invoke('runtime:updateConfig', patch),
  appendEventLogsCsv: (entries) => ipcRenderer.invoke('runtime:appendEventLogsCsv', entries),
  listEventLogFiles: () => ipcRenderer.invoke('runtime:listEventLogFiles'),
  readEventLogFile: (payload) => ipcRenderer.invoke('runtime:readEventLogFile', payload),
  openEventLogViewer: () => ipcRenderer.invoke('runtime:openEventLogViewer'),
  openLayoutDevConsole: () => ipcRenderer.invoke('runtime:openLayoutDevConsole'),
  getMainWindowBounds: () => ipcRenderer.invoke('runtime:getMainWindowBounds'),
  setMainWindowSize: (payload) => ipcRenderer.invoke('runtime:setMainWindowSize', payload),
  pickModelPath: (options) => ipcRenderer.invoke('runtime:pickModelPath', options),
  pickDirectory: (options) => ipcRenderer.invoke('runtime:pickDirectory', options),
  readGeoJsonFromDirectory: (payload) => ipcRenderer.invoke('runtime:readGeoJsonFromDirectory', payload),
  onStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('runtime:status', listener);
    return () => {
      ipcRenderer.removeListener('runtime:status', listener);
    };
  },
});
