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
let lightboxBlock = null;      // 灯箱当前对应的 mermaid 块
let lightboxScale = 1;         // 灯箱当前缩放倍率
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
  scheduleMermaidRenders();
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

async function renderOneMermaid(b) {
  if (b.status !== 'pending') return;
  const svgHost = b.el.querySelector('.mermaid-svg');
  if (!svgHost) return;
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: getMermaidTheme(),
      securityLevel: 'strict',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    });
    await mermaid.parse(b.source);
    const result = await mermaid.render(b.el.getAttribute('data-mermaid-id'), b.source);
    svgHost.innerHTML = result.svg;
    svgHost.classList.remove('mermaid-pending');
    svgHost.classList.add('mermaid-rendered');
    b.status = 'rendered';
    attachMermaidToolbar(b);
  } catch (err) {
    svgHost.classList.remove('mermaid-pending');
    svgHost.classList.add('mermaid-error');
    b.status = 'error';
    const msg = (err && (err.str || err.message)) || String(err);
    svgHost.innerHTML =
      '<div class="mermaid-error-box">' +
      '<div class="mermaid-error-title">Mermaid 渲染失败</div>' +
      '<div class="mermaid-error-msg">' + escapeHtmlForSearch(msg) + '</div>' +
      '<pre class="mermaid-error-source">' + escapeHtmlForSearch(b.source) + '</pre>' +
      '</div>';
  }
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
  lightboxScale = 1;
  const stage = $('chart-lightbox-stage');
  stage.innerHTML = '';
  const clone = svgEl.cloneNode(true);
  clone.removeAttribute('style');
  stage.appendChild(clone);
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
  updateLightboxZoom();
  $('chart-lightbox').hidden = false;
  document.body.classList.add('chart-lightbox-open');
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
    let width = parseInt(clone.getAttribute('width'), 10) || 0;
    let height = parseInt(clone.getAttribute('height'), 10) || 0;
    if (!width || !height) {
      const vb = clone.getAttribute('viewBox');
      if (vb) {
        const parts = vb.split(/[\s,]+/).map(Number);
        if (parts.length >= 4) { width = parts[2]; height = parts[3]; }
      }
    }
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
    lightboxScale = Math.min(5, lightboxScale + 0.1);
    updateLightboxZoom();
  });
  $('chart-zoom-out').addEventListener('click', function () {
    lightboxScale = Math.max(0.2, lightboxScale - 0.1);
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
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    lightboxScale = Math.min(5, Math.max(0.2, lightboxScale + delta));
    updateLightboxZoom();
  }, { passive: false });
  stage.addEventListener('click', function (e) {
    if (e.target === stage) closeChartLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lb.hidden) closeChartLightbox();
  });
}
initMermaidModule();
