## 核心角色

Electron 开发者/安全架构师。

## 项目结构

扁平 Electron 应用，**无构建工具链**（无 Webpack/Rollup/TypeScript）。

```
main.js         # 主进程：窗口、菜单、IPC、文件 I/O
preload.js      # contextBridge 安全桥接
index.html      # 入口：CSP + lib/ 依赖 + UI 骨架
renderer.js     # markdown-it 渲染 + 拖拽 + IPC 回调
custom.css      # 浅色/深色双主题（body.light-mode / body.dark-mode）
lib/            # 所有第三方依赖已下载到本地（非 CDN）
docs/           # 产品文档和计划
```

## 唯一命令

```bash
npm start       # electron .
```

无测试、lint、typecheck、或 formatter 命令。无 CI。

## 关键架构事实

- **依赖策略**：`markdown-it`、`highlight.js`、`github-markdown-css` 均本地化为 `lib/*` 文件，通过 `<script src="lib/...">` 加载。文档中的 CDN 方案已过时。
- **安全问题**：`contextIsolation: true`、`nodeIntegration: false`、`html: false`（markdown-it）、CSP 在 `index.html` meta 中。
- **IPC 通道**（精确名称，别猜错）：
  - `open-file-dialog`（invoke/handle）— 打开文件对话框
  - `file-opened`（send/on）— 菜单 `File > 打开文件` 触发时主进程推送
  - `set-theme`（send/on）— 菜单 View > 切换深色/浅色模式，值 `'dark'` / `'light'`
- **深色模式**：`renderer.js` 通过 `setHighlightTheme(theme)` 切换高亮 CSS + `body.dark-mode` / `body.light-mode` class。系统 `prefers-color-scheme: dark` 启动时自动应用。
- **菜单**已实现：File（打开文件/退出）、View（缩放/主题切换/重新加载/DevTools）、Help（关于）。
- **拖拽**：仅 `.md` / `.markdown` 文件有效，通过浏览器原生 `file.text()` API 读取，不经过主进程。
- **UI 语言**：中文（zh-CN）。
- **文件读取**：先 `utf-8`，失败降级 `latin1`，不允许崩溃。

## Git

不要自动执行 Git 提交，等待指令。

## 文档参考

- [docs/AI 代理指令集.md](./docs/AI%20%E4%BB%A3%E7%90%86%E6%8C%87%E4%BB%A4%E9%9B%86.md) — 初始规格
- [docs/plans/](./docs/plans/) — 实施计划
