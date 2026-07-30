# AI 代理指令集：Electron Markdown 阅读器 (Phase 1)

## 1. 核心角色定义
你是一名 **Electron 安全架构师**。你的任务是根据以下严格的输入/输出规范，生成一组用于 **只读 Markdown 渲染** 的 Electron 应用文件。代码必须零警告、零安全漏洞，且视觉上 1:1 还原 GitHub 主题。

## 2. 硬性技术约束 (Hard Constraints)
- **运行时**：Node.js v20+，Electron v28.0.0+。
- **包管理器**：npm。
- **渲染安全**：**必须** 启用 `contextIsolation: true`。**禁止** 在渲染进程中使用 `nodeIntegration: true`。
- **XSS 防御**：`markdown-it` 必须配置 `html: false`，且 CSP 头部必须阻止 `unsafe-inline`（仅允许通过 CDN 加载的脚本）。
- **依赖加载策略**：为避免 Webpack/Rollup 等构建工具带来的复杂性，渲染进程 **必须** 通过 **CDN (jsdelivr/unpkg)** 加载第三方库（`markdown-it`, `highlight.js`），而不是使用 `require` 或 `import`。

## 3. 目录结构与文件职责
AI 必须生成以下 5 个文件，并放置在项目根目录：
```text
/ (项目根目录)
├── main.js        # 主进程：窗口创建、文件读取、IPC 注册
├── preload.js     # 预加载脚本：暴露安全的 API 桥接
├── index.html     # 渲染进程入口：加载 CSS、UI 骨架
├── renderer.js    # 渲染逻辑：markdown-it 实例化、DOM 操作
└── custom.css     # 覆盖样式：微调 github-markdown-css 以匹配 GitHub 主题
```

## 4. 详细的原子化功能需求 (Atomic Functional Requirements)

### 4.1 主进程 (main.js) 规格
- **窗口属性**：`width: 1000`, `height: 800`, `webPreferences` 必须包含 `preload` 指向预加载脚本，`contextIsolation: true`。
- **IPC 通道**：必须注册 `ipcMain.handle('open-file-dialog', ...)`。
  - **行为**：调用 `dialog.showOpenDialog`，过滤 `['md', 'markdown']`。
  - **返回结构**：成功时返回 `{ filePath: string, content: string }`；取消/失败返回 `null`。
  - **读取编码**：默认 `utf8`，若读取失败则尝试 `latin1` 兜底，禁止应用崩溃。
- **应用协议**：注册 `app.setAsDefaultProtocolClient('markdown-reader')`（可选，但建议实现）。

### 4.2 预加载脚本 (preload.js) 规格
- **暴露 API**：使用 `contextBridge.exposeInMainWorld('electronAPI', { openFile: ... })`。
- **类型签名**：`openFile(): Promise<{ filePath: string; content: string } | null>`。
- **禁止**：暴露任何 `fs`, `path`, `process` 对象给渲染进程。

### 4.3 渲染进程 (index.html & renderer.js) 规格
- **CDN 库固定版本**（AI 必须使用这些具体 URL）：
  - CSS：`https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.0/github-markdown.min.css`
  - 高亮 CSS：`https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css`
  - JS 库：`https://cdn.jsdelivr.net/npm/markdown-it@14.0.0/dist/markdown-it.min.js`
  - JS 高亮：`https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/dist/highlight.min.js`
- **UI 布局**：
  - 顶部工具栏（高度 `52px`）：包含一个“📂 打开”按钮 + 当前文件名的展示区域。
  - 主内容区：包裹 `<div id="content" class="markdown-body">`，内部由 JS 动态注入渲染后的 HTML。
- **拖拽交互**：
  - 监听全局 `dragover` 和 `drop` 事件。
  - 仅当拖入文件后缀为 `.md` 或 `.markdown` 时触发渲染，否则弹出 `alert('不支持此文件类型')`。
  - 拖拽读取应使用 `file.text()` 方法（浏览器原生 API），避免占用主进程。
- **Markdown-it 配置**：
  - `html: false, linkify: true, typographer: true`。
  - `highlight` 函数必须调用 `hljs.highlightAuto(str).value`（若指定 lang 则使用 `highlight(str, {lang})`）。

### 4.4 样式覆盖 (custom.css) 规格（关键：对齐 GitHub 主题）
AI 必须包含以下精确的 CSS 覆盖，这是视觉还原度通过验收的核心：
```css
body { margin: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
#toolbar { padding: 12px 24px; background: #f6f8fa; border-bottom: 1px solid #e1e4e8; display: flex; gap: 16px; align-items: center; }
#content { max-width: 860px; margin: 0 auto; padding: 50px 30px 80px 30px; box-sizing: border-box; }

/* 微调 GitHub 主题 */
.markdown-body h1, .markdown-body h2 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
.markdown-body blockquote { border-left: 0.25em solid #d0d7de; padding: 0 1em; color: #6a737d; }
.markdown-body pre { background-color: #f6f8fa; border-radius: 6px; padding: 16px; overflow: auto; }
.markdown-body code { background-color: rgba(175, 184, 193, 0.2); border-radius: 4px; padding: 0.2em 0.4em; }
.markdown-body img { display: block; margin: 0 auto; max-width: 100%; }
```

## 5. 错误处理与边缘案例 (Edge Cases)
- **空文件**：渲染为空白，但提示“文件内容为空”。
- **超大文件（> 20MB）**：渲染进程可能卡顿，必须使用 `requestIdleCallback` 分片渲染，或至少在 UI 显示加载遮罩。
- **文件名过长**：在顶部工具栏中使用 `text-overflow: ellipsis` 截断。
- **非 UTF-8 编码**：若主进程读取 `utf8` 抛出异常，自动降级为 `latin1` 并记录警告日志到控制台。

## 6. 验收测试指令 (Self-Check for AI)
在生成代码后，AI 必须自行在逻辑上验证以下断点：
1. `main.js` 中是否包含 `app.whenReady().then(createWindow)`？
2. `preload.js` 是否使用了 `contextBridge` 且**没有**使用 `require('fs')`？
3. `index.html` 是否在 `<head>` 中正确插入了 CSP 标签？（示例：`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline';" />`）—— *注意：`'unsafe-inline'` 对 style 是必需的，因为 github-markdown-css 使用内联样式。*
4. `renderer.js` 中的 `markdownIt` 是否通过全局变量 `window.markdownit` 访问（因为 CDN 加载）？

## 7. 输出格式要求
- AI 必须为每个文件输出独立且完整的代码块，并标注文件名。
- 在代码块之后，附上 `package.json` 的 `dependencies` 和 `scripts` 字段内容（`start: electron .`）。
- **不要**输出解释性长文本，除非 AI 发现需求矛盾。保持输出极度精简，专注代码。

---

**执行指令**：请根据上述规格，生成可直接用于 `npm install` 和 `npm start` 的完整代码。
