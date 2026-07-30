# 跨平台打包设计文档

**日期**: 2026-07-30
**项目**: MarkdownReader (Phase 1)

## 设计目标

为 MarkdownReader 提供跨平台打包能力，支持 Windows、macOS、Linux 三平台的分发和安装，输出便携版和安装包两种格式。

## 技术选型: electron-builder

选择 **electron-builder**，理由：

- 零侵入——仅需一个 devDependency + `package.json` 的 `"build"` 配置字段
- 支持全部输出格式：Windows NSIS 安装包 + 便携 `.exe`，macOS DMG + 可执行 `.app`，Linux AppImage + deb
- 与现有扁平项目结构完全兼容，无需改动源代码
- 支持 later 无缝扩展自动更新、代码签名等

## 输出产物

| 平台 | 安装包格式 | 便携格式 | 说明 |
|------|-----------|---------|------|
| Windows (x64) | NSIS 安装包 (`.exe`) | 便携版 (`.exe`) | NSIS 支持自定义安装路径、创建桌面快捷方式 |
| macOS (x64 + arm64) | DMG (`.dmg`) | 可执行 `.app` | 生成 universal 二进制 (Fat Binary) 支持 Intel + Apple Silicon |
| Linux (x64) | AppImage + deb | 解压即用目录 | AppImage 通用性最强，deb 适合 Debian/Ubuntu 系 |

## package.json 配置设计

在现有 `package.json` 中新增 `"build"` 字段：

```jsonc
{
  "name": "MarkdownReader",
  "version": "1.0.0",
  "description": "MarkdownReader  — 轻量级 Markdown 阅读器",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --dir",        // 仅打包目录（调试用）
    "dist": "electron-builder",              // 完整打包+安装包
    "dist:win": "electron-builder --win",
    "dist:mac": "electron-builder --mac",
    "dist:linux": "electron-builder --linux"
  },
  "build": {
    "appId": "com.MarkdownReader.app",
    "productName": "MarkdownReader",
    "directories": {
      "output": "release"
    },
    "files": [
      "main.js",
      "preload.js",
      "index.html",
      "renderer.js",
      "custom.css",
      "lib/**/*",
      "node_modules/**/*"
    ],
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ],
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "unicode": true
    },
    "mac": {
      "target": [
        { "target": "dmg", "arch": ["x64", "arm64"] },
        { "target": "zip", "arch": ["x64", "arm64"] }
      ],
      "icon": "assets/icon.icns",
      "category": "public.app-category.productivity"
    },
    "dmg": {
      "contents": [
        { "x": 130, "y": 220, "type": "file" },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
      ]
    },
    "linux": {
      "target": [
        { "target": "AppImage", "arch": ["x64"] },
        { "target": "deb", "arch": ["x64"] }
      ],
      "icon": "assets/icon.png",
      "category": "Office"
    }
  },
  "dependencies": {
    "electron": "^43.2.0"
  },
  "devDependencies": {
    "electron-builder": "^25.0.0"
  }
}
```

## 应用图标

需要为各平台准备对应格式的应用图标：

| 平台 | 格式 | 尺寸要求 |
|------|------|---------|
| Windows | `.ico` | 至少 256x256，建议包含 16/32/48/256 多尺寸 |
| macOS | `.icns` | 至少 512x512，建议包含 1024x1024 |
| Linux | `.png` | 至少 256x256 |

图标源文件建议使用 SVG 或 1024x1024 PNG，通过工具转换。

## 构建策略

### macOS Apple Silicon 支持

- macOS 目标配置 `arch: ["x64", "arm64"]`，electron-builder 会自动生成通用二进制
- 构建必须在 macOS 机器上执行（Windows/Linux 无法交叉编译 macOS .app/.dmg）

### Windows 构建

- 可在 Windows 或 macOS 上构建 Windows 目标（electron-builder 支持交叉编译 Windows 安装包）
- NSIS 安装包需系统安装 NSIS（electron-builder 自动处理）

### Linux 构建

- 可在 Linux 或 macOS 上构建 Linux 目标
- AppImage 需 `appimagetool`（electron-builder 自动处理）
- deb 需 `dpkg-deb`（Linux 环境）

### CI/CD 建议

推荐使用 GitHub Actions 矩阵构建：

```yaml
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx electron-builder --publish=never
```

## 安全注意事项

- `files` 配置已排除源码构建日志、`.git`、`docs/`、`assets/src/` 等非必需文件
- `node_modules` 中仅打包 Electron 运行时所需的原生模块
- 不会将开发依赖（`electron-builder` 自身）打包进产物
- 输出目录 `release/` 应加入 `.gitignore`

## 构建命令

```bash
# 本地测试打包
npm run pack

# 完整构建（当前平台）
npm run dist

# 指定平台构建
npm run dist:win
npm run dist:mac
npm run dist:linux
```

产物输出到 `release/` 目录。

## 后续扩展

- **自动更新**：electron-builder 内置 `electron-updater` 支持，未来可配合 GitHub Releases / S3 实现静默更新
- **代码签名**：Windows 使用 `certificateFile/certificatePassword` 或 `sign` 回调，macOS 使用 `CSC_LINK/CSC_KEY_PASSWORD` 环境变量
- **Portable 版本差异**：Windows 便携版可根据需要配置 `requestExecutionLevel` 避免 UAC 提示
