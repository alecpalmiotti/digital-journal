#!/usr/bin/env bash
# digital_journal - refresh.sh
# Re-run the indexer to regenerate manifest.js after figures change.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Activate your Python environment (needs pyyaml + PIL).
# Uncomment / adjust one of the following for your setup:
#   source /path/to/miniconda3/etc/profile.d/conda.sh && conda activate base
#   source /path/to/venv/bin/activate
if [[ -z "${CONDA_DEFAULT_ENV:-}" ]] || [[ "${CONDA_DEFAULT_ENV}" == "" ]]; then
  echo "WARNING: No conda env active. Activate an env with pyyaml + PIL first." >&2
fi

python "${HERE}/index.py" "$@"

# Also generate journal_data.js from journal_entries.json (for file:// loading)
JOURNAL_JSON="${HERE}/journal_entries.json"
JOURNAL_JS="${HERE}/journal_data.js"
if [ -f "$JOURNAL_JSON" ]; then
  echo "// AUTO-GENERATED from journal_entries.json — do not edit directly." > "$JOURNAL_JS"
  echo "// Edit journal_entries.json then run: bash refresh.sh" >> "$JOURNAL_JS"
  printf "window.__JOURNAL_ENTRIES = " >> "$JOURNAL_JS"
  cat "$JOURNAL_JSON" >> "$JOURNAL_JS"
  echo ";" >> "$JOURNAL_JS"
  echo "[refresh] Generated journal_data.js from journal_entries.json"
fi

# Copy journal-referenced figures to saved/ for permanence
python "${HERE}/save_journal_figures.py"
