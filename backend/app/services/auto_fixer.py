"""
auto_fixer.py — Reads the codebase, finds bugs, and applies auto-fixes.

Uses only free, local tools — NO API key required:
  • Backend Python: `python -m py_compile` (syntax errors) + ruff --fix if available
  • Frontend TypeScript: `tsc --noEmit` (type errors) + `eslint --fix` (auto-fixable issues)
  • Built-in pattern scanner: a curated list of known anti-patterns with direct
    string replacements (e.g. raw `JSON.parse` without try/catch on WebSocket).

Each run produces a structured JSON summary and appends a human-readable
report to backend/auto_fix.log.
"""

import asyncio
import json
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
_SERVICE_DIR = Path(__file__).parent
PROJECT_ROOT = _SERVICE_DIR.parent.parent.parent          # marketcap/
BACKEND_DIR  = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
FRONTEND_SRC = FRONTEND_DIR / "src"
LOG_FILE     = BACKEND_DIR / "auto_fix.log"

_SKIP_DIRS  = {"__pycache__", ".git", "node_modules", "venv", ".venv", "dist", "build", ".next"}
_SKIP_FILES = {"auto_fixer.py"}


# ── Pattern library ───────────────────────────────────────────────────────────
# Each pattern: (file_glob, description, regex_pattern_to_find, replacement_string)
# Only applied when the pattern matches EXACTLY ONCE in the file (safety guard).

_PATTERNS: list[dict] = [
    {
        "name":        "websocket-onmessage-try-catch",
        "glob":        "frontend/src/context/WSContext.tsx",
        "description": "Wrap WebSocket JSON.parse in try/catch to prevent malformed messages from killing the connection",
        "find":        r"socket\.onmessage = \(e\) => \{\s*const tick: PriceTick = JSON\.parse\(e\.data\);\s*setPrices\(\(prev\) => \(\{ \.\.\.prev, \[tick\.ticker\]: tick \}\)\);\s*\};",
        "replace":     (
            "socket.onmessage = (e) => {\n"
            "        try {\n"
            "          const tick: PriceTick = JSON.parse(e.data);\n"
            "          if (tick?.ticker) {\n"
            "            setPrices((prev) => ({ ...prev, [tick.ticker]: tick }));\n"
            "          }\n"
            "        } catch { /* ignore malformed messages */ }\n"
            "      };"
        ),
    },
    {
        "name":        "history-null-date-sort",
        "glob":        "backend/app/routers/history.py",
        "description": "History events with null dates should sort to the bottom, not the top",
        "find":        r'events\.sort\(key=lambda e: e\["date"\] or "", reverse=True\)',
        "replace":     'events.sort(key=lambda e: e["date"] or "0000-00-00T00:00:00Z", reverse=True)',
    },
    {
        "name":        "portfolio-zero-division-allocation",
        "glob":        "backend/app/routers/portfolio.py",
        "description": "Guard allocation_pct against ZeroDivisionError when total_value is 0",
        "find":        r'h\["allocation_pct"\] = round\(h\["value"\] / total_value \* 100, 2\)\s*$',
        "replace":     'h["allocation_pct"] = round(h["value"] / total_value * 100, 2) if total_value > 0 else 0.0',
    },
]


# ── File collection ───────────────────────────────────────────────────────────

def _collect_files(base: Path, suffixes: tuple[str, ...]) -> list[Path]:
    files = []
    if not base.exists():
        return files
    for path in base.rglob("*"):
        if path.is_dir():
            continue
        if any(skip in path.parts for skip in _SKIP_DIRS):
            continue
        if path.name in _SKIP_FILES:
            continue
        if path.suffix in suffixes:
            files.append(path)
    return files


# ── Step 1: Python syntax check via py_compile ────────────────────────────────

def _check_python_syntax() -> list[dict]:
    """Return a list of {file, error} dicts for Python files with syntax errors."""
    issues = []
    for path in _collect_files(BACKEND_DIR, (".py",)):
        try:
            result = subprocess.run(
                ["python3", "-m", "py_compile", str(path)],
                capture_output=True, text=True, timeout=15,
            )
        except subprocess.TimeoutExpired:
            issues.append({
                "file":  str(path.relative_to(PROJECT_ROOT)),
                "error": "py_compile timed out after 15s",
            })
            continue
        if result.returncode != 0:
            issues.append({
                "file":  str(path.relative_to(PROJECT_ROOT)),
                "error": result.stderr.strip(),
            })
    return issues


# ── Step 2: Run ruff --fix on the backend (if installed) ──────────────────────

def _run_ruff() -> dict:
    """Run ruff --fix on backend/app. Returns summary or {'skipped': reason}."""
    ruff_bin = BACKEND_DIR / "venv" / "bin" / "ruff"
    if not ruff_bin.exists():
        return {"skipped": "ruff not installed in backend/venv"}

    try:
        result = subprocess.run(
            [str(ruff_bin), "check", "--fix", "--exit-zero", str(BACKEND_DIR / "app")],
            capture_output=True, text=True, cwd=str(BACKEND_DIR), timeout=60,
        )
    except subprocess.TimeoutExpired:
        return {"timeout": "ruff timed out after 60s"}
    return {
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "code":   result.returncode,
    }


# ── Step 3: Run tsc --noEmit (type errors) ────────────────────────────────────

def _run_tsc() -> dict:
    """Run tsc --noEmit on the frontend. Returns summary."""
    tsc_bin = FRONTEND_DIR / "node_modules" / ".bin" / "tsc"
    if not tsc_bin.exists():
        return {"skipped": "tsc not installed in frontend/node_modules"}

    try:
        result = subprocess.run(
            [str(tsc_bin), "--noEmit"],
            capture_output=True, text=True, cwd=str(FRONTEND_DIR),
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return {"timeout": "tsc timed out after 120s"}
    # Each line that looks like "src/foo.tsx(12,34): error TS2339: ..."
    errors = [
        line for line in result.stdout.splitlines()
        if re.search(r"error TS\d+", line)
    ]
    return {
        "errors":     errors,
        "error_count": len(errors),
        "code":        result.returncode,
    }


# ── Step 4: Run eslint --fix on the frontend ──────────────────────────────────

def _run_eslint() -> dict:
    """Run eslint --fix on the frontend src dir. Returns summary."""
    eslint_bin = FRONTEND_DIR / "node_modules" / ".bin" / "eslint"
    if not eslint_bin.exists():
        return {"skipped": "eslint not installed in frontend/node_modules"}

    try:
        result = subprocess.run(
            [str(eslint_bin), "--fix", "src/"],
            capture_output=True, text=True, cwd=str(FRONTEND_DIR),
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return {"timeout": "eslint timed out after 180s"}
    remaining = [
        line for line in result.stdout.splitlines()
        if re.search(r"\s+\d+:\d+\s+(error|warning)", line)
    ]
    return {
        "remaining_issues": len(remaining),
        "code":             result.returncode,
        "stdout_tail":      "\n".join(result.stdout.splitlines()[-20:]),
    }


# ── Step 5: Apply curated pattern-library fixes ───────────────────────────────

def _apply_patterns() -> list[dict]:
    """Walk the pattern library and apply each fix that uniquely matches."""
    results = []
    for pat in _PATTERNS:
        target = PROJECT_ROOT / pat["glob"]
        if not target.exists():
            results.append({
                "name":        pat["name"],
                "description": pat["description"],
                "file":        pat["glob"],
                "applied":     False,
                "reason":      "file not found",
            })
            continue

        content = target.read_text(encoding="utf-8")
        matches = list(re.finditer(pat["find"], content, re.MULTILINE))

        if len(matches) == 0:
            results.append({
                "name":        pat["name"],
                "description": pat["description"],
                "file":        pat["glob"],
                "applied":     False,
                "reason":      "pattern not found (already fixed or different version)",
            })
            continue
        if len(matches) > 1:
            results.append({
                "name":        pat["name"],
                "description": pat["description"],
                "file":        pat["glob"],
                "applied":     False,
                "reason":      f"pattern matched {len(matches)} times — too ambiguous",
            })
            continue

        updated = re.sub(pat["find"], pat["replace"], content, count=1, flags=re.MULTILINE)
        # Validate BEFORE writing: the syntax check at the top of the run
        # inspects the pre-patch file, so a bad replacement used to land on
        # disk and only be caught by the NEXT run — after the damage was live.
        if target.suffix == ".py":
            try:
                compile(updated, str(target), "exec")
            except SyntaxError as exc:
                results.append({
                    "name":        pat["name"],
                    "description": pat["description"],
                    "file":        pat["glob"],
                    "applied":     False,
                    "reason":      f"replacement would break syntax: {exc}",
                })
                continue
        try:
            target.write_text(updated, encoding="utf-8")
            results.append({
                "name":        pat["name"],
                "description": pat["description"],
                "file":        pat["glob"],
                "applied":     True,
                "reason":      "applied",
            })
        except Exception as exc:
            results.append({
                "name":        pat["name"],
                "description": pat["description"],
                "file":        pat["glob"],
                "applied":     False,
                "reason":      f"write failed: {exc}",
            })

    return results


# ── Main entry point ──────────────────────────────────────────────────────────

async def run_auto_fixer() -> dict:
    """Run all checks and fixes. Returns a summary dict."""
    run_started = datetime.now(timezone.utc)
    logger.info("[auto_fixer] Run started at %s", run_started.isoformat())

    loop = asyncio.get_event_loop()

    # Each step is sync + blocks on subprocesses, so run them in a thread.
    py_syntax  = await loop.run_in_executor(None, _check_python_syntax)
    ruff_out   = await loop.run_in_executor(None, _run_ruff)
    tsc_out    = await loop.run_in_executor(None, _run_tsc)
    eslint_out = await loop.run_in_executor(None, _run_eslint)
    patterns   = await loop.run_in_executor(None, _apply_patterns)

    applied_patterns = sum(1 for p in patterns if p["applied"])
    duration = (datetime.now(timezone.utc) - run_started).total_seconds()

    summary = {
        "status":             "ok",
        "run_at":             run_started.isoformat(),
        "duration_sec":       round(duration, 1),
        "python_syntax_errors": py_syntax,
        "ruff":               ruff_out,
        "tsc":                tsc_out,
        "eslint":             eslint_out,
        "patterns":           patterns,
        "patterns_applied":   applied_patterns,
        "patterns_total":     len(patterns),
    }

    _write_log(summary)
    logger.info(
        "[auto_fixer] Done in %.1fs — %d/%d patterns applied, %d TS errors, %d Py syntax errors.",
        duration, applied_patterns, len(patterns),
        tsc_out.get("error_count", 0) if isinstance(tsc_out, dict) else 0,
        len(py_syntax),
    )
    return summary


_LOG_MAX_BYTES = 1_048_576   # 1 MB — rotate beyond this
_LOG_BACKUPS   = 3            # keep auto_fix.log.1, .2, .3


def _rotate_log_if_needed() -> None:
    """Naive size-based rotation: when auto_fix.log exceeds 1MB, shift backups."""
    try:
        if not LOG_FILE.exists() or LOG_FILE.stat().st_size < _LOG_MAX_BYTES:
            return
        # Shift .2 → .3, .1 → .2, then current → .1
        for i in range(_LOG_BACKUPS - 1, 0, -1):
            src = LOG_FILE.with_suffix(LOG_FILE.suffix + f".{i}")
            dst = LOG_FILE.with_suffix(LOG_FILE.suffix + f".{i + 1}")
            if src.exists():
                src.replace(dst)
        LOG_FILE.replace(LOG_FILE.with_suffix(LOG_FILE.suffix + ".1"))
    except Exception as exc:
        logger.warning("[auto_fixer] Log rotation failed: %s", exc)


def _write_log(summary: dict) -> None:
    """Append a human-readable report to auto_fix.log."""
    _rotate_log_if_needed()
    try:
        lines = [
            "",
            "=" * 72,
            f"AUTO-FIXER RUN  {summary['run_at']}",
            f"  Duration : {summary['duration_sec']}s",
            "-" * 72,
            f"  Python syntax errors : {len(summary['python_syntax_errors'])}",
        ]
        for e in summary["python_syntax_errors"]:
            lines.append(f"    ✗ {e['file']}: {e['error'][:120]}")

        lines.append(f"  Ruff (Python lint --fix) : {summary['ruff']}")
        lines.append(f"  TypeScript errors        : {summary['tsc'].get('error_count', 'n/a')}")
        for err in summary["tsc"].get("errors", [])[:10]:
            lines.append(f"    ! {err}")
        lines.append(f"  ESLint --fix remaining   : {summary['eslint'].get('remaining_issues', 'n/a')}")
        lines.append("-" * 72)
        lines.append(f"  Pattern library: {summary['patterns_applied']}/{summary['patterns_total']} applied")
        for p in summary["patterns"]:
            status = "✓ APPLIED" if p["applied"] else f"✗ SKIPPED ({p['reason']})"
            lines.append(f"    [{status}] {p['file']}")
            lines.append(f"      {p['description']}")
        lines.append("=" * 72)

        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except Exception as exc:
        logger.warning("[auto_fixer] Could not write log: %s", exc)


def read_log(max_bytes: int = 50_000) -> str:
    """Return the tail of the log file (for the admin endpoint)."""
    if not LOG_FILE.exists():
        return "(no runs yet)"
    size = LOG_FILE.stat().st_size
    with LOG_FILE.open("r", encoding="utf-8") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
            f.readline()
        return f.read()
