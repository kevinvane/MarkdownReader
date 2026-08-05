const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, data) => callback(data)),
  onSetTheme: (callback) => ipcRenderer.on('set-theme', (_event, theme) => callback(theme)),
  exportPdf: (html, filePath) => ipcRenderer.invoke('export-pdf', { html, filePath }),
  onExportPdfRequest: (callback) => ipcRenderer.on('export-pdf-request', () => callback()),
  setExportEnabled: (enabled) => ipcRenderer.send('set-export-enabled', enabled),
  resolveImageSrcs: (html, filePath) => ipcRenderer.invoke('resolve-image-srcs', { html, filePath }),
});
