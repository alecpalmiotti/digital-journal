#!/usr/bin/env python3
"""digital_journal.serve · tiny stdlib HTTP server for the journal UI.

Runs on localhost (default port 8765). Serves the static digital_journal
directory AND a small REST API that lets browser.html / journal.html write
journal entries straight to disk — no copy-paste needed.

Usage:
    bash start_server.sh
        # or
    python serve.py [--port 8765]

Then open:  http://localhost:8765/browser.html
            http://localhost:8765/journal.html

Endpoints:
    GET  /api/health                    → {ok, app, version, entries, last_modified}
    GET  /api/journal                   → journal_entries.json contents
    POST /api/journal                   → append entry; body:
                                          {figure_id, commentary, author?}
    PATCH  /api/journal/<entry_id>      → update commentary; body:
                                          {commentary}
    DELETE /api/journal/<entry_id>      → remove entry
    POST /api/refresh                   → re-run index.py and reload manifest

Design notes:
- stdlib only (http.server + json + pathlib). No flask, no deps.
- Localhost-bind by default (127.0.0.1) — never exposed to network.
- On every write we also regenerate journal_entries.js wrapper so file://
  fallback still works after the server is stopped.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
JOURNAL_JSON = HERE / "journal_entries.json"
JOURNAL_JS = HERE / "journal_entries.js"
INDEX_PY = HERE / "index.py"
APP_NAME = "digital_journal"
APP_VERSION = "0.1"

# Single lock for journal writes (server is multi-threaded)
_journal_lock = threading.Lock()


# ── Coloured terminal output ─────────────────────────────────────────
def _supports_color() -> bool:
    return sys.stderr.isatty() and os.environ.get("TERM", "") not in ("", "dumb")

if _supports_color():
    OK, WARN, ERR, DIM, BOLD, RESET = (
        "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[1m", "\033[0m",
    )
else:
    OK = WARN = ERR = DIM = BOLD = RESET = ""


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _today() -> str:
    return _dt.date.today().isoformat()


# ── Journal file helpers ─────────────────────────────────────────────
def _empty_journal() -> dict:
    return {
        "created": _today(),
        "last_modified": _now_iso(),
        "entries": [],
    }


def _load_journal() -> dict:
    if not JOURNAL_JSON.exists():
        return _empty_journal()
    try:
        return json.loads(JOURNAL_JSON.read_text())
    except Exception as e:
        # Don't silently nuke a corrupt file — back it up.
        backup = JOURNAL_JSON.with_suffix(".json.broken")
        JOURNAL_JSON.rename(backup)
        sys.stderr.write(
            f"{WARN}WARN{RESET} journal_entries.json was unparseable; "
            f"moved to {backup.name} and starting fresh ({e})\n"
        )
        return _empty_journal()


def _save_journal(j: dict) -> None:
    j["last_modified"] = _now_iso()
    JOURNAL_JSON.write_text(json.dumps(j, indent=2))
    # Mirror to JS wrapper for file:// fallback
    wrapper = "// AUTO-GENERATED from journal_entries.json by serve.py — do not edit.\n"
    wrapper += "// Edit journal_entries.json instead, then refresh the page.\n"
    wrapper += "window.__JOURNAL = "
    wrapper += json.dumps(j, indent=2)
    wrapper += ";\n"
    JOURNAL_JS.write_text(wrapper)


def _next_entry_id(j: dict) -> str:
    nums = []
    for e in j.get("entries", []):
        eid = e.get("id", "")
        if eid.startswith("entry-"):
            try:
                nums.append(int(eid.split("-", 1)[1]))
            except ValueError:
                pass
    n = (max(nums) if nums else 0) + 1
    return f"entry-{n:04d}"


# ── Request handler ──────────────────────────────────────────────────
class JournalHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that serves HERE/ + intercepts /api/* paths."""

    # Serve files from HERE/ regardless of CWD
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    # ── Logging: quieter, coloured ──
    def log_message(self, fmt, *args):
        sys.stderr.write(
            f"{DIM}{self.log_date_time_string()}{RESET}  "
            f"{self.address_string()}  {fmt % args}\n"
        )

    # ── CORS / preflight (helpful when opened from file:// during dev) ──
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ── Helpers ──
    def _read_json_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid JSON body"})
            return None

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── Routing ──
    def _api_path(self) -> str | None:
        """Return path under /api/, or None if not an API request."""
        p = urlparse(self.path).path
        if p.startswith("/api/"):
            return p[len("/api/"):].rstrip("/")
        return None

    def do_GET(self):
        api = self._api_path()
        if api is None:
            return super().do_GET()

        if api == "health":
            with _journal_lock:
                j = _load_journal()
            return self._send_json(200, {
                "ok": True,
                "app": APP_NAME,
                "version": APP_VERSION,
                "entries": len(j.get("entries", [])),
                "last_modified": j.get("last_modified"),
            })

        if api == "journal":
            with _journal_lock:
                j = _load_journal()
            return self._send_json(200, j)

        return self._send_json(404, {"error": f"unknown GET endpoint: /api/{api}"})

    def do_POST(self):
        api = self._api_path()
        if api is None:
            return self._send_json(404, {"error": f"no static POST handler"})

        body = self._read_json_body()
        if body is None:
            return  # error already sent

        if api == "journal":
            fig_id = (body.get("figure_id") or "").strip()
            commentary = (body.get("commentary") or "").strip()
            author = (body.get("author") or "alec").strip()
            if not fig_id:
                return self._send_json(400, {"error": "figure_id required"})
            if not commentary:
                return self._send_json(400, {"error": "commentary required"})

            with _journal_lock:
                j = _load_journal()
                entry = {
                    "id": _next_entry_id(j),
                    "date": _today(),
                    "figure_id": fig_id,
                    "commentary": commentary,
                    "author": author,
                    "added_at": _now_iso(),
                }
                j.setdefault("entries", []).append(entry)
                _save_journal(j)
            return self._send_json(201, {"ok": True, "entry": entry, "total": len(j["entries"])})

        if api == "refresh":
            try:
                proc = subprocess.run(
                    [sys.executable, str(INDEX_PY)],
                    capture_output=True, text=True, cwd=str(HERE),
                    timeout=60,
                )
                ok = proc.returncode == 0
                return self._send_json(200 if ok else 500, {
                    "ok": ok,
                    "stdout": proc.stdout,
                    "stderr": proc.stderr,
                })
            except Exception as e:
                return self._send_json(500, {"ok": False, "error": str(e)})

        return self._send_json(404, {"error": f"unknown POST endpoint: /api/{api}"})

    def do_PATCH(self):
        api = self._api_path()
        if api is None or not api.startswith("journal/"):
            return self._send_json(404, {"error": "PATCH only on /api/journal/<id>"})
        eid = api[len("journal/"):]
        body = self._read_json_body()
        if body is None:
            return
        with _journal_lock:
            j = _load_journal()
            for e in j.get("entries", []):
                if e.get("id") == eid:
                    if "commentary" in body:
                        e["commentary"] = (body["commentary"] or "").strip()
                    e["edited_at"] = _now_iso()
                    _save_journal(j)
                    return self._send_json(200, {"ok": True, "entry": e})
        return self._send_json(404, {"error": f"no entry with id {eid}"})

    def do_DELETE(self):
        api = self._api_path()
        if api is None or not api.startswith("journal/"):
            return self._send_json(404, {"error": "DELETE only on /api/journal/<id>"})
        eid = api[len("journal/"):]
        with _journal_lock:
            j = _load_journal()
            n_before = len(j.get("entries", []))
            j["entries"] = [e for e in j.get("entries", []) if e.get("id") != eid]
            if len(j["entries"]) == n_before:
                return self._send_json(404, {"error": f"no entry with id {eid}"})
            _save_journal(j)
        return self._send_json(200, {"ok": True, "removed": eid, "remaining": len(j["entries"])})


# ── Main ─────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="digital_journal local server")
    ap.add_argument("--port", type=int, default=8765, help="TCP port (default 8765)")
    ap.add_argument("--host", default="127.0.0.1",
                    help="Bind address (default 127.0.0.1; use 0.0.0.0 to expose)")
    args = ap.parse_args()

    # Make sure the JSON exists so first GET /api/journal doesn't 404
    if not JOURNAL_JSON.exists():
        _save_journal(_empty_journal())

    addr = (args.host, args.port)
    httpd = ThreadingHTTPServer(addr, JournalHandler)

    sys.stderr.write(
        f"{BOLD}digital_journal{RESET} server listening on "
        f"http://{args.host}:{args.port}/\n"
        f"  {DIM}browser:{RESET} http://{args.host}:{args.port}/browser.html\n"
        f"  {DIM}journal:{RESET} http://{args.host}:{args.port}/journal.html\n"
        f"  {DIM}plan   :{RESET} http://{args.host}:{args.port}/plan.html\n"
        f"  {DIM}root   :{RESET} {HERE}\n"
        f"  {DIM}journal:{RESET} {JOURNAL_JSON}\n"
        f"  {DIM}stop   :{RESET} Ctrl-C\n\n"
    )

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write(f"\n{OK}OK{RESET}   stopped\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
