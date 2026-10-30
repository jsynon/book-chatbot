#!/usr/bin/env python3
"""Replay one saved live answer packet through the local composer, offline.

The command verifies v49 source identity, reuses the Worker's exact composition
windows, bypasses local retrieval/selection, and makes one local Ollama call.
It never calls Cloudflare. Keep input traces and output reports private.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = re.compile(r"^S[1-9][0-9]*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
MAX_SOURCES = 6
MAX_SOURCE_BYTES = 35_000


class ReplayError(ValueError):
    """The saved trace and local corpus cannot support a safe replay."""


class FixedPacketIndex:
    """Small index-shaped context for the existing composer; it cannot search."""

    def __init__(self, passages, tokenize):
        # Context grouping needs canonical book/page order; selected evidence
        # itself retains the Worker's original source order and citation IDs.
        self.passages = sorted(
            passages, key=lambda p: (str(p["book_id"]), min(p["pages"]), p["source_id"])
        )
        self.tokenize = tokenize
        self.is_cross_library = len({str(p["book_id"]) for p in passages}) > 1
        self.discovery = {"required_author_groups": []}


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_trace_packet(report, case):
    if report.get("reproducibility", {}).get("corpus", {}).get("libraryVersion") != 49:
        raise ReplayError("The artifact is not pinned to live library v49.")
    trace = case.get("evidenceTrace")
    submitted = case.get("submittedSources")
    if not isinstance(trace, dict) or not isinstance(submitted, list):
        raise ReplayError("The case lacks its authenticated evidence trace or submitted page IDs.")

    # The trace stores exact text and fingerprint; submittedSources supplies
    # globalPageId, which joins that evidence to the local corpus shard.
    submitted_by_page = {}
    for item in submitted:
        if not isinstance(item, dict):
            raise ReplayError("Malformed submitted source metadata.")
        key = (str(item.get("bookId", "")), item.get("page"))
        if (not key[0].isdigit() or not isinstance(key[1], int)
                or not isinstance(item.get("globalPageId"), int)
                or item["globalPageId"] < 0 or key in submitted_by_page):
            raise ReplayError("Submitted page IDs are missing or duplicated.")
        submitted_by_page[key] = item

    sources = {}
    for item in trace.get("evidence", []):
        if not isinstance(item, dict):
            raise ReplayError("Malformed Worker evidence trace.")
        source_id = item.get("id")
        key = (str(item.get("bookId", "")), item.get("page"))
        meta = submitted_by_page.get(key)
        if (not isinstance(source_id, str) or not SOURCE_ID.fullmatch(source_id)
                or source_id in sources or meta is None
                or not isinstance(item.get("sha256"), str)
                or not SHA256.fullmatch(item["sha256"])):
            raise ReplayError("Worker evidence cannot be joined to verified submitted pages.")
        sources[source_id] = {**item, "globalPageId": meta["globalPageId"]}
    if not sources or len(sources) > MAX_SOURCES or len(sources) != len(submitted_by_page):
        raise ReplayError("Worker evidence and submitted page lists do not match.")

    stage = next((s for s in trace.get("stages", [])
                  if isinstance(s, dict) and s.get("stage") == "compose"), None)
    messages = stage.get("messages") if stage else None
    if not isinstance(messages, list) or len(messages) < 2:
        raise ReplayError("The trace does not contain the Worker composition request.")
    try:
        payload = json.loads(messages[1]["content"])
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ReplayError("The Worker composition request is not valid JSON.") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("evidence"), list):
        raise ReplayError("The composition request contains no evidence pages.")

    response = stage.get("response", {})
    choices = response.get("choices", []) if isinstance(response, dict) else []
    message = choices[0].get("message", {}) if choices else {}
    draft = message.get("content") if isinstance(message, dict) else None
    return trace, sources, payload, draft if isinstance(draft, str) else None


def local_page(library_root, book_id, page_id, page_number):
    if not book_id.isdigit() or not isinstance(page_id, int) or page_id < 0:
        raise ReplayError("The trace contains an invalid book or global page ID.")
    path = library_root / "data-v49" / f"book-{book_id}.json.gz"
    try:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            shard = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise ReplayError(f"Could not read the local v49 shard for book {book_id}.") from error
    matches = [p for p in shard.get("pages", [])
               if str(p.get("id")) == str(page_id) and p.get("page") == page_number]
    if len(matches) != 1 or not isinstance(matches[0].get("text"), str):
        raise ReplayError(f"No unique local v49 page for {book_id}:{page_number}.")
    return matches[0]["text"]


def make_passages(payload, trace, sources, library_root, catalog):
    from passage_quality import source_form

    passages, audit, total_bytes, seen = [], [], 0, set()
    rows = payload["evidence"]
    if not 1 <= len(rows) <= MAX_SOURCES:
        raise ReplayError("The Worker composition packet must contain one to six pages.")
    for row in rows:
        if not isinstance(row, dict):
            raise ReplayError("Malformed Worker composition evidence.")
        source_id = row.get("id")
        source = sources.get(source_id)
        if (source is None or source_id in seen
                or str(row.get("bookId", "")) != str(source.get("bookId", ""))
                or row.get("page") != source.get("page")):
            raise ReplayError("A composition page does not match its verified source identity.")
        seen.add(source_id)
        book_id, page = str(source["bookId"]), source["page"]
        raw_text = local_page(library_root, book_id, source["globalPageId"], page)
        if digest(raw_text) != source["sha256"]:
            raise ReplayError(f"Local v49 text for {source_id} fails its Worker page fingerprint.")

        windows = row.get("passages")
        if isinstance(windows, list):
            texts = [w["text"] for w in windows if isinstance(w, dict)
                     and isinstance(w.get("text"), str) and w["text"].strip()]
            page_context = source.get("scopeText") or source.get("text")
            if not isinstance(page_context, str) or any(t not in page_context for t in texts):
                raise ReplayError(f"Composition windows for {source_id} do not match the trace page.")
            text = "\n\n".join(texts)
        else:
            text = row.get("text", "")
        if not isinstance(text, str) or not text.strip():
            raise ReplayError(f"The Worker composition packet has no text for {source_id}.")
        size = len(text.encode("utf-8"))
        total_bytes += size
        if size > MAX_SOURCE_BYTES:
            raise ReplayError(f"Evidence page {source_id} exceeds the live source byte limit.")

        book = catalog.get(book_id)
        if not book:
            raise ReplayError(f"Book {book_id} is missing from the local catalog.")
        form = source_form(text)
        passage_id = hashlib.sha256(
            f"{book_id}\0v49\0{page}\0{source_id}\0{text}".encode("utf-8")
        ).hexdigest()[:24]
        passages.append({
            **book, "title": str(source.get("title") or book["title"]),
            "book_id": book_id, "corpus_version": "v49", "page": page,
            "pages": [page], "source_id": source_id, "passage_id": passage_id,
            "text": text, "source_form_kind": form["kind"],
        })
        audit.append({
            "source_id": source_id, "book_id": book_id, "page": page,
            "global_page_id": source["globalPageId"],
            "canonical_page_sha256": digest(raw_text),
            "window_sha256": digest(text), "window_count": len(windows or []),
            "characters": len(text), "utf8_bytes": size,
        })
    if len(seen) != len(sources) or total_bytes > MAX_SOURCE_BYTES:
        raise ReplayError("The replay packet does not match the full live source set or byte budget.")
    return passages, audit, total_bytes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Replay one saved Worker packet through the local composer.")
    parser.add_argument("artifact", type=Path, help="Extracted live evaluation JSON")
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--output", required=True, type=Path, help="Private JSON path outside this repository")
    parser.add_argument("--library-data", type=Path, default=Path(os.environ.get(
        "BOOK_CHATBOT_LIBRARY_DATA", str(ROOT.parent / "antilogicalism-library-data"))))
    parser.add_argument("--catalog", type=Path, default=Path(os.environ.get(
        "BOOK_CHATBOT_CATALOG", str(ROOT.parent / "antilogicalism" /
                                      "digital-library" / "library-catalog.json"))))
    parser.add_argument("--model", default=os.environ.get("OLLAMA_MODEL", "gemma3:12b"))
    parser.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--context-tokens", type=int, default=int(
        os.environ.get("BOOK_CHATBOT_CONTEXT_TOKENS", "8192")))
    args = parser.parse_args(argv)

    artifact = args.artifact.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if not artifact.is_file():
        raise ReplayError(f"Artifact JSON not found: {artifact}")
    if output_path == ROOT or ROOT in output_path.parents:
        raise ReplayError("Write the replay report outside the public repository.")
    if args.context_tokens < 1024:
        raise ReplayError("Ollama context must be at least 1024 tokens.")
    try:
        report = json.loads(artifact.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ReplayError("Could not read the evaluation artifact JSON.") from error
    matches = [c for c in report.get("cases", [])
               if isinstance(c, dict) and c.get("id") == args.case_id]
    if len(matches) != 1:
        raise ReplayError(f"Expected exactly one artifact case named {args.case_id!r}.")
    case = matches[0]
    question = case.get("question")
    if not isinstance(question, str) or not question.strip():
        raise ReplayError("The case has no question.")

    trace, sources, payload, worker_draft = read_trace_packet(report, case)
    os.environ["BOOK_CHATBOT_DATA_VERSION"] = "v49"
    os.environ["BOOK_CHATBOT_LIBRARY_DATA"] = str(args.library_data.expanduser().resolve())
    sys.path.insert(0, str(ROOT))
    import app
    from evidence_pipeline import answer_evidence_first
    from inference import OllamaProvider
    from library_catalog import read_catalog

    first = next(iter(sources.values()))
    fallback = {"book_id": str(first["bookId"]), "title": str(first.get("title", "")),
                "pdf_file_id": None}
    catalog = read_catalog(args.catalog.expanduser(), fallback)
    passages, audit, byte_count = make_passages(
        payload, trace, sources, args.library_data.expanduser().resolve(), catalog
    )
    provider = OllamaProvider(args.ollama_url, args.model, args.context_tokens)
    index = FixedPacketIndex(passages, app.tokenize)
    started = time.perf_counter()
    result = answer_evidence_first(
        question, [], index,
        [p.get("question", question) for p in payload.get("parts", [])
         if isinstance(p, dict)] or [question],
        provider, "fixed-packet-replay-v1", fixed_evidence=passages,
    )
    final = trace.get("final", {})
    output = {
        "schema": "reading-companion-fixed-packet-replay-v1",
        "caseId": args.case_id, "question": question, "corpusVersion": "v49",
        "packet": {"sourceCount": len(audit), "utf8Bytes": byte_count,
                   "sources": audit, "sha256": digest(json.dumps(
                       [(x["source_id"], x["window_sha256"]) for x in audit],
                       ensure_ascii=False, separators=(",", ":")))},
        "worker": {"compositionDraft": worker_draft,
                   "finalReviewedAnswer": final.get("answer") or case.get("answerText", "")},
        "local": {"model": args.model, "contextTokens": args.context_tokens,
                  "answer": result.get("answer", ""), "outcome": result.get("outcome", ""),
                  "followUpQuestions": result.get("follow_up_questions", []),
                  "elapsedMs": round((time.perf_counter() - started) * 1000),
                  "providerCalls": provider.calls,
                  "quotationPrecision": result.get("diagnostics", {}).get(
                      "evidence_check", {}).get("quotation_precision", {})},
        "interpretation": "Same page IDs and exact Worker composition windows; models, prompts, plan context, and validation differ.",
        "cloudflareCalls": 0, "localOllamaRequests": len(provider.calls),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"Saved {args.case_id} replay to {output_path}; "
          f"{len(audit)} pages, {byte_count} UTF-8 bytes, {len(provider.calls)} local call(s).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReplayError as error:
        print(f"Replay refused: {error}", file=sys.stderr)
        raise SystemExit(2)
