"""digital_journal.fig_io · save_figure() helper.

The 3-line onboarding recipe for any pipeline that wants its figures to
appear in the digital journal:

    from digital_journal.fig_io import save_figure
    # ... build matplotlib `fig` ...
    save_figure(fig, project="graphtheory", run="run_1",
                name="fig1_tissue_and_tic",
                title="Tissue mask + total intensity (log10)",
                description="...",
                inputs=[{"path": "...", "description": "..."}],
                tags=["qc", "sol0153"],
                script=__file__)

Behaviour:
  * Writes <project_root>/figures/<run>/<name>.png
  * Writes <project_root>/figures/<run>/<name>.svg (vector copy of fig)
  * Writes <project_root>/figures/<run>/<name>.meta.yaml
  * Auto-fills: created timestamp, image dims/dpi/size, GPU (if CUDA),
    SLURM job id (if $SLURM_JOB_ID set), git sha (if script is in a repo).
  * Closes fig.
  * Returns the meta dict.

Project name must exist in projects.yaml.
"""
from __future__ import annotations

import datetime as _dt
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "fig_io requires PyYAML.  In the base env: `pip install pyyaml` "
        "(or use any env that already has it; pyyaml is in base + maldi_flask_web)."
    ) from e

# ── Locate the digital_journal directory and load the registry once ────
_HERE = Path(__file__).resolve().parent
_REGISTRY_PATH = _HERE / "projects.yaml"


def _load_registry() -> dict[str, dict]:
    if not _REGISTRY_PATH.exists():
        raise FileNotFoundError(
            f"Registry not found: {_REGISTRY_PATH}.  Create it with at least one "
            f"project entry (see digital_journal/README.md)."
        )
    with open(_REGISTRY_PATH) as f:
        data = yaml.safe_load(f) or {}
    return data.get("projects", {})


# ── Auto-detect helpers ───────────────────────────────────────────────
def _detect_gpu() -> str | None:
    """Return GPU model string if CUDA is available, else None."""
    try:
        import torch  # type: ignore[import-not-found]
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        pass
    # Fallback: parse nvidia-smi if available (cheap)
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            out = subprocess.run(
                [nvidia_smi, "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=2, check=False,
            )
            name = out.stdout.strip().splitlines()[0] if out.stdout else ""
            return name or None
        except Exception:
            return None
    return None


def _detect_git_sha(start: Path) -> str | None:
    """Return short git SHA of the repo containing `start`, or None."""
    try:
        out = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--short=7", "HEAD"],
            capture_output=True, text=True, timeout=2, check=False,
        )
        sha = out.stdout.strip()
        return sha if re.fullmatch(r"[0-9a-f]{7,}", sha) else None
    except Exception:
        return None


def _safe_name(name: str) -> str:
    """Reject names that would escape the run dir."""
    if "/" in name or "\\" in name or name.startswith("."):
        raise ValueError(f"Invalid figure name: {name!r}")
    return name


def _yaml_dump(meta: dict) -> str:
    """Pretty-stable YAML dump for the .meta.yaml sidecar."""
    return yaml.safe_dump(
        meta,
        sort_keys=False,
        default_flow_style=False,
        width=100,
        allow_unicode=True,
    )


# ── Main API ──────────────────────────────────────────────────────────
def save_figure(
    fig,
    *,
    project: str,
    run: str,
    name: str,
    title: str,
    description: str | None = None,
    inputs: Iterable[dict] | None = None,
    compute: dict | None = None,
    analysis: dict | None = None,
    references: Iterable[dict] | None = None,
    tags: Iterable[str] | None = None,
    script: str | None = None,
    dpi: int = 150,
    close: bool = True,
) -> dict[str, Any]:
    """Save matplotlib `fig` plus SVG plus .meta.yaml sidecar.

    Required:
        fig      : matplotlib Figure
        project  : key into projects.yaml
        run      : subdirectory name under <root>/figures/
        name     : basename without extension
        title    : one-line human-readable title

    Optional metadata is forwarded into the YAML sidecar verbatim. The
    fields listed in §4 of plan.html are recognised; extras are preserved.
    """
    name = _safe_name(name)
    registry = _load_registry()
    if project not in registry:
        raise KeyError(
            f"Project {project!r} not registered in {_REGISTRY_PATH}. "
            f"Known projects: {sorted(registry)}"
        )
    project_root = Path(registry[project]["root"]).resolve()
    if not project_root.exists():
        raise FileNotFoundError(f"Project root does not exist: {project_root}")

    out_dir = project_root / "figures" / run
    out_dir.mkdir(parents=True, exist_ok=True)

    png_path = out_dir / f"{name}.png"
    svg_path = out_dir / f"{name}.svg"
    meta_path = out_dir / f"{name}.meta.yaml"

    # Save raster + vector
    fig.savefig(png_path, dpi=dpi, bbox_inches="tight")
    fig.savefig(svg_path,           bbox_inches="tight")

    # Auto-collect image dims (do this AFTER save so we measure the on-disk file)
    width_px = height_px = None
    try:
        from PIL import Image  # type: ignore[import-not-found]
        with Image.open(png_path) as im:
            width_px, height_px = im.size
    except Exception:
        pass

    # Auto-collect compute info
    compute = dict(compute or {})
    compute.setdefault("gpu", _detect_gpu())
    if "slurm_job" not in compute:
        sjid = os.environ.get("SLURM_JOB_ID")
        compute["slurm_job"] = int(sjid) if sjid and sjid.isdigit() else sjid
    if "slurm_partition" not in compute:
        compute["slurm_partition"] = os.environ.get("SLURM_JOB_PARTITION")

    # Script path + git sha
    script_block: dict[str, Any] | None = None
    if script:
        script_path = Path(script).resolve()
        script_block = {
            "path": str(script_path),
            "function": None,
            "git_sha": _detect_git_sha(script_path.parent),
        }

    meta: dict[str, Any] = {
        "id": f"{project}/{run}/{name}",
        "project": project,
        "run": run,
        "name": name,
        "title": title,
        "description": description,
        "created": _dt.datetime.now().isoformat(timespec="seconds"),
        "image": {
            "png": png_path.name,
            "svg": svg_path.name,
            "width_px": width_px,
            "height_px": height_px,
            "dpi": dpi,
            "size_bytes": png_path.stat().st_size,
        },
        "script": script_block,
        "inputs": [dict(i) for i in (inputs or [])] or None,
        "compute": compute or None,
        "analysis": dict(analysis) if analysis else None,
        "references": [dict(r) for r in (references or [])] or None,
        "tags": list(tags) if tags else [],
    }

    # Drop top-level keys that ended up None to keep the YAML tidy
    meta = {k: v for k, v in meta.items() if v is not None}

    with open(meta_path, "w") as f:
        f.write(_yaml_dump(meta))

    if close:
        try:
            import matplotlib.pyplot as plt
            plt.close(fig)
        except Exception:
            pass

    return meta


__all__ = ["save_figure"]
