const $ = document.getElementById.bind(document);

let currentHtml = '';
let currentFilePath = null;
let rawMarkdown = '';          // 当前打开的源码全文（仅供搜索，内存持有）
let searchResults = [];        // [{ lineNo, lineText, hitCount }]
let searchTotalHits = 0;       // 匹配命中总数（非行数）
let searchBlocked = false;     // 结果因超 500 条截断
let searchActiveIndex = -1;    // 结果列表中当前选中下标
let searchRegex = null;        // 当前已编译的 RegExp
let searchDebounceId = null;
let sourceLineMap = [];        // 顶层 DOM 块索引 → 对应源码起始行号
let mermaidSeq = 0;            // mermaid 渲染块自增 id
let mermaidBlocks = [];        // [{ el, source, status }] 当前文档中的 mermaid 块
let mermaidRenderToken = 0;    // 渲染令牌：打开新文件时作废旧渲染任务
let mermaidObserver = null;    // 视口懒加载观察器
const mermaidRenderCache = new Map(); // 渲染缓存：theme+source → { id, svg }
const MERMAID_CACHE_MAX = 40;
let lightboxBlock = null;      // 灯箱当前对应的 mermaid 块
let lightboxScale = 1;         // 灯箱当前缩放倍率
let lightboxPanning = false;   // 灯箱拖拽平移状态
let lightboxPanStart = { x: 0, y: 0, sl: 0, st: 0 };
let lightboxPanMoved = false;  // 本次按下是否发生过拖拽（区分点击关闭）
let outlineItems = [];         // [{ level, title, el }]
let activeOutlineIndex = -1;   // 当前高亮条目下标
let outlineCollapsed = false;  // 折叠状态（localStorage 持久化）
const OUTLINE_STORAGE_KEY = 'md-reader.outline.collapsed';

const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
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
          return '<pre class="hljs"><code>' + hljs.highlight(str, { language: lang }).value + '</code></pre>';
        } catch (e) {}
      }
      try {
        return '<pre class="hljs"><code>' + hljs.highlightAuto(str).value + '</code></pre>';
      } catch (e) {}
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
  }
});

async function renderMarkdown(content, filePath) {
  rawMarkdown = content || '';
  clearSearchState();
  clearOutlineState();
  closeChartLightbox();
  buildLineMap(rawMarkdown);
  let html = md.render(content || '');
  html = html.replace(/<li>\[ \]\s*/g, '<li><input type="checkbox" disabled>');
  html = html.replace(/<li>\[x\]\s*/gi, '<li><input type="checkbox" disabled checked>');
  if (filePath && window.electronAPI.resolveImageSrcs) {
    html = await window.electronAPI.resolveImageSrcs(html, filePath);
  }
  currentHtml = html;
  currentFilePath = filePath || null;
  const contentEl = $('content');
  if (!content || !content.trim()) {
    contentEl.innerHTML = '<p style="color: #6a737d; text-align: center; margin-top: 80px;">文件内容为空</p>';
  } else {
    contentEl.innerHTML = html;
  }
  collectMermaidBlocks();
  buildOutline();
  window.electronAPI.setExportEnabled(Boolean(content && content.trim()));
  if (filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    document.title = parts[parts.length - 1] + ' - MD-Reader';
  }
}

let dragCounter = 0;

document.addEventListener('dragenter', function (e) {
  e.preventDefault();
  dragCounter++;
  document.body.classList.add('drag-over');
});

document.addEventListener('dragover', function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', function () {
  dragCounter--;
  if (dragCounter === 0) {
    document.body.classList.remove('drag-over');
  }
});

document.addEventListener('drop', async function (e) {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (!name.endsWith('.md') && !name.endsWith('.markdown')) {
    alert('不支持此文件类型');
    return;
  }
  try {
    const text = await file.text();
    renderMarkdown(text, file.name);
  } catch (err) {
    console.error('读取拖拽文件失败:', err);
  }
});

window.electronAPI.onFileOpened((data) => {
  renderMarkdown(data.content, data.filePath);
});

function setHighlightTheme(theme) {
  const old = document.getElementById('hljs-theme');
  const existing = old.getAttribute('data-theme');
  if (existing === theme) return;
  const link = document.createElement('link');
  link.id = 'hljs-theme';
  link.rel = 'stylesheet';
  link.setAttribute('data-theme', theme);
  link.href = theme === 'dark' ? 'lib/github-highlight-dark.min.css' : 'lib/github-highlight.min.css';
  link.onload = () => old.remove();
  old.parentNode.insertBefore(link, old.nextSibling);
}

if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.body.classList.add('dark-mode');
  setHighlightTheme('dark');
}

window.electronAPI.onSetTheme((theme) => {
  document.body.classList.toggle('dark-mode', theme === 'dark');
  document.body.classList.toggle('light-mode', theme === 'light');
  setHighlightTheme(theme);
  reRenderMermaidForTheme();
});

window.electronAPI.onExportPdfRequest(async () => {
  if (!currentHtml) {
    alert('请先打开 Markdown 文件');
    return;
  }
  const result = await window.electronAPI.exportPdf(currentHtml, currentFilePath || '');
  if (result.canceled) return;
  if (result.ok) {
    alert('导出成功：' + result.filePath);
  } else {
    alert('导出失败：' + (result.error || '未知错误'));
  }
});

// ============ 搜索功能（纯渲染进程内存操作，无新增 IPC） ============

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchExp(query, useRegex, caseSensitive) {
  const pattern = useRegex ? query : escapeRegExp(query);
  return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
}

function escapeHtmlForSearch(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function highlightLine(line, re) {
  re.lastIndex = 0;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(line)) && m[0]) {
    if (m.index > last) parts.push(escapeHtmlForSearch(line.slice(last, m.index)));
    parts.push('<mark>' + escapeHtmlForSearch(m[0]) + '</mark>');
    last = m.index + m[0].length;
  }
  parts.push(escapeHtmlForSearch(line.slice(last)));
  return parts.join('');
}

function renderResults(results, emptyMessage, regex, blocked) {
  const listEl = $('search-results');
  const hintEl = $('search-hint');
  const countEl = $('search-count');
  listEl.innerHTML = '';
  if (emptyMessage) {
    hintEl.textContent = emptyMessage;
    countEl.textContent = '';
    return;
  }
  hintEl.textContent = '';
  const frag = document.createDocumentFragment();
  results.forEach(function (r, idx) {
    const li = document.createElement('li');
    const noSpan = document.createElement('span');
    noSpan.className = 'line-no';
    noSpan.textContent = (r.lineNo + 1) + ' 行';
    const textSpan = document.createElement('span');
    textSpan.className = 'line-text';
    textSpan.innerHTML = highlightLine(r.lineText, regex);
    li.appendChild(noSpan);
    li.appendChild(textSpan);
    li.addEventListener('click', function () {
      searchActiveIndex = idx;
      highlightActiveResult(idx, true);
    });
    frag.appendChild(li);
  });
  listEl.appendChild(frag);
  countEl.textContent = '共 ' + searchTotalHits + ' 个匹配 / ' + searchResults.length + ' 行' + (blocked ? '（仅显示前 500 条）' : '');
}

function runSearch() {
  clearSearchHighlights();
  const inputEl = $('search-input');
  const query = inputEl.value;
  const useRegex = $('search-btn-regex').getAttribute('aria-pressed') === 'true';
  const caseSensitive = $('search-btn-case').getAttribute('aria-pressed') === 'true';
  if (!query) {
    searchResults = [];
    searchTotalHits = 0;
    searchActiveIndex = -1;
    searchBlocked = false;
    searchRegex = null;
    renderResults(null, '输入关键词开始搜索');
    return;
  }
  let re;
  try {
    re = buildSearchExp(query, useRegex, caseSensitive);
  } catch (e) {
    inputEl.classList.add('is-error');
    searchResults = [];
    searchTotalHits = 0;
    searchActiveIndex = -1;
    searchRegex = null;
    renderResults([], '正则表达式错误：' + e.message);
    return;
  }
  inputEl.classList.remove('is-error');
  const lines = rawMarkdown.split('\n');
  const results = [];
  let totalHits = 0;
  let blocked = false;
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    const m = lines[i].match(re);
    if (m) {
      totalHits += m.length;
      results.push({ lineNo: i, lineText: lines[i], hitCount: m.length });
      if (results.length >= 500) { blocked = true; break; }
    }
  }
  searchResults = results;
  searchTotalHits = totalHits;
  searchBlocked = blocked;
  searchRegex = re;
  searchActiveIndex = results.length ? 0 : -1;
  renderResults(results, results.length ? null : '未找到匹配项', re, blocked);
  if (searchActiveIndex >= 0) highlightActiveResult(searchActiveIndex, false);
  else updateStatusBar();
}

function updateStatusBar() {
  const countEl = $('search-count');
  if (!searchResults.length) return;
  countEl.textContent = '共 ' + searchTotalHits + ' 个匹配 / ' + searchResults.length + ' 行' + (searchBlocked ? '（仅显示前 500 条）' : '');
}

function clearSearchHighlights() {
  const listEl = $('search-results');
  if (listEl) {
    Array.prototype.forEach.call(listEl.querySelectorAll('li.search-active'), function (el) {
      el.classList.remove('search-active');
    });
  }
}

function clearContentFlash() {
  Array.prototype.forEach.call(document.querySelectorAll('.search-result-mark'), function (el) {
    el.classList.remove('search-result-mark');
  });
}

function flashHighlight(el) {
  el.classList.add('search-result-mark');
  setTimeout(function () {
    el.classList.remove('search-result-mark');
  }, 1200);
}

function highlightActiveResult(index, shouldJump) {
  const listEl = $('search-results');
  const items = listEl.querySelectorAll('li');
  clearSearchHighlights();
  if (items[index]) items[index].classList.add('search-active');
  const r = searchResults[index];
  if (r) {
    if (shouldJump !== false) jumpToLine(r.lineNo);
    updateStatusBar();
  }
}

function rerunSearchNow() {
  clearTimeout(searchDebounceId);
  runSearch();
}

function moveSelection(dir) {
  const n = searchResults.length;
  if (!n) return;
  searchActiveIndex = (searchActiveIndex + dir + n) % n;
  highlightActiveResult(searchActiveIndex, true);
}

function openSearchPanel() {
  $('search-panel').hidden = false;
  const inputEl = $('search-input');
  inputEl.focus();
  inputEl.select();
  if (!inputEl.value) {
    $('search-results').innerHTML = '';
    $('search-hint').textContent = rawMarkdown ? '输入关键词开始搜索' : '请先打开一个 Markdown 文件';
    $('search-count').textContent = '';
  }
}

function closeSearchPanel() {
  $('search-panel').hidden = true;
  clearSearchState();
}

function clearSearchState() {
  const inputEl = $('search-input');
  if (inputEl) inputEl.value = '';
  const btnCase = $('search-btn-case');
  const btnRegex = $('search-btn-regex');
  if (btnCase) { btnCase.setAttribute('aria-pressed', 'false'); btnCase.textContent = 'Aa'; }
  if (btnRegex) { btnRegex.setAttribute('aria-pressed', 'false'); btnRegex.textContent = '.*'; }
  if (inputEl) inputEl.classList.remove('is-error');
  const resEl = $('search-results');
  if (resEl) resEl.innerHTML = '';
  const hintEl = $('search-hint');
  if (hintEl) hintEl.textContent = '';
  const countEl = $('search-count');
  if (countEl) countEl.textContent = '';
  searchResults = [];
  searchTotalHits = 0;
  searchActiveIndex = -1;
  searchBlocked = false;
  searchRegex = null;
  clearSearchHighlights();
  clearContentFlash();
}

function initSearchPanel() {
  const panel = $('search-panel');
  const inputEl = $('search-input');
  const btnCase = $('search-btn-case');
  const btnRegex = $('search-btn-regex');

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (panel.hidden) openSearchPanel();
      else closeSearchPanel();
      return;
    }
    if (e.key === 'Escape' && !panel.hidden) closeSearchPanel();
  });

  inputEl.addEventListener('input', function () {
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(runSearch, 300);
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!searchResults.length) return;
      moveSelection(e.shiftKey ? -1 : 1);
    }
  });

  btnCase.addEventListener('click', function () {
    const on = btnCase.getAttribute('aria-pressed') !== 'true';
    btnCase.setAttribute('aria-pressed', String(on));
    btnCase.textContent = on ? 'A' : 'Aa';
    rerunSearchNow();
  });

  btnRegex.addEventListener('click', function () {
    const on = btnRegex.getAttribute('aria-pressed') !== 'true';
    btnRegex.setAttribute('aria-pressed', String(on));
    rerunSearchNow();
  });
}

function buildLineMap(content) {
  sourceLineMap = [];
  if (!content) return;
  const tokens = md.parse(content, {});
  const blockTokens = tokens.filter(function (t) {
    return t.map && t.map[0] >= 0 && t.level === 0;
  });
  blockTokens.forEach(function (t) {
    sourceLineMap.push(t.map[0]);
  });
}

function jumpToLine(lineNo) {
  const contentEl = $('content');
  const blocks = contentEl.querySelectorAll(':scope > *');
  if (!blocks.length) return;
  let target = blocks[blocks.length - 1];
  // 近似映射：在块索引 i 的起始行 = sourceLineMap[i]，找到最后一个起始行 <= lineNo 的块
  if (sourceLineMap.length) {
    for (let i = sourceLineMap.length - 1; i >= 0; i--) {
      if (sourceLineMap[i] <= lineNo) {
        target = blocks[Math.min(i, blocks.length - 1)];
        break;
      }
    }
  }
  clearContentFlash();
  flashHighlight(target);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

initSearchPanel();

// ============ 大纲侧边栏（纯渲染进程内存操作，无新增 IPC） ============

function clearOutlineState() {
  activeOutlineIndex = -1;
  outlineItems = [];
  document.body.classList.remove('outline-open');
}

function syncOutlineLayout() {
  const panelVisible = !outlineCollapsed;
  $('outline-panel').hidden = !panelVisible;
  $('outline-toggle-collapsed').hidden = panelVisible;
  document.body.classList.toggle('outline-open', panelVisible);
  $('search-panel').classList.toggle('outer-panel-shifted', panelVisible);
}

function buildOutline() {
  const contentEl = $('content');
  outlineItems = [];

  const headers = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (!headers.length) {
    activeOutlineIndex = -1;
    $('outline-body').innerHTML = '<p class="outline-empty">该文档暂未检测到标题</p>';
    syncOutlineLayout();
    return;
  }

  outlineItems = Array.prototype.map.call(headers, function (h) {
    const level = Number(h.tagName.charAt(1));
    const title = h.textContent.replace(/\s+/g, ' ').trim();
    return { level: level, title: title, el: h };
  });
  activeOutlineIndex = -1;

  renderOutlineList();
  focusOutlineItem(0, false);
  syncOutlineLayout();
}

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

function updateActiveOutlineFromScroll() {
  let bestIndex = -1;
  for (let i = 0; i < outlineItems.length; i++) {
    const rect = outlineItems[i].el.getBoundingClientRect();
    if (rect.top <= 60) { bestIndex = i; } else { break; }
  }
  if (bestIndex !== activeOutlineIndex && bestIndex >= 0) {
    focusOutlineItem(bestIndex, false);
  }
}

function bindOutlineScrollListener() {
  const target = document.scrollingElement || window;
  target.addEventListener('scroll', function () {
    if (outlineItems.length && !$('outline-panel').hidden) {
      window.requestAnimationFrame(updateActiveOutlineFromScroll);
    }
  }, { passive: true });
}

function collapseOutline() {
  outlineCollapsed = true;
  localStorage.setItem(OUTLINE_STORAGE_KEY, '1');
  syncOutlineLayout();
}

function expandOutline() {
  outlineCollapsed = false;
  localStorage.setItem(OUTLINE_STORAGE_KEY, '0');
  syncOutlineLayout();
}

function readOutlineStorage() {
  try {
    return localStorage.getItem(OUTLINE_STORAGE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function initOutlinePanel() {
  outlineCollapsed = readOutlineStorage();
  $('outline-collapse-btn').addEventListener('click', collapseOutline);
  $('outline-toggle-collapsed').addEventListener('click', expandOutline);
  bindOutlineScrollListener();
}
initOutlinePanel();

// ============ Mermaid 图表渲染（本地 lib/mermaid.min.js） ============

function collectMermaidBlocks() {
  mermaidBlocks = [];
  mermaidRenderToken++;
  const blocks = $('content').querySelectorAll('.mermaid-block');
  if (!blocks.length) return;
  if (typeof mermaid === 'undefined') {
    Array.prototype.forEach.call(blocks, function (el) {
      const srcEl = el.querySelector('.mermaid-source');
      const src = srcEl ? srcEl.textContent : '';
      el.querySelector('.mermaid-svg').innerHTML =
        '<div class="mermaid-error-box">' +
        '<div class="mermaid-error-title">Mermaid 渲染库未加载</div>' +
        '<pre class="mermaid-error-source">' + escapeHtmlForSearch(src) + '</pre>' +
        '</div>';
    });
    return;
  }
  Array.prototype.forEach.call(blocks, function (el) {
    const srcEl = el.querySelector('.mermaid-source');
    mermaidBlocks.push({
      el: el,
      source: srcEl ? srcEl.textContent : '',
      status: 'pending'
    });
  });
  observeMermaidBlocks();
}

function observeMermaidBlocks() {
  if (mermaidObserver) {
    mermaidObserver.disconnect();
    mermaidObserver = null;
  }
  if (typeof IntersectionObserver !== 'function') {
    scheduleMermaidRenders();
    return;
  }
  mermaidObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      mermaidObserver.unobserve(el);
      const b = findMermaidBlock(el);
      if (b && b.status === 'pending') renderOneMermaid(b);
    });
  }, { root: null, rootMargin: '1500px 0px 1500px 0px', threshold: 0 });
  mermaidBlocks.forEach(function (b) { mermaidObserver.observe(b.el); });
}

function findMermaidBlock(el) {
  for (let i = 0; i < mermaidBlocks.length; i++) {
    if (mermaidBlocks[i].el === el) return mermaidBlocks[i];
  }
  return null;
}

function scheduleMermaidRenders() {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(function () { renderMermaidAll(); }, { timeout: 1500 });
  } else {
    renderMermaidAll();
  }
}

async function renderMermaidAll() {
  const token = mermaidRenderToken;
  for (let i = 0; i < mermaidBlocks.length; i++) {
    if (token !== mermaidRenderToken) return;
    const b = mermaidBlocks[i];
    if (b.status !== 'pending') continue;
    await renderOneMermaid(b);
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
  }
}

function getMermaidTheme() {
  return document.body.classList.contains('dark-mode') ? 'dark' : 'default';
}

function cacheMermaid(key, entry) {
  if (mermaidRenderCache.has(key)) mermaidRenderCache.delete(key);
  mermaidRenderCache.set(key, entry);
  if (mermaidRenderCache.size > MERMAID_CACHE_MAX) {
    mermaidRenderCache.delete(mermaidRenderCache.keys().next().value);
  }
}

function buildMermaidErrorBox(b, err) {
  const message = (err && (err.str || err.message)) || String(err);
  const lineMatch = /on line\s+(\d+)/i.exec(message);
  const errLine = lineMatch ? parseInt(lineMatch[1], 10) : null;
  let html =
    '<div class="mermaid-error-box">' +
    '<div class="mermaid-error-head">' +
    '<span class="mermaid-error-title">Mermaid 渲染失败</span>' +
    '<button type="button" class="mermaid-tool-btn mermaid-error-copy" title="复制源码">复制源码</button>' +
    '</div>';
  if (errLine) html += '<div class="mermaid-error-loc">错误位于第 ' + errLine + ' 行</div>';
  html +=
    '<pre class="mermaid-error-msg">' + escapeHtmlForSearch(message) + '</pre>' +
    '<pre class="mermaid-error-source">' + buildSourceWithErrorLine(b.source, errLine) + '</pre>' +
    '</div>';
  return html;
}

function buildSourceWithErrorLine(source, errLine) {
  if (!errLine) return escapeHtmlForSearch(source);
  const lines = source.split('\n');
  const idx = errLine - 1;
  if (idx < 0 || idx >= lines.length) return escapeHtmlForSearch(source);
  return lines.map(function (ln, i) {
    const esc = escapeHtmlForSearch(ln);
    return i === idx ? '<span class="mermaid-error-line">' + esc + '</span>' : esc;
  }).join('\n');
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function renderOneMermaid(b) {
  if (b.status !== 'pending') return;
  const svgHost = b.el.querySelector('.mermaid-svg');
  if (!svgHost) return;
  const theme = getMermaidTheme();
  const cacheKey = theme + '\u0000' + b.source;
  const targetId = b.el.getAttribute('data-mermaid-id');
  let svg = null;
  const cached = mermaidRenderCache.get(cacheKey);
  if (cached) {
    svg = cached.id === targetId ? cached.svg : cached.svg.split(cached.id).join(targetId);
  } else {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme,
        securityLevel: 'strict',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
      });
      await mermaid.parse(b.source);
      const result = await mermaid.render(targetId, b.source);
      svg = result.svg;
      cacheMermaid(cacheKey, { id: targetId, svg: svg });
    } catch (err) {
      svgHost.classList.remove('mermaid-pending');
      svgHost.classList.add('mermaid-error');
      b.status = 'error';
      svgHost.innerHTML = buildMermaidErrorBox(b, err);
      const copyBtn = svgHost.querySelector('.mermaid-error-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          const old = copyBtn.textContent;
          copyTextToClipboard(b.source).then(function (ok) {
            copyBtn.textContent = ok ? '已复制' : '复制失败';
            setTimeout(function () { copyBtn.textContent = old; }, 1200);
          });
        });
      }
      return;
    }
  }
  svgHost.innerHTML = svg;
  svgHost.classList.remove('mermaid-pending');
  svgHost.classList.add('mermaid-rendered');
  b.status = 'rendered';
  attachMermaidToolbar(b);
}

function attachMermaidToolbar(b) {
  if (b.el.querySelector('.mermaid-toolbar')) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-toolbar';
  toolbar.innerHTML =
    '<button type="button" class="mermaid-tool-btn" data-action="zoom" title="点击放大查看">放大</button>' +
    '<button type="button" class="mermaid-tool-btn" data-action="svg" title="导出为 SVG">SVG</button>' +
    '<button type="button" class="mermaid-tool-btn" data-action="png" title="导出为 PNG">PNG</button>';
  b.el.appendChild(toolbar);
  toolbar.addEventListener('click', function (e) {
    const btn = e.target.closest('.mermaid-tool-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.getAttribute('data-action');
    if (action === 'zoom') openChartLightbox(b);
    else if (action === 'svg') exportChartFromBlock(b, 'svg');
    else if (action === 'png') exportChartFromBlock(b, 'png');
  });
  const svgHost = b.el.querySelector('.mermaid-svg');
  if (svgHost) {
    svgHost.addEventListener('click', function () {
      openChartLightbox(b);
    });
  }
}

async function reRenderMermaidForTheme() {
  if (typeof mermaid === 'undefined') return;
  const targets = mermaidBlocks.filter(function (b) { return b.status === 'rendered'; });
  if (!targets.length) return;
  targets.forEach(function (b) {
    b.status = 'pending';
    const svgHost = b.el.querySelector('.mermaid-svg');
    if (svgHost) {
      svgHost.innerHTML = '<span class="mermaid-placeholder">重新渲染…</span>';
      svgHost.classList.remove('mermaid-rendered', 'mermaid-error');
      svgHost.classList.add('mermaid-pending');
    }
    const toolbar = b.el.querySelector('.mermaid-toolbar');
    if (toolbar) toolbar.remove();
  });
  for (let i = 0; i < targets.length; i++) {
    await renderOneMermaid(targets[i]);
  }
  if (lightboxBlock && !$('chart-lightbox').hidden) {
    openChartLightbox(lightboxBlock);
  }
}

// ============ 图表缩放查看（灯箱） ============

function openChartLightbox(b) {
  const svgHost = b.el.querySelector('.mermaid-svg');
  const svgEl = svgHost ? svgHost.querySelector('svg') : null;
  if (!svgEl) return;
  lightboxBlock = b;
  const stage = $('chart-lightbox-stage');
  stage.innerHTML = '';
  const clone = svgEl.cloneNode(true);
  clone.removeAttribute('style');
  stage.appendChild(clone);
  $('chart-lightbox').hidden = false;
  document.body.classList.add('chart-lightbox-open');
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
  lightboxScale = 1;
  fitLightboxToScreen();
}

function getSvgNaturalSize(svgEl) {
  let w = 0;
  let h = 0;
  const wa = svgEl.getAttribute('width');
  const ha = svgEl.getAttribute('height');
  if (wa && !/%/.test(wa)) {
    const n = parseFloat(wa);
    if (isFinite(n) && n > 0) w = n;
  }
  if (ha && !/%/.test(ha)) {
    const n = parseFloat(ha);
    if (isFinite(n) && n > 0) h = n;
  }
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  if (!w && vb && vb.width > 0) w = vb.width;
  if (!h && vb && vb.height > 0) h = vb.height;
  return { w: w, h: h };
}

function fitLightboxToScreen() {
  const stage = $('chart-lightbox-stage');
  const svgEl = stage.querySelector('svg');
  if (!svgEl) return;
  const size = getSvgNaturalSize(svgEl);
  if (!size.w || !size.h) return;
  const pad = 48;
  const availW = Math.max(stage.clientWidth - pad, 100);
  const availH = Math.max(stage.clientHeight - pad, 100);
  const scale = Math.min(availW / size.w, availH / size.h);
  lightboxScale = Math.max(0.1, Math.min(1, Math.round(scale * 100) / 100));
  updateLightboxZoom();
}

function updateLightboxZoom() {
  const clone = $('chart-lightbox-stage').querySelector('svg');
  if (!clone) return;
  clone.style.transform = 'scale(' + lightboxScale + ')';
  clone.style.transformOrigin = 'top left';
  const level = $('chart-zoom-level');
  if (level) level.textContent = Math.round(lightboxScale * 100) + '%';
}

function closeChartLightbox() {
  $('chart-lightbox').hidden = true;
  $('chart-lightbox-stage').innerHTML = '';
  document.body.classList.remove('chart-lightbox-open');
  lightboxBlock = null;
  lightboxScale = 1;
  lightboxPanning = false;
  lightboxPanMoved = false;
}

// ============ 图表导出（SVG / PNG） ============

function exportChartFromBlock(b, format) {
  const svgHost = b.el.querySelector('.mermaid-svg');
  const svgEl = svgHost ? svgHost.querySelector('svg') : null;
  if (!svgEl) return;
  const baseName = (b.el.getAttribute('data-mermaid-id') || 'mermaid');
  exportSvgElement(svgEl, format, baseName);
}

async function exportSvgElement(svgEl, format, baseName) {
  try {
    let data;
    let defaultName;
    if (format === 'svg') {
      data = serializeSvg(svgEl);
      defaultName = baseName + '.svg';
    } else {
      data = await svgToPngDataUrl(svgEl, 2);
      defaultName = baseName + '.png';
    }
    const res = await window.electronAPI.exportChart({ format: format, data: data, defaultName: defaultName });
    if (!res || res.canceled) return;
    if (res.ok) {
      alert('导出成功：' + res.filePath);
    } else {
      alert('导出失败：' + (res.error || '未知错误'));
    }
  } catch (err) {
    alert('导出失败：' + (err.message || String(err)));
  }
}

function serializeSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.removeAttribute('style');
  const xml = new XMLSerializer().serializeToString(clone);
  if (/^<svg[^>]*xmlns=/.test(xml)) return xml;
  return xml.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function svgToPngDataUrl(svgEl, scale) {
  return new Promise(function (resolve, reject) {
    const clone = svgEl.cloneNode(true);
    clone.removeAttribute('style');
    const size = getSvgNaturalSize(clone);
    const width = size.w;
    const height = size.h;
    if (!width || !height) {
      reject(new Error('无法确定图表尺寸'));
      return;
    }
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = document.body.classList.contains('dark-mode') ? '#0d1117' : '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = function () {
      reject(new Error('SVG 转 PNG 失败'));
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  });
}

function initMermaidModule() {
  const lb = $('chart-lightbox');
  const stage = $('chart-lightbox-stage');
  if (!lb || !stage) return;

  $('chart-lightbox-close').addEventListener('click', closeChartLightbox);
  $('chart-zoom-in').addEventListener('click', function () {
    lightboxScale = Math.min(5, lightboxScale * 1.25);
    updateLightboxZoom();
  });
  $('chart-zoom-out').addEventListener('click', function () {
    lightboxScale = Math.max(0.05, lightboxScale / 1.25);
    updateLightboxZoom();
  });
  $('chart-zoom-reset').addEventListener('click', function () {
    lightboxScale = 1;
    updateLightboxZoom();
  });
  $('chart-export-svg').addEventListener('click', function () {
    if (lightboxBlock) exportChartFromBlock(lightboxBlock, 'svg');
  });
  $('chart-export-png').addEventListener('click', function () {
    if (lightboxBlock) exportChartFromBlock(lightboxBlock, 'png');
  });
  stage.addEventListener('wheel', function (e) {
    if (lb.hidden) return;
    e.preventDefault();
    lightboxScale = Math.min(5, Math.max(0.05, lightboxScale * (e.deltaY < 0 ? 1.1 : 0.9)));
    updateLightboxZoom();
  }, { passive: false });
  stage.addEventListener('pointerdown', function (e) {
    if (lb.hidden) return;
    lightboxPanning = true;
    lightboxPanMoved = false;
    lightboxPanStart = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('lightbox-panning');
  });
  stage.addEventListener('pointermove', function (e) {
    if (!lightboxPanning) return;
    const dx = e.clientX - lightboxPanStart.x;
    const dy = e.clientY - lightboxPanStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) lightboxPanMoved = true;
    stage.scrollLeft = lightboxPanStart.sl - dx;
    stage.scrollTop = lightboxPanStart.st - dy;
  });
  stage.addEventListener('pointerup', function (e) {
    if (!lightboxPanning) return;
    lightboxPanning = false;
    stage.classList.remove('lightbox-panning');
    try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
  });
  stage.addEventListener('pointercancel', function () {
    lightboxPanning = false;
    stage.classList.remove('lightbox-panning');
  });
  stage.addEventListener('dblclick', function () {
    if (lb.hidden) return;
    fitLightboxToScreen();
  });
  stage.addEventListener('click', function (e) {
    if (e.target === stage && !lightboxPanMoved) closeChartLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lb.hidden) closeChartLightbox();
  });
}
initMermaidModule();
