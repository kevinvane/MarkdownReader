const $ = document.getElementById.bind(document);

let currentHtml = '';
let currentFilePath = null;

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

function renderMarkdown(content, filePath) {
  let html = md.render(content || '');
  html = html.replace(/<li>\[ \]\s*/g, '<li><input type="checkbox" disabled>');
  html = html.replace(/<li>\[x\]\s*/gi, '<li><input type="checkbox" disabled checked>');
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
