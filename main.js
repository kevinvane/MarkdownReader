const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

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
        {
          label: '导出为 PDF…',
          accelerator: 'CmdOrCtrl+Shift+S',
          id: 'export-pdf',
          enabled: false,
          click: () => {
            win.webContents.send('export-pdf-request');
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

  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.control || input.meta) &&
      input.shift &&
      input.key &&
      input.key.toLowerCase() === 's'
    ) {
      event.preventDefault();
      win.webContents.send('export-pdf-request');
    }
  });
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

async function openFileDialog(win) {
  const result = await dialog.showOpenDialog(win, {
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
}

ipcMain.handle('open-file-dialog', (_event) => {
  const win = BrowserWindow.getFocusedWindow();
  return openFileDialog(win);
});

ipcMain.handle('resolve-image-srcs', (_event, { html, filePath }) => {
  return resolveImageSrcs(html || '', filePath);
});

ipcMain.on('set-export-enabled', (_event, enabled) => {
  const item = Menu.getApplicationMenu()?.getMenuItemById('export-pdf');
  if (item) item.enabled = Boolean(enabled);
});

function resolveImageSrcs(html, filePath) {
  if (!filePath || !path.isAbsolute(filePath)) return html;
  const dir = path.dirname(filePath);
  return html.replace(/<img([^>]*?)\ssrc="([^"]*)"/gi, (match, attrs, src) => {
    if (/^(data:|https?:|file:|blob:)/i.test(src)) return match;
    try {
      return `<img${attrs} src="${pathToFileURL(path.resolve(dir, src)).href}"`;
    } catch (err) {
      return match;
    }
  });
}

const RENDER_MERMAID_SCRIPT = `(async () => {
  if (typeof mermaid === 'undefined') return true;
  const blocks = Array.from(document.querySelectorAll('#print-content .mermaid-block'));
  if (!blocks.length) return true;
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
  for (const block of blocks) {
    const srcEl = block.querySelector('.mermaid-source');
    const host = block.querySelector('.mermaid-svg');
    if (!srcEl || !host) continue;
    try {
      await mermaid.parse(srcEl.textContent);
      const res = await mermaid.render('print-' + Date.now() + '-' + Math.floor(Math.random() * 1e6), srcEl.textContent);
      host.innerHTML = res.svg;
    } catch (e) {
      host.innerHTML = '<p style="color:#d1242f;margin:0;font-size:13px;font-family:sans-serif">Mermaid 渲染失败</p>';
    }
  }
  return true;
})();`;

const WAIT_IMAGES_SCRIPT = `new Promise((resolve) => {
  const imgs = Array.from(document.querySelectorAll('#print-content img'));
  if (imgs.length === 0) { resolve(true); return; }
  let pending = imgs.length;
  let settled = false;
  const finish = () => { if (!settled) { settled = true; resolve(true); } };
  const oneLess = () => { pending--; if (pending <= 0) finish(); };
  imgs.forEach((img) => {
    if (img.complete) { oneLess(); }
    else { img.addEventListener('load', oneLess, { once: true }); img.addEventListener('error', oneLess, { once: true }); }
  });
  setTimeout(finish, 10000);
});`;

ipcMain.handle('export-pdf', async (event, { html, filePath }) => {
  const mainWin = BrowserWindow.fromWebContents(event.sender);
  const hiddenWin = new BrowserWindow({
    width: 794,
    height: 1123,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await hiddenWin.loadFile('print.html');
    const finalHtml = resolveImageSrcs(html || '', filePath);
    await hiddenWin.webContents.executeJavaScript(
      `document.getElementById('print-content').innerHTML = ${JSON.stringify(finalHtml)};`
    );
    await hiddenWin.webContents.executeJavaScript(RENDER_MERMAID_SCRIPT);
    await hiddenWin.webContents.executeJavaScript(WAIT_IMAGES_SCRIPT);

    const data = await hiddenWin.webContents.printToPDF({
      printBackground: false,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });

    const baseName = filePath && path.basename(filePath)
      ? path.basename(filePath, path.extname(filePath))
      : '未命名';
    const saveResult = await dialog.showSaveDialog(mainWin, {
      title: '导出为 PDF',
      defaultPath: `${baseName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, canceled: true };
    }

    await fs.promises.writeFile(saveResult.filePath, data);
    return { ok: true, filePath: saveResult.filePath };
  } catch (err) {
    console.error('导出 PDF 失败:', err);
    return { ok: false, error: err.message || String(err) };
  } finally {
    if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
  }
});

ipcMain.handle('export-chart', async (event, { format, data, defaultName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const isPng = format === 'png';
  const saveResult = await dialog.showSaveDialog(win, {
    title: isPng ? '导出图表为 PNG' : '导出图表为 SVG',
    defaultPath: defaultName || 'mermaid.' + (isPng ? 'png' : 'svg'),
    filters: isPng
      ? [{ name: 'PNG 图片', extensions: ['png'] }]
      : [{ name: 'SVG 图片', extensions: ['svg'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, canceled: true };
  }
  try {
    if (isPng) {
      const base64 = String(data || '').replace(/^data:image\/png;base64,/, '');
      await fs.promises.writeFile(saveResult.filePath, Buffer.from(base64, 'base64'));
    } else {
      await fs.promises.writeFile(saveResult.filePath, String(data || ''), 'utf-8');
    }
    return { ok: true, filePath: saveResult.filePath };
  } catch (err) {
    console.error('导出图表失败:', err);
    return { ok: false, error: err.message || String(err) };
  }
});
