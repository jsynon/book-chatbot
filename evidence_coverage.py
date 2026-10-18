"""Bounded *post-selector* evidence-gap retrieval, without extra model calls.

The first model call may identify a missing part of the reader's question and
supply up to two SEARCH PHRASES. Those phrases are untrusted suggestions,
NEVER source claims. This module checks them against the existing local book
index and admits only actual passages, with their original PDF provenance.

No writer-, era-, genre-, or benchmark-specific topic dictionaries are used.
Selected passages keep stable source IDs. The same open book index and the
same six-core-passage / evidence-character budgets are reused.
"""
import re

from passage_quality import source_form
from retrieval_relevance import passage_topic_score

MAX_GAP_QUERIES = 2
MAX_ADDED_ANCHORS = 2
MAX_GAP_CANDIDATES = 8

# These are ordinary English request instructions, not topical book terms.
_FRAMING = {
    "what", "how", "why", "when", "where", "who", "which", "explain",
    "summarize", "describe", "compare", "contrast", "author", "writer",
    "question", "book", "chapter", "passage", "text", "source", "quote",
    "think", "thought", "meaning", "answer",
}


def validated_gap_queries(raw, tokenize):
    """Normalize bounded lexical hints without treating them as authority."""
    if not isinstance(raw, list) or len(raw) > 4:
        return []
    kept = []
    for raw_phrase in raw:
        if (not isinstance(raw_phrase, str)
                or not 4 <= len(raw_phrase) <= 90
                or "\n" in raw_phrase or "\r" in raw_phrase
                or not re.fullmatch(r"[\w\s'’\-/.,]+", raw_phrase, re.UNICODE)):
            continue
        terms = list(dict.fromkeys(tokenize(raw_phrase)))
        terms = [term for term in terms
                 if len(term) >= 4 and term not in _FRAMING]
        if not 1 <= len(terms) <= 6:
            continue
        phrase = " ".join(terms)
        if phrase not in kept:
            kept.append(phrase)
        if len(kept) >= MAX_GAP_QUERIES:
            break
    return kept


def recover_gap_evidence(index, original_candidates, anchors, raw_queries,
                         *, max_primary=6):
    """Return (augmented candidates, augmented anchors, audit).

    Only model mode should call this: the hypothetical cross-author planner
    has already spent call one, so no separate evidence selector exists.
    A query returns at most one strongest NEW source to avoid overriding the
    model's decisive argument with unrelated source tangents. At most the
    lowest-priority selected anchors are replaced. Never load a new book.
    """
    queries = validated_gap_queries(raw_queries, index.tokenize)
    audit = {
        "queries": queries, "searched": 0, "admitted": [],
        "replaced_source_ids": [], "reason": "no_gap_queries",
    }
    candidates = list(original_candidates)
    selected = list(anchors)
    if not queries or not selected:
        return candidates, selected, audit

    by_passage = {p["passage_id"]: p for p in candidates}
    primary_passages = {p["passage_id"] for p in selected}
    next_number = max(
        (int(p["source_id"][1:]) for p in candidates
         if re.fullmatch(r"S[1-9]\d*", p.get("source_id", ""))),
        default=0
    ) + 1
    gap_hits = []
    for query in queries:
        hints = query.split()
        results = index.search(query, [query], limit=MAX_GAP_CANDIDATES)
        audit["searched"] += len(results)
        scored = []
        for result in results:
            if source_form(result["text"])["kind"] != "prose":
                continue
            score, coverage = passage_topic_score(
                result["text"], hints, index.tokenize
            )
            # A multiword suggestion must actually cover multiple terms;
            # a generic mention of one word is not evidence of the topic.
            if coverage < min(2, len(hints)):
                continue
            if result["passage_id"] in primary_passages:
                continue
            scored.append((score, coverage, result))
        scored.sort(key=lambda item: (-item[0], -item[1]))
        if scored:
            winner = scored[0][2]
            if winner["passage_id"] not in {
                hit["passage_id"] for _, hit in gap_hits
            }:
                gap_hits.append((query, winner))
        if len(gap_hits) >= MAX_ADDED_ANCHORS:
            break

    if not gap_hits:
        audit["reason"] = "no_matching_original_prose"
        return candidates, selected, audit

    for query, hit in gap_hits:
        original = by_passage.get(hit["passage_id"])
        if original is None:
            original = {**hit, "source_id": f"S{next_number}"}
            next_number += 1
            by_passage[hit["passage_id"]] = original
            candidates.append(original)
        # Retain first / most decisive selected sources. If selected was
        # already full, drop from the bottom. Author coverage must be applied
        # after this step, so an author cannot disappear without notice.
        if len(selected) >= max_primary:
            replaced = selected.pop()
            audit["replaced_source_ids"].append(replaced["source_id"])
        selected.append(original)
        primary_passages.add(hit["passage_id"])
        audit["admitted"].append({
            "source_id": original["source_id"], "book_id": original["book_id"],
            "pages": original["pages"], "query": query,
            "origin": "actual_indexed_source",
        })
    audit["reason"] = "original_evidence_added"
    return candidates, selected, audit
