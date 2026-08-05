# MarkdownReader 

轻量级桌面 Markdown 阅读器，基于 Electron 构建。采用 GitHub 主题渲染风格。

![](./assets/icon.ico)

## 快速开始

```bash
npm install
npm start
```

需要 Node.js 20+。

## 功能

- **三种打开方式**：菜单 `File > 打开文件`、快捷键 `Ctrl+O`、拖拽 `.md`/`.markdown` 文件
- **代码高亮**：基于 highlight.js，支持 190+ 语言
- **深色/浅色主题**：通过 `View` 菜单切换，跟随系统偏好自动应用
- **安全设计**：`contextIsolation: true`、`nodeIntegration: false`、CSP 策略、禁用 HTML 渲染
- **编码适应**：优先 UTF-8 读取，失败自动降级 latin1

## 项目结构

```
main.js         # 主进程
preload.js      # contextBridge 安全桥接
index.html      # 入口页面
renderer.js     # markdown-it 渲染逻辑
custom.css      # 双主题样式
lib/            # 本地化的第三方依赖
docs/           # 产品文档
```

无构建工具链，所有依赖已下载到 `lib/` 目录。

## 打包构建

```bash
npm run pack          # 打包到目录（仅解压，不生成安装包）
npm run dist          # 打包当前平台安装包
npm run dist:win      # 打包 Windows (NSIS 安装包 + 便携版)
npm run dist:mac      # 打包 macOS (DMG + ZIP，支持 x64/arm64)
npm run dist:linux    # 打包 Linux (AppImage + deb)
```

输出目录：`release/`

首次打包前需安装依赖：

```bash
npm install
```

## 技术栈

| 组件 | 选型 |
|------|------|
| 桌面框架 | Electron 43 |
| Markdown 解析 | markdown-it |
| 代码高亮 | highlight.js |
| 基础样式 | github-markdown-css |

## 许可

MIT
