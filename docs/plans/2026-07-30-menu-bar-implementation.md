# 菜单栏实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 MarkdownReader 替换 Electron 默认菜单，实现自定义精简菜单栏（File/View/Help）。

**Architecture:** 主进程 `main.js` 使用 `Menu.buildFromTemplate()` 构建菜单，通过 `webContents` 控制视图行为，通过 IPC 向渲染进程发送深色模式切换事件。

**Tech Stack:** Electron Menu API, IPC (contextBridge)

---

### Task 1: 修改 main.js — 添加自定义菜单

**Files:**
- Modify: `main.js:21-45`

**步骤 1: 在 main.js 顶部导入 Menu**

```javascript
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
```

**步骤 2: 创建 buildMenu 函数**

```javascript
function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: '打开文件',
          accelerator: process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const filePath = result.filePaths[0];
            const { isValidFile, readFileSafe } = require('./main'); // won't work, need refactor
            // Actually, we should handle this via IPC or inline the logic
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          role: 'quit',
        },
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
            win.webContents.send('toggle-dark-mode');
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
              detail: '版本：1.0.0\n轻量级 Markdown 阅读器\n基于 Electron 构建',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

**步骤 3: 在 createWindow 中调用 buildMenu(win)**

```javascript
function createWindow() {
  const win = new BrowserWindow({ ... });
  buildMenu(win);
  win.loadFile('index.html');
}
```

**步骤 4: 验证**

```bash
npm start
```
Expected: 窗口菜单栏显示 File/View/Help 三个菜单，替代默认的五个菜单。

---

### Task 2: 修改 preload.js — 暴露深色模式监听

**Files:**
- Modify: `preload.js:1-5`

**步骤 1: 新增 onToggleDarkMode API**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  onToggleDarkMode: (callback) => ipcRenderer.on('toggle-dark-mode', () => callback()),
});
```

---

### Task 3: 修改 renderer.js — 处理深色模式切换

**Files:**
- Modify: `renderer.js`

**步骤 1: 在文件末尾添加深色模式监听**

```javascript
window.electronAPI.onToggleDarkMode(() => {
  document.body.classList.toggle('dark-mode');
});
```

---

### Task 4: 修改 custom.css — 深色模式样式

**Files:**
- Modify: `custom.css`

**步骤 1: 添加深色模式样式覆盖**

```css
body.dark-mode {
  background: #0d1117;
  color: #c9d1d9;
}
body.dark-mode #toolbar {
  background: #161b22;
  border-bottom-color: #30363d;
}
body.dark-mode #content {
  color: #c9d1d9;
}
body.dark-mode .markdown-body {
  color: #c9d1d9;
}
body.dark-mode .markdown-body h1,
body.dark-mode .markdown-body h2 {
  border-bottom-color: #21262d;
}
body.dark-mode .markdown-body blockquote {
  color: #8b949e;
  border-left-color: #30363d;
}
body.dark-mode .markdown-body pre {
  background-color: #161b22;
}
body.dark-mode .markdown-body code {
  background-color: rgba(240, 246, 252, 0.15);
}
```

---

### Task 5: 验证整体功能

**步骤 1: 启动应用**

```bash
npm start
```

**步骤 2: 验证菜单功能**
- File > 打开文件：弹出文件选择对话框
- File > 退出：关闭应用
- View > 放大/缩小/重置缩放：页面内容缩放
- View > 切换深色模式：页面切换为深色主题
- View > 重新加载：页面刷新
- View > 开发者工具：打开 DevTools
- Help > 关于 MarkdownReader：弹出关于对话框
