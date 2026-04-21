# CLAUDE.md -- Digital Research Journal

You help maintain a static research figure journal. The journal indexes figures from research projects, provides a browsable UI, and stores annotated observations. Everything runs locally via `file://` with no server required.

## Key files

| File | Purpose | Edit? |
|------|---------|-------|
| `projects.yaml` | Project registry -- maps project names to root paths | Yes |
| `fig_io.py` | Python `save_figure()` API for analysis scripts | Rarely |
| `index.py` | Manifest indexer -- walks projects, generates manifest.js | Rarely |
| `refresh.sh` | Convenience wrapper: runs indexer + generates JS data files | No (just run it) |
| `manifest.js` | Auto-generated figure index | **Never edit** |
| `journal_data.js` | Auto-generated from journal_entries.json | **Never edit** |
| `ideas_data.js` | Auto-generated from ideas.json | **Never edit** |
| `journal_entries.json` | Journal entry data (can be exported from UI) | With care |
| `ideas.json` | Ideas tracker data (can be exported from UI) | With care |
| `browser.html` / `browser.js` | Figure browser UI | Only for features/fixes |
| `journal.html` / `journal.js` | Journal timeline UI | Only for features/fixes |
| `ideas.html` / `ideas.js` | Ideas tracker UI | Only for features/fixes |
| `saved/` | Permanent copies of journal-referenced figures | **Never edit directly** |

## Setup wizard protocol

When a user is new or asks for help setting up, walk them through this sequence:

### 1. Discover projects
Ask the user:
- What research projects do you have?
- What does each one study? (becomes the `description`)
- Where does each project's data live on disk? (becomes the `root`)
- What tags or categories apply? (becomes `tags`)

### 2. Create folder structure
For each project, ensure the directory exists with a `figures/` subdirectory:
```
<workspace>/
  digital_journal/          <-- this repo
  <project_name>/
    figures/                <-- where save_figure() writes to
```

### 3. Generate projects.yaml
Write `projects.yaml` with the discovered projects:
```yaml
projects:
  <project_key>:
    root: /absolute/path/to/<project_key>
    description: "<what the user said>"
    tags: [<suggested tags>]
```
Use absolute paths. The project key should be a short, filesystem-safe identifier (lowercase, underscores).

### 4. Run initial refresh
```bash
bash refresh.sh
```
This generates `manifest.js`. If there are no figures yet, the manifest will be empty but valid.

### 5. Set up parent CLAUDE.md (optional)
If the user wants agent instructions at the workspace level:
- Copy `CLAUDE.md.parent-template` to `<workspace>/CLAUDE.md`
- Fill in the lab name, project descriptions, and any conventions
- This file helps future agent sessions understand the workspace layout

### 6. Verify
- Open `browser.html` in the browser
- If figures exist, confirm they appear in the grid
- If no figures yet, confirm the page loads without errors

## Common tasks

### Add a new project
1. Create the project directory with `figures/` subdirectory
2. Add an entry to `projects.yaml`
3. Run `bash refresh.sh`

### Refresh after new figures
Run `bash refresh.sh` any time new figures have been saved via `save_figure()` or placed manually in a project's `figures/<run>/` directory. The indexer will pick up new PNGs and their `.meta.yaml` sidecars.

### Write a journal entry
Journal entries link observations to specific figures. They can be:
- Created in the journal UI (journal.html) and exported as JSON
- Written directly into `journal_entries.json` following the schema:
```json
{
  "id": "unique-id",
  "created": "2024-01-15T10:30:00Z",
  "figure_id": "project_name/run_name/figure_name",
  "commentary": "Markdown-formatted observation text.",
  "tags": ["finding", "important"]
}
```
After editing the JSON file, run `bash refresh.sh` to regenerate `journal_data.js`.

### Add save_figure() to an analysis script
```python
import sys, os
sys.path.insert(0, "/path/to/workspace")
from digital_journal.fig_io import save_figure

save_figure(
    fig,
    project="project_key",
    run="experiment_name",
    name="descriptive_figure_name",
    title="One-line title for the UI",
    description="What this figure shows and why it matters.",
    tags=["relevant", "tags"],
    script=__file__,
)
```

## Conventions

### Figure naming
- Use lowercase with underscores: `fig1_umap_clusters`, `qc_tic_heatmap`
- Prefix with a number if order matters within a run: `fig01_`, `fig02_`
- The `name` field should be descriptive enough to understand without context

### Run naming
- Runs are subdirectories under `figures/` -- each represents a logical group (an experiment, a pipeline run, a date)
- Examples: `baseline_qc`, `clustering_v3`, `2024_01_pilot`

### Tags
- Keep tags lowercase and consistent across projects
- Common categories: `qc`, `clustering`, `spatial`, `differential`, `overview`, `publication`

### Journal entries
- Reference figures by their full ID: `project/run/name`
- Write observations in markdown -- the journal UI renders headers, bold, italic, bullet lists, and inline code
- Focus on _what you observed and what it means_, not just what the figure shows

## What NOT to do

- **Don't edit `manifest.js`** -- it's regenerated every time you run `refresh.sh`
- **Don't edit `journal_data.js` or `ideas_data.js`** -- these are auto-generated wrappers around the JSON files
- **Don't edit files in `saved/`** -- these are auto-copied backups of journal-referenced figures
- **Don't put figures directly in `digital_journal/`** -- they belong in project directories under `figures/<run>/`
- **Don't use relative paths in `projects.yaml`** -- always use absolute paths for project roots
- **Don't delete `.meta.yaml` sidecars** -- they contain all the metadata shown in the browser UI
