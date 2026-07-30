# 应用图标

设计源文件：`icon.svg` — 折角文档 + `#` 符号，品牌蓝色 (#0969da)。

替换默认 Electron 图标，需要准备以下格式的图标文件：

| 平台 | 文件名 | 格式 | 要求 |
|------|--------|------|------|
| Windows | `icon.ico` | `.ico` | 至少 256x256，建议包含 16/32/48/256 多尺寸 |
| macOS | `icon.icns` | `.icns` | 至少 512x512，建议包含 1024x1024 |
| Linux | `icon.png` | `.png` | 至少 256x256 |

## 生成工具推荐

- **SVG → 多尺寸**: 使用 [icon-gen](https://github.com/akabekobeko/npm-icon-gen) (CLI) 或 [electron-icon-builder](https://github.com/safu9/electron-icon-builder)
- **在线工具**: [EasyAppIcon](https://easyappicon.com/)、[IConverter](https://iconverter.com/)
- **macOS**: `iconutil` 命令可将 `.iconset` 文件夹转为 `.icns`

## package.json 配置参考

放置图标后，在 `package.json` 的 `"build"` 字段中添加：

```jsonc
"win": {
  "icon": "assets/icon.ico",
  // ...
},
"mac": {
  "icon": "assets/icon.icns",
  // ...
},
"linux": {
  "icon": "assets/icon.png",
  // ...
}
```
