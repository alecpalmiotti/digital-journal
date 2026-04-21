#!/usr/bin/env python3
"""
Copy figures referenced by journal entries into digital_journal/saved/
so the journal is self-contained even if original paths (scratch, etc.) are wiped.

Usage: python save_journal_figures.py          (from digital_journal/)
   or: bash refresh.sh                         (calls this automatically)

Reads journal_entries.json + manifest.js to find source PNGs.
Copies to saved/<project>/<run>/<name>.png (and .svg if available).
Skips files already saved. Prints a summary.
"""
import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JOURNAL_PATH = os.path.join(HERE, 'journal_entries.json')
MANIFEST_PATH = os.path.join(HERE, 'manifest.js')
SAVED_DIR = os.path.join(HERE, 'saved')

def parse_manifest():
    """Parse manifest.js → dict (strips the window.__MANIFEST = ...;)"""
    if not os.path.exists(MANIFEST_PATH):
        return {}
    text = open(MANIFEST_PATH).read()
    # Strip: window.__MANIFEST = { ... };
    m = re.search(r'window\.__MANIFEST\s*=\s*', text)
    if not m:
        return {}
    json_text = text[m.end():].rstrip().rstrip(';')
    return json.loads(json_text)

def build_figure_index(manifest):
    """figure_id → { png_rel, svg_rel, png_abs, svg_abs }"""
    idx = {}
    for pname, pdata in manifest.get('projects', {}).items():
        proj_root = pdata.get('root', '')
        for rname, rdata in pdata.get('runs', {}).items():
            for fig in rdata.get('figures', []):
                fid = fig.get('id', '')
                png_rel = fig.get('png', '')
                svg_rel = fig.get('svg')
                # Absolute path on filesystem
                png_abs = os.path.join(HERE, png_rel) if png_rel else None
                svg_abs = os.path.join(HERE, svg_rel) if svg_rel else None
                # Also try via project root (for figures not in symlinked tree)
                if png_abs and not os.path.exists(png_abs) and proj_root:
                    alt = os.path.join(proj_root, 'figures', rname,
                                       fig.get('name', '') + '.png')
                    if os.path.exists(alt):
                        png_abs = alt
                idx[fid] = {
                    'png_rel': png_rel,
                    'svg_rel': svg_rel,
                    'png_abs': png_abs,
                    'svg_abs': svg_abs,
                    'project': fig.get('project', ''),
                    'run': fig.get('run', ''),
                    'name': fig.get('name', ''),
                }
    return idx

def main():
    if not os.path.exists(JOURNAL_PATH):
        print('[save_journal_figures] No journal_entries.json — skipping')
        return

    journal = json.load(open(JOURNAL_PATH))
    entries = journal.get('entries', [])
    if not entries:
        print('[save_journal_figures] No journal entries — skipping')
        return

    manifest = parse_manifest()
    fig_idx = build_figure_index(manifest)

    os.makedirs(SAVED_DIR, exist_ok=True)
    copied = 0
    skipped = 0
    missing = 0

    for entry in entries:
        fid = entry.get('figure_id', '')
        info = fig_idx.get(fid)
        if not info:
            print(f'  WARN: figure_id "{fid}" not in manifest — cannot save')
            missing += 1
            continue

        # Destination: saved/<project>/<run>/<name>.png
        dest_dir = os.path.join(SAVED_DIR, info['project'], info['run'])
        os.makedirs(dest_dir, exist_ok=True)

        for ext, src_key in [('png', 'png_abs'), ('svg', 'svg_abs')]:
            src = info.get(src_key)
            if not src or not os.path.exists(src):
                continue
            dest = os.path.join(dest_dir, f"{info['name']}.{ext}")
            if os.path.exists(dest):
                # Only copy if source is newer
                if os.path.getmtime(src) <= os.path.getmtime(dest):
                    skipped += 1
                    continue
            shutil.copy2(src, dest)
            copied += 1
            print(f'  Saved: {os.path.relpath(dest, HERE)}')

    print(f'[save_journal_figures] {copied} copied, {skipped} up-to-date, {missing} missing')

if __name__ == '__main__':
    main()
