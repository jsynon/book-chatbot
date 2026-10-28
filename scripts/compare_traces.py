"""Offline trace inspection and side-by-side comparisons for the Reading Companion.

Accepts local saved reports or authenticated Worker evaluation JSON. Does not
call models, import third-party packages, or infer semantic correctness.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from collections import Counter

MAX_FILE_BYTES = 25_000_000
STAGES = {
    "planning": ("planner", "plan", "question_parts", "questionParts", "resolvedQuestion"),
    "retrieval": ("retrieval", "retrieved", "candidates", "candidatePages", "selectedPages", "passages"),
    "composition": ("composition", "composer", "draft", "answer", "response"),
    "review": ("review", "reviewer", "sourceDecisions", "claimDecisions", "evidenceMap"),
    "outcome": ("status", "result", "failure", "error", "coverage", "citations"),
}
PRIVATE_KEYS = {"api_key", "authorization", "cookie", "turnstile", "token", "secret", "password", "visitor_ip", "ip_address"}
SCHEMA = "antilogicalism-offline-trace-comparison-v1"


def load_json(path: Path):
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"File exceeds {MAX_FILE_BYTES} bytes: {path}")
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, (dict, list)):
        raise ValueError("Expected a JSON object or array")
    return obj


def walk(value, prefix="", depth=0):
    if depth > 14:
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if any(part in str(key).lower() for part in PRIVATE_KEYS):
                continue
            path = f"{prefix}.{key}" if prefix else str(key)
            yield path, key, item
            yield from walk(item, path, depth + 1)
    elif isinstance(value, list):
        for i, item in enumerate(value[:250]):
            yield from walk(item, f"{prefix}[{i}]", depth + 1)


def summarize(obj):
    roots = list(obj) if isinstance(obj, dict) else ["array"]
    matches = {stage: [] for stage in STAGES}
    for path, key, value in walk(obj):
        for stage, words in STAGES.items():
            if str(key).lower() in {w.lower() for w in words}:
                descriptor = {"path": path, "type": type(value).__name__}
                if isinstance(value, (list, dict)):
                    descriptor["items"] = len(value)
                elif isinstance(value, (str, int, float, bool)) and len(str(value)) <= 160:
                    descriptor["value"] = value
                matches[stage].append(descriptor)
    # Preserve exact paths, not guessed shared stage schemas.
    return {"top_level_keys": roots, "stages": {k: v[:100] for k, v in matches.items()}}


def compare(left, right, left_label, right_label):
    a, b = summarize(left), summarize(right)
    changes = {}
    for stage in STAGES:
        lhs = {x["path"]: x for x in a["stages"][stage]}
        rhs = {x["path"]: x for x in b["stages"][stage]}
        changes[stage] = {
            "left_paths": len(lhs), "right_paths": len(rhs),
            "only_left": sorted(lhs.keys() - rhs.keys()),
            "only_right": sorted(rhs.keys() - lhs.keys()),
            "changed_metadata": [
                {"path": p, "left": lhs[p], "right": rhs[p]}
                for p in sorted(lhs.keys() & rhs.keys()) if lhs[p] != rhs[p]
            ][:100],
        }
    return {"schema": SCHEMA, "left": {"label": left_label, **a},
            "right": {"label": right_label, **b}, "differences": changes,
            "warning": "Structural trace comparison only; model quality and citation entailment require human review."}


def render_html(report):
    def escaped_json(obj):
        return html.escape(json.dumps(obj, ensure_ascii=False, indent=2))
    sections = []
    for stage, diff in report["differences"].items():
        sections.append(f"<details open><summary>{html.escape(stage.title())} · "
                        f"{diff['left_paths']} / {diff['right_paths']} traced fields</summary>"
                        f"<pre>{escaped_json(diff)}</pre></details>")
    return """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width"><title>Reading Companion · Offline Trace Comparison</title>
<style>:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}
body{max-width:1100px;margin:2rem auto;padding:0 1rem}
details{border:1px solid #8886;border-radius:6px;margin:1rem 0;padding:.8rem}
summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.84rem}
small{opacity:.75}</style></head><body><h1>Reading Companion · Trace comparison</h1>
<p>""" + html.escape(str(report["left"]["label"])) + " vs. " + html.escape(str(report["right"]["label"])) + """</p>
<p><small>Offline diagnostic only. No model calls. Structural differences do not establish answer accuracy.</small></p>""" + "".join(sections) + "</body></html>"


def main(argv=None):
    p = argparse.ArgumentParser(description="Compare two saved local/Worker traces without network or model calls")
    p.add_argument("left", type=Path)
    p.add_argument("right", type=Path)
    p.add_argument("--output", type=Path, default=Path("reports/trace-comparison.json"))
    p.add_argument("--html", type=Path, help="Optional standalone browser report")
    args = p.parse_args(argv)
    try:
        report = compare(load_json(args.left), load_json(args.right), args.left.name, args.right.name)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if args.html:
            args.html.parent.mkdir(parents=True, exist_ok=True)
            args.html.write_text(render_html(report), encoding="utf-8")
    except (OSError, ValueError) as exc:
        p.error(str(exc))
    print(f"Wrote {args.output}")
    if args.html:
        print(f"Wrote {args.html}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
