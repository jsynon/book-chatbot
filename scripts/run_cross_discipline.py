"""Run the cross-disciplinary benchmark against your LOCAL Reading Companion.

Runs exactly the selected questions *sequentially* with Gemma3:12b by
default; does not compare models, install software or mutate source books.

Windows examples (from D:\Downloads\book-chatbot):
  python scripts\run_cross_discipline.py --list
  python scripts\run_cross_discipline.py --case science-darwin-selection
  python scripts\run_cross_discipline.py --discipline history
  python scripts\run_cross_discipline.py --summary
  python scripts\run_cross_discipline.py --all --resume

--all is deliberately explicit: each question invokes two Ollama calls and
may take a while. Each case has a separate diagnostic report, so completed
cases can be resumed. --rerun is required to overwrite a previous report.
"""
import argparse
from datetime import datetime, timezone
import json
from collections import defaultdict
from statistics import mean
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from benchmark_suite import (
    DISCIPLINES, InvalidBenchmark, empty_review, inspect_response, load_suite,
)

SUITE_FILE = ROOT / "benchmarks" / "cross-disciplinary-v1.json"
DEFAULT_OUTPUT = ROOT / "reports" / "cross-disciplinary-v1"
DEFAULT_URL = "http://127.0.0.1:8765"


def _json_request(url, payload=None, timeout=180):
    request = Request(url, headers={"Accept": "application/json"})
    if payload is not None:
        request = Request(
            url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Accept": "application/json",
                     "Content-Type": "application/json"},
            method="POST",
        )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        raw = error.read()
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = {"error": raw.decode("utf-8", errors="replace")[:1000]}
        return error.code, body


def list_cases(suite):
    print("Antilogicalism cross-disciplinary evaluation (" +
          str(len(suite["cases"])) + " questions)")
    for case in suite["cases"]:
        book = "book " + case["book_id"] if case["scope"] == "book" else "across library"
        print("  " + case["id"] + " [" + case["discipline"] +
              ", " + book + "]")
        print("    " + case["question"])
    print("\nNo model requests have been made. Run --case CASE_ID for one test "
          "or --all for the entire suite.")


def summarize(directory):
    files = sorted(directory.glob("*.json")) if directory.is_dir() else []
    records = []
    for path in files:
        try:
            with path.open("r", encoding="utf-8") as file:
                entry = json.load(file)
        except (OSError, ValueError):
            print("Ignoring invalid report " + str(path))
            continue
        if (isinstance(entry, dict)
                and entry.get("suite_id") == "antilogicalism-cross-disciplinary-v1"
                and entry.get("case_id")):
            records.append(entry)
    if not records:
        print("No completed reports in " + str(directory))
        return []
    print("\nSaved benchmark reports in " + str(directory))
    for entry in records:
        validation = entry.get("structural_checks", {})
        verdict = "PROVENANCE OK" if validation.get("provenance_pass") else "CHECK SOURCES"
        manually_reviewed = entry.get("human_review", {}).get("reviewed") is True
        issues = [i["code"] for i in validation.get("issues", [])]
        print(f"  {entry['case_id']} [{entry.get('build', '?')}] "
              f"{entry.get('wall_seconds', 0):.1f}s — {verdict}; "
              f"{'human-reviewed' if manually_reviewed else 'UNREVIEWED'}"
              + ("; " + ", ".join(issues) if issues else ""))
    groups = defaultdict(list)
    for entry in records:
        groups[(entry.get("build", "?"), entry.get("discipline", "?"))].append(entry)
    print("\nBreakdown by build and discipline:")
    for (build, discipline), entries in sorted(groups.items()):
        passed = sum(
            bool(e.get("structural_checks", {}).get("provenance_pass"))
            for e in entries
        )
        human = [e for e in entries if e.get("human_review", {}).get("reviewed")
                 is True]
        average = mean(e.get("wall_seconds", 0) for e in entries)
        print(f"  {build} / {discipline}: {len(entries)} cases; "
              f"{passed} passed source checks; {average:.1f}s mean; "
              f"{len(human)} manually reviewed")
        if human:
            from benchmark_suite import SCORE_DIMENSIONS
            for dimension in SCORE_DIMENSIONS:
                scores = [
                    e.get("human_review", {}).get("scores_0_to_3", {}).get(dimension)
                    for e in human
                ]
                valid = [value for value in scores
                         if isinstance(value, int) and 0 <= value <= 3]
                if valid:
                    print(f"    {dimension}: {mean(valid):.2f}/3 "
                          f"({len(valid)} human scores)")
    print("Structural success does NOT score historical, scientific or literary "
          "truth; manually inspect the cited excerpts and enter the rubric.")
    return records


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Evaluate selected questions across science, history, literature and philosophy."
    )
    choices = load_suite(SUITE_FILE)
    names = [item["id"] for item in choices["cases"]]
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--case", action="append", choices=names, metavar="CASE_ID",
                       help="Run a single named question (repeat for several).")
    group.add_argument("--discipline", choices=sorted(DISCIPLINES),
                       help="Run one discipline's two questions, sequentially.")
    group.add_argument("--all", action="store_true",
                       help="Explicit opt-in to all eight two-call tests.")
    group.add_argument("--list", action="store_true",
                       help="List questions without any model calls (default).")
    group.add_argument("--summary", action="store_true",
                       help="Review existing output files without model calls.")
    parser.add_argument("--base-url", default=DEFAULT_URL,
                        help="Local Reading Companion server (default: localhost:8765).")
    parser.add_argument("--model", default=choices["default_model"],
                        help="One Ollama model for ALL selected runs.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="Folder for individual diagnostic reports.")
    parser.add_argument("--timeout", type=int, default=300,
                        help="Maximum time per HTTP request in seconds.")
    parser.add_argument("--resume", action="store_true",
                        help="Skip existing case reports.")
    parser.add_argument("--rerun", action="store_true",
                        help="Replace existing case reports intentionally.")
    args = parser.parse_args(argv)

    if not (args.case or args.discipline or args.all or args.list or args.summary):
        list_cases(choices)
        return 0
    if args.list:
        list_cases(choices)
        return 0
    if args.summary:
        summarize(args.output)
        return 0
    if args.resume and args.rerun:
        parser.error("--resume and --rerun cannot both be set")
    if not 10 <= args.timeout <= 1800:
        parser.error("--timeout must be between 10 and 1800 seconds")

    cases = [
        case for case in choices["cases"]
        if args.all or (args.case and case["id"] in args.case)
        or case["discipline"] == args.discipline
    ]
    base_url = args.base_url.rstrip("/")
    if not base_url.startswith(("http://", "https://")):
        parser.error("--base-url must be an HTTP(S) URL")

    try:
        status, health = _json_request(base_url + "/api/health", timeout=12)
        if status != 200 or not isinstance(health, dict) or not health.get("build"):
            raise RuntimeError("Reading Companion health endpoint is unavailable.")
        _, listing = _json_request(base_url + "/api/books", timeout=15)
    except (OSError, URLError, RuntimeError, ValueError) as exc:
        print("Cannot connect to Reading Companion: " + str(exc), file=sys.stderr)
        print("Start start.bat first, then retry.", file=sys.stderr)
        return 2

    available_books = {
        str(book.get("book_id")): book
        for book in listing.get("books", [])
        if isinstance(book, dict)
    }
    results = []
    args.output.mkdir(parents=True, exist_ok=True)
    print("Local build:", health["build"], "| Model:", args.model,
          "| Pipeline: evidence | Questions:", len(cases))
    print("Each test starts with a FRESH conversation history.")
    for index, case in enumerate(cases, 1):
        path = args.output / (case["id"] + ".json")
        if path.exists() and not args.rerun:
            print(f"[{index}/{len(cases)}] Already saved: {case['id']}; "
                  "use --rerun to replace.")
            continue
        if case["scope"] == "book":
            book = available_books.get(case["book_id"])
            if not book or not book.get("available"):
                print("Cannot test " + case["id"] + ": book " +
                      case["book_id"] + " is not available locally.",
                      file=sys.stderr)
                return 2

        print(f"[{index}/{len(cases)}] {case['id']} …", flush=True)
        payload = {
            "question": case["question"],
            "history": [],
            "scope": case["scope"],
            "pipeline": "evidence",
            "model": args.model,
            "diagnostics": True,
        }
        if case["scope"] == "book":
            payload["book_id"] = case["book_id"]
        started = datetime.now(timezone.utc).isoformat()
        clock = time.perf_counter()
        status = None
        try:
            status, response = _json_request(
                base_url + "/api/chat", payload, timeout=args.timeout
            )
            if not isinstance(response, dict):
                response = {"error": "Server returned non-object JSON"}
        except (OSError, URLError, ValueError) as exc:
            response = {"error": str(exc)}
        elapsed = round(time.perf_counter() - clock, 3)
        checks = inspect_response(case, response, catalog=available_books)
        if status != 200:
            checks["issues"].append({
                "level": "error", "code": "http_error",
                "description": "Request returned HTTP " + str(status)
            })
            checks["provenance_pass"] = False

        record = {
            "suite_id": choices["suite_id"],
            "case_id": case["id"],
            "discipline": case["discipline"],
            "task": case["task"],
            "question": case["question"],
            "scope": case["scope"],
            "expected_book_id": case.get("book_id"),
            "source_expectation": case["source_expectation"],
            "review_focus": case["review_focus"],
            "started_at": started,
            "build": health["build"],
            "model": args.model,
            "pipeline": "evidence",
            "http_status": status,
            "wall_seconds": elapsed,
            "structural_checks": checks,
            "human_review": empty_review(),
            "response": response,
        }
        with path.open("w", encoding="utf-8") as output:
            json.dump(record, output, indent=2, ensure_ascii=False)
            output.write("\n")
        results.append(record)
        print(f"    {elapsed:.1f}s | "
              f"{'source checks passed' if checks['provenance_pass'] else 'check source warnings/errors'} "
              f"| {len(response.get('sources', []))} cited passages | saved {path.name}",
              flush=True)
        if status != 200:
            print("    ERROR: " + str(response.get("error", status)), file=sys.stderr)
    summarize(args.output)
    return 1 if any(not item["structural_checks"]["provenance_pass"]
                    for item in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
