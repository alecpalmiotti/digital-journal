/* ─────────────────────────────────────────────────────────────────────
   Digital Journal · ideas.js
   Renders the Ideas page from window.__IDEAS (loaded via ideas_data.js).
   localStorage overlay for file:// editing.
   ───────────────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  const LS_KEY = 'digital_journal_ideas';

  // ── DOM refs ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const listEl     = $('ideas-list');
  const emptyEl    = $('ideas-empty');
  const stampEl    = $('ideas-stamp');
  const countEl    = $('i-count');
  const countLabel = $('i-count-label');
  const toastEl    = $('toast');
  const searchEl   = $('i-search');
  const statusSel  = $('i-status');
  const tagSel     = $('i-tag');

  // ── Helpers ───────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');

  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  const debounce = (fn, ms = 200) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  // ── Markdown renderer (shared logic with journal.js) ──────────────
  function renderMarkdown(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // == SECTION HEADER ==
      if (/^==\s+.+\s+==$/.test(line.trim())) {
        const title = line.trim().replace(/^==\s+/, '').replace(/\s+==$/, '');
        blocks.push(`<div class="section-header">${inline(title)}</div>`);
        i++; continue;
      }
      // Table rows (| ... | ... |)
      if (/^\|.+\|$/.test(line.trim())) {
        const rows = [];
        while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
          rows.push(lines[i].trim());
          i++;
        }
        // Skip separator rows (|---|---|)
        const dataRows = rows.filter(r => !/^\|[\s-:|]+\|$/.test(r));
        if (dataRows.length > 0) {
          let table = '<table class="kv-table" style="margin:0.5em 0">';
          for (const row of dataRows) {
            const cells = row.split('|').filter(c => c.trim() !== '');
            table += '<tr>' + cells.map(c => `<td>${inline(c.trim())}</td>`).join('') + '</tr>';
          }
          table += '</table>';
          blocks.push(table);
        }
        continue;
      }
      // Bullet list
      if (/^\s*[-•]\s/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-•]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-•]\s+/, ''));
          i++;
        }
        blocks.push('<ul>' + items.map(it => `<li>${inline(it)}</li>`).join('') + '</ul>');
        continue;
      }
      // Blank line
      if (line.trim() === '') { i++; continue; }
      // Paragraph
      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^==\s+.+\s+==$/.test(lines[i].trim()) && !/^\s*[-•]\s/.test(lines[i]) && !/^\|.+\|$/.test(lines[i].trim())) {
        para.push(lines[i]);
        i++;
      }
      blocks.push(`<p>${inline(para.join('<br>'))}</p>`);
    }
    return blocks.join('');
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  // ── Data loading ──────────────────────────────────────────────────
  let data = null;
  let allIdeas = [];
  let filtered = [];
  const filters = { search: '', status: '', tag: '' };

  function loadIdeas() {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      try { data = JSON.parse(cached); } catch { data = null; }
    }
    if (!data && window.__IDEAS) {
      data = JSON.parse(JSON.stringify(window.__IDEAS));
    }
    if (!data) {
      data = { last_modified: new Date().toISOString(), ideas: [] };
    }
    // Merge localStorage + file
    if (cached && window.__IDEAS) {
      const fileIdeas = window.__IDEAS.ideas || [];
      const lsIds = new Set((data.ideas || []).map(e => e.id));
      for (const fi of fileIdeas) {
        if (!lsIds.has(fi.id)) data.ideas.push(fi);
      }
    }
    save();

    allIdeas = [...(data.ideas || [])];
    // Sort newest first
    allIdeas.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (stampEl) stampEl.textContent = `${allIdeas.length} ideas · last modified ${data.last_modified || '—'}`;
    populateFilters();
    applyFilters();
  }

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
  }

  // ── Filters ───────────────────────────────────────────────────────
  function populateFilters() {
    const tags = new Set();
    for (const idea of allIdeas) {
      for (const t of (idea.tags || [])) tags.add(t);
    }
    for (const t of [...tags].sort()) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      tagSel.appendChild(opt);
    }
  }

  function passes(idea) {
    if (filters.status && idea.status !== filters.status) return false;
    if (filters.tag && !(idea.tags || []).includes(filters.tag)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [idea.title, idea.content, idea.source, ...(idea.tags || [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function applyFilters() {
    filtered = allIdeas.filter(passes);
    countEl.textContent = filtered.length;
    countLabel.textContent = filtered.length === 1 ? 'idea' : 'ideas';
    render();
  }

  // ── Render ────────────────────────────────────────────────────────
  function render() {
    listEl.innerHTML = '';
    if (filtered.length === 0) { emptyEl.style.display = ''; return; }
    emptyEl.style.display = 'none';

    for (const idea of filtered) {
      const li = document.createElement('li');
      li.className = 'idea-card';
      li.dataset.status = idea.status || 'idea';
      li.innerHTML = renderCard(idea);
      listEl.appendChild(li);
    }
    wireActions();
  }

  function renderCard(idea) {
    const status = idea.status || 'idea';
    let html = `
      <div class="idea-header">
        <span class="status-chip ${esc(status)}">${esc(status)}</span>
        <span class="date-chip">${esc(idea.date)}</span>
        <span class="source-chip">${esc(idea.source || '')}</span>
      </div>
      <div class="idea-body">
        <div class="idea-title">${esc(idea.title)}</div>
        <div class="idea-content" data-idea-id="${esc(idea.id)}" title="Click to edit">
          ${renderMarkdown(esc(idea.content))}
        </div>
      </div>`;

    // Refs
    if (idea.refs && idea.refs.length) {
      html += `<div class="idea-refs">${idea.refs.map(r =>
        `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`
      ).join('')}</div>`;
    }

    // Tags
    if (idea.tags && idea.tags.length) {
      html += `<div class="idea-tags">${idea.tags.map(t => `<span class="t">${esc(t)}</span>`).join('')}</div>`;
    }

    // Next step
    if (idea.next_step) {
      html += `<div class="idea-next"><strong>Next step:</strong> ${inline(esc(idea.next_step))}</div>`;
    }

    // Footer
    html += `
      <div class="idea-footer">
        <button class="btn" data-action="copy-idea" data-idea-id="${esc(idea.id)}">Copy JSON</button>
        <button class="btn danger" data-action="delete-idea" data-idea-id="${esc(idea.id)}">Delete</button>
      </div>`;
    return html;
  }

  // ── Actions ───────────────────────────────────────────────────────
  function wireActions() {
    // Click content -> edit
    document.querySelectorAll('.idea-content').forEach(el => {
      el.addEventListener('click', () => enterEdit(el));
    });

    // Copy JSON
    document.querySelectorAll('[data-action="copy-idea"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idea = allIdeas.find(i => i.id === btn.dataset.ideaId);
        if (!idea) return;
        navigator.clipboard.writeText(JSON.stringify(idea, null, 2))
          .then(() => toast('Copied to clipboard'))
          .catch(() => toast('Copy failed'));
      });
    });

    // Delete
    document.querySelectorAll('[data-action="delete-idea"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ideaId;
        if (!confirm(`Delete idea ${id}?`)) return;
        data.ideas = data.ideas.filter(i => i.id !== id);
        data.last_modified = new Date().toISOString();
        save();
        allIdeas = allIdeas.filter(i => i.id !== id);
        applyFilters();
        toast(`Deleted ${id}. Export JSON to persist.`);
      });
    });
  }

  function enterEdit(el) {
    const id = el.dataset.ideaId;
    const idea = allIdeas.find(i => i.id === id);
    if (!idea || el.querySelector('.edit-area')) return;

    const original = idea.content || '';
    el.innerHTML = `
      <textarea class="edit-area">${esc(original)}</textarea>
      <div class="edit-actions">
        <button class="btn primary save-edit">Save</button>
        <button class="btn cancel-edit">Cancel</button>
      </div>`;

    const textarea = el.querySelector('.edit-area');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    el.querySelector('.cancel-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      el.innerHTML = renderMarkdown(esc(original));
    });

    el.querySelector('.save-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      const newText = textarea.value.trim();
      if (!newText) { toast('Content is empty'); return; }
      idea.content = newText;
      const dataIdea = data.ideas.find(i => i.id === id);
      if (dataIdea) dataIdea.content = newText;
      data.last_modified = new Date().toISOString();
      save();
      el.innerHTML = renderMarkdown(esc(newText));
      toast('Saved (in browser). Export JSON to persist.');
    });
  }

  // ── Export ────────────────────────────────────────────────────────
  $('btn-export-ideas').addEventListener('click', () => {
    if (!data) { toast('No data'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ideas.json'; a.click();
    URL.revokeObjectURL(url);
    toast('JSON downloaded — replace ideas.json and regenerate ideas_data.js');
  });

  // ── Wire filters ──────────────────────────────────────────────────
  searchEl.addEventListener('input', debounce(() => { filters.search = searchEl.value.trim(); applyFilters(); }, 150));
  statusSel.addEventListener('change', () => { filters.status = statusSel.value; applyFilters(); });
  tagSel.addEventListener('change', () => { filters.tag = tagSel.value; applyFilters(); });

  // ── Init ──────────────────────────────────────────────────────────
  loadIdeas();

})();
