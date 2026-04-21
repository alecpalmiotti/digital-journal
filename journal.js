/* ─────────────────────────────────────────────────────────────────────
   Digital Journal · journal.js
   Pure-vanilla JS for the research journal timeline.
   Reads window.__JOURNAL_ENTRIES (loaded via journal_data.js <script>)
   with localStorage as live overlay for file:// compatibility.
   ───────────────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  const manifest = window.__MANIFEST;
  const LS_KEY = 'digital_journal_entries';

  // ── DOM refs ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const timeline     = $('timeline');
  const emptyState   = $('journal-empty');
  const stampEl      = $('journal-stamp');
  const countEl      = $('j-count');
  const countLabel   = $('j-count-label');
  const toastEl      = $('toast');
  const searchInput  = $('j-search');
  const projectSel   = $('j-project');
  const tagSel       = $('j-tag');
  const dateFromEl   = $('j-date-from');
  const dateToEl     = $('j-date-to');

  // ── Helpers ───────────────────────────────────────────────────────
  const escapeHtml = (s) => String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const esc = escapeHtml;

  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  async function copyToClipboard(text, what = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} to clipboard`);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(`${what} to clipboard`); }
      catch { toast('Copy failed — select manually'); }
      finally { document.body.removeChild(ta); }
    }
  }

  const fmtBytes = (n) => {
    if (n == null) return '—';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0, x = n;
    while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
    return `${x.toFixed(x < 10 && i ? 1 : 0)} ${units[i]}`;
  };

  const debounce = (fn, ms = 200) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  // ── Lightweight markdown → HTML ───────────────────────────────────
  function renderMarkdown(text) {
    if (!text) return '';
    // Split into lines for block-level processing
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // == SECTION HEADER ==
      if (/^==\s+.+\s+==$/.test(line.trim())) {
        const title = line.trim().replace(/^==\s+/, '').replace(/\s+==$/, '');
        blocks.push(`<div class="section-header">${inlineMarkdown(title)}</div>`);
        i++;
        continue;
      }
      // Bullet list: lines starting with "- "
      if (/^\s*[-•]\s/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-•]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-•]\s+/, ''));
          i++;
        }
        blocks.push('<ul>' + items.map(it => `<li>${inlineMarkdown(it)}</li>`).join('') + '</ul>');
        continue;
      }
      // Blank line
      if (line.trim() === '') { i++; continue; }
      // Regular paragraph — collect consecutive non-blank, non-special lines
      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^==\s+.+\s+==$/.test(lines[i].trim()) && !/^\s*[-•]\s/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      blocks.push(`<p>${inlineMarkdown(para.join('<br>'))}</p>`);
    }
    return blocks.join('');
  }

  function inlineMarkdown(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  // ── Extract title from commentary first line ─────────────────────
  function extractTitle(commentary) {
    if (!commentary) return '';
    const firstLine = commentary.split('\n')[0].trim();
    // Strip common prefixes like "SESSION REPORT:" or "FINDING:"
    return firstLine.replace(/^(SESSION REPORT|REPORT|FINDING|NOTE|UPDATE|LOG)\s*:\s*/i, '').trim() || firstLine;
  }

  // ── Font selector ───────────────────────────────────────────────────
  const FONT_KEY = 'digital_journal_font';
  const FONTS = {
    'garamond': { label: 'EB Garamond', family: "'EB Garamond', Georgia, serif" },
    'inter':    { label: 'Inter',       family: "'Inter', sans-serif" },
    'georgia':  { label: 'Georgia',     family: "Georgia, 'Times New Roman', serif" },
    'palatino': { label: 'Palatino',    family: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif" },
    'system':   { label: 'System',      family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    'mono':     { label: 'Monospace',   family: "'JetBrains Mono', 'Fira Code', monospace" },
  };

  function initFontSelector() {
    const sel = document.getElementById('j-font');
    if (!sel) return;
    const saved = localStorage.getItem(FONT_KEY) || 'garamond';
    sel.value = saved;
    applyFont(saved);
    sel.addEventListener('change', () => {
      localStorage.setItem(FONT_KEY, sel.value);
      applyFont(sel.value);
    });
  }

  function applyFont(key) {
    const f = FONTS[key] || FONTS.garamond;
    document.querySelectorAll('.entry-commentary, .entry-fig-title, .entry-text-only').forEach(el => {
      el.style.fontFamily = f.family;
    });
    // Store for future renders
    window.__journalFont = f.family;
  }

  // ── Manifest figure lookup ────────────────────────────────────────
  const figIndex = new Map();
  if (manifest?.projects) {
    for (const [, pdata] of Object.entries(manifest.projects)) {
      for (const [, rdata] of Object.entries(pdata.runs || {})) {
        for (const fig of (rdata.figures || [])) {
          figIndex.set(fig.id, fig);
        }
      }
    }
  }
  function getFigure(figureId) {
    const fig = figIndex.get(figureId);
    if (!fig) return null;
    // Prefer saved/ copy (permanent) over original path (may be on scratch)
    const savedPng = `saved/${fig.project}/${fig.run}/${fig.name}.png`;
    return { ...fig, png: savedPng, _originalPng: fig.png };
  }

  // ── Journal data: load from script tag + localStorage overlay ─────
  let journalData = null;
  let allEntries = [];
  let filteredEntries = [];

  const filters = {
    search: '',
    project: '',
    tag: '',
    dateFrom: '',
    dateTo: '',
  };

  function loadJournal() {
    // File-backed data is the source of truth; localStorage is only for
    // entries created in the browser UI that haven't been saved to the JSON yet.
    const fileData = window.__JOURNAL_ENTRIES
      ? JSON.parse(JSON.stringify(window.__JOURNAL_ENTRIES))
      : null;

    let lsData = null;
    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      try { lsData = JSON.parse(cached); } catch { lsData = null; }
    }

    if (fileData) {
      // Start from the file version (always up-to-date)
      journalData = fileData;
      // Merge in any localStorage-only entries (created in browser, not yet in JSON)
      if (lsData) {
        const fileIds = new Set((fileData.entries || []).map(e => e.id));
        for (const le of (lsData.entries || [])) {
          if (!fileIds.has(le.id)) {
            journalData.entries.push(le);
          }
        }
      }
    } else if (lsData) {
      journalData = lsData;
    } else {
      journalData = { created: new Date().toISOString().slice(0, 10), last_modified: new Date().toISOString(), entries: [] };
    }

    // Save merged to localStorage
    saveToLocalStorage();

    // Merge figure data
    allEntries = (journalData.entries || []).map(e => ({
      ...e,
      _fig: getFigure(e.figure_id),
    }));

    // Sort newest first
    allEntries.sort((a, b) => (b.added_at || b.date || '').localeCompare(a.added_at || a.date || ''));

    if (stampEl) stampEl.textContent = `${allEntries.length} entries · last modified ${journalData.last_modified || '—'}`;
    populateFilterDropdowns();
    applyFilters();
  }

  function saveToLocalStorage() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(journalData)); } catch {}
  }

  // ── Filter dropdowns ──────────────────────────────────────────────
  function populateFilterDropdowns() {
    const projects = new Set();
    const tags = new Set();
    for (const e of allEntries) {
      if (e._fig?.project) {
        projects.add(e._fig.project);
      } else if (e.figure_id) {
        // Extract project from figure_id path for text-only entries
        const parts = e.figure_id.split('/');
        if (parts.length >= 1) projects.add(parts[0]);
      }
      for (const t of (e.tags || e._fig?.tags || [])) tags.add(t);
    }
    for (const p of [...projects].sort()) {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      projectSel.appendChild(opt);
    }
    for (const t of [...tags].sort()) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      tagSel.appendChild(opt);
    }
  }

  // ── Filter logic ──────────────────────────────────────────────────
  function passesFilter(entry) {
    const entryProject = entry._fig?.project || (entry.figure_id ? entry.figure_id.split('/')[0] : '');
    if (filters.project && entryProject !== filters.project) return false;
    if (filters.tag) {
      const etags = entry.tags || entry._fig?.tags || [];
      if (!etags.includes(filters.tag)) return false;
    }
    if (filters.dateFrom && (entry.date || '') < filters.dateFrom) return false;
    if (filters.dateTo && (entry.date || '') > filters.dateTo) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [entry.commentary, entry._fig?.title, entry.figure_id, ...(entry.tags || []), ...(entry._fig?.tags || [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function applyFilters() {
    filteredEntries = allEntries.filter(passesFilter);
    countEl.textContent = filteredEntries.length;
    countLabel.textContent = filteredEntries.length === 1 ? 'entry' : 'entries';
    renderTimeline();
  }

  // ── Timeline render ───────────────────────────────────────────────
  function renderTimeline() {
    timeline.innerHTML = '';
    if (filteredEntries.length === 0) {
      emptyState.style.display = '';
      return;
    }
    emptyState.style.display = 'none';

    for (const entry of filteredEntries) {
      const li = document.createElement('li');
      li.className = 'timeline-entry';
      if (!entry._fig) li.classList.add('text-only');
      li.dataset.id = entry.id;
      li.innerHTML = renderEntry(entry);
      timeline.appendChild(li);
    }
    wireEntryActions();

    // Re-apply font preference
    const fontKey = localStorage.getItem(FONT_KEY) || 'garamond';
    applyFont(fontKey);
  }

  function renderEntry(e) {
    const fig = e._fig;
    const figTitle = fig?.title || '';
    const figPng = fig?.png || '';
    const figFallback = fig?._originalPng || '';
    const entryTags = e.tags || fig?.tags || [];
    const isTextOnly = !fig;
    const browserLink = fig ? `browser.html#fig=${encodeURIComponent(fig.id)}` : '#';

    // Extract project/run from figure_id if no manifest match
    let displayProject = fig?.project || '';
    let displayRun = fig?.run || '';
    if (!displayProject && e.figure_id) {
      const parts = e.figure_id.split('/');
      if (parts.length >= 1) displayProject = parts[0];
      if (parts.length >= 2) displayRun = parts[1];
    }

    // Derive a title for text-only entries from commentary first line or figure_id
    const entryTitle = figTitle || extractTitle(e.commentary) || e.figure_id || '(untitled)';

    let html = `
      <div class="entry-header">
        <span class="date-chip">${esc(e.date)}</span>
        <div class="entry-badges">
          ${displayProject ? `<span class="project-chip">${esc(displayProject)}</span>` : ''}
          ${displayRun ? `<span class="run-chip">${esc(displayRun)}</span>` : ''}
          <span class="author-chip">by ${esc(e.author || 'unknown')}</span>
        </div>
      </div>`;

    if (isTextOnly) {
      // ── Text-only layout: full-width card ──
      html += `
      <div class="entry-text-only">
        <div class="entry-fig-title">${esc(entryTitle)}</div>
        <div class="entry-commentary" data-entry-id="${esc(e.id)}" title="Click to edit">
          ${renderMarkdown(esc(e.commentary))}
        </div>
      </div>`;
    } else {
      // ── Figure + commentary layout ──
      html += `
      <div class="entry-figure">
        ${figPng
          ? `<div class="thumb-container" data-action="open-browser" data-link="${esc(browserLink)}">
               <img src="${esc(figPng)}" alt="${esc(figTitle)}" loading="lazy"
                    data-fallback="${esc(figFallback)}"
                    onerror="if(this.dataset.fallback && this.src.indexOf('saved/')>=0){this.src=this.dataset.fallback;this.dataset.fallback=''}else{this.style.display='none';this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--muted);font-size:0.85rem;font-family:Inter,sans-serif\\'>Image not available</div>'}">
             </div>`
          : `<div class="thumb-container" style="display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--muted);font-family:'Inter',sans-serif;font-size:0.85rem">
               Figure not in manifest
             </div>`
        }
        <div class="entry-content">
          <div class="entry-fig-title">${esc(entryTitle)}</div>
          <div class="entry-commentary" data-entry-id="${esc(e.id)}" title="Click to edit">
            ${renderMarkdown(esc(e.commentary))}
          </div>
        </div>
      </div>`;
    }

    if (entryTags.length) {
      html += `<div class="entry-tags">${entryTags.map(t => `<span class="t">${esc(t)}</span>`).join('')}</div>`;
    }

    if (fig?.meta) {
      html += renderDetailsSummary(fig);
    }

    html += `
      <div class="entry-footer">
        <button class="btn" data-action="copy-entry-json" data-entry-id="${esc(e.id)}">Copy JSON</button>
        <button class="btn danger" data-action="delete-entry" data-entry-id="${esc(e.id)}">Delete</button>
      </div>`;
    return html;
  }

  function renderDetailsSummary(fig) {
    const m = fig.meta || {};
    const c = m.compute || {};
    const s = m.script || {};
    let inner = '';

    if (m.description) {
      inner += `<div style="font-family:'EB Garamond',serif;font-size:0.92rem;line-height:1.5;white-space:pre-wrap;color:#555;margin-bottom:0.8rem">${esc(m.description)}</div>`;
    }
    const img = m.image || {};
    if (img.width_px || img.size_bytes) {
      inner += `<table class="kv-table">`;
      if (img.width_px) inner += `<tr><td>Dimensions</td><td>${img.width_px} × ${img.height_px} px (dpi ${img.dpi ?? '?'})</td></tr>`;
      if (img.size_bytes) inner += `<tr><td>Size</td><td>${fmtBytes(img.size_bytes)}</td></tr>`;
      inner += `</table>`;
    }
    if (c.gpu || c.slurm_job) {
      inner += `<table class="kv-table" style="margin-top:0.4rem">`;
      if (c.gpu)             inner += `<tr><td>GPU</td><td>${esc(c.gpu)}</td></tr>`;
      if (c.slurm_job)       inner += `<tr><td>SLURM job</td><td><code>${esc(c.slurm_job)}</code></td></tr>`;
      if (c.slurm_partition) inner += `<tr><td>Partition</td><td><code>${esc(c.slurm_partition)}</code></td></tr>`;
      if (c.wallclock_sec)   inner += `<tr><td>Wallclock</td><td>${c.wallclock_sec}s</td></tr>`;
      inner += `</table>`;
    }
    if (m.analysis?.method || m.analysis?.summary) {
      inner += `<table class="kv-table" style="margin-top:0.4rem">`;
      if (m.analysis.method)  inner += `<tr><td>Method</td><td>${esc(m.analysis.method)}</td></tr>`;
      if (m.analysis.summary) inner += `<tr><td>Summary</td><td>${esc(m.analysis.summary)}</td></tr>`;
      inner += `</table>`;
    }
    if (s.path) {
      inner += `<div style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;color:var(--muted);margin-top:0.4rem">Script: ${esc(s.path)}</div>`;
    }
    return `
      <details class="entry-details">
        <summary>Figure metadata</summary>
        <div class="detail-body">${inner}</div>
      </details>`;
  }

  // ── Wire event listeners ──────────────────────────────────────────
  function wireEntryActions() {
    // Click thumbnail → open lightbox (stay in journal)
    document.querySelectorAll('[data-action="open-browser"]').forEach(el => {
      el.addEventListener('click', () => {
        const img = el.querySelector('img');
        if (!img || !img.src) return;
        const lb = document.getElementById('lightbox');
        const lbImg = document.getElementById('lightbox-img');
        lbImg.src = img.src;
        lbImg.alt = img.alt;
        lb.style.display = '';
        document.body.style.overflow = 'hidden';
      });
    });

    document.querySelectorAll('.entry-commentary').forEach(el => {
      el.addEventListener('click', () => enterEditMode(el));
    });

    document.querySelectorAll('[data-action="copy-entry-json"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entryId = btn.dataset.entryId;
        const entry = allEntries.find(e => e.id === entryId);
        if (!entry) return;
        const { _fig, ...clean } = entry;
        copyToClipboard(JSON.stringify(clean, null, 2), 'Entry JSON copied');
      });
    });

    document.querySelectorAll('[data-action="delete-entry"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entryId = btn.dataset.entryId;
        if (!confirm(`Delete entry ${entryId}?`)) return;
        journalData.entries = journalData.entries.filter(e => e.id !== entryId);
        journalData.last_modified = new Date().toISOString();
        saveToLocalStorage();
        allEntries = allEntries.filter(e => e.id !== entryId);
        applyFilters();
        toast(`Deleted ${entryId}. Export JSON to persist.`);
      });
    });
  }

  // ── Edit mode for commentary ──────────────────────────────────────
  function enterEditMode(el) {
    const entryId = el.dataset.entryId;
    const entry = allEntries.find(e => e.id === entryId);
    if (!entry || el.querySelector('.edit-area')) return;

    const original = entry.commentary || '';
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
      el.innerHTML = `<p>${renderMarkdown(esc(original))}</p>`;
    });

    el.querySelector('.save-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      const newText = textarea.value.trim();
      if (!newText) { toast('Commentary is empty'); return; }

      // Update in-memory and localStorage
      entry.commentary = newText;
      const jEntry = journalData.entries.find(x => x.id === entryId);
      if (jEntry) jEntry.commentary = newText;
      journalData.last_modified = new Date().toISOString();
      saveToLocalStorage();

      el.innerHTML = `<p>${renderMarkdown(esc(newText))}</p>`;
      toast('Saved (in browser). Export JSON to persist to file.');
    });
  }

  // ── Export: JSON ──────────────────────────────────────────────────
  $('btn-export-json').addEventListener('click', () => {
    if (!journalData) { toast('No journal data'); return; }
    const blob = new Blob([JSON.stringify(journalData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_entries.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSON downloaded — replace journal_entries.json and run refresh.sh');
  });

  // ── Export: self-contained HTML ────────────────────────────────────
  $('btn-export-html').addEventListener('click', async () => {
    if (!filteredEntries.length) { toast('No entries to export'); return; }
    toast('Building export…');

    const entries = filteredEntries;
    const imageCache = new Map();
    const loadImage = (src) => {
      if (imageCache.has(src)) return imageCache.get(src);
      const p = new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          try { resolve(canvas.toDataURL('image/png')); }
          catch { resolve(src); }
        };
        img.onerror = () => resolve(src);
        img.src = src;
      });
      imageCache.set(src, p);
      return p;
    };

    const pngs = entries.map(e => e._fig?.png).filter(Boolean);
    const b64Map = {};
    await Promise.all(pngs.map(async (p) => { b64Map[p] = await loadImage(p); }));

    const today = new Date().toISOString().slice(0, 10);
    let bodyHtml = '';
    for (const e of entries) {
      const fig = e._fig;
      const imgSrc = fig?.png ? (b64Map[fig.png] || fig.png) : '';
      bodyHtml += `
        <div style="background:white;border:1px solid #e5e2dd;border-radius:10px;margin-bottom:1.5rem;padding:1.2rem;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
          <div style="display:flex;gap:0.6rem;align-items:center;margin-bottom:0.8rem;flex-wrap:wrap">
            <span style="font-family:monospace;font-size:0.8rem;background:#4E79A7;color:white;padding:0.2em 0.6em;border-radius:4px">${esc(e.date)}</span>
            <span style="font-size:0.75rem;color:#6b7280">${esc(fig?.project || '')} / ${esc(fig?.run || '')} · by ${esc(e.author || 'unknown')}</span>
          </div>
          ${imgSrc ? `<img src="${imgSrc}" style="max-width:100%;border-radius:6px;border:1px solid #e5e2dd;margin-bottom:0.8rem" alt="${esc(fig?.title || '')}">` : ''}
          <h3 style="font-size:1.1rem;margin-bottom:0.4rem">${esc(fig?.title || e.figure_id)}</h3>
          <div style="font-size:0.95rem;line-height:1.6;white-space:pre-wrap">${renderMarkdown(esc(e.commentary))}</div>
        </div>`;
    }

    const exportHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research Journal Export — ${today}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
body{font-family:'EB Garamond',Georgia,serif;max-width:860px;margin:0 auto;padding:2rem;background:#faf9f7;color:#2c2c2c}
h1{font-size:1.8rem;margin-bottom:.3rem}.meta{font-family:'Inter',sans-serif;font-size:.82rem;color:#6b7280;margin-bottom:2rem}
code{font-family:monospace;font-size:.85em;background:#f3f1ee;padding:.05em .3em;border-radius:2px}
</style></head><body>
<h1>Research Journal</h1><div class="meta">Exported ${today} · ${entries.length} entries</div>
${bodyHtml}</body></html>`;

    const blob = new Blob([exportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `journal_export_${today}.html`; a.click();
    URL.revokeObjectURL(url);
    toast('HTML exported');
  });

  // ── Wire filters ──────────────────────────────────────────────────
  searchInput.addEventListener('input', debounce(() => { filters.search = searchInput.value.trim(); applyFilters(); }, 150));
  projectSel.addEventListener('change', () => { filters.project = projectSel.value; applyFilters(); });
  tagSel.addEventListener('change', () => { filters.tag = tagSel.value; applyFilters(); });
  dateFromEl.addEventListener('change', () => { filters.dateFrom = dateFromEl.value; applyFilters(); });
  dateToEl.addEventListener('change', () => { filters.dateTo = dateToEl.value; applyFilters(); });

  // ── Init ──────────────────────────────────────────────────────────
  initFontSelector();
  loadJournal();

})();
