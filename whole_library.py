"""Bounded cross-book retrieval from the existing Antilogicalism v47 search data.

No new text corpus or vector database is created. The already-published v47
manifest maps global page IDs to books, and terms-xx.json.gz stores sorted,
delta-encoded global page IDs. After matching a reader's terms, open ONLY
the top few compressed book shards and build a short-lived PassageIndex over
their best matching original pages and immediate page neighbors.

This module is independent of Ollama, so one selected-book and across-library
questions reuse the same evidence-first answer pipeline and source bindings.
The global manifest and at most a few term partitions are kept in memory,
NOT every passage in the library.
"""
from collections import Counter, OrderedDict, defaultdict
import gzip
import json
import math
from pathlib import Path
import re
import threading

from grounded_pipeline import PassageIndex
from library_catalog import DRIVE_FILE


MAX_TERMS = 8
MAX_BOOKS = 4
MAX_PAGES_PER_BOOK = 9
MATCH_PAGES_PER_BOOK = 5
PARTITION_CACHE_SIZE = 8
BROAD_RESULTS = 24

TERM_RE = re.compile(r"[a-z0-9]+")
QUESTION_FRAMING = {
    "explain", "compare", "comparison", "contrasts", "contrast",
    "different", "difference", "differences", "understand", "understanding",
    "describes", "describe", "view", "views", "approach", "approaches",
    "author", "authors", "book", "books", "work", "works",
    "philosopher", "philosophers", "think", "thinking", "discuss",
    "discussion", "according", "relationship", "relate", "related",
}


class LibrarySearchError(ValueError):
    """The full-text manifest, a partition or a required shard is unusable."""


class DiversePassageIndex(PassageIndex):
    """Preserve source diversity in the 24 passages offered to the selector."""

    def __init__(self, books, tokenize, continuation, chosen_books, discovery):
        super().__init__(books, tokenize, continuation)
        self.chosen_books = list(chosen_books)
        self.discovery = discovery
        # Automatically selected works are preferred, but not every author
        # mentioned in a question is necessarily the author's own text.
        self.is_cross_library = True

    def search(self, question, facets, history=(), limit=BROAD_RESULTS):
        questions = list(dict.fromkeys(
            facets if len(facets) > 1 else [question]
        ))
        if len(self.tokenize(question)) < 4:
            prior = [m.get("content", "") for m in history
                     if m.get("role") == "user"]
            if prior:
                questions.append(prior[-1] + " " + question)
        ranked = [self.rank(q) for q in questions]
        book_lists = {book_id: [] for book_id in self.chosen_books}
        seen = set()
        # Round robin across question facets before distributing book quotas.
        for rank in range(max(map(len, ranked), default=0)):
            for ranking in ranked:
                if rank >= len(ranking):
                    continue
                pos = ranking[rank]
                if pos in seen:
                    continue
                seen.add(pos)
                book_id = str(self.passages[pos]["book_id"])
                if book_id in book_lists:
                    book_lists[book_id].append(pos)
        result = []
        # Each book gets a chance to contribute passages even when another
        # book contains more repetitions of the query terms.
        for rank in range(max(map(len, book_lists.values()), default=0)):
            for book_id in self.chosen_books:
                candidates = book_lists[book_id]
                if rank < len(candidates):
                    result.append(self.passages[candidates[rank]])
                    if len(result) == limit:
                        return [{**p, "source_id": f"S{i + 1}"}
                                for i, p in enumerate(result)]
        return [{**p, "source_id": f"S{i + 1}"}
                for i, p in enumerate(result)]


class WholeLibraryLocator:
    """Read only partitions relevant to query words and selected book shards."""

    def __init__(self, registry, tokenize, continuation,
                 partition_cache_size=PARTITION_CACHE_SIZE):
        self.registry = registry
        self.tokenize = tokenize
        self.continuation = continuation
        self.root = registry.corpus_root / f"data-{registry.corpus_version}"
        self._manifest = None
        self._book_counts = None
        self._partitions = OrderedDict()
        self._cache_size = max(1, int(partition_cache_size))
        self._lock = threading.RLock()

    def _read_gzip(self, path):
        try:
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                return json.load(stream)
        except (OSError, ValueError, UnicodeDecodeError) as error:
            raise LibrarySearchError(
                f"Unable to read library index data {path.name}: {error}"
            ) from error

    def _manifest_data(self):
        if self._manifest is None:
            value = self._read_gzip(self.root / "manifest.json.gz")
            if (not isinstance(value, dict)
                    or value.get("version") != int(self.registry.corpus_version.lstrip("v"))
                    or value.get("postings_encoding") != "delta-json-v1"
                    or value.get("prefix_length") != 2
                    or not isinstance(value.get("page_books"), list)
                    or not isinstance(value.get("books"), dict)
                    or not isinstance(value.get("partitions"), list)
                    or len(value["page_books"]) != value.get("pages")):
                raise LibrarySearchError(
                    "Library index manifest is incompatible with the configured "
                    "version or has missing page/book metadata."
                )
            self._manifest = value
            self._book_counts = Counter(str(x) for x in value["page_books"])
        return self._manifest

    def status(self):
        with self._lock:
            return {"available": (self.root / "manifest.json.gz").is_file(),
                    "corpus_version": self.registry.corpus_version,
                    "mode": "bounded_page_search",
                    "max_books": MAX_BOOKS,
                    "max_pages_per_book": MAX_PAGES_PER_BOOK}

    def _partition(self, prefix, manifest):
        if prefix not in manifest["partitions"]:
            return {}
        if prefix in self._partitions:
            self._partitions.move_to_end(prefix)
            return self._partitions[prefix]
        data = self._read_gzip(self.root / f"terms-{prefix}.json.gz")
        if not isinstance(data, dict):
            raise LibrarySearchError(f"Malformed term partition: {prefix}")
        self._partitions[prefix] = data
        while len(self._partitions) > self._cache_size:
            self._partitions.popitem(last=False)
        return data

    def _authors_mentioned(self, question):
        """Resolve explicitly mentioned author names without model guesses.

        Full author names, and sufficiently distinctive surnames, are checked
        as word-boundary phrases against actual catalog author metadata.
        When two named authors occur, book selection must represent both.
        """
        question = " " + " ".join(TERM_RE.findall(question.lower())) + " "
        groups = OrderedDict()
        for item in self.registry.entries.values():
            author = " ".join(TERM_RE.findall(item.get("author", "").lower()))
            if not author or author == "anonymous":
                continue
            tokens = author.split()
            parts = [author]
            if len(tokens) > 1 and len(tokens[-1]) >= 5:
                parts.append(tokens[-1])
            if not any(" " + name + " " in question for name in parts):
                continue
            groups.setdefault(author, set()).add(item["book_id"])
        return list(groups.values())

    def _terms(self, question, author_groups):
        author_words = set()
        for group in author_groups:
            for book_id in group:
                meta = self.registry.entries.get(book_id, {})
                author_words.update(TERM_RE.findall(
                    meta.get("author", "").lower()
                ))
        terms = []
        for word in TERM_RE.findall(question.lower()):
            if (len(word) < 3 or word in author_words
                    or word in QUESTION_FRAMING
                    or not self.tokenize(word)):
                continue
            if word not in terms:
                terms.append(word)
            # The search index retains literal word forms (not stems).
            # Inflection-expanded words can help, but never replace the
            # reader's actual word with an invented substitute.
        return terms[:MAX_TERMS]

    def _book_metadata(self, book_id, manifest):
        existing = self.registry.entries.get(str(book_id))
        entry = manifest["books"].get(str(book_id))
        if not isinstance(entry, dict):
            return None
        drive = str(entry.get("drive_url") or "")
        matched = DRIVE_FILE.match(drive)
        if not matched:
            return None
        pdf_id = matched.group(1)
        # The manifest is the source of truth for v47 book/page membership;
        # the website catalog supplies rich names. Reject conflicts rather
        # than accidentally linking another book's PDF.
        if existing and existing.get("pdf_file_id") and existing["pdf_file_id"] != pdf_id:
            return None
        return {
            "book_id": str(book_id),
            "title": (existing or {}).get("title") or entry.get("title"),
            "pdf_file_id": pdf_id,
            "corpus_version": self.registry.corpus_version,
        }

    def _rank_page_candidates(self, question, manifest):
        author_groups = self._authors_mentioned(question)
        terms = self._terms(question, author_groups)
        page_scores = defaultdict(float)
        page_matches = defaultdict(int)
        page_books = manifest["page_books"]
        used = []
        for term in terms:
            deltas = self._partition(term[:2], manifest).get(term, [])
            if not isinstance(deltas, list):
                raise LibrarySearchError(f"Malformed postings for term: {term}")
            if not deltas:
                continue
            # Rare tokens contain more information than extremely common
            # terms such as 'life'. Weight by indexed-page document frequency.
            idf = math.log1p(len(page_books) / (len(deltas) + 1))
            current = 0
            for delta in deltas:
                if not isinstance(delta, int) or delta < 0:
                    raise LibrarySearchError(f"Invalid delta posting for {term}")
                current += delta
                if current >= len(page_books):
                    raise LibrarySearchError(f"Out-of-range global page ID for {term}")
                page_scores[current] += idf
                page_matches[current] += 1
            used.append(term)
        by_book = defaultdict(list)
        for page_id, score in page_scores.items():
            book_id = str(page_books[page_id])
            by_book[book_id].append((page_id, score, page_matches[page_id]))
        scored = {}
        for book_id, hits in by_book.items():
            book = self._book_metadata(book_id, manifest)
            if not book or not (
                self.root / f"book-{book_id}.json.gz"
            ).is_file():
                continue
            hits.sort(key=lambda h: (-h[2], -h[1], h[0]))
            top = hits[:MATCH_PAGES_PER_BOOK]
            size = self._book_counts.get(book_id, 1)
            # Favor pages covering several words, then substantial evidence
            # rather than sheer volume of one frequent word in a huge book.
            scored[book_id] = {
                "score": (top[0][1] * 2.5
                          + sum(x[1] for x in top[:3]) * .6
                          + top[0][2] * 2
                          + math.log1p(len(hits)) * .25
                          - math.log1p(size) * .12),
                "pages": top, "matches": len(hits),
                "meta": book,
            }
        return scored, used, author_groups

    def _select_books(self, scored, author_groups, max_books):
        ranked = sorted(scored, key=lambda b: (
            -scored[b]["score"], -scored[b]["matches"], int(b)
        ))
        if not author_groups:
            return ranked[:max_books], []
        selected = []
        required = []
        # One source from every explicitly named author is more important
        # than filling all slots with works by just one named author.
        for group in author_groups:
            matches = [bid for bid in ranked if bid in group]
            if matches:
                selected.append(matches[0])
                required.append(matches[0])
        if len(selected) > max_books:
            selected = selected[:max_books]
            required = required[:max_books]
        permissible = set().union(*author_groups)
        for book_id in ranked:
            if len(selected) >= max_books:
                break
            if book_id in permissible and book_id not in selected:
                selected.append(book_id)
        return selected, required

    def _matching_source_pages(self, book_id, page_scores):
        path = self.root / f"book-{book_id}.json.gz"
        document = self._read_gzip(path)
        if not isinstance(document, dict) or not isinstance(document.get("pages"), list):
            raise LibrarySearchError(f"Malformed source book shard {book_id}")
        all_pages = document["pages"]
        # The shard is indexed by global page ID. 'page' is the physical PDF
        # page number; they must not be confused with one another.
        positions = {}
        for position, page in enumerate(all_pages):
            if isinstance(page, dict) and isinstance(page.get("id"), int):
                positions[page["id"]] = position
        matched = []
        for global_id, _, _ in page_scores:
            if global_id in positions:
                matched.append(positions[global_id])
        if not matched:
            return []
        chosen = list(dict.fromkeys(matched))
        # Read immediate neighbors ONLY for the few highest-ranking pages.
        # They allow the argument-context stage to resolve page breaks.
        for pos in list(chosen):
            for near in (pos - 1, pos + 1):
                if (len(chosen) >= MAX_PAGES_PER_BOOK
                        or not 0 <= near < len(all_pages)
                        or near in chosen):
                    continue
                left = all_pages[pos]
                right = all_pages[near]
                if (isinstance(left, dict) and isinstance(right, dict)
                        and abs(int(left["page"]) - int(right["page"])) <= 1):
                    chosen.append(near)
        pages = []
        for pos in sorted(chosen):
            page = all_pages[pos]
            text = page.get("text", "")
            if isinstance(text, str) and text.strip():
                pages.append({"page": int(page["page"]), "text": text})
        return pages

    def search(self, question, max_books=MAX_BOOKS):
        """Return a cross-book passage index plus audit-friendly discovery.

        No Ollama calls. Never read more than max_books book shards, and never
        add more than MAX_PAGES_PER_BOOK pages of each shard to the index.
        """
        with self._lock:
            manifest = self._manifest_data()
            scored, terms, author_groups = self._rank_page_candidates(
                question, manifest
            )
            chosen, required = self._select_books(
                scored, author_groups, max(1, min(MAX_BOOKS, max_books))
            )
            if not chosen:
                raise LibrarySearchError(
                    "No locally installed books with verified source PDFs "
                    "matched this question in the v47 full-text index."
                )
            books = []
            details = []
            for book_id in chosen:
                pages = self._matching_source_pages(
                    book_id, scored[book_id]["pages"]
                )
                if not pages:
                    continue
                books.append((scored[book_id]["meta"], pages))
                details.append({
                    "book_id": book_id,
                    "title": scored[book_id]["meta"]["title"],
                    "matching_pages": scored[book_id]["matches"],
                    "opened_pages": [p["page"] for p in pages],
                    "top_global_page_ids": [
                        hit[0] for hit in scored[book_id]["pages"]
                    ],
                })
            if not books:
                raise LibrarySearchError(
                    "Matching books had no usable original text pages."
                )
            used_ids = [book["book_id"] for book, _ in books]
            discovery = {
                "scope": "library", "corpus_version": self.registry.corpus_version,
                "terms": terms, "authors_detected": len(author_groups),
                "required_book_ids": [
                    bid for bid in required if bid in used_ids
                ],
                "candidate_books": details,
                "book_shards_opened": len(books),
                "page_count": sum(len(pages) for _, pages in books),
                "all_indexed_books_opened": False,
            }
            index = DiversePassageIndex(
                books, self.tokenize, self.continuation, used_ids, discovery
            )
            if not index.passages:
                raise LibrarySearchError(
                    "Selected book pages contain no indexable passages."
                )
            return index, discovery
