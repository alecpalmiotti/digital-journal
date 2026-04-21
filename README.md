# Digital Research Journal

A static HTML+JS research figure journal that works entirely via `file://` -- no server required. Browse, annotate, and search your experiment figures locally.

## What it does

- **Figure Browser** -- grid view of all indexed experiment figures with filtering by project, run, tags, and date
- **Research Journal** -- timeline of annotated observations linked to figures, with inline editing and markdown support
- **Ideas Tracker** -- capture and organize research ideas with status tracking, tags, and figure references
- **Python API** -- `save_figure()` helper to save publication-quality PNGs + SVGs with rich metadata directly from analysis scripts

Everything runs from local files. No database, no server, no account needed.

## Recommended folder structure

The journal is designed to live inside a parent folder alongside your project data. Think of the parent folder as your lab workspace:

```
My_Lab/                              <-- your lab / workspace folder
  CLAUDE.md                          <-- agent instructions for your lab (optional)
  digital_journal/                   <-- this repo (clone it here)
    browser.html
    journal.html
    ideas.html
    projects.yaml                    <-- register your projects here
    fig_io.py                        <-- Python save_figure() API
    refresh.sh
    manifest.js                      <-- auto-generated (don't edit)
    ...
  proteomics_aging/                  <-- example project
    figures/
      baseline_qc/
        fig1_sample_overview.png
        fig1_sample_overview.svg
        fig1_sample_overview.meta.yaml
      clustering_v2/
        ...
  imaging_study/                     <-- another project
    figures/
      pilot_run/
        ...
  shared_data/                       <-- non-project folders are fine too
```

The key idea: `digital_journal/` indexes figures from sibling project folders. Each project stores its figures in `<project>/figures/<run_name>/`.

## Setup

### 1. Create your workspace and clone

```bash
mkdir ~/My_Lab
cd ~/My_Lab
git clone https://github.com/alecpalmiotti/digital-journal.git digital_journal
```

### 2. Create project folders

Create directories for each of your research projects. Each project needs a `figures/` subdirectory where the journal will look for indexed figures:

```bash
mkdir -p proteomics_aging/figures
mkdir -p imaging_study/figures
```

### 3. Configure projects.yaml

Edit `digital_journal/projects.yaml` to register your projects:

```yaml
projects:
  proteomics_aging:
    root: /home/you/My_Lab/proteomics_aging
    description: "Aging proteomics time-course"
    tags: [proteomics, aging]

  imaging_study:
    root: /home/you/My_Lab/imaging_study
    description: "Tissue imaging pilot"
    tags: [imaging, maldi]
```

Each project needs:
- A key name (used as the project identifier everywhere)
- `root`: absolute path to the project directory
- `description` (optional): human-readable label shown in the browser UI
- `tags` (optional): default tags applied to figures that don't specify their own

The indexer expects figures at `<root>/figures/<run_name>/*.png`, each optionally accompanied by a `.meta.yaml` sidecar.

### 4. Run the indexer

```bash
cd ~/My_Lab/digital_journal
bash refresh.sh
```

This generates `manifest.js` (the figure index), `journal_data.js`, and `ideas_data.js`. Requires Python 3 with `pyyaml` (and optionally `Pillow` for image dimensions).

### 5. Open in your browser

Open `browser.html` in any browser -- that's it. Use the navigation bar to switch between the figure browser, research journal, and ideas tracker.

```bash
# macOS
open digital_journal/browser.html

# Linux
xdg-open digital_journal/browser.html
```

## Adding figures from Python

The `save_figure()` function is the primary way to get figures into the journal. Call it from any analysis script:

```python
import sys, os
sys.path.insert(0, os.path.expanduser("~/My_Lab"))
from digital_journal.fig_io import save_figure

import matplotlib.pyplot as plt

fig, ax = plt.subplots()
ax.plot([1, 2, 3], [4, 5, 6])
ax.set_title("Example")

save_figure(
    fig,
    project="proteomics_aging",      # must match a key in projects.yaml
    run="baseline_qc",               # subdirectory under figures/
    name="fig1_sample_overview",      # filename (no extension)
    title="Sample overview - all timepoints",
    description="Distribution of protein counts across samples and timepoints.",
    tags=["qc", "overview"],
    script=__file__,                  # auto-captures git SHA
)
```

This saves three files into `proteomics_aging/figures/baseline_qc/`:
- `fig1_sample_overview.png` (raster at 150 dpi)
- `fig1_sample_overview.svg` (vector)
- `fig1_sample_overview.meta.yaml` (metadata sidecar)

After saving new figures, run `bash refresh.sh` and reload the browser.

### Full save_figure() signature

```python
save_figure(
    fig,
    *,
    project: str,                    # Key in projects.yaml (required)
    run: str,                        # Run/experiment subdirectory (required)
    name: str,                       # Figure basename, no extension (required)
    title: str,                      # One-line title (required)
    description: str = None,         # Longer description
    inputs: list[dict] = None,       # Input files: [{"path": "...", "description": "..."}]
    compute: dict = None,            # Compute context: {"gpu": "...", "slurm_job": ...}
    analysis: dict = None,           # Free-form analysis metadata
    references: list[dict] = None,   # Related references
    tags: list[str] = None,          # Searchable tags
    script: str = None,              # Path to calling script (auto-detects git SHA)
    dpi: int = 150,                  # PNG resolution
    close: bool = True,              # Close matplotlib figure after saving
)
```

Auto-detected metadata (no action needed):
- Image dimensions, file size, DPI
- GPU name (via PyTorch or nvidia-smi)
- SLURM job ID and partition (from environment variables)
- Git SHA of the script (if in a git repo)
- Creation timestamp

## How data flows

```
Analysis scripts                    Digital Journal
  |                                   |
  | save_figure()                     |
  |  -> PNG + SVG + .meta.yaml        |
  |     into project/figures/run/     |
  |                                   |
  |           bash refresh.sh ------->|
  |                                   |  index.py walks projects
  |                                   |  -> manifest.js
  |                                   |  -> journal_data.js
  |                                   |  -> ideas_data.js
  |                                   |
  |                          browser.html reads manifest.js
  |                          journal.html reads journal_data.js
  |                          ideas.html reads ideas_data.js
```

1. Your analysis scripts call `save_figure()`, which writes PNGs + SVGs + YAML metadata into project figure directories
2. `bash refresh.sh` walks all registered projects and generates `manifest.js`
3. The browser UI reads `manifest.js` to render the figure grid with filtering and search
4. Journal entries and ideas are stored in JSON files + localStorage for live editing
5. Export JSON from the UI, replace the file, and re-run `refresh.sh` to persist changes

## Setting up with an AI agent

If you use an AI coding agent (Claude Code, Cursor, Copilot, etc.), you can have it walk you through setup. Copy-paste this prompt after cloning:

> I just cloned `digital_journal` into my workspace folder. I need help setting it up.
>
> Please read `digital_journal/CLAUDE.md` and then walk me through the setup wizard:
> 1. Ask me about my research projects (names, what they study, where data lives)
> 2. Help me create the folder structure with `figures/` directories
> 3. Generate `digital_journal/projects.yaml` with the right paths
> 4. Run `bash digital_journal/refresh.sh` to initialize the manifest
> 5. If I have a parent-level CLAUDE.md template at `digital_journal/CLAUDE.md.parent-template`, copy it to my workspace root and fill it in
>
> My workspace folder is: `[paste your path here]`

The agent will ask you a few questions about your projects and then handle the rest.

## File structure

```
digital_journal/
  browser.html / browser.js    Figure browser UI (grid, filters, modal)
  journal.html / journal.js    Research journal timeline
  ideas.html / ideas.js        Ideas tracker
  nav.js                       Shared navigation bar
  style.css                    Shared styles

  fig_io.py                    Python save_figure() API
  index.py                     Manifest indexer (walks projects)
  serve.py                     Optional HTTP server for live editing
  refresh.sh                   Convenience wrapper (runs index.py + data wrappers)
  save_journal_figures.py      Copies journal-referenced figures to saved/

  projects.yaml                Project registry (you edit this)
  manifest.js                  Auto-generated figure index (don't edit)
  journal_entries.json          Journal data
  journal_data.js              Auto-generated wrapper (don't edit)
  ideas.json                   Ideas data
  ideas_data.js                Auto-generated wrapper (don't edit)
  saved/                       Permanent copies of journal-referenced figures

  CLAUDE.md                    Agent instructions for journal maintenance
  CLAUDE.md.parent-template    Template for your workspace-level CLAUDE.md
```

## License

MIT
