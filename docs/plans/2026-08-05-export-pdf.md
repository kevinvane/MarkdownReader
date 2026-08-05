# 导出 PDF 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 MD-Reader 增加「导出为 PDF」功能：把当前渲染的 Markdown 内容导出为 A4 PDF 文件，包含图片，PDF 强制浅色主题。

**Architecture:** 渲染器把已渲染 HTML 通过新 IPC 通道 `export-pdf` 发送给主进程；主进程创建隐藏 `BrowserWindow` 加载 `print.html`，注入 HTML 并等待图片加载后调用 Electron 内置 `webContents.printToPDF()` 生成 PDF Buffer，弹出保存对话框后写入磁盘。零新增依赖。

**Tech Stack:** Electron `webContents.printToPDF()`、IPC (contextBridge)、`pathToFileURL` 图片路径解析。

---

## 任务总览

| # | 任务 | 文件 |
|---|------|------|
| 1 | 创建打印专用入口页 | `print.html`（新建） |
| 2 | 暴露 IPC API | `preload.js` |
| 3 | 菜单项 + 导出处理器 | `main.js` |
| 4 | 渲染器：内容记录与导出触发 | `renderer.js` |
| 5 | 打包清单 | `package.json` |
| 6 | 整体手动验证 | — |

**Git 约定：** 本仓库 AGENTS.md 规定不自动执行 Git 提交。每个任务末尾的 commit 步骤仅在用户明确指示时执行。

---

### Task 1: 创建 `print.html`（打印专用入口页）

**Files:**
- Create: `print.html`

**步骤 1: 新建 `print.html`**

与 `index.html` 同级，加载与主窗口相同的本地样式（保证与当前渲染一致），`body` 强制挂 `light-mode` class。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: file:;">
  <title>MD-Reader 打印页</title>
  <link rel="stylesheet" href="lib/github-markdown.min.css">
  <link rel="stylesheet" href="lib/github-highlight.min.css">
  <link rel="stylesheet" href="custom.css">
  <style>
    body { margin: 0; padding: 0; }
    #print-content { max-width: none; padding: 32px; box-sizing: border-box; }
  </style>
</head>
<body class="light-mode">
  <div id="print-content" class="markdown-body"></div>
</body>
</html>
```

**说明：**
- CSP `img-src` 增加 `file:`，允许本地图片以 `file://` 加载
- 不加载任何脚本，`script-src` 走 `default-src 'self'` 默认值
- `custom.css` 的 `body.light-mode`（特异性高于 `@media (prefers-color-scheme: dark)` 中的 `body`）保证无论系统主题都得到浅色

**步骤 2: 验证**

```bash
npm start
```

Expected: 应用正常启动（本页暂未被使用，仅确认文件语法/路径无误）。

**步骤 3: 提交（可选，等待用户指令）**

```bash
git add print.html
git commit -m "feat: 新增 PDF 打印专用页面"
```

---

### Task 2: 修改 `preload.js` — 暴露导出 API

**Files:**
- Modify: `preload.js`

**步骤 1: 新增 3 个 API**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, data) => callback(data)),
  onSetTheme: (callback) => ipcRenderer.on('set-theme', (_event, theme) => callback(theme)),
  exportPdf: (html, filePath) => ipcRenderer.invoke('export-pdf', { html, filePath }),
  onExportPdfRequest: (callback) => ipcRenderer.on('export-pdf-request', () => callback()),
  setExportEnabled: (enabled) => ipcRenderer.send('set-export-enabled', enabled),
});
```

**说明：** IPC 通道精确名称：`export-pdf`（invoke/handle）、`export-pdf-request`（send/on）、`set-export-enabled`（send/on）。

**步骤 2: 验证**

```bash
npm start
```

Expected: 应用正常启动，`window.electronAPI` 多出 3 个函数。

---

### Task 3: 修改 `main.js` — 菜单项 + 导出处理器

**Files:**
- Modify: `main.js:1-5`（顶部 require）
- Modify: `main.js:21-48`（File 菜单增加导出项）
- Modify: `main.js` 文件末尾（新增 3 个 IPC handler）

**步骤 1: 顶部引入 `pathToFileURL`**

```javascript
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
```

**步骤 2: File 菜单中「打开文件」与「退出」之间新增「导出为 PDF…」**

```javascript
      submenu: [
        {
          label: '打开文件',
          accelerator: 'CmdOrCtrl+O',
          click: async () => { /* 保持原样 */ },
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
```

**说明：**
- `id: 'export-pdf'` 供 `Menu.getApplicationMenu().getMenuItemById('export-pdf')` 动态启停
- `enabled: false` 初始禁用，渲染器报告有内容后才启用

**步骤 3: 文件末尾新增 IPC handler**

```javascript
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
```

**步骤 4: 验证（语法）**

```bash
node -c main.js
```

Expected: 无输出（语法通过）。PowerShell 中可运行 `node --check main.js`。

---

### Task 4: 修改 `renderer.js` — 内容记录与导出触发

**Files:**
- Modify: `renderer.js:1`（新增状态变量）
- Modify: `renderer.js:22-36`（renderMarkdown 记录内容）
- Modify: `renderer.js` 文件末尾（监听导出请求）

**步骤 1: 新增状态变量（`const $` 之后）**

```javascript
let currentHtml = '';
let currentFilePath = null;
```

**步骤 2: `renderMarkdown` 中记录内容**

在 `html = html.replace(...)` 之后、`const contentEl = $('content');` 之前：

```javascript
  currentHtml = html;
  currentFilePath = filePath || null;
```

在设置 `contentEl.innerHTML` 之后（函数末尾、`if (filePath)` 之前或之后均可）调用：

```javascript
  window.electronAPI.setExportEnabled(Boolean(content && content.trim()));
```

**步骤 3: 文件末尾新增导出请求监听**

```javascript
window.electronAPI.onExportPdfRequest(async () => {
  if (!currentHtml) {
    alert('请先打开 Markdown 文件');
    return;
  }
  const result = await window.electronAPI.exportPdf(currentHtml, currentFilePath || '');
  if (result.canceled) return;
  if (result.ok) {
    alert('导出成功：' + result.filePath);
  } else {
    alert('导出失败：' + (result.error || '未知错误'));
  }
});
```

**步骤 4: 验证（语法）**

```bash
node --check renderer.js
```

Expected: 无输出（语法通过）。

---

### Task 5: 修改 `package.json` — 打包清单加入打印页

**Files:**
- Modify: `package.json:21-32`（`build.files`）

**步骤 1: 在 `build.files` 中 `index.html` 后新增 `print.html`**

```json
      "index.html",
      "print.html",
```

**步骤 2: 验证**

```bash
npm run pack
```

Expected: 打包成功，`release/` 产物中包含 `print.html`。

---

### Task 6: 整体手动验证

**步骤 1: 准备测试文档**

在 `docs/` 或临时目录准备一个 `test-export.md`，内容包含：标题、列表（含 checkbox `- [x]`）、代码块（```js）、一张相对路径本地图片（`![x](img.png)` 或相对子目录）以及一张远程图片（`https://...`）。

**步骤 2: 启动应用**

```bash
npm start
```

**步骤 3: 功能验证清单**

1. 启动后 File 菜单「导出为 PDF…」为禁用状态（灰色）
2. File > 打开文件 打开 `test-export.md` → 菜单项变为可点击
3. File > 导出为 PDF… → 弹出保存对话框，默认文件名为 `test-export.pdf`，路径可改
4. 保存后弹出「导出成功」，在目标路径打开 PDF：
   - 白底黑字（浅色）
   - 代码块语法高亮保留
   - 本地图片正常显示
   - 远程图片正常显示（如网络不可用则缺失，不阻塞导出）
   - checkbox 正常渲染
   - A4 分页正常，长文自动分页
5. View > 切换暗色模式 后再导出 → PDF 仍为浅色
6. 不打开文件直接按 `CmdOrCtrl+Shift+S` → 提示「请先打开 Markdown 文件」
7. 保存对话框点「取消」→ 无报错、无「导出成功」提示
8. 拖拽打开 `.md` 文件 → 导出功能可用

**步骤 4: 提交（可选，等待用户指令）**

```bash
git add print.html preload.js main.js renderer.js package.json
git commit -m "feat: 增加导出 PDF 功能"
```
