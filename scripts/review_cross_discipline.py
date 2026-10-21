"""Manually score saved local Reading Companion answers without model calls.

Usage:
  python scripts/review_cross_discipline.py
  python scripts/review_cross_discipline.py --output reports/cross-model/qwen3-14b
  python scripts/review_cross_discipline.py --output reports/cross-model/gemma3-12b --case science-darwin-selection

The reviewer reads each answer alongside its cited passages and records human
scores in the existing report JSON. This script never contacts Ollama or the
Cloudflare Worker.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from benchmark_suite import SCORE_DIMENSIONS

DEFAULT_OUTPUT = ROOT / "reports" / "cross-disciplinary-v1"

DIMENSION_GUIDANCE = {
    "accuracy": "Are the answer's factual and interpretive claims sound?",
    "completeness": "Does it address every important part of the question?",
    "explanatory_value": "Does it explain how the ideas fit together, with useful context?",
    "citation_support": "Do the cited passages support the claims attached to them?",
    "readability": "Is the answer clear, coherent, and appropriately organized?",
}
SCORE_GUIDANCE = (
    "0 = incorrect/unsupported or absent; 1 = substantial problems; "
    "2 = mostly good, with a notable gap; 3 = strong and well supported"
)


def load_reports(directory, selected_cases=None):
    """Load valid cross-disciplinary report records from one output folder."""
    records = []
    for path in sorted(Path(directory).glob("*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (not isinstance(record, dict)
                or record.get("suite_id") != "antilogicalism-cross-disciplinary-v1"
                or not record.get("case_id")):
            continue
        if selected_cases and record["case_id"] not in selected_cases:
            continue
        records.append((path, record))
    return records


def report_source_lines(record):
    response = record.get("response", {})
    sources = response.get("sources", []) if isinstance(response, dict) else []
    lines = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        pages = source.get("pages") or [source.get("page", "?")]
        excerpt = source.get("excerpt") or source.get("text") or ""
        lines.append(
            f"  [{source.get('id', '?')}] {source.get('title', 'Source')} "
            f"(PDF p. {', '.join(str(page) for page in pages)})"
        )
        if excerpt:
            lines.append("      " + " ".join(str(excerpt).split()))
        if source.get("url"):
            lines.append("      " + str(source["url"]))
    return lines


def prompt_score(dimension, existing):
    while True:
        current = "" if existing is None else f" [current {existing}]"
        value = input(f"{dimension}: {DIMENSION_GUIDANCE[dimension]}{current}\n  0-3 (Enter keeps current, x skips): ").strip().lower()
        if value == "x":
            return None, False
        if value == "" and existing is not None:
            return existing, True
        if value == "" or value not in {"0", "1", "2", "3"}:
            print("Enter 0, 1, 2, 3, Enter with a saved score, or x to skip.")
            continue
        return int(value), True


def save_report(path, record):
    """Replace one JSON report atomically after a completed review."""
    path = Path(path)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=path.parent,
        prefix=path.name + ".", suffix=".tmp", delete=False,
    ) as handle:
        json.dump(record, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def review_record(path, record):
    print("\n" + "=" * 78)
    print(f"{record.get('case_id')} | {record.get('discipline')} | {record.get('model')} | build {record.get('build')}")
    print("Question: " + str(record.get("question", "")))
    for focus in record.get("review_focus", []):
        print("Review focus: " + str(focus))
    checks = record.get("structural_checks", {})
    print("Source identity checks: " + ("passed" if checks.get("provenance_pass") else "review warnings/errors"))
    answer = record.get("response", {}).get("answer", "")
    print("\nANSWER\n" + str(answer))
    print("\nCITED PASSAGES\n" + ("\n".join(report_source_lines(record)) or "  No source passages were saved."))
    review = record.setdefault("human_review", {
        "scores_0_to_3": {dimension: None for dimension in SCORE_DIMENSIONS},
        "notes": "",
        "reviewed": False,
    })
    scores = review.setdefault("scores_0_to_3", {})
    complete = True
    print("\n" + SCORE_GUIDANCE)
    for dimension in SCORE_DIMENSIONS:
        value, supplied = prompt_score(dimension, scores.get(dimension))
        if supplied:
            scores[dimension] = value
        if scores.get(dimension) not in {0, 1, 2, 3}:
            complete = False
    if not complete:
        print("At least one score is missing; report remains marked unreviewed.")
        return False
    notes = input("Reviewer notes (Enter keeps current notes): ").strip()
    if notes:
        review["notes"] = notes
    elif "notes" not in review:
        review["notes"] = ""
    confirm = input("Save these human scores and mark this answer reviewed? [y/N] ").strip().lower()
    if confirm != "y":
        print("Review not marked complete; no score changes saved.")
        return False
    review["reviewed"] = True
    save_report(path, record)
    print("Saved human review to " + str(path))
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Manually review saved local answers; makes no model requests."
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="Directory containing saved case JSON reports.")
    parser.add_argument("--case", action="append", dest="cases",
                        help="Review only this case ID; may be repeated.")
    args = parser.parse_args(argv)
    reports = load_reports(args.output, set(args.cases or []))
    if not reports:
        print("No matching cross-disciplinary report files in " + str(args.output))
        return 1
    print(f"Manual review: {len(reports)} saved answer(s); no Ollama or Worker calls.")
    reviewed = 0
    for index, (path, record) in enumerate(reports, 1):
        print(f"\nAnswer {index}/{len(reports)}")
        if review_record(path, record):
            reviewed += 1
    print(f"Completed {reviewed}/{len(reports)} manual review(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
