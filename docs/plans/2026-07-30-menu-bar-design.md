# 菜单栏设计文档

**日期**: 2026-07-30
**项目**: MarkdownReader (Phase 1)

## 设计目标

替换 Electron 默认菜单，为 MarkdownReader 创建符合阅读器定位的精简菜单栏。

## 菜单结构

### File 菜单
| 菜单项 | 快捷键 | 行为 |
|--------|--------|------|
| 打开文件 | Cmd/Ctrl+O | 调用 `dialog.showOpenDialog`，过滤 `.md/.markdown` |
| 退出 | Cmd/Ctrl+Q | `app.quit()` |

### View 菜单
| 菜单项 | 快捷键 | 行为 |
|--------|--------|------|
| 放大 | Cmd/Ctrl+= | `webContents.zoomLevel + 0.5` |
| 缩小 | Cmd/Ctrl+- | `webContents.zoomLevel - 0.5` |
| 重置缩放 | Cmd/Ctrl+0 | `webContents.zoomLevel = 0` |
| 分隔线 | — | — |
| 切换深色模式 | — | 通过 IPC 向渲染进程发送 `toggle-dark-mode` |
| 切换浅色模式 | — | 通过 IPC 向渲染进程发送 `toggle-light-mode` |
| 分隔线 | — | — |
| 重新加载 | Cmd/Ctrl+R | `webContents.reload()` |
| 开发者工具 | Cmd/Ctrl+Shift+I | `webContents.toggleDevTools()` |

### Help 菜单
| 菜单项 | 行为 |
|--------|------|
| 关于 MarkdownReader | 弹出 `dialog.showMessageBox` 显示版本信息 |

## 技术实现

### 主进程 (main.js)
- 使用 `Menu.buildFromTemplate()` 构建菜单
- 在 `app.whenReady()` 中调用 `Menu.setApplicationMenu()`
- View 菜单通过 `win.webContents` 控制缩放/刷新/DevTools
- View 菜单通过 `win.webContents.send()` 向渲染进程发送深色模式切换事件

### 预加载脚本 (preload.js)
- 新增 `onToggleDarkMode` API，暴露给渲染进程监听

### 渲染进程 (renderer.js)
- 监听 `electronAPI.onToggleDarkMode()` 回调
- 切换 `document.body` 的 CSS class `dark-mode`

### 样式 (custom.css)
- 新增 `body.dark-mode` 下的深色主题变量
