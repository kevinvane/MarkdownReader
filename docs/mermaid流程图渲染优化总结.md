# Mermaid 流程图渲染：实现与优化总结

> 对应需求：`docs/TODO需求.md` 模块二「Mermaid 流程图渲染」
> 依赖：`lib/mermaid.min.js`（mermaid 11.17.0，本地化 UMD 构建，无 eval / 无 Worker / 符合 CSP）

## 一、功能目标

识别 Markdown 中的 ````mermaid` 代码块，渲染为可交互 SVG 图表，支持缩放查看与导出。

用户故事全部满足：

- ````mermaid` 代码块自动渲染为图表
- 深色 / 浅色主题下均有合适配色（theme: `dark` / `default`）
- 渲染错误时展示友好的错误提示
- 图表支持缩放查看（点击放大）
- 图表可导出为 SVG 或 PNG 图片
- 图表渲染不影响页面滚动性能

## 二、架构与实现

- **渲染管线**：`renderer.js` 中 markdown-it 的 `highlight` 函数拦截 `lang === 'mermaid'`，输出占位结构：

  ```html
  <pre class="mermaid-block" data-mermaid-id="mdm-N">
    <div class="mermaid-svg mermaid-pending"><span class="mermaid-placeholder">渲染中…</span></div>
    <div class="mermaid-source" hidden>转义后的源码</div>
  </pre>
  ```

  源码以 `textContent` 方式安全存储于隐藏节点，渲染完成后 SVG 注入 `.mermaid-svg`。

- **安全**：`securityLevel: 'strict'`（内置 DOMPurify 消毒）、`html: false`、CSP 维持 `'self'` + `style 'unsafe-inline'`、源码经 `md.utils.escapeHtml` 转义。

- **导出 IPC**（新增通道 `export-chart`）：渲染进程生成 SVG 文本或 PNG dataURL，主进程弹出保存对话框后写盘。

- **PDF 导出联动**：`print.html` 加载 mermaid，导出 PDF 时在隐藏窗口内执行 `RENDER_MERMAID_SCRIPT` 渲染全部图表后再 `printToPDF`。

## 三、优化项（本轮改动）

### 1. 视口懒加载

- 由「一次性 idle 渲染全部」改为 `IntersectionObserver`（`rootMargin: 1500px`）按需渲染，视口外的图表保持 `pending`，滚动临近时才计算。
- `IntersectionObserver` 不可用时回退到 `requestIdleCallback` 分块渲染。
- 打开新文件时通过 `mermaidRenderToken` 令牌作废旧渲染任务并断开旧观察器。

### 2. 灯箱增强

- **初始自适应**：打开灯箱时按窗口可用尺寸自动计算初始缩放（`fitLightboxToScreen`，不放大，最多 100%）。
- **拖拽平移**：Pointer Events + `setPointerCapture`，通过滚动位移实现平移；区分「点击关闭」与「拖拽不关闭」。
- **双击复位**：双击图表区域重新自适应。
- **缩放交互**：按钮改为 1.25× / 0.9× 比例缩放，滚轮 1.1× / 0.9×，范围 5% ~ 500%。
- **修复尺寸误判**：mermaid SVG 的 `width` 属性为 `100%`，新增 `getSvgNaturalSize`（数值属性优先、`viewBox` 兜底）统一解析自然尺寸，同时修复了 PNG 导出的宽高比失真（原来 PNG 宽度被错误解析为 100px）。

### 3. 渲染缓存

- 以 `theme + source` 为键的 `Map` 缓存渲染结果（上限 40 条，FIFO 淘汰）。
- 命中时直接复用 SVG，跳过 `initialize / parse / render`；复用给不同块时通过 id 字符串替换（`svg.split(fromId).join(toId)`）保证样式选择器与元素 id 正确。
- 主题来回切换零重复计算。

### 4. 错误提示细化

- 错误框新增：标题栏 +「复制源码」按钮（`navigator.clipboard` 优先，`execCommand` 兜底，成功后按钮短暂显示「已复制」）。
- 从错误信息解析「错误位于第 N 行」提示，并在源码 `<pre>` 中红色高亮出错行（行号超出源文件时安全降级、不标红）。
- 错误消息独立 `<pre>` 展示（保留 mermaid 自带的脱字符 `^` 定位）。

## 四、验证

无测试框架，采用 Electron 无头 smoke 测试（临时隐藏窗口 + stub preload）：

| 场景 | 结果 |
|------|------|
| 合法图表渲染为 SVG、普通代码块不受影响 | ✓ |
| 非法语法显示错误框 + 行号 + 源码，不崩溃 | ✓ |
| 视口外图表保持 pending，滚动后自动渲染 | ✓ |
| 相同源码+主题命中缓存，主题来回切换正常 | ✓ |
| 灯箱打开自适应缩放、缩放按钮、拖拽平移、双击复位 | ✓ |
| PNG 导出尺寸 = viewBox × 2（784×140），宽高比正确 | ✓ |
| PDF 打印路径（print.html + 隐藏窗口渲染） | ✓ |

`node --check` 全部通过。

## 五、变更文件

- `renderer.js` — 渲染管线、懒加载、缓存、灯箱、导出（本轮优化主改动）
- `custom.css` — 错误框样式细化、灯箱平移光标 / 选区禁用（本轮优化）
- `index.html` — 引入 `lib/mermaid.min.js`、灯箱骨架
- `main.js` — `export-chart` IPC、PDF 导出前的 mermaid 渲染脚本
- `preload.js` — 暴露 `exportChart`
- `print.html` — 加载 mermaid 以支持 PDF 导出
- `lib/mermaid.min.js` — 本地化依赖

## 六、已知限制

- 单图表渲染仍是主线程同步计算（mermaid 普通模式无 Worker）；懒加载缓解了多图表场景的突发阻塞，但超大单个图表仍可能短暂卡顿。
- 系统级 `prefers-color-scheme` 在运行中变化不自动跟随（与现有浅/深色切换一致，需通过菜单切换）。
- 复制源码在窗口失焦（自动化测试）时可能失败并提示「复制失败」，真实用户点击时正常。