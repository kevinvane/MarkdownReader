# Phase 1 执行实施计划：MarkdownReader 

**依据文档**：`docs/产品设计文档：Markdown 阅读器（第一阶段）.md`、`docs/AI 代理指令集.md`
**角色**：Electron 安全架构师
**目标**：零警告、零安全漏洞、GitHub 主题 1:1 还原

---

## 1. 先决条件

| 项目 | 要求 |
| :--- | :--- |
| Node.js | v20+ |
| npm | 最新稳定版 |
| Electron | v28.0.0+ |

---

## 2. 实施步骤（按顺序执行）

### Step 1：项目初始化

```bash
mkdir MarkdownReader && cd MarkdownReader
npm init -y
```

- `package.json` 必须包含：
  - `"main": "main.js"`
  - `"scripts": { "start": "electron ." }`
  - `"dependencies": { "electron": "^28.0.0" }`

---

### Step 2：主进程 — `main.js`

**核心职责**：窗口生命周期 + 文件 I/O + IPC 注册

| 关注点 | 实现要求 |
| :--- | :--- |
| 窗口配置 | `width: 1000, height: 800, contextIsolation: true, preload` |
| IPC 通道 | `ipcMain.handle('open-file-dialog')` → `dialog.showOpenDialog` 过滤 `['md', 'markdown']` |
| 文件读取 | 默认 `utf-8`，失败降级 `latin1`，禁止崩溃 |
| 安全校验 | 读取前校验后缀名是否在白名单 `['.md', '.markdown']` |
| 返回值 | `{ filePath: string, content: string }` 或 `null` |

**关键代码骨架**：
```
app.whenReady() → createWindow()
  → BrowserWindow({ webPreferences: { preload, contextIsolation: true } })
  → ipcMain.handle('open-file-dialog', handler)
```

---

### Step 3：预加载脚本 — `preload.js`

**核心职责**：安全桥接渲染进程 ↔ 主进程

| 关注点 | 实现要求 |
| :--- | :--- |
| API 暴露 | `contextBridge.exposeInMainWorld('electronAPI', { openFile })` |
| 类型签名 | `openFile(): Promise<{filePath, content} | null>` |
| 红线 | **禁止**暴露 `fs`、`path`、`process`、`require` |

**验证点**：渲染进程中 `window.electronAPI.openFile()` 可调用。

---

### Step 4：渲染入口 — `index.html`

**核心职责**：安全策略 + UI 骨架 + CDN 依赖加载

| 关注点 | 实现要求 |
| :--- | :--- |
| CSP | `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline';">` |
| CDN CSS | `github-markdown-css@5.5.0`、`highlight.js@11.9.0/styles/github.min.css` |
| CDN JS | `markdown-it@14.0.0`、`highlight.js@11.9.0` |
| 本地资源 | `custom.css`、`renderer.js` |
| UI 骨架 | 工具栏 `#toolbar`（打开按钮 + 文件名）+ 内容区 `#content.markdown-body` |

**拖拽事件**：在 `index.html` 中绑定 body 的 `dragover`/`drop` 事件（或由 `renderer.js` 负责）。

---

### Step 5：渲染逻辑 — `renderer.js`

**核心职责**：markdown-it 配置 + 渲染 + 拖拽 + 按钮事件

| 关注点 | 实现要求 |
| :--- | :--- |
| markdown-it | `window.markdownit({ html: false, linkify: true, typographer: true })` |
| highlight 回调 | `hljs.highlightAuto(str).value` / `hljs.highlight(str, { lang })` |
| 打开按钮 | 点击调用 `window.electronAPI.openFile()` → 渲染结果注入 `#content` |
| 拖拽打开 | `file.text()` 读取 → `markdownit.render()` → 注入 DOM |
| 工具栏更新 | 渲染完成后更新 `#fileName` 显示当前文件名 |
| 异常处理 | 空文件提示、文件类型校验、渲染错误捕获 |

**约定**：绝对不出现 `require` 或 `import`，所有库通过全局变量访问。

---

### Step 6：样式覆盖 — `custom.css`

**核心职责**：微调 `github-markdown-css` 以匹配 GitHub 主题

**必须包含的覆盖规则**：

| 选择器 | 作用 |
| :--- | :--- |
| `body` | 重置 margin，设置字体栈 |
| `#toolbar` | 背景 `#f6f8fa`，下边框 `#e1e4e8` |
| `#content` | 最大宽度 860px，居中，内边距 50px/30px |
| `h1, h2` | 下边框 `#eaecef`，与 GitHub 主题一致 |
| `h1, h2, h3` | margin-top 24px，font-weight 600 |
| `blockquote` | 左边框 `#d0d7de`，颜色 `#6a737d` |
| `pre` | 背景 `#f6f8fa`，圆角 6px，内边距 16px |
| `code` | 背景 `rgba(175,184,193,0.2)`，圆角 4px |
| `img` | 块级居中，最大宽度 100% |

---

## 3. 依赖清单

```json
{
  "dependencies": {
    "electron": "^28.0.0"
  },
  "devDependencies": {},
  "scripts": {
    "start": "electron ."
  }
}
```

> 说明：`markdown-it`、`highlight.js`、`github-markdown-css` 均通过 CDN 加载，不纳入 `package.json`。

---

## 4. 验收检查清单

### 4.1 安全审计
- [ ] `contextIsolation: true` — 渲染进程无法访问 Node API
- [ ] `preload.js` 无 `require('fs')`、`require('path')`
- [ ] `markdown-it` 配置 `html: false`
- [ ] CSP 禁止 `unsafe-inline` 脚本（style 除外）
- [ ] 文件后缀白名单校验

### 4.2 功能验收
- [ ] **AC1**：菜单栏 `Ctrl+O` / 按钮打开 `.md` 文件，渲染效果与 GitHub 主题对比无肉眼差异
- [ ] **AC2**：拖拽 `.md` 文件到窗口，正确渲染；拖拽 `.exe`/`.txt` 提示"不支持的文件类型"
- [ ] **AC3**：超大文件不崩溃，滚动流畅
- [ ] **AC4**：`<script>alert('xss')</script>` 显示为纯文本
- [ ] **AC5**：非 UTF-8 文件自动降级 `latin1`
- [ ] **AC6**：空文件提示"文件内容为空"
- [ ] **AC7**：文件名过长时 `text-overflow: ellipsis` 截断

### 4.3 性能检查
- [ ] 空窗启动 < 500ms
- [ ] 10万字文件渲染 < 1.5s
- [ ] 闲置内存 < 80MB，加载大文件 < 150MB
- [ ] 滚动帧率 60 FPS

---

## 5. 实施顺序总览

```
Step 1:  npm init, 配置 package.json
Step 2:  编写 main.js（主进程）
Step 3:  编写 preload.js（预加载桥接）
Step 4:  编写 index.html（安全策略 + CDN + 骨架）
Step 5:  编写 renderer.js（渲染逻辑）
Step 6:  编写 custom.css（样式覆盖）
Step 7:  npm install
Step 8:  npm start → 验证
```

---

## 6. 风险与缓解

| 风险 | 缓解措施 |
| :--- | :--- |
| CDN 加载失败导致渲染空白 | 添加 `onerror` 回退提示，或考虑未来版本本地打包 |
| 超大文件阻塞渲染进程 | 使用 `requestIdleCallback` 分片渲染 + 加载遮罩 |
| 编码检测失败 | `utf8` → `latin1` 二级降级，日志警告 |
| 视觉还原偏差 | 以 GitHub 主题截图作为对照基准，逐元素比对 |

---

## 7. 阶段边界（Phase 1 不做）

- ❌ 编辑 / WYSIWYG
- ❌ 保存 / 导出
- ❌ 侧边栏目录树
- ❌ 文件系统监听（`fs.watch`）
- ❌ 深色主题切换
