# Digital Research Journal

A static HTML+JS research figure journal that works entirely via `file://` -- no server required. Browse, annotate, and search your experiment figures locally.

## What it does

- **Figure Browser** -- grid view of all indexed experiment figures with filtering by project, run, tags, and date
- **Research Journal** -- timeline of annotated observations linked to figures, with inline editing and markdown support
- **Ideas Tracker** -- capture and organize research ideas with status tracking, tags, and references
- **Python API** -- `save_figure()` helper to save publication-quality PNGs with metadata directly from analysis scripts

Everything runs from local files. No database, no server, no account needed.

## Quick start

1. **Clone this repo** into a directory alongside your project data:
   ```bash
   git clone https://github.com/alecpalmiotti/digital-journal.git
   ```

2. **Edit `projects.yaml`** to register your project:
   ```yaml
   projects:
     my_project:
       root: /absolute/path/to/my_project
       description: "My research project"
       tags: [experiment, analysis]
   ```
   The indexer expects figures at `<root>/figures/<run_name>/*.png`.

3. **Run the indexer** to generate `manifest.js`:
   ```bash
   bash refresh.sh
   ```
   Requires Python 3 with `pyyaml` (and optionally `Pillow` for image dimensions).

4. **Open `browser.html`** in your browser -- that's it.

## Adding figures from Python

```python
import sys
sys.path.insert(0, "/path/to/parent/of/digital_journal")
from digital_journal.fig_io import save_figure

# After creating a matplotlib figure:
save_figure(fig, "my_project", "run_name", "descriptive_title",
            description="What this figure shows",
            tags=["clustering", "umap"])
```

This saves a PNG + `.meta.yaml` sidecar into the project's `figures/` directory.

## File structure

```
digital_journal/
  browser.html / browser.js   -- figure browser UI
  journal.html / journal.js   -- research journal timeline
  ideas.html / ideas.js       -- ideas tracker
  nav.js                      -- shared navigation bar
  style.css                   -- shared styles
  index.py                    -- manifest indexer
  fig_io.py                   -- Python save_figure() API
  refresh.sh                  -- convenience wrapper
  projects.yaml               -- project registry
  manifest.js                 -- auto-generated figure index
  journal_entries.json         -- journal data
  ideas.json                  -- ideas data
  saved/                      -- permanent figure copies
```

## How data flows

1. Your analysis scripts call `save_figure()` which writes PNGs + YAML metadata
2. `bash refresh.sh` walks registered projects and generates `manifest.js`
3. `browser.html` reads `manifest.js` to render the figure grid
4. Journal entries and ideas are stored in JSON files + localStorage for live editing
5. Export JSON from the UI, replace the file, and re-run `refresh.sh` to persist changes

## License

MIT
