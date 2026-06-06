// app.js — client-side markdown renderer + navigation
// Expects: every markdown file is inlined as <script type="text/markdown" id="doc-XXX">
// Loaded at runtime from inline <script> tags, so this works from file://.

(function () {
  'use strict';

  // ----- Minimal markdown renderer (GFM-ish) -----
  // We implement just enough of GFM to render our own docs well.
  // No external deps — keeps the build artifact self-contained.

  const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');

  // Render inline elements: code, bold, italic, links, hard line breaks.
  // Operates on already-escaped HTML (so we don't re-escape).
  function renderInline(text) {
    // Inline code: `code` (must come first to protect content from other rules)
    text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    // Images: ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
      (_, alt, url, title) => {
        const t = title ? ` title="${title}"` : '';
        return `<img src="${url}" alt="${alt}"${t} loading="lazy" />`;
      });
    // Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const isExternal = /^https?:\/\//.test(url);
      const target = isExternal ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${url}"${target}>${label}</a>`;
    });
    // Bold: **text** or __text__
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_ (must not match the middle of ** or __)
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    return text;
  }

  // Convert one markdown line to the start of an HTML block. State-machine
  // for fenced code, lists, tables, blockquotes, headings, paragraphs, hr.
  function renderMarkdown(md) {
    const lines = md.split('\n');
    const out = [];
    let i = 0;
    let inCode = false;
    let codeLang = '';
    let codeBuf = [];
    let listStack = []; // stack of {tag, indent}
    let paraBuf = [];
    let inTable = false;
    let tableHeader = [];
    let tableRows = [];
    let inBlockquote = false;
    let blockquoteBuf = [];

    const flushPara = () => {
      if (paraBuf.length) {
        out.push(`<p>${renderInline(paraBuf.join(' '))}</p>`);
        paraBuf = [];
      }
    };
    const closeLists = (toIndent = -1) => {
      while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
        out.push(`</${listStack.pop().tag}>`);
      }
    };
    const flushTable = () => {
      if (!inTable) return;
      const alignRow = (cells) => cells.map((c) => {
        const m = /^\s*:?-+:?\s*$/.exec(c);
        if (!m) return null;
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
      });
      // We re-parse by collecting header + body; the previous block already
      // gave us the rows. Convert now.
      const aligns = tableHeader._aligns || [];
      const thead = `<thead><tr>${tableHeader.map((c, i) =>
        `<th style="text-align:${aligns[i] || 'left'}">${renderInline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${tableRows.map((row) =>
        `<tr>${row.map((c, i) =>
          `<td style="text-align:${aligns[i] || 'left'}">${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      inTable = false;
      tableHeader = [];
      tableRows = [];
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced code blocks
      if (/^```/.test(trimmed)) {
        if (inCode) {
          out.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
          inCode = false;
          codeBuf = [];
          codeLang = '';
        } else {
          flushPara(); closeLists(); flushTable();
          inCode = true;
          codeLang = trimmed.slice(3).trim();
        }
        i++;
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        i++;
        continue;
      }

      // Blank line: flush paragraph / close lists
      if (trimmed === '') {
        flushPara();
        closeLists();
        flushTable();
        inBlockquote = false;
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(trimmed)) {
        flushPara(); closeLists(); flushTable();
        out.push('<hr />');
        i++;
        continue;
      }

      // ATX heading
      const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
      if (h) {
        flushPara(); closeLists(); flushTable();
        const level = h[1].length;
        const text = h[2];
        // Auto-generate id from heading text (sluggified, GitHub-style)
        const id = text
          .toLowerCase()
          .replace(/[`*_~]/g, '')
          .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');
        out.push(`<h${level} id="${escapeHtml(id)}">${renderInline(text)}</h${level}>`);
        i++;
        continue;
      }

      // Blockquote
      if (/^>\s?/.test(trimmed)) {
        flushPara(); closeLists(); flushTable();
        blockquoteBuf.push(trimmed.replace(/^>\s?/, ''));
        inBlockquote = true;
        i++;
        // peek: if next line is not a blockquote, flush
        if (!lines[i] || !/^>\s?/.test(lines[i].trim())) {
          out.push(`<blockquote>${renderMarkdown(blockquoteBuf.join('\n'))}</blockquote>`);
          blockquoteBuf = [];
          inBlockquote = false;
        }
        continue;
      }

      // Tables: a row of | … | followed by a separator row
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
          /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        flushPara(); closeLists();
        if (!inTable) {
          // start table
          inTable = true;
          tableHeader = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
          const sep = lines[i + 1].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
          tableHeader._aligns = sep.map((c) => {
            const left = c.startsWith(':');
            const right = c.endsWith(':');
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return '';
          });
          i += 2;
          continue;
        }
      }
      if (inTable && /^\s*\|.*\|\s*$/.test(line)) {
        const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        tableRows.push(cells);
        i++;
        continue;
      } else if (inTable) {
        flushTable();
      }

      // Lists: ordered (1. ) or unordered (- * +)
      const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (listMatch) {
        flushPara();
        flushTable();
        const indent = listMatch[1].length;
        const marker = listMatch[2];
        const isOrdered = /\d+\./.test(marker);
        const tag = isOrdered ? 'ol' : 'ul';
        const content = listMatch[3];

        // If new indent level exceeds the top of the stack, open a nested list
        if (listStack.length === 0 || indent > listStack[listStack.length - 1].indent) {
          listStack.push({ tag, indent });
          out.push(`<${tag}>`);
        } else if (indent === listStack[listStack.length - 1].indent) {
          // same level: nothing
        } else {
          // closing deeper levels
          closeLists(indent - 1);
          listStack.push({ tag, indent });
          out.push(`<${tag}>`);
        }

        // task-list checkbox?
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(content);
        if (taskMatch) {
          const checked = taskMatch[1] !== ' ';
          out.push(`<li class="task-list-item"><input type="checkbox" disabled${checked ? ' checked' : ''}/> ${renderInline(taskMatch[2])}</li>`);
        } else {
          out.push(`<li>${renderInline(content)}</li>`);
        }
        i++;
        continue;
      } else if (listStack.length) {
        closeLists();
      }

      // Paragraph
      paraBuf.push(trimmed);
      i++;
    }

    // Trailing flushes
    flushPara();
    closeLists();
    flushTable();
    if (inCode) {
      out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    }
    if (inBlockquote && blockquoteBuf.length) {
      out.push(`<blockquote>${renderMarkdown(blockquoteBuf.join('\n'))}</blockquote>`);
    }
    return out.join('\n');
  }

  // ----- Index of available docs -----
  function buildIndex() {
    const docs = [];
    document.querySelectorAll('script[type="text/markdown"]').forEach((el) => {
      docs.push({
        id: el.id.replace(/^doc-/, ''),
        title: el.dataset.title || el.id,
        file: el.dataset.file || '',
      });
    });
    return docs;
  }

  function renderSidebar(docs, currentId) {
    const groups = [
      { label: 'Overview', ids: ['root', 'progress', 'prd', 'design', 'docs-index'] },
      { label: 'Reference', ids: ['architecture', 'database', 'api'] },
      { label: 'Features',  ids: ['ai-agent', 'frontend', 'rbac'] },
      { label: 'Operations',ids: ['operations', 'contributing'] },
    ];
    const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
    const html = groups.map((g) => {
      const items = g.ids.filter((id) => byId[id]).map((id) => {
        const active = id === currentId ? ' class="active"' : '';
        return `<li><a href="#${id}" data-doc="${id}"${active}>${escapeHtml(byId[id].title)}</a></li>`;
      }).join('');
      return `<div class="nav-group"><span class="nav-group-title">${escapeHtml(g.label)}</span><ul>${items}</ul></div>`;
    }).join('');
    return html + `<div class="nav-group"><span class="nav-group-title">Search</span><p style="font-size:12px;color:var(--text-soft);padding:0 8px;margin:6px 0 0;">Tip: <kbd>/</kbd> focuses the search box; matches across all docs.</p></div>`;
  }

  // ----- Render one doc -----
  function loadDoc(id) {
    const el = document.getElementById(`doc-${id}`);
    if (!el) {
      document.getElementById('doc').innerHTML = '<p class="error">Document not found.</p>';
      return;
    }
    const html = renderMarkdown(el.textContent);
    const fileNote = el.dataset.file ? `<p style="font-size:12px;color:var(--text-soft);margin-top:-8px;margin-bottom:18px;">Source: <code>${escapeHtml(el.dataset.file)}</code></p>` : '';
    document.getElementById('doc').innerHTML = fileNote + html;

    // Update sidebar active state
    document.querySelectorAll('.sidebar a[data-doc]').forEach((a) => {
      a.classList.toggle('active', a.dataset.doc === id);
    });

    // Update URL hash
    history.replaceState(null, '', `#${id}`);

    // Scroll to top of content
    document.querySelector('.content').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // ----- Search across all docs -----
  function buildSearchIndex() {
    const idx = [];
    document.querySelectorAll('script[type="text/markdown"]').forEach((el) => {
      const lines = el.textContent.split('\n');
      let currentHeading = '';
      lines.forEach((line, i) => {
        const h = /^#{1,3}\s+(.+?)\s*$/.exec(line);
        if (h) currentHeading = h[1];
        // Strip markdown noise
        const text = line.replace(/[`*_#>\[\]]/g, '').trim();
        if (text.length > 30) {
          idx.push({ id: el.id.replace(/^doc-/, ''), heading: currentHeading, text });
        }
      });
    });
    return idx;
  }

  function search(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const idx = window.__searchIdx;
    const matches = [];
    const seen = new Set();
    for (const item of idx) {
      if (item.text.toLowerCase().includes(q)) {
        const key = `${item.id}|${item.heading}|${item.text.slice(0, 60)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push(item);
        if (matches.length >= 25) break;
      }
    }
    return matches;
  }

  function renderSearchResults(matches, query) {
    if (!matches.length) return '<p style="color:var(--text-soft);font-size:13px;">No matches.</p>';
    const grouped = {};
    matches.forEach((m) => {
      (grouped[m.id] = grouped[m.id] || []).push(m);
    });
    const titleById = Object.fromEntries(
      Array.from(document.querySelectorAll('script[type="text/markdown"]')).map((el) => [
        el.id.replace(/^doc-/, ''), el.dataset.title || el.id,
      ])
    );
    let html = '';
    for (const [id, items] of Object.entries(grouped)) {
      html += `<div class="nav-group"><span class="nav-group-title">${escapeHtml(titleById[id] || id)}</span><ul>`;
      items.slice(0, 5).forEach((m) => {
        const snippet = m.text.length > 110 ? m.text.slice(0, 110) + '…' : m.text;
        const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
        const highlighted = snippet.replace(re, '<mark>$1</mark>');
        html += `<li><a href="#${id}" data-doc="${id}">${escapeHtml(m.heading)}</a><br><span style="font-size:12px;color:var(--text-soft);">${highlighted}</span></li>`;
      });
      html += `</ul></div>`;
    }
    return html;
  }

  // ----- Theme toggle -----
  function initTheme() {
    const saved = localStorage.getItem('crm-docs-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-toggle');
    btn.textContent = saved === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('crm-docs-theme', next);
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  // ----- Print / Export PDF button -----
  // Calls window.print() — the existing @media print CSS hides the topbar
  // and sidebar, so the user gets a clean printable view (or "Save as PDF"
  // via the browser's print dialog).
  function initPrintButton() {
    const btn = document.getElementById('print-btn');
    if (!btn) return;
    btn.addEventListener('click', () => window.print());
  }

  // ----- Boot -----
  function boot() {
    initTheme();
    initPrintButton();

    const docs = buildIndex();
    // Default landing: PRD (老闆版). The audience for this bundled file is
    // the boss / decision-maker first; technical readers can navigate to
    // the dev docs from the sidebar.
    const PREFERRED_LANDING = 'prd';
    const initialId = (location.hash || '').slice(1) || PREFERRED_LANDING;
    const valid = docs.find((d) => d.id === initialId) ? initialId : PREFERRED_LANDING;

    document.getElementById('nav').innerHTML = renderSidebar(docs, valid);
    loadDoc(valid);

    // Sidebar clicks
    document.getElementById('nav').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-doc]');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.doc;
      loadDoc(id);
      // Close mobile sidebar
      if (window.innerWidth < 800) {
        document.getElementById('sidebar').classList.add('collapsed');
      }
    });

    // Hash navigation
    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (id && docs.find((d) => d.id === id)) loadDoc(id);
    });

    // Build search index
    window.__searchIdx = buildSearchIndex();
    const searchInput = document.getElementById('search');
    const nav = document.getElementById('nav');

    function showAllDocs() {
      nav.innerHTML = renderSidebar(docs, valid);
    }

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value;
      if (q.length < 2) {
        showAllDocs();
        return;
      }
      const results = search(q);
      nav.innerHTML = renderSearchResults(results, q) +
        `<div style="padding:8px;border-top:1px solid var(--border);margin-top:8px;">
           <a href="#" id="search-clear" style="font-size:12px;color:var(--text-soft);">← Back to full index</a>
         </div>`;
      document.getElementById('search-clear').addEventListener('click', (ev) => {
        ev.preventDefault();
        searchInput.value = '';
        showAllDocs();
      });
    });

    // / and Escape shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.value = '';
        showAllDocs();
        searchInput.blur();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
