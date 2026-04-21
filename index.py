#!/usr/bin/env python3
"""digital_journal.index · build manifest.js from registered projects.

Reads projects.yaml, ensures projects/<name> symlinks point at each
project root, walks <root>/figures/<run>/*.png, and emits a single
manifest.js consumed by browser.html and journal.html.

    python index.py
        # or
    bash refresh.sh
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sys
from pathlib import Path

try:
    import yaml
except ImportError as e:
    sys.exit(
        "ERROR: PyYAML is required.  Activate an env that has it:\n"
        "  conda activate base  # or your env with pyyaml\n"
        f"({e})"
    )

GENERATOR_VERSION = "0.1"
HERE = Path(__file__).resolve().parent
REGISTRY = HERE / "projects.yaml"
PROJECTS_DIR = HERE / "projects"
MANIFEST_OUT = HERE / "manifest.js"


# ── Coloured terminal output (no deps; degrades to plain text) ────────
def _supports_color() -> bool:
    return sys.stderr.isatty() and os.environ.get("TERM", "") not in ("", "dumb")

if _supports_color():
    OK, WARN, ERR, DIM, BOLD, RESET = (
        "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[1m", "\033[0m",
    )
else:
    OK = WARN = ERR = DIM = BOLD = RESET = ""


def info(msg: str) -> None:
    print(msg, file=sys.stderr)

def warn(msg: str) -> None:
    print(f"{WARN}WARN{RESET} {msg}", file=sys.stderr)

def good(msg: str) -> None:
    print(f"{OK}OK{RESET}   {msg}", file=sys.stderr)


# ── Helpers ──────────────────────────────────────────────────────────
def ensure_symlink(link: Path, target: Path) -> None:
    """Create or refresh `link` -> `target` using a RELATIVE path.

    Why relative: the digital_journal directory may be opened from
    different mount points (e.g. a remote filesystem via SSHFS). An
    absolute symlink would break on a different mount; a relative
    symlink resolves correctly under either mountpoint.
    """
    target_abs = target.resolve()
    rel_target = os.path.relpath(target_abs, link.parent.resolve())
    if link.is_symlink():
        if os.readlink(link) == rel_target:
            return
        link.unlink()
    elif link.exists():
        raise RuntimeError(
            f"Refusing to clobber non-symlink at {link} (would point to {target_abs})."
        )
    link.symlink_to(rel_target)
    good(f"symlink: {link.name} -> {rel_target}  (resolves to {target_abs})")


def load_meta(meta_path: Path) -> dict:
    with open(meta_path) as f:
        return yaml.safe_load(f) or {}


def measure_image(png_path: Path) -> dict:
    """Return {width_px, height_px, size_bytes} (PIL optional)."""
    out: dict = {"size_bytes": png_path.stat().st_size}
    try:
        from PIL import Image  # type: ignore[import-not-found]
        with Image.open(png_path) as im:
            out["width_px"], out["height_px"] = im.size
    except Exception:
        out["width_px"] = None
        out["height_px"] = None
    return out


# ── Discovery ────────────────────────────────────────────────────────
def discover_project(name: str, project_cfg: dict) -> dict:
    """Walk one project's figures/ dir and return a manifest sub-tree."""
    root = Path(project_cfg["root"])
    if not root.exists():
        warn(f"[{name}] root does not exist: {root}")
        return {
            "description": project_cfg.get("description"),
            "root": str(root),
            "figures_rel_url": f"projects/{name}/figures",
            "figure_count": 0,
            "runs": {},
        }

    fig_root = root / "figures"
    runs: dict[str, dict] = {}
    fig_total = 0
    default_tags = list(project_cfg.get("tags", []))

    if not fig_root.exists():
        warn(f"[{name}] no figures/ directory at {fig_root}")
    else:
        # one level deep: each subdir is a "run"
        for run_dir in sorted(p for p in fig_root.iterdir() if p.is_dir()):
            figures = []
            for png in sorted(run_dir.glob("*.png")):
                # Skip macOS resource-fork files (._foo.png)
                if png.name.startswith("._"):
                    continue
                stem = png.stem
                svg = run_dir / f"{stem}.svg"
                meta_yaml = run_dir / f"{stem}.meta.yaml"

                meta: dict = {}
                if meta_yaml.exists():
                    try:
                        meta = load_meta(meta_yaml)
                    except Exception as e:
                        warn(f"[{name}/{run_dir.name}] failed to parse "
                             f"{meta_yaml.name}: {e}")
                else:
                    warn(f"[{name}/{run_dir.name}] missing meta.yaml for {stem}")

                if not svg.exists():
                    warn(f"[{name}/{run_dir.name}] missing svg for {stem}")

                # Auto-fill image dims if meta omits them
                meta.setdefault("image", {})
                if not meta["image"].get("size_bytes"):
                    meta["image"].update(measure_image(png))
                if "png" not in meta["image"]:
                    meta["image"]["png"] = png.name
                if svg.exists() and "svg" not in meta["image"]:
                    meta["image"]["svg"] = svg.name

                fig_id = meta.get("id") or f"{name}/{run_dir.name}/{stem}"
                title = meta.get("title") or stem
                tags = list(meta.get("tags") or []) or list(default_tags)

                rel_base = f"projects/{name}/figures/{run_dir.name}"
                figures.append({
                    "id": fig_id,
                    "title": title,
                    "name": stem,
                    "project": name,
                    "run": run_dir.name,
                    "png": f"{rel_base}/{png.name}",
                    "svg": f"{rel_base}/{svg.name}" if svg.exists() else None,
                    "meta": meta,
                    "tags": tags,
                })
                fig_total += 1

            if figures:
                runs[run_dir.name] = {
                    "figure_count": len(figures),
                    "figures": figures,
                }

    return {
        "description": project_cfg.get("description"),
        "root": str(root),
        "figures_rel_url": f"projects/{name}/figures",
        "figure_count": fig_total,
        "runs": runs,
    }


# ── Main ─────────────────────────────────────────────────────────────
def main() -> int:
    if not REGISTRY.exists():
        sys.exit(f"ERROR: {REGISTRY} does not exist")

    with open(REGISTRY) as f:
        registry = (yaml.safe_load(f) or {}).get("projects", {})
    if not registry:
        sys.exit("ERROR: projects.yaml has no `projects:` entries")

    PROJECTS_DIR.mkdir(exist_ok=True)

    info(f"{BOLD}Indexing {len(registry)} project(s){RESET}")
    info(f"  registry : {REGISTRY}")
    info(f"  output   : {MANIFEST_OUT}")
    info("")

    manifest_projects: dict[str, dict] = {}
    all_tags: set[str] = set()

    for name, cfg in registry.items():
        ensure_symlink(PROJECTS_DIR / name, Path(cfg["root"]))
        sub = discover_project(name, cfg)
        manifest_projects[name] = sub
        for run in sub["runs"].values():
            for fig in run["figures"]:
                all_tags.update(fig["tags"])
        good(f"{name}: {sub['figure_count']} figures, "
             f"{len(sub['runs'])} run{'s' if len(sub['runs']) != 1 else ''}, "
             f"{len({t for r in sub['runs'].values() for f in r['figures'] for t in f['tags']})} tags")

    manifest = {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator_version": GENERATOR_VERSION,
        "projects": manifest_projects,
        "all_tags": sorted(all_tags),
    }

    body = "// AUTO-GENERATED by digital_journal/index.py — do not edit.\n"
    body += f"// Generated at {manifest['generated_at']} (generator v{GENERATOR_VERSION})\n"
    body += "window.__MANIFEST = "
    body += json.dumps(manifest, indent=2, default=str)
    body += ";\n"
    MANIFEST_OUT.write_text(body)
    good(f"wrote {MANIFEST_OUT.name}  ({MANIFEST_OUT.stat().st_size:,} bytes)")

    # ── Also wrap journal_entries.json as a JS file so journal.html can
    #    load it under file:// (browsers block fetch() of local JSON). ──
    journal_json = HERE / "journal_entries.json"
    journal_js = HERE / "journal_entries.js"
    if journal_json.exists():
        try:
            journal = json.loads(journal_json.read_text())
        except Exception as e:
            warn(f"failed to parse {journal_json.name}: {e} — skipping wrapper")
        else:
            wrapper = "// AUTO-GENERATED from journal_entries.json by index.py — do not edit.\n"
            wrapper += "// Edit journal_entries.json instead, then re-run refresh.sh\n"
            wrapper += "window.__JOURNAL = "
            wrapper += json.dumps(journal, indent=2, default=str)
            wrapper += ";\n"
            journal_js.write_text(wrapper)
            n_entries = len(journal.get("entries", []))
            good(f"wrote {journal_js.name}  ({n_entries} entr{'y' if n_entries == 1 else 'ies'})")
    else:
        info(f"{DIM}  (no journal_entries.json yet — skipping wrapper){RESET}")

    info("")
    info(f"{DIM}  open: file://{HERE}/browser.html{RESET}")
    info(f"{DIM}  open: file://{HERE}/journal.html{RESET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
