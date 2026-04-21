/* ─────────────────────────────────────────────────────────────────────
   Digital Journal · browser.js
   Pure-vanilla JS state + DOM for the figure browser.
   Reads window.__MANIFEST (loaded via manifest.js).
   ───────────────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  const manifest = window.__MANIFEST;
  if (!manifest) {
    document.body.innerHTML = '<div style="padding:2rem;font-family:sans-serif">' +
      '<h2>manifest.js not found</h2>' +
      '<p>Run <code>bash refresh.sh</code> in the digital_journal directory.</p></div>';
    return;
  }

  // ── Flatten the manifest into a single array of figure records ───
  const allFigures = [];
  for (const [pname, pdata] of Object.entries(manifest.projects || {})) {
    for (const [rname, rdata] of Object.entries(pdata.runs || {})) {
      (rdata.figures || []).forEach((fig, i) => {
        allFigures.push({
          ...fig,
          _runIndex: i + 1,             // 1-based: "Figure 1, Figure 2..."
          _runFigureCount: rdata.figures.length,
          _projectDescription: pdata.description || '',
          _created: fig.meta?.created || null,
        });
      });
    }
  }

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    filters: {
      projects: new Set(),  // empty = all
      runs:     new Set(),
      tags:     new Set(),
      search:   '',
      dateFrom: null,
      dateTo:   null,
    },
    sort: 'recency',
    pageSize: 40,
    pagesShown: 1,
  };

  // ── DOM refs ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const grid       = $('grid');
  const emptyState = $('empty-state');
  const resultsCount = $('results-count');
  const resultsPlural = $('results-plural');
  const resultsOfTotal = $('results-of-total');
  const filterProjects = $('filter-projects');
  const filterRuns = $('filter-runs');
  const filterTags = $('filter-tags');
  const searchInput = $('search-input');
  const dateFrom = $('date-from');
  const dateTo = $('date-to');
  const sortSelect = $('sort-select');
  const manifestStamp = $('manifest-stamp');
  const toastEl = $('toast');
  const modalEl = $('modal');
  const modalImageContainer = $('modal-image-container');
  const modalMeta = $('modal-meta');

  if (manifestStamp) manifestStamp.textContent = `manifest: ${manifest.generated_at} · v${manifest.generator_version} · ${allFigures.length} figs`;

  // ── Helpers ────────────────────────────────────────────────────────
  const fmtBytes = (n) => {
    if (n == null) return '—';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0, x = n;
    while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
    return `${x.toFixed(x < 10 && i ? 1 : 0)} ${units[i]}`;
  };
  const escapeHtml = (s) => String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const esc = escapeHtml;
  const debounce = (fn, ms = 200) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }
  async function copyToClipboard(text, what = 'copied') {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} to clipboard`);
    } catch {
      // Fallback: textarea + execCommand (works in old browsers + some file:// contexts)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(`${what} to clipboard`); }
      catch { toast('copy failed — select manually'); }
      finally { document.body.removeChild(ta); }
    }
  }

  // ── Tag / project / run frequency counts (over ALL figures) ────────
  const counts = {
    projects: new Map(),
    runs:     new Map(),
    tags:     new Map(),
  };
  for (const f of allFigures) {
    counts.projects.set(f.project, (counts.projects.get(f.project) || 0) + 1);
    counts.runs.set(f.run, (counts.runs.get(f.run) || 0) + 1);
    for (const t of (f.tags || [])) counts.tags.set(t, (counts.tags.get(t) || 0) + 1);
  }

  // ── Sidebar render (chips) ─────────────────────────────────────────
  function renderChipGroup(container, kind, items) {
    container.innerHTML = '';
    for (const [value, count] of items) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'chip' + (kind === 'tags' ? ' tag-chip' : '');
      el.dataset.kind = kind;
      el.dataset.value = value;
      el.innerHTML = `${esc(value)}<span class="count">${count}</span>`;
      el.addEventListener('click', () => {
        const set = state.filters[kind];
        if (set.has(value)) set.delete(value); else set.add(value);
        update();
      });
      container.appendChild(el);
    }
  }

  function refreshChipSelectedState() {
    document.querySelectorAll('.chip[data-kind]').forEach((el) => {
      const set = state.filters[el.dataset.kind];
      el.classList.toggle('selected', set && set.has(el.dataset.value));
    });
  }

  renderChipGroup(filterProjects,
    'projects', [...counts.projects.entries()].sort((a,b) => a[0].localeCompare(b[0])));
  renderChipGroup(filterRuns,
    'runs',     [...counts.runs.entries()].sort((a,b) => a[0].localeCompare(b[0])));
  renderChipGroup(filterTags,
    'tags',     [...counts.tags.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])));

  // Clear-filter buttons
  document.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.clear;
      if (k === 'dates') {
        state.filters.dateFrom = null; state.filters.dateTo = null;
        dateFrom.value = ''; dateTo.value = '';
      } else {
        state.filters[k]?.clear();
      }
      update();
    });
  });

  // ── Filter + sort logic ────────────────────────────────────────────
  function passesFilters(f) {
    const fl = state.filters;
    if (fl.projects.size && !fl.projects.has(f.project)) return false;
    if (fl.runs.size && !fl.runs.has(f.run)) return false;
    if (fl.tags.size) {
      const ts = f.tags || [];
      let hit = false;
      for (const t of ts) if (fl.tags.has(t)) { hit = true; break; }
      if (!hit) return false;
    }
    if (fl.search) {
      const q = fl.search.toLowerCase();
      const hay = [f.title, f.meta?.description, ...(f.tags || []), f.id].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fl.dateFrom || fl.dateTo) {
      const c = (f._created || '').slice(0, 10);
      if (!c) return false;
      if (fl.dateFrom && c < fl.dateFrom) return false;
      if (fl.dateTo && c > fl.dateTo) return false;
    }
    return true;
  }

  function sortFigures(arr) {
    const cmp = {
      'recency':     (a,b) => (b._created || '').localeCompare(a._created || ''),
      'recency-asc': (a,b) => (a._created || '').localeCompare(b._created || ''),
      'project':     (a,b) => a.project.localeCompare(b.project) || a.run.localeCompare(b.run) || a._runIndex - b._runIndex,
      'run':         (a,b) => a.run.localeCompare(b.run) || a._runIndex - b._runIndex,
      'title':       (a,b) => a.title.localeCompare(b.title),
    }[state.sort];
    return [...arr].sort(cmp);
  }

  // ── Grid render ────────────────────────────────────────────────────
  function renderGrid(figures) {
    const total = figures.length;
    const visible = figures.slice(0, state.pageSize * state.pagesShown);

    grid.innerHTML = '';
    if (total === 0) {
      emptyState.style.display = '';
      grid.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      grid.style.display = '';
    }

    for (const f of visible) {
      const card = document.createElement('div');
      card.className = 'fig-card';
      card.dataset.id = f.id;
      const tagsHtml = (f.tags || []).slice(0, 4)
        .map(t => `<span class="t">${esc(t)}</span>`).join('');
      card.innerHTML = `
        <img class="thumb" src="${esc(f.png)}" alt="${esc(f.title)}" loading="lazy"
             onerror="this.style.background='var(--code-bg)';this.alt='Image not found: ${esc(f.png)}'">
        <div class="body">
          <div class="title">${esc(f.title)}</div>
          <div class="label-row">
            <span class="project-chip">${esc(f.project)}</span>
            <span class="run-label">${esc(f.run)} · fig ${f._runIndex}/${f._runFigureCount}</span>
          </div>
          <div class="tag-row">${tagsHtml}</div>
        </div>`;
      card.addEventListener('click', () => openModal(f.id));
      grid.appendChild(card);
    }

    resultsCount.textContent = total;
    resultsPlural.textContent = total === 1 ? '' : 's';
    resultsOfTotal.textContent = total < allFigures.length
      ? ` of ${allFigures.length}`
      : ` (showing ${visible.length})`;
  }

  // ── Apply filters/sort and re-render ───────────────────────────────
  let lastFiltered = [];
  function update() {
    refreshChipSelectedState();
    state.pagesShown = 1;  // reset pagination on any filter change
    lastFiltered = sortFigures(allFigures.filter(passesFilters));
    renderGrid(lastFiltered);
  }

  // Infinite scroll: load more when near bottom of viewport
  window.addEventListener('scroll', () => {
    const totalShown = state.pageSize * state.pagesShown;
    if (totalShown >= lastFiltered.length) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
      state.pagesShown++;
      renderGrid(lastFiltered);
    }
  });

  // ── Modal ──────────────────────────────────────────────────────────
  function openModal(id) {
    const f = allFigures.find(x => x.id === id);
    if (!f) { toast(`figure not found: ${id}`); return; }
    location.hash = `fig=${encodeURIComponent(id)}`;

    // Set up metadata panel
    modalMeta.innerHTML = renderMetaPanel(f);
    wireModalActions(f);

    // Show modal FIRST
    modalEl.classList.add('open');
    modalEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Build image panel dynamically (avoids display:none rendering bug)
    const pngBytes = f.meta?.image?.size_bytes;
    const closeBtn = modalImageContainer.querySelector('.close-btn');

    // Remove old image content but keep close button
    while (modalImageContainer.lastChild !== closeBtn) {
      modalImageContainer.removeChild(modalImageContainer.lastChild);
    }

    // Create fresh image element
    const img = document.createElement('img');
    img.alt = f.title;
    img.style.cssText = 'max-width:100%;max-height:80vh;object-fit:contain;border-radius:4px;background:white;padding:8px';
    img.onerror = () => {
      img.style.display = 'none';
      const fb = document.createElement('div');
      fb.style.cssText = 'color:rgba(255,255,255,0.6);font-family:Inter,sans-serif;font-size:0.9rem;text-align:center;padding:2rem';
      fb.innerHTML = `Image could not be loaded<br><code style="font-size:0.75rem;opacity:0.5">${esc(f.png)}</code>`;
      modalImageContainer.appendChild(fb);
    };
    img.src = f.png;
    modalImageContainer.appendChild(img);

    // Add overlay buttons
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    const pngLink = document.createElement('a');
    pngLink.className = 'btn ghost-light';
    pngLink.href = f.png;
    pngLink.download = `${f.name}.png`;
    pngLink.textContent = `↓ PNG${pngBytes ? ' (' + fmtBytes(pngBytes) + ')' : ''}`;
    overlay.appendChild(pngLink);
    if (f.svg) {
      const svgLink = document.createElement('a');
      svgLink.className = 'btn ghost-light';
      svgLink.href = f.svg;
      svgLink.download = `${f.name}.svg`;
      svgLink.textContent = '↓ SVG';
      overlay.appendChild(svgLink);
    }
    modalImageContainer.appendChild(overlay);
  }
  function closeModal() {
    modalEl.classList.remove('open');
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (location.hash.startsWith('#fig=')) history.replaceState(null, '', ' ');
  }
  $('modal-close').addEventListener('click', closeModal);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl.classList.contains('open')) closeModal();
  });

  function renderMetaPanel(f) {
    const m = f.meta || {};
    const c = m.compute || {};
    const s = m.script || {};
    const a = m.analysis || {};
    const created = m.created || '—';
    const created_short = created.slice(0, 16).replace('T', ' ');

    const fullPngPath = (manifest.projects[f.project]?.root || '') + '/figures/' + f.run + '/' + (m.image?.png || `${f.name}.png`);
    const fullSvgPath = f.svg
      ? (manifest.projects[f.project]?.root || '') + '/figures/' + f.run + '/' + (m.image?.svg || `${f.name}.svg`)
      : null;

    let html = `
      <h2>${esc(f.title)}</h2>
      <div class="modal-subtitle">
        <span class="project-chip">${esc(f.project)}</span>
        <span>${esc(f.run)} · figure ${f._runIndex} of ${f._runFigureCount}</span>
        <span style="opacity:0.5">·</span>
        <span>${esc(created_short)}</span>
      </div>

      <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.8rem 1rem;margin-bottom:1rem">
        <textarea class="commentary-area" id="modal-commentary"
                  placeholder="Your commentary on this figure (markdown OK)…"
                  style="margin-bottom:0.5rem"></textarea>
        <div class="action-row">
          <button class="btn success" id="btn-add-to-journal">Add to journal</button>
          <button class="btn" id="btn-copy-md">Copy markdown ref</button>
          <button class="btn" id="btn-copy-png-path">Copy PNG path</button>
          ${fullSvgPath ? `<button class="btn" id="btn-copy-svg-path">Copy SVG path</button>` : ''}
          <button class="btn" id="btn-copy-link">Copy share link</button>
        </div>
        <div id="journal-add-feedback" style="display:none;font-family:'Inter',sans-serif;font-size:0.82rem;color:var(--accent3);margin-top:0.5rem"></div>
      </div>`;

    if (m.description) {
      html += `<h4>Description</h4><div class="description">${esc(m.description)}</div>`;
    }

    // Image facts
    const img = m.image || {};
    html += `<h4>Image</h4><table class="kv-table">`;
    html += `<tr><td>Dimensions</td><td>${img.width_px ?? '?'} × ${img.height_px ?? '?'} px (dpi ${img.dpi ?? '?'})</td></tr>`;
    html += `<tr><td>File size</td><td>${fmtBytes(img.size_bytes)}</td></tr>`;
    html += `<tr><td>PNG</td><td><code>${esc(fullPngPath)}</code></td></tr>`;
    if (fullSvgPath) html += `<tr><td>SVG</td><td><code>${esc(fullSvgPath)}</code></td></tr>`;
    html += `</table>`;

    // Inputs
    if (m.inputs && m.inputs.length) {
      html += `<h4>Inputs</h4><ul class="inputs-list">`;
      for (const i of m.inputs) {
        html += `<li>
          <div class="path">${esc(i.path || '')}</div>
          ${i.description ? `<div class="desc">${esc(i.description)}</div>` : ''}
          ${i.size_bytes ? `<div class="size">${fmtBytes(i.size_bytes)}</div>` : ''}
        </li>`;
      }
      html += `</ul>`;
    }

    // Compute
    if (c && Object.keys(c).length) {
      html += `<h4>Compute</h4><table class="kv-table">`;
      if (c.gpu)              html += `<tr><td>GPU</td><td>${esc(c.gpu)}</td></tr>`;
      if (c.cpus != null)     html += `<tr><td>CPUs</td><td>${c.cpus}</td></tr>`;
      if (c.mem_gb != null)   html += `<tr><td>Memory</td><td>${c.mem_gb} GB</td></tr>`;
      if (c.slurm_job)        html += `<tr><td>SLURM job</td><td><code>${esc(c.slurm_job)}</code></td></tr>`;
      if (c.slurm_partition)  html += `<tr><td>Partition</td><td><code>${esc(c.slurm_partition)}</code></td></tr>`;
      if (c.wallclock_sec)    html += `<tr><td>Wallclock</td><td>${c.wallclock_sec} s</td></tr>`;
      html += `</table>`;
    }

    // Analysis
    if (a.method || a.summary) {
      html += `<h4>Analysis</h4><table class="kv-table">`;
      if (a.method)  html += `<tr><td>Method</td><td>${esc(a.method)}</td></tr>`;
      if (a.summary) html += `<tr><td>Summary</td><td>${esc(a.summary)}</td></tr>`;
      html += `</table>`;
    }

    // Script
    if (s.path) {
      html += `<h4>Script</h4><table class="kv-table">`;
      html += `<tr><td>Path</td><td><code>${esc(s.path)}</code></td></tr>`;
      if (s.function) html += `<tr><td>Function</td><td><code>${esc(s.function)}</code></td></tr>`;
      if (s.git_sha)  html += `<tr><td>Git SHA</td><td><code>${esc(s.git_sha)}</code></td></tr>`;
      html += `</table>`;
    }

    // References
    if (m.references && m.references.length) {
      html += `<h4>References</h4><ul class="refs-list">`;
      for (const r of m.references) {
        const link = r.doi ? `https://doi.org/${r.doi}` : (r.url || null);
        html += `<li>
          <div class="ref-title">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(r.title || '(untitled)')}</a>` : esc(r.title || '(untitled)')}</div>
          <div class="ref-meta">
            ${r.authors ? esc((Array.isArray(r.authors) ? r.authors : [r.authors]).join(', ')) : ''}
            ${r.doi ? ` · doi:${esc(r.doi)}` : ''}
            ${r.role ? ` · <em>${esc(r.role)}</em>` : ''}
          </div>
        </li>`;
      }
      html += `</ul>`;
    }

    // Tags
    if (f.tags && f.tags.length) {
      html += `<h4>Tags</h4><div class="tag-list">`;
      html += f.tags.map(t => `<span class="t">${esc(t)}</span>`).join('');
      html += `</div>`;
    }

    return html;
  }

  function wireModalActions(f) {
    const fullPngPath = (manifest.projects[f.project]?.root || '') + '/figures/' + f.run + '/' + (f.meta?.image?.png || `${f.name}.png`);
    const fullSvgPath = f.svg
      ? (manifest.projects[f.project]?.root || '') + '/figures/' + f.run + '/' + (f.meta?.image?.svg || `${f.name}.svg`)
      : null;

    const commentary = $('modal-commentary');

    $('btn-add-to-journal').addEventListener('click', () => {
      const text = commentary.value.trim();
      if (!text) { toast('write some commentary first'); commentary.focus(); return; }

      // Read or init journal in localStorage
      const LS_KEY = 'digital_journal_entries';
      let journal;
      try { journal = JSON.parse(localStorage.getItem(LS_KEY)); } catch {}
      if (!journal) {
        // Try to read from window.__JOURNAL_ENTRIES (loaded via journal_data.js if present)
        journal = window.__JOURNAL_ENTRIES
          ? JSON.parse(JSON.stringify(window.__JOURNAL_ENTRIES))
          : { created: new Date().toISOString().slice(0, 10), last_modified: '', entries: [] };
      }

      // Auto-increment entry ID
      const maxNum = (journal.entries || []).reduce((mx, e) => {
        const m = (e.id || '').match(/^entry-(\d+)$/);
        return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
      }, 0);
      const newId = `entry-${String(maxNum + 1).padStart(4, '0')}`;
      const now = new Date();

      const newEntry = {
        id: newId,
        date: now.toISOString().slice(0, 10),
        figure_id: f.id,
        commentary: text,
        tags: (f.tags || []).slice(0, 6),
        author: 'alec',
        added_at: now.toISOString(),
      };

      journal.entries.push(newEntry);
      journal.last_modified = now.toISOString();
      localStorage.setItem(LS_KEY, JSON.stringify(journal));

      // UI feedback
      const feedback = $('journal-add-feedback');
      feedback.style.display = '';
      feedback.textContent = `Added as ${newId}. Open journal.html to see it.`;
      commentary.value = '';
      toast(`Added to journal as ${newId}`);
    });

    $('btn-copy-md').addEventListener('click', () => {
      const md = `![${f.title}](${fullPngPath})\n*${f.title} — ${f.run} fig ${f._runIndex}/${f._runFigureCount} (${f.project})*`;
      copyToClipboard(md, 'Markdown ref copied');
    });

    $('btn-copy-png-path').addEventListener('click', () => copyToClipboard(fullPngPath, 'PNG path copied'));

    if (fullSvgPath) {
      $('btn-copy-svg-path').addEventListener('click', () => copyToClipboard(fullSvgPath, 'SVG path copied'));
    }

    $('btn-copy-link').addEventListener('click', () => {
      const link = `${location.origin}${location.pathname}#fig=${encodeURIComponent(f.id)}`;
      copyToClipboard(link, 'Share link copied');
    });
  }

  // ── Search input (debounced) ───────────────────────────────────────
  searchInput.addEventListener('input', debounce((e) => {
    state.filters.search = e.target.value.trim();
    update();
  }, 150));

  // ── Date inputs ────────────────────────────────────────────────────
  dateFrom.addEventListener('change', (e) => { state.filters.dateFrom = e.target.value || null; update(); });
  dateTo.addEventListener('change',   (e) => { state.filters.dateTo   = e.target.value || null; update(); });

  // ── Sort select ────────────────────────────────────────────────────
  sortSelect.addEventListener('change', (e) => { state.sort = e.target.value; update(); });

  // ── Initial render + deep-link ─────────────────────────────────────
  update();

  function checkHashForFigure() {
    const m = location.hash.match(/^#fig=(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const f = allFigures.find(x => x.id === id);
      if (f) openModal(id);
    }
  }
  checkHashForFigure();
  window.addEventListener('hashchange', checkHashForFigure);

})();
