"""Deterministic question-part coverage for the final v1.4 quality milestone.

This is a SMALL, BOUNDED retrieval step between the original first and
second Ollama calls, never another model, embedding index or book-specific
answer rule. It takes the reader's EXISTING question parts, tests whether the
selected ORIGINAL passages contain evidence for each part, and can reserve at
most one better matching indexed passage per missing part. It does not infer
source meaning, identify speakers, manufacture a claim or certify an answer.

This module deliberately does not expand abstract subjects into named people
or episodes. If the original question does not identify a historical dispute,
lexical retrieval may still be insufficient; the trace records the limitation.
"""
import math
import re

from passage_quality import source_kind, source_form

MAX_EXTRA_FACETS = 2
MAX_FACET_RESULTS = 60
MIN_EVIDENCE_WORDS = 24

# General language describing the reader's request, not the book's topic.
# These terms are removed only for candidate evidence matching.
_REQUEST_WORDS = frozenset("""
according tell said explain describe compare differ difference
question book source text passage part work writer author
what which where how why who when does did would could should
approach relation role example discussion answer
""".split())


def _terms(facet, tokenize):
    return list(dict.fromkeys(
        t for t in tokenize(facet)
        if t not in _REQUEST_WORDS and len(t) >= 3
    ))


def _alignment(text, terms, distinctive, index):
    """Score ORIGINAL topical word overlap, not semantic entailment."""
    if not terms:
        return 0.0, 0, False
    actual = set(index.tokenize(text))
    relevant = set(terms) & actual
    distinct = bool(set(distinctive) & relevant)
    if not relevant:
        return 0.0, 0, distinct
    count = len(index.passages)
    # Rare subject terms are better discriminators than ordinary "cause".
    weights = {
        t: max(0.45, math.log1p(
            (count + 1) / (len(index.postings.get(t, {})) + 1)
        ))
        for t in terms
    }
    total = sum(weights.values())
    covered = sum(weights[t] for t in relevant)
    return round(covered / max(total, 1), 5), len(relevant), distinct


def reserve_question_parts(index, facets, candidates, anchors,
                           *, max_primary=6, max_additions=MAX_EXTRA_FACETS):
    """Return candidate, anchor and audit records from ONLY local originals.

    Candidates have stable source IDs, and a genuinely new result is allocated
    a fresh S-number above all existing IDs. Existing first-ranked model
    passages get priority, except the last slots can be exchanged for much
    stronger coverage of question parts it overlooked. Each added source has
    real physical pages and its inherited original PDF identity.
    """
    candidates = list(candidates)
    anchors = list(anchors)
    audit = {
        "status": "single_part_or_no_evidence",
        "parts": [], "added": [], "replaced_source_ids": [],
        "model_calls_added": 0,
    }
    if len(facets) < 2 or not anchors or not index.passages:
        return candidates, anchors, audit

    normalized = [_terms(part, index.tokenize) for part in facets[:4]]
    if len({tuple(t) for t in normalized}) < 2:
        audit["status"] = "no_distinct_parts"
        return candidates, anchors, audit

    all_tokens = [set(ts) for ts in normalized]
    existing = {p["passage_id"]: p for p in candidates}
    anchors_by_passage = {p["passage_id"] for p in anchors}
    source_ids = {
        p["source_id"] for p in candidates
        if isinstance(p.get("source_id"), str)
    }
    next_id = max(
        [int(s[1:]) for s in source_ids if re.fullmatch(r"S[1-9]\d*", s)]
        or [0]
    ) + 1
    suggested = []

    for part, terms, siblings in zip(facets[:4], normalized, all_tokens):
        if not terms:
            audit["parts"].append({
                "part": part, "status": "no_retrievable_terms"
            })
            continue
        other = set().union(*(t for t in all_tokens if t is not siblings))
        distinctive = [t for t in terms if t not in other]
        # For two explanatory clauses sharing subject terms, the second
        # clause's rarer unique terms are the best way to avoid returning
        # the same summary passage twice.
        def eligible(p):
            if source_kind(p) != "prose":
                return False
            if source_form(p["text"])["word_count"] < MIN_EVIDENCE_WORDS:
                return False
            return True

        def rate(p):
            score, matched, distinct = _alignment(
                p["text"], terms, distinctive, index
            )
            if (matched < min(2, len(terms))
                    or (distinctive and not distinct)):
                return 0.0
            return score

        before = max(((rate(p), p) for p in anchors if eligible(p)),
                     key=lambda x: x[0], default=(0, None))
        # Search at most sixty rank-ordered original passage indexes. This
        # does not download additional books, walk the full 644-book corpus,
        # or call another LLM.
        matched = index.rank(part)[:MAX_FACET_RESULTS]
        best = (0.0, None)
        for pos in matched:
            p = index.passages[pos]
            if not eligible(p):
                continue
            score = rate(p)
            if score > best[0]:
                best = (score, p)

        current_score, current = before
        best_score, best_passage = best
        record = {
            "part": part, "terms": terms,
            "distinctive_terms": distinctive[:8],
            "original_source_id": current["source_id"] if current else None,
            "selected_alignment": current_score,
            "best_index_alignment": best_score,
            "status": "sufficient" if current_score else "not_found",
        }
        # Don't add source snippets that merely share a generic vocabulary,
        # or duplicates of passages already selected for another part.
        better = (
            best_passage is not None
            and best_passage["passage_id"] not in anchors_by_passage
            and best_score >= 0.25
            and (current_score < 0.70 * best_score)
            and max_additions > 0
        )
        if better and not any(
            p["passage_id"] == best_passage["passage_id"]
            for _, p in suggested
        ):
            suggested.append((record, best_passage))
            record["status"] = "index_source_reserved"
            if len(suggested) >= max_additions:
                audit["parts"].append(record)
                break
        elif best_score > 0:
            record["status"] = "already_covered" if current_score else "weak_unselected"
        audit["parts"].append(record)

    if not suggested:
        audit["status"] = "already_covered_or_lexically_unresolved"
        return candidates, anchors, audit

    # Batch allocation: the second mandatory source must not evict the
    # first, and the existing four top model selections survive when full.
    keep = max(0, min(len(anchors), max_primary - len(suggested)))
    audit["replaced_source_ids"] = [p["source_id"] for p in anchors[keep:]]
    anchors = anchors[:keep]
    for record, passage in suggested:
        original = existing.get(passage["passage_id"])
        if original is None:
            original = {**passage, "source_id": f"S{next_id}"}
            next_id += 1
            candidates.append(original)
            existing[passage["passage_id"]] = original
        anchors.append(original)
        audit["added"].append({
            "part": record["part"], "source_id": original["source_id"],
            "book_id": original["book_id"], "pages": original["pages"],
            "original_indexed": True,
        })
    audit["status"] = "facet_passages_reserved"
    return candidates, anchors, audit


def final_part_coverage(index, facets, anchors):
    """Report lexical *evidence presence* without asserting claim support."""
    records = []
    for facet in facets[:4]:
        tokens = _terms(facet, index.tokenize)
        others = [
            _terms(other, index.tokenize)
            for other in facets[:4] if other != facet
        ]
        shared = set().union(*(set(o) for o in others)) if others else set()
        distinctive = [token for token in tokens if token not in shared]
        ranked = []
        for p in anchors:
            score, matched, specific = _alignment(
                p["text"], tokens, distinctive, index
            )
            if (matched >= min(2, len(tokens))
                    and (specific or not distinctive)):
                ranked.append((score, p["source_id"]))
        ranked.sort(reverse=True)
        records.append({
            "part": facet,
            "candidate_source_ids": [sid for _, sid in ranked[:3]],
            "lexical_evidence_present": bool(ranked),
            "claim_semantically_verified": False,
        })
    return records
