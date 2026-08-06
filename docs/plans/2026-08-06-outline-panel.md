# 大纲侧边栏实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 MD-Reader 增加右侧大纲面板：从当前打开文件自动提取 `h1~h6` 标题，平铺层级缩进展示，滚动时高亮当前项，点击平滑滚动跳转，面板可折叠且状态持久化。

**Architecture:** 纯渲染进程实现，**不新增任何 IPC**。在 `index.html` 中静态插入 `#outline-panel` DOM；`custom.css` 复用双主题 CSS 变量；`renderer.js` 在 `renderMarkdown` 渲染后调用 `buildOutline()` 提取 DOM 标题生成扁平 `outlineItems`，并挂载 `scroll`（`requestAnimationFrame` 节流）监听与点击处理。折叠状态用 `localStorage` 持久化。

**Tech Stack:** 原生 ES5/ES6 JavaScript、DOM `scrollIntoView({behavior:'smooth'})`、`localStorage`、markdown-it（已存在）、无新依赖。

---

## 任务总览

| # | 任务 | 文件 |
|---|------|------|
| 1 | `#outline-panel` DOM 骨架 | `index.html` |
| 2 | 面板样式 + 双主题 + 折叠动画 | `custom.css` |
| 3 | 大纲提取 `buildOutline` + 状态 | `renderer.js` |
| 4 | 点击跳转 + 滚动高亮跟随 | `renderer.js` |
| 5 | 折叠/展开 + localStorage 持久化 | `renderer.js` |
| 6 | 整体手动验证（对照 AC） | — |

**Git 约定：** 本仓库 AGENTS.md 规定不自动执行 Git 提交。每个任务末尾的 commit 步骤仅在用户明确指示时执行。本次同样遵循，仅在用户要求时提交。

**测试约定：** 项目无测试框架、无 lint/typecheck。采用**手动验证 + `node --check` 语法校验**代替 TDD。每任务末尾列出手动验证步骤。

---

### Task 1: `#outline-panel` DOM 骨架（`index.html`）

**Files:**
- Modify: `index.html`

**步骤 1: 在 `#content` 容器外新增大纲面板结构**

当前 `index.html` 结构：`<body>` 内先 `#content`，后 `#search-panel`，最后三个 script。

将 `#content` 与右侧面板包进一个横向 flex 容器，或用 `position: fixed` 独立定位。选择轻量方案：**保持 `#content` 不动**，`#outline-panel` 用 `position: fixed; right: 0; top: 0; bottom: 0; width: 220px` 覆盖在右侧，`#content` 通过 `#content` 样式预留右侧内边距（见 Task 2 的 `.outline-open #content` 规则）。

在 `#content` 与 `#search-panel` 之间插入：

```html
<aside id="outline-panel" class="outline-panel" hidden>
  <div class="outline-header">
    <span class="outline-title">📑 大纲</span>
    <button id="outline-collapse-btn" class="outline-collapse-btn" type="button" title="折叠大纲" aria-label="折叠大纲">×</button>
  </div>
  <div id="outline-body" class="outline-body">
    <p class="outline-empty">该文档暂未检测到标题</p>
  </div>
</aside>

<button id="outline-toggle-collapsed" class="outline-restore-btn" hidden>大纲</button>
```

> `#outline-toggle-collapsed` 是折叠后的右侧窄条恢复按钮；两个元素默认 `hidden`，由 JS 控制显示。

**步骤 2: `body` 加 `outline-open` 类切换**

当打开文件且有大纲时，`renderer.js` 会给 `document.body` 添加 `outline-open` class，用于 CSS 调整 `#content` 宽度避开右侧面板。

**步骤 3: 验证**

- `npm start`，DevTools 确认 `#outline-panel` 与 `#outline-toggle-collapsed` 存在、默认 `hidden`，不遮挡正文。

---

### Task 2: 面板样式 + 双主题 + 折叠（`custom.css`）

**Files:**
- Modify: `custom.css`

**步骤 1: 在 `custom.css` 末尾追加样式**

在现有 `.search-*` 样式之后新增。复用双主题 CSS 变量（`--color-*` 已在 `body.light-mode` / `.dark-mode` 定义，见 `custom.css`）。

```css
/* ============ 大纲侧边栏 ============ */
.outline-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 220px;
  z-index: 900;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border-default, #d0d7de);
  background-color: var(--color-canvas-default, #fff);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.08);
}
.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-muted, #d0d7de);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, #1F2328);
}
.outline-collapse-btn {
  border: none;
  background: none;
  font-size: 18px;
  line-height: 1;
  color: var(--color-fg-muted, #656d76);
  cursor: pointer;
  padding: 0 4px;
}
.outline-collapse-btn:hover { color: var(--color-danger-fg, #d1242f); }
#outline-body {
  flex: 1;
  overflow-y: auto;
  padding: 5px 0;
}
.outline-panel ul { list-style: none; margin: 0; padding: 0; }
.outline-panel li { padding: 4px 10px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.outline-panel li:hover { background-color: var(--color-canvas-subtle, #f6f8fa); }
.outline-panel li.outline-active {
  background-color: var(--color-accent-subtle, rgba(9, 105, 218, 0.1));
  color: var(--color-fg-default, #1F2328);
  font-weight: 600;
  outline: 1px solid var(--color-accent-emphasis, #0969da);
}
.outline-panel li .outline-icon { margin-right: 5px; color: var(--color-accent-fg, #0969da); }
.outline-panel li.level-1 .outline-icon { font-size: 16px; }
.outline-panel li.level-2 .outline-icon { font-size: 14px; margin-left: 14px; }
.outline-panel li.level-3 .outline-icon { font-size: 12px; margin-left: 30px; }
.outline-panel li.level-n .outline-icon { font-size: 11px; margin-left: 44px; }
.outline-empty {
  padding: 12px;
  color: var(--color-fg-muted, #656d76);
  font-size: 12px;
  text-align: center;
}
.outline-restore-btn {
  position: fixed;
  top: 8px;
  right: 0;
  z-index: 901;
  padding: 8px 10px;
  border: 1px solid var(--color-border-default, #d0d7de);
  border-right: none;
  border-radius: 8px 0 0 8px;
  background-color: var(--color-canvas-subtle, #f6f8fa);
  color: var(--color-fg-default, #1F2328);
  font-size: 12px;
  cursor: pointer;
}

body.outline-open #content { padding-right: 30px; }
body.outline-open .search-panel.outer-panel-shifted { right: 220px; }
```

> 说明：
> - `li.level-N` 段间距累计实现缩进：`level-1` 无缩进，`level-2` 加 `margin-left:14px`（图标自带，叠加内容继续左移），以此完成每级约 `16px` 缩进。文本本身在 `li` 内，图标 `margin-left` 足够形成层次。
> - `body.outline-open #content` 右移内边距，避免正文被面板遮住。
> - 折叠状态：面板 `hidden` 时显示 `#outline-toggle-collapsed` 窄条按钮。

**步骤 2: 验证**

- 浅色/深色各开一个含多级标题测试文件，检查面板背景、当前高亮、图标颜色均可读。

---

### Task 3: 大纲提取 `buildOutline` + 状态变量（`renderer.js`）

**Files:**
- Modify: `renderer.js`

**步骤 1: 新增状态变量**

在脚本顶部（`sourceLineMap` 声明附近）追加：

```js
let outlineItems = [];        // [{ level, text, headingElement }]
let activeOutlineIndex = -1;  // 当前高亮条目下标
let outlineCollapsed = false; // 折叠状态（localStorage 持久化）
const OUTLINE_STORAGE_KEY = 'md-reader.outline.collapsed';
```

**步骤 2: 新增 `buildOutline()` 函数**

在 `renderer.js` 末尾（大纲相关，放在搜索功能之后）新增：

```js
function buildOutline() {
  const body = $('outline-body');
  const contentEl = $('content');
  outlineItems = [];
  activeOutlineIndex = -1;
  body.innerHTML = '';

  const headers = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (!headers.length) {
    document.body.classList.remove('outline-open');
    $('outline-panel').hidden = true;
    showNoOutline();
    return;
  }

  outlineItems = Array.prototype.map.call(headers, function (h) {
    const level = Number(h.tagName.charAt(1));
    const title = h.textContent.replace(/\s+/g, ' ').trim();
    return { level: level, title: title, el: h };
  });

  document.body.classList.add('outline-open');
  if (outlineCollapsed) {
    $('outline-panel').hidden = true;
    $('outline-toggle-collapsed').hidden = false;
  } else {
    $('outline-panel').hidden = false;
    $('outline-toggle-collapsed').hidden = true;
  }
  renderOutlineList();
}
```

> 说明：`#outline-body` 原本放空状态 `<p>`. 无标题时保留空状态的提示；有标题时重建 `<ul>`。见 `renderOutlineList`。

**步骤 3: 新增 `renderOutlineList()` 渲染扁平列表**

```js
function renderOutlineList() {
  const bodyEl = $('outline-body');
  const ul = document.createElement('ul');
  const icons = { 1: '●', 2: '○', 3: '▪', n: '·' };
  outlineItems.forEach(function (item, idx) {
    const li = document.createElement('li');
    const levelClass = item.level <= 3 ? 'level-' + item.level : 'level-n';
    li.className = levelClass;
    const icon = document.createElement('span');
    icon.className = 'outline-icon';
    icon.textContent = item.level <= 3 ? icons[item.level] : icons.n;
    li.appendChild(icon);
    li.appendChild(document.createTextNode(item.title));
    li.addEventListener('click', function () {
      focusOutlineItem(idx, true);
    });
    ul.appendChild(li);
  });
  bodyEl.innerHTML = '';
  bodyEl.appendChild(ul);
}
```

**步骤 4: 在 `renderMarkdown` 渲染后调用 `buildOutline()`**

修改 `renderMarkdown`，在设置 `contentEl.innerHTML` 之后调用；同时保持重建大纲时序在渲染后、且尽早。

```js
  contentEl.innerHTML = html;
  buildOutline();   // 渲染完成后再提取标题
```
> 放在 `contentEl.innerHTML = html;` 之后；`buildOutline` 只在有内容时提取。空内容时 `headers.length === 0`，走空状态分支。

**步骤 5: `clearOutlineState()`**（供打开新文件/清空用）

在滚动/折叠任务之间加入临时清理逻辑：

```js
function clearOutlineState() {
  activeOutlineIndex = -1;
  outlineItems = [];
  document.body.classList.remove('outline-open');
}
```
并在 `renderMarkdown` 开头调用 `clearOutlineState();`（与搜索的 `clearSearchState()` 并列），确保新文件渲染前无残留。实际重建由 `buildOutline()` 完成。

**步骤 6: 验证**

- `node --check renderer.js` 通过。
- `npm start` 打开含 H1~H4 的文件，大纲按左右缩进展示，条目文本、图标正确。

---

### Task 4: 点击跳转 + 滚动高亮跟随（`renderer.js`）

**Files:**
- Modify: `renderer.js`

**步骤 1: `focusOutlineItem(index, shouldScroll)`**

```js
function focusOutlineItem(index, shouldScroll) {
  if (index < 0 || index >= outlineItems.length) return;
  activeOutlineIndex = index;
  const listEl = $('outline-body').querySelector('ul');
  const items = listEl ? listEl.querySelectorAll('li') : [];
  Array.prototype.forEach.call(items, function (el, i) {
    el.classList.toggle('outline-active', i === index);
  });
  if (shouldScroll !== false) {
    outlineItems[index].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
```

修改 `renderOutlineList` 的点击回调为：`focusOutlineItem(idx, true);`（见 Task 2 众已写）。同时，页面加载后可对首个标题默认高亮（打开文件后 `focusOutlineItem(0, false)`，可选）。

**步骤 2: 滚动高亮跟随（scrollspy）**

新增节流监听：

```js
function updateActiveOutlineFromScroll() {
  let bestIndex = -1;
  for (let i = 0; i < outlineItems.length; i++) {
    const rect = outlineItems[i].el.getBoundingClientRect();
    // 标题顶部是否已在视口之上（或内部偏上），选最靠上且已阅读到的标题
    if (rect.top <= 60) { bestIndex = i; } else { break; }
  }
  // bestIndex 停留最后一个"已越过顶部阈值 60px"的标题
  if (bestIndex !== activeOutlineIndex && bestIndex >= 0) {
    focusOutlineItem(bestIndex, false);
  }
}
```

修改 `#content` 的 `scroll` 事件即可（`#content` 是滚动容器）：

```js
const contentScrollEl = $('content');
contentScrollEl.addEventListener('scroll', function () {
  if (outlineItems.length) {
    requestAnimationFrame(updateActiveOutlineFromScroll);
  }
});
```

> 以 `#content` 为滚动容器（`renderer.js` 中 `#content` 当前无自定义 overflow，默认 body 滚动则 `document` 滚动）。计划按 `#content` 为滚动者实现；若实际滚动者为 `window`，则监听 `window` 的 `scroll`。实现时按 DevTools 实际滚动节点为准，以下代码为 `window` 版本更通用：

```js
function bindOutlineScrollListener() {
  const target = document.scrollingElement || window;
  target.addEventListener('scroll', function () {
    if (outlineItems.length) {
      requestAnimationFrame(updateActiveOutlineFromScroll);
    }
  }, { passive: true });
}
```

> 打开新文件时，`activeOutlineIndex` 重置；`scroll` 监听始终全局绑定一次（在 `initOutlinePanel` 中），避免重复绑定。

**步骤 3: 验证**

- 滚动正文，观察大纲高亮随当前阅读标题切换；点击条目正文滚动并高亮该项。

---

### Task 5: 折叠/展开 + localStorage 持久化（`renderer.js`）

**Files:**
- Modify: `renderer.js`

**步骤 1: 折叠/展开逻辑**

```js
function collapseOutline() {
  outlineCollapsed = true;
  localStorage.setItem(OUTLINE_STORAGE_KEY, '1');
  $('outline-panel').hidden = true;
  $('outline-toggle-collapsed').hidden = false;
}

function expandOutline() {
  outlineCollapsed = false;
  localStorage.setItem(OUTLINE_STORAGE_KEY, '0');
  $('outline-panel').hidden = false;
  $('outline-toggle-collapsed').hidden = true;
}
```

**步骤 2: 初始化（读取持久化 + 绑定事件）**

```js
function initOutlinePanel() {
  outlineCollapsed = localStorage.getItem(OUTLINE_STORAGE_KEY) === '1';
  $('outline-collapse-btn').addEventListener('click', collapseOutline);
  $('outline-toggle-collapsed').addEventListener('click', expandOutline);
  bindScrollListener();
  // 若打开的文件早就渲染，刷新初始状态
  if (outlineItems.length) {
    if (outlineCollapsed) { $('outline-panel').hidden = true; $('outline-toggle-collapsed').hidden = false; }
    else { $('outline-panel').hidden = false; $('outline-toggle-collapsed').hidden = true; }
    focusOutlineItem(0, false);
  }
}
```

> `initOutlinePanel()` 在脚本末尾调用一次（`renderer.js` 最底部）。`renderMarkdown` 每次调用 `buildOutline()`，其内部会在渲染后根据 `outlineCollapsed` 设置显隐。因此初始化只需读取状态；显隐交给 `buildOutline`。确保 `buildOutline` 中引用 `outlineCollapsed`（Task 3 已含）。

**步骤 3: 验证**

- 点击 `[×]` 折叠→右侧出现"展开大纲"窄条；点击恢复。重启应用后用 DevTools 或肉身观察大纲保持上次折叠状态。

---

### Task 6: 整体手动验证（对照 AC）

**Files:** 无（验证）

**步骤 1: 逐条执行需求文档第 7 节 AC 1~7**

准备含 H1~H4 多级标题（含表格、代码块、列表）的测试 `.md`，`npm start`：

1. **[提取]** — H1~H4 多级标题按层级缩进完整展示。
2. **[定位]** — 点击任一标题，内容区平滑滚动到该标题位置且大纲项高亮。
3. **[跟随]** — 滚动正文，大纲当前项随阅读位置自动切换高亮。
4. **[折叠]** — 点击 `[×]` 面板折叠不遮挡正文；再次展开大纲内容保留。
5. **[折叠记忆]** — 折叠状态重启后保持。
6. **[空状态]** — 打开无标题文档，显示"该文档暂未检测到标题"。
7. **[安全]** — 未新增 IPC、无 `fs` 访问；`contextIsolation` 边界不变。

**步骤 2: 回归**

确认与搜索功能冲突：`Ctrl+F` 面板仍在、搜索跳转不受影响；两侧面板不互相遮挡（搜索底部、大纲右侧）。

---

## 完成后交接

- 计划保存于 `docs/plans/YYYY-MM-DD-outline-panel.md`（实现后按实际日期命名）。
- 遵循仓库 AGENTS.md：**不自动 Git 提交**，等待用户指示。
- 执行选项：
  1. **Subagent-Driven（本会话）** — 每任务派发独立 subagent，任务间审查，快速迭代。
  2. **并行会话（单独）** — 新会话按 `superpowers:executing-plans` 批量执行带检查点。