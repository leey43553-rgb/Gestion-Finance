const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  saveBackup: (jsonContent, kind = 'manual', customDir = '') =>
    ipcRenderer.invoke('backup:save', { jsonContent, kind, customDir }),
  listBackups: (customDir = '') =>
    ipcRenderer.invoke('backup:list', customDir),
  restoreBackup: (filePath = '') =>
    ipcRenderer.invoke('backup:restore', filePath),
  printToPDF: (options = {}) =>
    ipcRenderer.invoke('pdf:printToPDF', options),
  selectFolder: (currentDir = '') =>
    ipcRenderer.invoke('backup:selectFolder', currentDir),
  getDefaultBackupFolder: () =>
    ipcRenderer.invoke('backup:getDefaultFolder'),
  onRequestCloseBackup: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:request-close-backup', listener);
    return () => ipcRenderer.removeListener('app:request-close-backup', listener);
  },
  notifyCloseBackupDone: () => ipcRenderer.send('app:close-backup-done'),
});
