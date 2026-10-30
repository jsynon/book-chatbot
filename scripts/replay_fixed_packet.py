#!/usr/bin/env python3
"""Replay one saved live answer packet through the local composer, offline.

This diagnostic validates each page against the pinned local corpus, reuses
only the Worker composition windows recorded in its authenticated trace, and
makes exactly one Ollama writing call. It does not retrieve, select, review,
or contact Cloudflare. Keep input artifacts and output reports private.
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
LIVE_MAX_SOURCES = 6
LIVE_MAX_SOURCE_BYTES = 35_000


class ReplayError(ValueError):
    """A saved trace or local corpus cannot support a trustworthy replay."""


class FixedPacketIndex:
    """Minimal index contract for answer_evidence_first with no search method."""

    def __init__(self, passages, tokenize):
        # Use canonical book/page order for context grouping while preserving
        # Worker packet order in the separate selected evidence list.
        self.passages = sorted(
            passages, key=lambda p: (str(p["book_id"]), min(p["pages"]), p["source_id"])
        )
        self.tokenize = tokenize
        self.is_cross_library = len({str(p["book_id"]) for p in passages}) > 1
        self.discovery = {"required_author_groups": []}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def find_case(report, case_id):
    cases = report.get("cases") if isinstance(report, dict) else None
    if not isinstance(cases, list):
        raise ReplayError("Artifact must contain a cases array.")
    matches = [case for case in cases if isinstance(case, dict) and case.get("id") == case_id]
    if len(matches) != 1:
        raise ReplayError(f"Expected exactly one case with id {case_id!r}.")
    return matches[0]


def composition_payload(trace):
    stages = trace.get("stages") if isinstance(trace, dict) else None
    stage = next((item for item in stages or []
                  if isinstance(item, dict) and item.get("stage") == "compose"), None)
    messages = stage.get("messages") if stage else None
    if not isinstance(messages, list) or len(messages) < 2:
        raise ReplayError("The saved trace has no exact Worker composition request.")
    content = messages[1].get("content") if isinstance(messages[1], dict) else None
    if not isinstance(content, str):
        raise ReplayError("The Worker composition request is not serialized JSON.")
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise ReplayError("The Worker composition request is malformed.") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("evidence"), list):
        raise ReplayError("The Worker composition request has no evidence pages.")
    response = stage.get("response") if stage else None
    choices = response.get("choices") if isinstance(response, dict) else None
    message = choices[0].get("message") if isinstance(choices, list) and choices else None
    draft = message.get("content") if isinstance(message, dict) else None
    return payload, draft if isinstance(draft, str) else None


def load_raw_page(library_root: Path, version: str, book_id: str,
                  global_page_id: int, page_number: int) -> str:
    if not book_id.isdigit() or not isinstance(global_page_id, int) or global_page_id < 0:
        raise ReplayError("The trace contains an invalid book or global page ID.")
    path = library_root / f"data-{version}" / f"book-{book_id}.json.gz"
    if not path.is_file():
        raise ReplayError(f"Missing local corpus file for book {book_id}: {path}")
    try:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            shard = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise ReplayError(f"Could not read local v49 book data for {book_id}.") from error
    pages = [item for item in shard.get("pages", [])
             if str(item.get("id")) == str(global_page_id)
             and item.get("page") == page_number]
    if len(pages) != 1 or not isinstance(pages[0].get("text"), str):
        raise ReplayError(
            f"Local corpus does not contain one matching page {book_id}:{page_number}."
        )
    return pages[0]["text"]


def worker_evidence_by_id(trace):
    evidence = trace.get("evidence") if isinstance(trace, dict) else None
    if not isinstance(evidence, list) or not evidence:
        raise ReplayError("The saved answer trace does not contain verified page evidence.")
    result = {}
    for page in evidence:
        if not isinstance(page, dict):
            raise ReplayError("The saved evidence trace contains a malformed page.")
        source_id = page.get("id")
        if not isinstance(source_id, str) or not SOURCE_ID.fullmatch(source_id) or source_id in result:
            raise ReplayError("The saved evidence trace has invalid or duplicate source IDs.")
        if page.get("libraryVersion") != 49:
            raise ReplayError("This replay supports only Worker-verified library v49 pages.")
        digest = page.get("sha256")
        if not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise ReplayError(f"{source_id} has no valid canonical page fingerprint.")
        result[source_id] = page
    if len(result) > LIVE_MAX_SOURCES:
        raise ReplayError("The live trace contains more than six submitted pages.")
    return result


def prepare_packet(payload, trace, library_root, version, catalog):
    from passage_quality import source_form

    pages_by_id = worker_evidence_by_id(trace)
    evidence_rows = payload["evidence"]
    if not 1 <= len(evidence_rows) <= LIVE_MAX_SOURCES:
        raise ReplayError("The Worker composition packet must have one to six pages.")
    passages = []
    source_audit = []
    seen = set()
    total_bytes = 0

    for row in evidence_rows:
        if not isinstance(row, dict):
            raise ReplayError("The Worker composition packet has a malformed evidence row.")
        source_id = row.get("id")
        if source_id not in pages_by_id or source_id in seen:
            raise ReplayError("The Worker composition packet references an unknown page.")
        seen.add(source_id)
        source = pages_by_id[source_id]
        book_id = str(source.get("bookId", ""))
        page_number = source.get("page")
        global_page_id = source.get("globalPageId")
        if (str(row.get("bookId", "")) != book_id
                or row.get("page") != page_number):
            raise ReplayError(f"Composition row {source_id} does not match its verified page identity.")
        raw_text = load_raw_page(
            library_root, version, book_id, global_page_id, page_number
        )
        local_digest = sha256_text(raw_text)
        if local_digest != source["sha256"]:
            raise ReplayError(
                f"Local corpus text for {source_id} does not match the Worker's v49 fingerprint."
            )

        windows = row.get("passages")
        if isinstance(windows, list):
            texts = [window.get("text") for window in windows
                     if isinstance(window, dict) and isinstance(window.get("text"), str)
                     and window["text"].strip()]
            replay_text = "\n\n".join(texts)
            # Confirm each exact model window belongs to the authenticated
            # page context, including a narrower scopeText when the Worker used one.
            verified_context = source.get("scopeText") or source.get("text")
            if not isinstance(verified_context, str) or any(
                    window not in verified_context for window in texts):
                raise ReplayError(f"Composition windows for {source_id} do not match its trace page text.")
        else:
            replay_text = row.get("text") if isinstance(row.get("text"), str) else ""
        if not replay_text.strip():
            raise ReplayError(f"The Worker composition packet has no text for {source_id}.")
        page_bytes = len(replay_text.encode("utf-8"))
        if page_bytes > LIVE_MAX_SOURCE_BYTES:
            raise ReplayError(f"Worker composition evidence {source_id} exceeds the source limit.")
        total_bytes += page_bytes

        metadata = catalog.get(book_id)
        if not metadata:
            raise ReplayError(f"Book {book_id} is missing from the local library catalog.")
        passage_id = hashlib.sha256(
            f"{book_id}\0{version}\0{page_number}\0{source_id}\0{replay_text}".encode("utf-8")
        ).hexdigest()[:24]
        form = source_form(replay_text)
        passages.append({
            **metadata,
            "title": str(source.get("title") or metadata.get("title") or ""),
            "book_id": book_id,
            "corpus_version": version,
            "pages": [page_number],
            "page": page_number,
            "source_id": source_id,
            "passage_id": passage_id,
            "text": replay_text,
            "source_form_kind": form["kind"],
        })
        source_audit.append({
            "source_id": source_id,
            "book_id": book_id,
            "title": str(source.get("title") or metadata.get("title") or "")[:200],
            "catalogTitle": str(metadata.get("title") or "")[:200],
            "titleMatchesCatalog": str(source.get("title") or "").strip() == str(metadata.get("title") or "").strip(),
            "page": page_number,
            "global_page_id": global_page_id,
            "canonical_page_sha256": local_digest,
            "replay_window_sha256": sha256_text(replay_text),
            "worker_window_count": len(windows) if isinstance(windows, list) else 1,
            "replay_characters": len(replay_text),
            "replay_utf8_bytes": page_bytes,
        })
    if total_bytes > LIVE_MAX_SOURCE_BYTES:
        raise ReplayError("The fixed replay packet exceeds the live total source byte limit.")
    return passages, source_audit, total_bytes


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Run the local composer once on exact evidence from a saved Worker trace."
    )
    parser.add_argument("artifact", type=Path, help="Extracted live evaluation JSON artifact")
    parser.add_argument("--case-id", required=True, help="Exact case ID from the artifact")
    parser.add_argument("--output", required=True, type=Path,
                        help="Private output JSON path outside the public repository")
    parser.add_argument("--library-data", type=Path,
                        default=Path(os.environ.get(
                            "BOOK_CHATBOT_LIBRARY_DATA",
                            str(ROOT.parent / "antilogicalism-library-data"))))
    parser.add_argument("--catalog", type=Path,
                        default=Path(os.environ.get(
                            "BOOK_CHATBOT_CATALOG",
                            str(ROOT.parent / "antilogicalism" / "digital-library"
                                / "library-catalog.json"))))
    parser.add_argument("--corpus-version", default="v49")
    parser.add_argument("--model", default=os.environ.get("OLLAMA_MODEL", "gemma3:12b"))
    parser.add_argument("--ollama-url", default=os.environ.get(
        "OLLAMA_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--context-tokens", type=int, default=int(
        os.environ.get("BOOK_CHATBOT_CONTEXT_TOKENS", "8192")))
    args = parser.parse_args(argv)

    artifact_path = args.artifact.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    if args.corpus_version != "v49":
        raise ReplayError("The live artifact comparison is pinned to corpus v49.")
    if not artifact_path.is_file():
        raise ReplayError(f"Artifact JSON was not found: {artifact_path}")
    if output_path == ROOT or ROOT in output_path.parents:
        raise ReplayError("Write the replay report outside the public repository.")
    if args.context_tokens < 1024:
        raise ReplayError("Ollama context must be at least 1024 tokens.")

    with artifact_path.open("r", encoding="utf-8") as stream:
        report = json.load(stream)
    case = find_case(report, args.case_id)
    trace = case.get("evidenceTrace")
    if not isinstance(trace, dict):
        raise ReplayError("The selected case has no saved authenticated Worker evidence trace.")
    question = case.get("question")
    if not isinstance(question, str) or not question.strip():
        raise ReplayError("The selected case has no question.")
    payload, worker_draft = composition_payload(trace)

    os.environ["BOOK_CHATBOT_DATA_VERSION"] = "v49"
    os.environ["BOOK_CHATBOT_LIBRARY_DATA"] = str(args.library_data.expanduser().resolve())
    sys.path.insert(0, str(ROOT))
    import app
    from evidence_pipeline import answer_evidence_first
    from inference import OllamaProvider
    from library_catalog import read_catalog

    fallback_source = next(iter(trace.get("evidence", [])), {})
    fallback_book = {
        "book_id": str(fallback_source.get("bookId", "")),
        "title": str(fallback_source.get("title", "")),
        "pdf_file_id": None,
    }
    catalog_data = read_catalog(args.catalog.expanduser(), fallback_book)
    passages, source_audit, total_bytes = prepare_packet(
        payload, trace, args.library_data.expanduser().resolve(),
        args.corpus_version, catalog_data
    )
    index = FixedPacketIndex(passages, app.tokenize)
    provider = OllamaProvider(args.ollama_url, args.model, args.context_tokens)

    started = time.perf_counter()
    result = answer_evidence_first(
        question, [], index, [part.get("question", question)
        for part in payload.get("parts", []) if isinstance(part, dict)]
        or [question], provider, "fixed-packet-replay-v1",
        fixed_evidence=passages,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    final_trace = trace.get("final") if isinstance(trace.get("final"), dict) else {}
    output = {
        "schema": "reading-companion-fixed-packet-replay-v1",
        "caseId": args.case_id,
        "question": question,
        "corpusVersion": "v49",
        "packet": {
            "sourceCount": len(source_audit),
            "utf8Bytes": total_bytes,
            "sources": source_audit,
            "verifiedAgainstLocalCorpus": True,
            "sha256": sha256_text(json.dumps(
                [(row["source_id"], row["book_id"], row["page"],
                  row["replay_window_sha256"]) for row in source_audit],
                ensure_ascii=False, separators=(",", ":")
            )),
        },
        "worker": {
            "compositionDraft": worker_draft,
            "finalReviewedAnswer": final_trace.get("answer") or case.get("answerText") or "",
            "reviewStatus": case.get("reviewStatus") or "",
            "note": "The Worker composition used passage windows from these pages; the local composer receives those same window texts joined per page.",
        },
        "local": {
            "model": args.model,
            "contextTokens": args.context_tokens,
            "build": "fixed-packet-replay-v1",
            "answer": result.get("answer", ""),
            "outcome": result.get("outcome", ""),
            "followUpQuestions": result.get("follow_up_questions", []),
            "elapsedMs": elapsed_ms,
            "providerCalls": getattr(provider, "calls", []),
            "quotationPrecision": result.get("diagnostics", {}).get(
                "evidence_check", {}).get("quotation_precision", {}),
        },
        "comparisonLimit": (
            "Question and cited page identities are held fixed. The Worker and local "
            "composer prompts, models, output validation, and review stages differ; "
            "this is a controlled diagnostic, not a production parity score."
        ),
        "externalNetworkCalls": 0,
        "cloudflareCalls": 0,
        "localOllamaRequests": 1,
        "modelCalls": len(provider.calls),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"Saved one-call local replay for {args.case_id} to {output_path}")
    print(f"Evidence: {len(source_audit)} pages, {total_bytes} UTF-8 bytes; "
          f"verified against local v49. Ollama calls: {len(provider.calls)}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReplayError as error:
        print(f"Replay refused: {error}", file=sys.stderr)
        raise SystemExit(2)
