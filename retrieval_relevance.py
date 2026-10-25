"""Query intent and authorship for bounded whole-library retrieval.

Keep *search instruction* separate from *search subject*. This is deliberately
deterministic and general-purpose: no book-specific rules, hidden background
model, paid embedding API, or new inference call. Subsequent stages still
rank actual source pages and passages, rather than matching only a keyword
list or pretending that these heuristics understand philosophy.
"""
import re
from collections import OrderedDict


WORDS = re.compile(r"[a-z0-9]+", re.I)

# These describe the act of asking/searching, not the subject to look up.
# All items are lower-case normalized by the project's shared tokenizer.
QUESTION_FRAMING = frozenset("""
author authors book books library libraries work works writing writings
passage passages text texts source sources page pages
question questions ask asking answer answers
explain explanation describe description
compare comparison contrasting contrast contrasts
different differences difference distinguish distinctions
understand understanding view views
approach approaches relate related relation relationship
discuss discussion explore exploration
think thinking philosopher philosophers
according tell show showing find
connection connections connect connects connected
said say says told
""".split())

# Attribution fields in edited anthologies are not people's names. In
# particular, "different authors" must never silently require the literal
# catalog byline "Various authors".
GENERIC_BYLINES = frozenset({
    "anonymous", "unknown", "various", "various author",
    "various authors", "multiple authors", "multiple author",
    "several authors", "assorted authors", "editor", "editors",
    "unattributed", "miscellaneous", "collective",
})


def canonical_author(byline):
    if not isinstance(byline, str):
        return ""
    # Keep the original author's name, not an editor buried in parentheses.
    left = re.split(r"\s*\(\s*(?:edited|translated|compiled|introduced)\b",
                    byline, maxsplit=1, flags=re.I)[0]
    value = " ".join(WORDS.findall(left.casefold()))
    if value in GENERIC_BYLINES or not value:
        return ""
    if value.startswith(("various author", "anonymous", "edited by")):
        return ""
    return value


def named_author_groups(question, entries):
    """Return recognized PEOPLE and all their catalog book IDs.

    A recognized surname must be unique among distinct authors in the local
    catalog. Only full name matches resolve a collision. Thus a generic
    byline, or a common ambiguous surname, cannot create bogus requirements.
    """
    q = " " + " ".join(WORDS.findall(question.casefold())) + " "
    authored = OrderedDict()
    for book in entries.values():
        key = canonical_author(book.get("author"))
        if key:
            authored.setdefault(key, set()).add(str(book["book_id"]))

    last_names = {}
    for key in authored:
        words = key.split()
        if len(words) > 1 and len(words[-1]) >= 4:
            last_names.setdefault(words[-1], set()).add(key)

    groups = []
    for author, ids in authored.items():
        is_named = " " + author + " " in q
        surname = author.split()[-1]
        if (not is_named and len(author.split()) > 1
                and surname in last_names
                and len(last_names[surname]) == 1):
            is_named = " " + surname + " " in q
        if is_named:
            groups.append({
                "author": author,
                "book_ids": sorted(ids, key=lambda x: int(x)),
            })
    return groups


def content_terms(question, tokenize, author_groups=(), limit=8):
    """Recover indexed literal content words without the query instructions.

    We retain the reader's actual words (not invented synonyms) because v48
    partitions store surface word forms. The same tokenizer as passage BM25
    decides whether a word is just a stop word; the query-framing filter then
    removes ordinary search directions. This supports unfamiliar subjects
    without maintaining a philosophy-specific keyword dictionary.
    """
    excluded_authors = {
        word for group in author_groups
        for word in WORDS.findall(group["author"])
    }
    tokens = []
    for word in WORDS.findall(question.lower()):
        if (len(word) < 3 or word in excluded_authors
                or not tokenize(word)):
            continue
        normalized = tokenize(word)[0]
        if (word in QUESTION_FRAMING
                or normalized in QUESTION_FRAMING
                or word in tokens):
            continue
        tokens.append(word)
    return tokens[:limit]


def passage_topic_score(text, topic_terms, tokenize):
    """Lightweight post-retrieval *relevance* check on real source prose.

    Reward coverage of multiple question concepts, then proximity of those
    concepts within the same original passage. This prevents a far-flung
    reference to 'life' plus a dictionary explanation of the word 'meaning'
    from outranking a passage that treats the two together. No semantic
    truth or authorial position is inferred.
    """
    if not topic_terms:
        return 0.0, 0
    topic = set(tokenize(" ".join(topic_terms)))
    if not topic:
        return 0.0, 0
    words = tokenize(text)
    where = {}
    for i, word in enumerate(words):
        if word in topic:
            where.setdefault(word, []).append(i)
    coverage = len(where)
    if not coverage:
        return 0.0, 0

    # Multi-term matches deserve more than many copies of one generic word.
    score = coverage / len(topic)
    if coverage > 1:
        events = sorted((index, word)
                        for word, positions in where.items()
                        for index in positions)
        counts = {}
        left, gap = 0, len(words)
        for right in range(len(events)):
            key = events[right][1]
            counts[key] = counts.get(key, 0) + 1
            while len(counts) == coverage:
                gap = min(gap, events[right][0] - events[left][0])
                name = events[left][1]
                counts[name] -= 1
                if counts[name] == 0:
                    del counts[name]
                left += 1
        score += .75 / (1 + gap / 7.0)
    return round(score, 5), coverage


def refers_to_previous_question(question, tokenize):
    """Keep conversation context only when a cross-library question needs it.

    A new, self-contained question should not inherit the last question's
    authors or conclusions. Conversely, 'How about Tolstoy?' and 'What does
    that mean?' are genuine follow-ups that need earlier context.
    """
    q = " ".join(WORDS.findall(question.lower()))
    if re.match(r"^(?:and |also |what about |how about |but |then )", q):
        return True
    if re.search(
        r"\b(?:earlier|previous|above|aforementioned|those|these|"
        r"this|that|they|them|their|same|it|its|he|she|his|her)\b",
        q
    ):
        return True
    # Very short elliptical queries generally lack a self-contained subject.
    return len(set(tokenize(question))) <= 2


# Collection titles are useful discovery aids but have a greater risk of
# mixing editorial introduction/commentary with an author's own prose.
# This is a general SOURCE-FORM distinction, not a score assigned to writers.
COLLECTION_TITLE = re.compile(
    r"\b(?:portable|anthology|collected|selected writings|"
    r"complete works|works of|the works|reader|edited by|compiled by)\b",
    re.I,
)


def is_edited_collection(title):
    """Return a cautious metadata signal, not a claim about source contents.

    The most relevant collected volume is still eligible if no standalone
    text has comparable passage matches; it is merely downweighted.
    """
    return bool(COLLECTION_TITLE.search(str(title or "")))
