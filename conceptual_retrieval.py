"""Two-call conceptual retrieval for genuinely hypothetical author comparisons.

Ordinary questions still use the evidence-first selector + synthesis.
For questions like "What would A think about B's philosophy?" the literal
index query has no real philosophical subject (often only 'thought'). In
that case the FIRST of the existing two inference calls constructs SEARCH
HINTS for EACH *catalog-verified* author, not quotations or historical facts.
The second call composes from actual v47 primary-source passages.

Model topic suggestions are NEVER treated as evidence; only indexed passages
can be cited. Failure or invalid output uses bounded lexical retrieval and
deterministic source selection (still at most two inference calls).
"""
import re
import time

from grounded_pipeline import object_schema
from inference import CompletionError
from retrieval_relevance import (
    content_terms, named_author_groups, WORDS, QUESTION_FRAMING
)

MAX_AUTHOR_TOPICS = 5
MAX_AUTHORS = 4


def needs_concept_plan(question, catalog_entries):
    """Choose a genuinely counterfactual or hypothetical cross-author task.

    Avoid routing ordinary "compare A and B on happiness" queries through an
    LLM planner: those already have an explicit topic and a well-tested source
    selector. Never infer authors from the planner.
    """
    groups = named_author_groups(question, catalog_entries)
    if not 2 <= len(groups) <= MAX_AUTHORS:
        return []
    q = " ".join(WORDS.findall(question.casefold()))
    hypothetical = bool(re.search(
        r"\b(?:what|how|why)\s+(?:might|would|could)\b"
        r"|\b(?:would|might|could)\s+[\w\s]{1,65}\b"
        r"(?:say|think|respond|criticize|criticise|evaluate|regard|view)\b",
        q,
    ))
    return groups if hypothetical else []


def _validated_topic_words(items, tokenize, author_groups):
    """Sanitize planning HINTS into ordinary v47 index terms, nothing more."""
    if not isinstance(items, list) or len(items) > 10:
        return []
    terms = []
    excluded = {
        w for group in author_groups for w in WORDS.findall(group["author"])
    }
    for phrase in items:
        if not isinstance(phrase, str) or len(phrase) > 70:
            continue
        for word in content_terms(phrase, tokenize, author_groups, limit=8):
            if (word not in terms and word not in excluded
                    and word not in QUESTION_FRAMING
                    and len(word) >= 4):
                terms.append(word)
                if len(terms) >= MAX_AUTHOR_TOPICS:
                    return terms
    return terms


def conceptual_search_plan(question, groups, tokenize, provider):
    """Spend exactly ONE model call on author-specific thematic retrieval.

    All names are taken from catalog matches. The model only supplies search
    terms. No generated statement, quotation, or supposed historical
    encounter goes into the answer or citation fields.
    """
    if not 2 <= len(groups) <= MAX_AUTHORS:
        raise ValueError("Conceptual comparison needs 2-4 named catalog authors")
    fields = {}
    for i in range(len(groups)):
        fields[f"author_{i+1}_topics"] = {
            "type": "array", "minItems": 2, "maxItems": MAX_AUTHOR_TOPICS,
            "items": {"type": "string", "minLength": 3, "maxLength": 70},
        }
    schema = object_schema(fields)
    authors = "\n".join(
        f"{i+1}. {group['author']}" for i, group in enumerate(groups)
    )
    system = (
        "You are preparing a RETRIEVAL PLAN for a library of primary sources, "
        "NOT writing an answer. A reader asks a counterfactual comparison of "
        "named authors without clearly specifying a topic. For EACH named "
        "author, choose 2-5 DISTINCT, precise topical search expressions "
        "likely to identify passages about central relevant philosophical "
        "positions in that author's own writings. Use ordinary searchable "
        "English words, preferably one word per item, and avoid broad filler "
        "like 'thought', 'thinking', 'author', 'life', 'idea', or 'philosophy'. "
        "Think about opposing positions, e.g. themes an author might defend "
        "versus criticize. Do not invent a documented meeting, quotation, "
        "book passage, page number, or assertion of what one author actually "
        "said about another. Hints do not establish truth. "
        "Return ONLY the specified JSON arrays, corresponding EXACTLY to "
        "the numbered authors and without additional keys."
    )
    user = (
        "Reader question:\n" + question +
        "\n\nVerified catalog author names:\n" + authors +
        "\n\nProvide distinct concept search terms for each writer. "
        "Historical counterfactual conclusions can be drawn only after "
        "reading actual retrieved source text."
    )
    start = time.perf_counter()
    report = {
        "stage": "conceptual_retrieval_plan",
        "status": "not_started",
        "author_groups": [
            {"author": g["author"], "book_count": len(g["book_ids"])}
            for g in groups
        ],
    }
    try:
        result = provider.complete(
            "conceptual_retrieval_plan", system, user, schema, 240
        )
        if not isinstance(result, dict):
            raise CompletionError("Retrieval plan must be a JSON object")
        topics = {}
        for position, group in enumerate(groups):
            field = f"author_{position + 1}_topics"
            values = result.get(field)
            if not isinstance(values, list) or not 2 <= len(values) <= MAX_AUTHOR_TOPICS:
                raise CompletionError("Each author needs 2-5 topical search hints")
            normalized = _validated_topic_words(values, tokenize, groups)
            if len(normalized) < 2:
                raise CompletionError("Conceptual search hints lacked usable indexed words")
            topics[group["author"]] = normalized
        report.update(status="complete", author_topics=topics)
        return {"author_topics": topics}, report
    except CompletionError as exc:
        report.update(status="invalid_plan", reason=str(exc))
        return None, report
    finally:
        report["elapsed_ms"] = round((time.perf_counter() - start) * 1000)
