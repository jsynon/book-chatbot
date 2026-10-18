"""Stable cross-disciplinary evaluation contracts, separate from answering.

This module is for evaluating user-visible replies, not rewriting prompts,
boosting a benchmark book, or deciding what the model should say. It never
loads book text or calls Ollama. Structural checks verify book/PDF identity
and citation references; nuanced scientific, historical and literary claims
still require a human to read the passages and assess the explanation.
"""
import json
from pathlib import Path
import re

DISCIPLINES = frozenset({"science", "history", "literature", "philosophy"})
SCORE_DIMENSIONS = (
    "accuracy", "completeness", "explanatory_value",
    "citation_support", "readability",
)
CITATION = re.compile(r"\[(S[1-9]\d*)\]")
DRIVE_ID = re.compile(
    r"^https://drive\.google\.com/file/d/([a-zA-Z0-9_-]+)/view(?:\?[^#]*)?(?:#page=(\d+))?$"
)


class InvalidBenchmark(ValueError):
    """A benchmark definition is malformed or ambiguous."""


def load_suite(path):
    """Validate evaluation metadata without contacting Ollama or the corpus."""
    with Path(path).open("r", encoding="utf-8") as stream:
        suite = json.load(stream)
    if not isinstance(suite, dict) or suite.get("schema_version") != 1:
        raise InvalidBenchmark("Unsupported benchmark schema version")
    if not isinstance(suite.get("suite_id"), str) or not suite["suite_id"]:
        raise InvalidBenchmark("A suite_id is required")
    cases = suite.get("cases")
    if not isinstance(cases, list) or not cases:
        raise InvalidBenchmark("A nonempty cases array is required")
    known_ids = set()
    for case in cases:
        if not isinstance(case, dict):
            raise InvalidBenchmark("Each benchmark case must be an object")
        name = case.get("id")
        if (not isinstance(name, str)
                or not re.fullmatch(r"[a-z][a-z0-9-]{2,79}", name)
                or name in known_ids):
            raise InvalidBenchmark("Duplicate or invalid case id: " + str(name))
        known_ids.add(name)
        if case.get("discipline") not in DISCIPLINES:
            raise InvalidBenchmark(name + ": unsupported discipline")
        if not isinstance(case.get("question"), str) or len(case["question"]) < 30:
            raise InvalidBenchmark(name + ": question missing or too short")
        if (case.get("scope") not in {"book", "library"}
                or (case.get("scope") == "book"
                    and not re.fullmatch(r"[1-9]\d*", str(case.get("book_id", ""))))
                or (case.get("scope") == "library" and "book_id" in case)):
            raise InvalidBenchmark(name + ": scope/book_id inconsistent")
        focus = case.get("review_focus")
        if (not isinstance(focus, list) or not 2 <= len(focus) <= 6
                or any(not isinstance(item, str) or len(item) < 15 for item in focus)):
            raise InvalidBenchmark(name + ": needs human review criteria")
        expectation = case.get("source_expectation")
        if not isinstance(expectation, dict):
            raise InvalidBenchmark(name + ": source expectation missing")
        mode = expectation.get("mode")
        if mode == "only":
            ids = expectation.get("book_ids")
            if (not isinstance(ids, list) or len(ids) != 1
                    or not all(isinstance(i, str) and i.isdecimal() for i in ids)
                    or (case["scope"] == "book" and ids[0] != case["book_id"])):
                raise InvalidBenchmark(name + ": one-book source mismatch")
        elif mode == "groups":
            groups = expectation.get("groups")
            if (case["scope"] != "library" or not isinstance(groups, list)
                    or len(groups) < 2):
                raise InvalidBenchmark(name + ": author groups required")
            for group in groups:
                if (not isinstance(group, dict)
                        or not isinstance(group.get("label"), str)
                        or not group["label"]
                        or not isinstance(group.get("book_ids"), list)
                        or not group["book_ids"]
                        or not all(isinstance(i, str) and i.isdecimal()
                                   for i in group["book_ids"])):
                    raise InvalidBenchmark(name + ": invalid author source group")
        elif mode != "nonempty":
            raise InvalidBenchmark(name + ": unknown source expectation")
    return suite


def _issue(issues, level, code, description):
    issues.append({"level": level, "code": code, "description": description})


def inspect_response(case, result):
    """Check deterministic citation/ID consistency, NEVER semantic correctness.

    The source metadata is returned by the app, and the tests distinguish
    integrity of that metadata from the truthfulness of the answer.
    A source may be perfectly real yet irrelevant, taken from an editor's
    commentary, or used to support a false claim.
    """
    issues = []
    if not isinstance(result, dict):
        result = {}
        _issue(issues, "error", "invalid_response", "Server returned non-object JSON.")
    answer = result.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        _issue(issues, "error", "no_answer", "No usable assistant explanation.")
        answer = ""
    sources = result.get("sources")
    if not isinstance(sources, list):
        _issue(issues, "error", "no_source_list", "Response lacks an array of cited sources.")
        sources = []
    by_id, seen_books, book_pdf_ids = {}, set(), {}
    for source in sources:
        if not isinstance(source, dict):
            _issue(issues, "error", "invalid_source", "Source is not an object.")
            continue
        sid, bid = source.get("id"), str(source.get("book_id", ""))
        if not isinstance(sid, str) or not re.fullmatch(r"S[1-9]\d*", sid):
            _issue(issues, "error", "invalid_source_id", "A source ID is malformed.")
            continue
        if sid in by_id:
            _issue(issues, "error", "duplicate_source_id",
                   f"Source ID {sid} is duplicated.")
        by_id[sid] = source
        if not re.fullmatch(r"[1-9]\d*", bid):
            _issue(issues, "error", "invalid_book_id",
                   f"Source {sid} has no numeric catalog book ID.")
        seen_books.add(bid)
        pages = source.get("pages")
        if (not isinstance(pages, list) or not pages
                or not all(isinstance(p, int) and p >= 1 for p in pages)
                or len(set(pages)) != len(pages)):
            _issue(issues, "error", "invalid_pages",
                   f"Source {sid} has missing or invalid physical PDF pages.")
            pages = []
        primary = source.get("url", "")
        matched = DRIVE_ID.fullmatch(primary) if isinstance(primary, str) else None
        if matched is None:
            _issue(issues, "error", "invalid_pdf_link",
                   f"Source {sid} has no verified Google Drive PDF URL.")
        else:
            pdf_id = matched.group(1)
            if matched.group(2) and pages and int(matched.group(2)) != pages[0]:
                _issue(issues, "error", "wrong_page_link",
                       f"Source {sid}'s link points at another PDF page.")
            previous = book_pdf_ids.setdefault(bid, pdf_id)
            if previous != pdf_id:
                _issue(issues, "error", "book_pdf_conflict",
                       f"Book {bid} points to multiple PDFs in one answer.")
        if (not isinstance(source.get("title"), str) or not source["title"]
                or not isinstance(source.get("excerpt"), str)
                or not source["excerpt"].strip()):
            _issue(issues, "error", "missing_passage",
                   f"Source {sid} is missing its title or original excerpt.")
        page_urls = source.get("page_urls", [])
        if page_urls and isinstance(page_urls, list):
            entries = [p for p in page_urls if isinstance(p, dict)]
            if len(entries) != len(pages):
                _issue(issues, "error", "page_link_count",
                       f"Source {sid} has inconsistent page links.")
            for index, item in enumerate(entries):
                link = DRIVE_ID.fullmatch(str(item.get("url", "")))
                expected_page = pages[index] if index < len(pages) else None
                if (not link or not matched
                        or link.group(1) != matched.group(1)
                        or item.get("page") != expected_page
                        or link.group(2) is None
                        or int(link.group(2)) != expected_page):
                    _issue(issues, "error", "page_link_mismatch",
                           f"Source {sid}'s additional page URL is inconsistent.")
                    break

    markers = set(CITATION.findall(answer))
    unknown = markers - set(by_id)
    if unknown:
        _issue(issues, "error", "unknown_answer_citations",
               "Answer references unprovided source IDs: " + ", ".join(sorted(unknown)))
    if not sources:
        _issue(issues, "error", "no_cited_sources",
               "No sources were supplied for the answer.")
    elif not markers:
        _issue(issues, "warning", "uncited_answer",
               "The returned answer has no inline source markers.")

    expectation = case.get("source_expectation", {})
    if expectation.get("mode") == "only":
        expected = set(expectation["book_ids"])
        if seen_books - expected:
            _issue(issues, "error", "wrong_book",
                   "Single-book answer cited another book: " + ", ".join(sorted(seen_books - expected)))
        if not seen_books.intersection(expected):
            _issue(issues, "error", "expected_book_absent",
                   "Answer did not cite the assigned book.")
    if expectation.get("mode") == "groups":
        for group in expectation["groups"]:
            if not seen_books.intersection(group["book_ids"]):
                _issue(issues, "error", "missing_author_evidence",
                       "No cited source from " + group["label"] + ".")
    trace = result.get("diagnostics") or {}
    calls = trace.get("provider_calls")
    if calls is not None:
        if not isinstance(calls, list):
            _issue(issues, "error", "invalid_call_trace",
                   "Model-call trace must be an array.")
        elif len(calls) > 2:
            _issue(issues, "error", "extra_model_calls",
                   f"Answer used {len(calls)} Ollama calls rather than at most 2.")
        elif result.get("outcome") == "draft" and len(calls) != 2:
            _issue(issues, "warning", "unexpected_call_count",
                   f"Draft shows {len(calls)} model calls.")
    if result.get("outcome") != "draft":
        _issue(issues, "warning", "not_cited_draft",
               "The assistant did not return a successfully bound cited draft.")

    return {
        "provenance_pass": not any(i["level"] == "error" for i in issues),
        "issues": issues,
        "source_count": len(sources),
        "cited_source_ids": sorted(markers),
        "source_book_ids": sorted(seen_books),
        "provider_call_count": len(calls) if isinstance(calls, list) else None,
        "human_interpretation_checked": False,
    }


def empty_review():
    """Explicitly separate manual judgments from automatic source checks."""
    return {
        "scores_0_to_3": {dimension: None for dimension in SCORE_DIMENSIONS},
        "notes": "",
        "reviewed": False,
    }
