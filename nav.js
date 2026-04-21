/* ---------------------------------------------------------------------------
   Digital Journal - nav.js
   Shared navigation bar injected into all pages.
   Include this script on any page: <script src="[path]/nav.js?v=1"></script>
   It auto-detects relative paths and highlights the active page.
   --------------------------------------------------------------------------- */

(() => {
  'use strict';

  const loc = window.location.pathname;
  const page = loc.split('/').pop().replace('.html', '').toLowerCase();

  function isActive(key) {
    return key === page;
  }

  const act = (key) => isActive(key) ? ' class="active"' : '';

  const html = `
<header class="topbar topbar-shared" id="shared-topbar">
  <div class="topbar-title">
    <h1>Research Journal</h1>
    <div class="subtitle">Searchable, annotated index of figures, ideas, and experimental observations</div>
  </div>
  <nav class="topbar-nav">
    <a href="browser.html"${act('browser')}>Browser</a>
    <span class="sep">&middot;</span>
    <a href="journal.html"${act('journal')}>Journal</a>
    <span class="sep">&middot;</span>
    <a href="ideas.html"${act('ideas')}>Ideas</a>
  </nav>
</header>`;

  // Inject at the very top of <body>
  const existing = document.querySelector('.topbar, header.topbar, header.hero, .topbar-shared');
  if (existing) {
    existing.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('afterbegin', html);
  }

  // Inject dropdown CSS if not already present
  if (!document.getElementById('nav-dropdown-css')) {
    const style = document.createElement('style');
    style.id = 'nav-dropdown-css';
    style.textContent = `
      .topbar-shared {
        background: linear-gradient(135deg, #1a1018 0%, #2a1520 30%, #0f2840 70%, #0a1e36 100%) !important;
        color: white !important;
        padding: 1.6rem 2rem 1.4rem !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        text-align: left !important;
        gap: 2rem;
        flex-wrap: wrap;
        font-family: 'EB Garamond', Georgia, serif;
      }
      .topbar-shared h1 {
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .topbar-shared .subtitle {
        font-family: 'Inter', sans-serif;
        font-size: 0.78rem;
        font-weight: 300;
        opacity: 0.7;
        margin-top: 0.15rem;
      }
      .topbar-shared .topbar-nav {
        font-family: 'Inter', sans-serif;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
      }
      .topbar-shared .topbar-nav a {
        color: #c4a87c;
        text-decoration: none;
        padding: 0.35em 0.7em;
        border: 1px solid transparent;
        border-radius: 4px;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .topbar-shared .topbar-nav a:hover {
        background: rgba(196,168,124,0.12);
        border-color: rgba(196,168,124,0.4);
        color: #e8d5b0;
      }
      .topbar-shared .topbar-nav a.active {
        background: rgba(196,168,124,0.18);
        border-color: rgba(196,168,124,0.45);
        color: #e8d5b0;
      }
      .topbar-shared .sep { opacity: 0.3; color: #c4a87c; }

      @media (max-width: 700px) {
        .topbar-shared { padding: 1rem 1.2rem; }
        .topbar-shared h1 { font-size: 1.2rem; }
      }
    `;
    document.head.appendChild(style);
  }
})();
