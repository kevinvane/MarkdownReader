# 导出 PDF 功能设计

- 日期：2026-08-05
- 状态：已批准（方案 A）

## 目标

把当前渲染的 Markdown 内容导出为 PDF 文件，包含文档中的图片。PDF 强制浅色主题，不跟随当前界面暗色/浅色。

## 方案：Electron 内置 `webContents.printToPDF()`

零新增依赖，复用现有 markdown-it + highlight.js 渲染管线，保真度最高，符合项目"无构建工具链、本地化轻量"架构。

## 架构

### 交互

- File 菜单新增「导出为 PDF…」，快捷键 `CmdOrCtrl+Shift+S`
- 文档为空或未打开文件时菜单项禁用
- 导出后由保存对话框选择路径，默认文件名为当前文档名 + `.pdf`

### 数据流

```
renderer.js                     main.js
   |   ipc invoke 'export-pdf'      |
   |  (payload: html, filePath) --->|  创建隐藏 BrowserWindow（print-win）
   |                               |  加载 print.html（复用 lib/*）
   |                               |  注入 html + 强制浅色 class
   |                               |  printToPDF({ printBackground:false, pageSize:'A4' })
   | <--- 返回 PDF Buffer -----------|  showSaveDialog 选择路径
   |                               |  fs.writeFile 写入
   | <--- 返回结果 ---------------->|  成功：通知渲染器；失败：显示错误
```

### 新增文件

- `print.html` — 打印专用入口页，仅加载 `lib/github-markdown.min.css` 与极简打印样式，`<div id="print-content">` 作为注入容器

### 修改文件

- `main.js`
  - `buildMenu` 增加「导出为 PDF…」菜单项（初始禁用，打开文档后启用）
  - 新增 IPC handler `export-pdf`：
    1. 创建隐藏 `BrowserWindow`（`show: false`，`webPreferences` 同主窗口，contextIsolation + preload）
    2. 加载 `print.html`，`did-finish-load` 后通过 `webContents.executeJavaScript` 或注入注入渲染 HTML
    3. 等待图片加载（`webContents.on('did-finish-load')` / 简单 setTimeout），调用 `printToPDF`
    4. `showSaveDialog`（默认名 = 文档名 + `.pdf`）
    5. `fs.writeFile` 写 PDF，销毁隐藏窗口，返回结果
  - 新增 `ipcMain.on('pdf-content-ready', ...)` 通道：渲染器把当前 HTML 经 `export-pdf` 传入，或主进程主动从 `print.html` 执行脚本写入
- `preload.js` — 暴露 `exportPdf(html, filePath)` → `ipcRenderer.invoke('export-pdf', ...)`
- `renderer.js` — 记录当前文件路径与渲染 HTML；菜单通知或保存 `#content` 的 `innerHTML`，调用 `exportPdf`
- `package.json` — `build.files` 加入 `print.html`

### 图片处理

- `data:` 图片直接可用（CSP 已允许）
- `https:` 远程图片直接可用（CSP 已允许）
- 相对路径本地图片：markdown 渲染为 `<img src="相对路径">`，注入前由主进程将相对路径解析为 `file://` 绝对路径（基于当前文件所在目录）
- `img-src 'self'` 需允许 `file:` 协议：打印页 CSP 调整为 `img-src 'self' data: https: file:`

### 主题

- 打印页始终挂载 `body.light-mode`，`printBackground: false`，白底黑字，与当前界面主题无关

### IPC 通道（精确名称）

- `export-pdf`（invoke/handle）— 渲染器请求导出，payload `{ html, filePath }`

## 错误处理

- 未打开文件：菜单禁用，不触发
- `printToPDF` 失败：返回错误对象，渲染器 `alert` 提示
- 保存被取消：静默返回
- 写入失败：提示错误

## 成功标准

1. 打开任意 `.md`（含本地图片、远程图片、代码块）后，File > 导出为 PDF… 生成 PDF
2. PDF 为白底黑字浅色，代码高亮保留，分页正常
3. 当前界面为暗色时，PDF 仍为浅色
4. 导出的 PDF 与当前渲染内容一致
