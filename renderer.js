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

const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
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
  setHighlightTheme('dark');
}

window.electronAPI.onSetTheme((theme) => {
  document.body.classList.toggle('dark-mode', theme === 'dark');
  document.body.classList.toggle('light-mode', theme === 'light');
  setHighlightTheme(theme);
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
