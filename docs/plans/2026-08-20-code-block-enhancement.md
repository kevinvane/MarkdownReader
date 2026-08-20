# 模块一：代码块增强实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 MD-Reader 的 Markdown 预览代码块增加**语言标识标签、左侧行号（不可选中）、悬停复制按钮（带成功反馈）、长代码块（>30 行）默认折叠可展开**，提升代码阅读体验。

**Architecture:** 纯渲染进程实现，**不新增任何 IPC 通道、不新增任何依赖**。分两层：
1. **渲染层**：`renderer.js` 的 markdown-it `highlight` 回调保持整块高亮，仅追加 `data-lang` / `data-lines` 元数据属性（返回串必须以 `<pre` 开头才会被 markdown-it 原样使用，故外壳 DOM 不能在此处生成）。
2. **增强层**：`renderMarkdown` 设置 `contentEl.innerHTML` 后调用新函数 `enhanceCodeBlocks()`，对每个 `pre.hljs`（跳过 `.mermaid-block`）动态包一层 `.code-shell`：顶部悬停工具栏（语言标签 + 复制按钮）、左侧行号 gutter、底部折叠遮罩 + 展开按钮。行号用真实 `<div>` 文本承载并 `user-select: none`，复制时取 `code.textContent`（天然不含行号）。复制复用 Mermaid 模块已有的 `copyTextToClipboard()`。

**关键设计决策（解释）:**
- **为什么外壳用 JS 包 DOM 而非 highlight 直接生成？** markdown-it 的 fence 渲染规则：`highlight` 返回值只有以 `<pre` 开头时才整体替换代码块；返回 `<div>` 外壳会被塞进 `<pre><code>` 内层，结构损坏。因此外壳必须渲染后注入。
- **为什么整块高亮而非逐行高亮？** 保留跨行 token（块注释、模板字符串）的语义高亮，且复制文本 `code.textContent` 天然是纯源码，无需二次清洗。
- **为什么行号用独立 gutter 列而非 `code` 内 `::before`/内嵌 span？** 行号不混入 `<code>` 文本，`textContent` 复制即纯代码；独立列可 `user-select: none` + `aria-hidden`；长行横向滚动时行号固定不随代码滚走（GitHub 行为）。
- **语言标签显示时机：** 与复制按钮一起挂在 `.code-header`，默认隐藏、`.code-shell:hover` 才显示（满足"悬停才出现，不干扰阅读"）。折叠块的"展开"按钮是常显遮罩，保证不悬停也能展开。
- **PDF 导出不受影响：** `currentHtml` 在 `enhanceCodeBlocks()` 执行前已赋值（renderer.js:66），导出内容仍是无外壳的原始 `pre/code`。

**Tech Stack:** 原生 ES5/ES6 JavaScript、`code.textContent` 复制、CSS 双主题变量、`user-select`、现有 `copyTextToClipboard()`。无新依赖、无新 IPC。

---

## 任务总览

| # | 任务 | 文件 |
|---|------|------|
| 1 | highlight 回调输出 `data-lang` / `data-lines` 标记 | `renderer.js` |
| 2 | `enhanceCodeBlocks()` 外壳 + 复制 + 折叠交互 | `renderer.js` |
| 3 | 代码块增强样式（双主题） | `custom.css` |
| 4 | renderMarkdown 接线 + 整体手动验证（对照用户故事） | `renderer.js` |

**Git 约定：** 本仓库 AGENTS.md 规定不自动执行 Git 提交。每个任务末尾的 commit 步骤仅在用户明确指示时执行。本次同样遵循，仅在用户要求时提交。

**测试约定：** 项目无测试框架、无 lint/typecheck。采用**手动验证 + `node --check` 语法校验**代替 TDD。每任务末尾列出手动验证步骤。

---

### Task 1: highlight 回调输出 `data-lang` / `data-lines` 标记（`renderer.js`）

**Files:**
- Modify: `renderer.js`（`md` 实例的 `highlight` 回调，当前在 33~51 行）

**步骤 1: 追加一个行数统计辅助函数**

在 `md` 实例定义之后新增（保持 `highlight` 回调简洁）：

```js
function countCodeLines(str) {
  return str ? str.split('\n').length : 1;
}
```

**步骤 2: 改造三个分支，统一追加元数据属性**

现状三个返回分支分别是 `hljs.highlight`（有 lang）、`hljs.highlightAuto`（无 lang）、纯 escapeHtml 兜底。全部改为：

```js
highlight: function (str, lang) {
  if (lang && lang.toLowerCase() === 'mermaid') {
    return '<pre class="mermaid-block" data-mermaid-id="mdm-' + (++mermaidSeq) + '">' +
      '<div class="mermaid-svg mermaid-pending"><span class="mermaid-placeholder">渲染中…</span></div>' +
      '<div class="mermaid-source" hidden>' + md.utils.escapeHtml(str) + '</div>' +
      '</pre>';
  }
  if (typeof hljs !== 'undefined') {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs" data-lines="' + countCodeLines(str) + '" data-lang="' + md.utils.escapeHtml(lang) + '"><code>' +
          hljs.highlight(str, { language: lang }).value + '</code></pre>';
      } catch (e) {}
    }
    try {
      return '<pre class="hljs" data-lines="' + countCodeLines(str) + '"><code>' +
        hljs.highlightAuto(str).value + '</code></pre>';
    } catch (e) {}
  }
  return '<pre class="hljs" data-lines="' + countCodeLines(str) + '"><code>' +
    md.utils.escapeHtml(str) + '</code></pre>';
}
```

> 说明：
> - `lang` 来自用户输入的 fence info 首词，可能含 `"`，必须用 `md.utils.escapeHtml` 转义后再写入属性，防属性注入 XSS。
> - 返回串仍以 `<pre` 开头，markdown-it 原样输出，行为与现状一致。
> - 无语言时**不写** `data-lang`，Task 2 据此隐藏语言标签。

**步骤 3: 验证**

- `node --check renderer.js` 通过。
- `npm start` 打开含 ` ```js ` / 无语言 / 纯文本代码块的文件，DevTools 中确认三种 `pre.hljs` 均带 `data-lines`，有语言的带 `data-lang`，渲染样式与改动前无差异（此步尚未加外壳）。

---

### Task 2: `enhanceCodeBlocks()` 外壳 + 复制 + 折叠交互（`renderer.js`）

**Files:**
- Modify: `renderer.js`

**步骤 1: 新增常量与语言名映射**

在脚本顶部状态变量区（`OUTLINE_STORAGE_KEY` 之后）追加：

```js
const CODE_COLLAPSE_THRESHOLD = 30;  // 超过 30 行默认折叠
const CODE_LANG_NAMES = {
  js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python',
  rb: 'Ruby', ruby: 'Ruby',
  go: 'Go', rust: 'Rust',
  c: 'C', cpp: 'C++', 'c++': 'C++',
  cs: 'C#', 'c#': 'C#',
  java: 'Java', kotlin: 'Kotlin', swift: 'Swift', dart: 'Dart',
  php: 'PHP', sql: 'SQL',
  html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass',
  json: 'JSON', xml: 'XML', yaml: 'YAML', yml: 'YAML', toml: 'TOML', ini: 'INI',
  bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Zsh', powershell: 'PowerShell',
  md: 'Markdown', markdown: 'Markdown',
  dockerfile: 'Dockerfile', diff: 'Diff', makefile: 'Makefile', http: 'HTTP', graphql: 'GraphQL'
};
```

**步骤 2: 新增代码块增强函数族**

在 `renderer.js` 末尾（`initMermaidModule()` 调用之后）追加新分区，复用 Mermaid 模块已有的 `copyTextToClipboard()`（renderer.js:688，函数声明提升，可直接调用）：

```js
// ============ 代码块增强（语言标签 / 行号 / 复制 / 折叠） ============

function codeLangLabel(lang) {
  if (!lang) return '';
  return CODE_LANG_NAMES[lang.toLowerCase()] || lang;
}

function buildCodeGutter(lineCount) {
  const nums = [];
  for (let i = 1; i <= lineCount; i++) nums.push(String(i));
  return nums.join('\n');
}

function codeTextFromPre(pre) {
  const codeEl = pre.querySelector('code');
  return codeEl ? codeEl.textContent : '';
}

function enhanceCodeBlock(pre) {
  if (pre.getAttribute('data-enhanced') === '1') return;
  pre.setAttribute('data-enhanced', '1');

  const lineCount = parseInt(pre.getAttribute('data-lines') || '1', 10) || 1;
  const lang = pre.getAttribute('data-lang') || '';
  const collapsible = lineCount > CODE_COLLAPSE_THRESHOLD;

  // 1) 外壳
  const shell = document.createElement('div');
  shell.className = 'code-shell' + (collapsible ? ' code-collapsed' : '');

  // 2) 悬停工具栏：语言标签 + 复制按钮
  const header = document.createElement('div');
  header.className = 'code-header';
  const langSpan = document.createElement('span');
  langSpan.className = 'code-lang' + (lang ? '' : ' code-lang-empty');
  langSpan.textContent = codeLangLabel(lang);
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'code-copy-btn';
  copyBtn.textContent = '复制';
  copyBtn.title = '复制代码';
  copyBtn.addEventListener('click', function () {
    copyTextToClipboard(codeTextFromPre(pre)).then(function (ok) {
      const old = copyBtn.textContent;
      copyBtn.textContent = ok ? '已复制' : '复制失败';
      copyBtn.classList.add(ok ? 'code-copied' : 'code-copy-failed');
      setTimeout(function () {
        copyBtn.textContent = old;
        copyBtn.classList.remove('code-copied', 'code-copy-failed');
      }, 1200);
    });
  });
  header.appendChild(langSpan);
  header.appendChild(copyBtn);

  // 3) 滚动容器：行号 gutter + pre（pre 移入其中）
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'code-scroll';
  const gutter = document.createElement('div');
  gutter.className = 'code-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.textContent = buildCodeGutter(lineCount);
  pre.parentNode.insertBefore(scrollWrap, pre);
  scrollWrap.appendChild(gutter);
  scrollWrap.appendChild(pre);
  pre.classList.add('code-enhanced');

  // 4) 折叠遮罩 + 展开按钮
  const overlay = document.createElement('div');
  overlay.className = 'code-overlay';
  overlay.hidden = !collapsible;
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'code-expand-btn';
  expandBtn.textContent = '展开全部 ' + lineCount + ' 行';
  expandBtn.addEventListener('click', function () {
    shell.classList.remove('code-collapsed');
    overlay.hidden = true;
  });
  overlay.appendChild(expandBtn);

  shell.appendChild(header);
  shell.appendChild(scrollWrap);
  shell.appendChild(overlay);
  pre.parentNode.insertBefore(shell, pre);
  shell.appendChild(pre);
}

function enhanceCodeBlocks() {
  const preList = $('content').querySelectorAll('pre.hljs');
  Array.prototype.forEach.call(preList, function (pre) {
    if (pre.classList.contains('mermaid-block')) return;
    enhanceCodeBlock(pre);
  });
}
```

> 说明：
> - **DOM 顺序**：先 `insertBefore(scrollWrap, pre)` 把 pre 挂进 scrollWrap，最后 `insertBefore(shell, pre)` 再把 shell 提到最前并 `appendChild(pre)` 收尾；shell 内部顺序为 header → scrollWrap → overlay。
> - **复制内容**：`codeTextFromPre(pre)` 取 `code.textContent`，行号在 gutter 中不参与，复制出的即纯源码。
> - **反馈**：复制成功按钮文本变"已复制"并加 `.code-copied`（绿色），1.2s 后还原，与 Mermaid 错误复制按钮行为一致。
> - **`data-enhanced` 守卫**：每个块只增强一次；每次打开新文件 `innerHTML` 整体重建，DOM 不会残留旧监听。

**步骤 3: 验证**

- `node --check renderer.js` 通过。
- 打开含多代码块文件，DevTools 确认：有语言的块出现 `.code-shell`（内含 header/gutter/overlay），行号从 1 递增到 N，`<code>` 内仍为纯高亮代码、无行号混入。

---

### Task 3: 代码块增强样式（`custom.css`）

**Files:**
- Modify: `custom.css`（在文件末尾"Mermaid"分区之后追加）

**步骤 1: 追加样式**

复用双主题 CSS 变量（`--color-*`）。关键对齐：gutter 与 `pre` 使用**相同字族 / 字号 / 行高**（github-markdown-css 的 pre 为 `font-size:85%; line-height:1.45`，字族 `ui-monospace, SFMono-Regular, Consolas, monospace`），保证行号与代码逐行对齐。

```css
/* ============ 代码块增强 ============ */
.code-shell {
  position: relative;
  margin: 16px 0;
  border: 1px solid var(--color-border-muted, #d0d7de);
  border-radius: 6px;
  background-color: var(--color-canvas-subtle, #f6f8fa);
}
.code-shell:hover { border-color: var(--color-border-default, #d0d7de); }
.code-header {
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--color-border-muted, #d0d7de);
}
.code-shell:hover .code-header { display: flex; }
.code-lang {
  color: var(--color-fg-muted, #656d76);
  font-size: 12px;
  font-weight: 600;
}
.code-lang-empty { display: none; }
.code-copy-btn {
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid var(--color-border-default, #d0d7de);
  border-radius: 4px;
  background-color: var(--color-canvas-default, #fff);
  color: var(--color-fg-default, #1F2328);
  cursor: pointer;
  user-select: none;
}
.code-copy-btn:hover {
  border-color: var(--color-accent-emphasis, #0969da);
  color: var(--color-accent-fg, #0969da);
}
.code-copy-btn.code-copied { color: var(--color-success-fg, #1a7f37); }
.code-copy-btn.code-copy-failed { color: var(--color-danger-fg, #d1242f); }

.code-scroll {
  display: flex;
  overflow-x: auto;
}
.code-gutter {
  flex: 0 0 auto;
  min-width: 40px;
  padding: 16px 0 16px 16px;
  text-align: right;
  color: var(--color-fg-subtle, #6e7781);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 85%;
  line-height: 1.45;
  white-space: pre;
  user-select: none;
}
.code-scroll pre {
  flex: 1 1 auto;
  margin: 0;
  padding: 16px;
  overflow: visible;
  border-radius: 0;
  background: none;
}
.code-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 20px 0 10px;
  background: linear-gradient(to bottom, transparent, var(--color-canvas-subtle, #f6f8fa) 70%);
}
.code-overlay[hidden] { display: none; }
.code-shell.code-collapsed .code-scroll { max-height: 320px; overflow: hidden; }
.code-expand-btn {
  padding: 4px 14px;
  font-size: 12px;
  border: 1px solid var(--color-border-default, #d0d7de);
  border-radius: 20px;
  background-color: var(--color-canvas-default, #fff);
  color: var(--color-fg-default, #1F2328);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  user-select: none;
}
.code-expand-btn:hover {
  border-color: var(--color-accent-emphasis, #0969da);
  color: var(--color-accent-fg, #0969da);
}
```

> 说明：
> - `.code-shell` 背景用 `--color-canvas-subtle`（浅色 `#f6f8fa` / 深色 `#161b22`），与现主题 `pre` 背景一致；`.code-scroll pre` 覆盖 github-markdown-css 的 `pre { padding/overflow/background }`，避免双重内边距与滚动条。
> - 折叠态 `.code-scroll` 限高 320px + `overflow:hidden`，遮罩渐变淡出底部并常显"展开全部 N 行"按钮。
> - 行号 `user-select: none`（不可选中），gutter 整体 `aria-hidden`。
> - 深色主题的 `--color-success-fg` / `--color-fg-subtle` 已在 `body.dark-mode .markdown-body` 定义（custom.css:93~112）。

**步骤 2: 验证**

- 浅色 / 深色各开一个含多语言代码块、超长行、>30 行代码块的文件，确认：行号与代码逐行对齐、长行横向滚动时行号固定、悬停出现工具栏、折叠遮罩可见可读。

---

### Task 4: renderMarkdown 接线 + 整体手动验证（对照用户故事）

**Files:**
- Modify: `renderer.js`

**步骤 1: 在 renderMarkdown 中调用 enhanceCodeBlocks()**

在 `renderMarkdown` 的 `contentEl.innerHTML = html;` 赋值之后、`collectMermaidBlocks()` 之前插入一行（现状 renderer.js:72 之后）：

```js
  contentEl.innerHTML = html;
  enhanceCodeBlocks();
  collectMermaidBlocks();
  buildOutline();
```

> 顺序说明：先增强代码块，再收集 Mermaid（两者互斥，mermaid 块被 `enhanceCodeBlocks` 跳过），最后建大纲。`currentHtml` 已在第 66 行赋值，PDF 导出不受外壳影响。
> 不需要在 `initOutlinePanel` / 其它初始化处挂监听：`enhanceCodeBlocks` 每次渲染全量重建 DOM，无全局状态、无重复绑定。

**步骤 2: 逐条执行用户故事验收（模块一 §2.2 全部 6 条）**

准备含下列内容的测试 `.md`，`npm start`：

1. **[语言标签]** — ` ```js`/` ```python`/` ```c++` 代码块悬停时，顶部显示友好语言名（JavaScript / Python / C++）；` ```weirdlang` 显示原始名；无语言代码块顶部只显示复制按钮、无标签。
2. **[行号不可选中]** — 代码块左侧显示 1..N 行号；鼠标框选代码，行号不会被选中、复制粘贴结果**不包含行号**。
3. **[一键复制]** — 悬停点"复制"，粘贴到系统剪贴板得到与源码逐字符一致的完整内容（含空行、缩进、前后无多余换行）。
4. **[悬停才出现]** — 鼠标移开时代码块顶部无工具栏、不干扰阅读；悬停即现。
5. **[复制反馈]** — 点击"复制"按钮文字变"已复制"（绿色），约 1.2s 还原；复制失败变"复制失败"（红色）。
6. **[长块折叠]** — 31 行及以上代码块默认只显示前部 + 底部渐变遮罩 + "展开全部 N 行"按钮；≤30 行不折叠。点"展开全部 N 行"后完整展示、遮罩消失。

**步骤 3: 回归验证（既有功能不受影响）**

- **搜索**：`Ctrl+F` 打开搜索、点击结果跳转（`jumpToLine` 的顶层块映射 1:1 保留，代码块现在是单个 `.code-shell` 子元素）、高亮闪烁正常。
- **Mermaid**：` ```mermaid` 块仍正常懒加载渲染、悬停工具栏、放大灯箱、SVG/PNG 导出不受影响（被 `enhanceCodeBlocks` 跳过）。
- **大纲**：打开含标题文档，大纲提取 / 高亮跟随 / 折叠持久化正常。
- **PDF 导出**：File > 导出 PDF，代码块导出为无外壳的纯 `pre/code`，行号与复制按钮不进入 PDF。
- **主题切换**：View > 切换深/浅色，代码块外壳、行号、按钮、遮罩颜色跟随主题；复制按钮无残留状态。
- **安全边界**：未新增 IPC、无 `fs` 访问、`contextIsolation` / CSP 边界不变；无语言 label 隐藏、`data-lang` 经 `escapeHtml`，无属性注入风险。

---

## 完成后交接

- 计划保存于 `docs/plans/2026-08-20-code-block-enhancement.md`。
- 遵循仓库 AGENTS.md：**不自动 Git 提交**，等待用户指示。
- 执行选项：
  1. **Subagent-Driven（本会话）** — 每任务派发独立 subagent，任务间审查，快速迭代。
  2. **并行会话（单独）** — 新会话按 `superpowers:executing-plans` 批量执行带检查点。
