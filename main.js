const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const VALID_EXTENSIONS = ['.md', '.markdown'];

function isValidFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`UTF-8 read failed for ${filePath}, falling back to latin1:`, err.message);
    return fs.readFileSync(filePath, 'latin1');
  }
}

function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: '打开文件',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const filePath = result.filePaths[0];
            if (!isValidFile(filePath)) return;
            try {
              const content = readFileSafe(filePath);
              win.webContents.send('file-opened', { filePath, content });
            } catch (err) {
              console.error('Failed to read file:', err.message);
            }
          },
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        {
          label: '切换深色模式',
          click: () => {
            win.webContents.send('set-theme', 'dark');
          },
        },
        {
          label: '切换浅色模式',
          click: () => {
            win.webContents.send('set-theme', 'light');
          },
        },
        { type: 'separator' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: '关于 MarkdownReader',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: '关于 MarkdownReader',
              message: 'MarkdownReader ',
              detail: '版本：1.0.0\n轻量级 Markdown 阅读器\n',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: path.join(__dirname, 'assets', 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  buildMenu(win);
  win.loadFile('index.html');
}

app.setAsDefaultProtocolClient('markdown-reader');

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];

  if (!isValidFile(filePath)) {
    return null;
  }

  try {
    const content = readFileSafe(filePath);
    return { filePath, content };
  } catch (err) {
    console.error(`Failed to read file: ${filePath}`, err.message);
    return null;
  }
});
