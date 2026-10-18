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
from retrieval_relevance import (
    canonical_author, content_terms, named_author_groups,
    passage_topic_score,
)


MAX_TERMS = 8
MAX_BOOKS = 4
MAX_PAGES_PER_BOOK = 9
MATCH_PAGES_PER_BOOK = 5
PARTITION_CACHE_SIZE = 8
BROAD_RESULTS = 24



class LibrarySearchError(ValueError):
    """The full-text manifest, a partition or a required shard is unusable."""


class DiversePassageIndex(PassageIndex):
    """Preserve source diversity in the 24 passages offered to the selector."""

    def __init__(self, books, tokenize, continuation, chosen_books,
                 discovery, topic_terms=()):
        super().__init__(books, tokenize, continuation)
        self.chosen_books = list(chosen_books)
        self.discovery = discovery
        self.topic_terms = list(topic_terms)
        self.is_cross_library = True

    def search(self, question, facets, history=(), limit=BROAD_RESULTS):
        """Rank original passage wording by the READER'S subject, not UI words.

        BM25 supplies a cheap first ranking. For each book, prefer original
        passages that actually discuss more than one content term and use
        those terms closely together. Never attach prose from a different
        work just to fill a quota. Round robin keeps selected books visible.
        """
        if self.topic_terms:
            questions = [" ".join(self.topic_terms)]
            # Preserve multipart facets, but strip author names and question
            # framing words by restricting each facet to known subject terms.
            for facet in facets if len(facets) > 1 else []:
                tokens = set(self.tokenize(facet))
                subset = [t for t in self.topic_terms
                          if self.tokenize(t)[0] in tokens]
                if subset and len(subset) < len(self.topic_terms):
                    questions.append(" ".join(subset))
        else:
            questions = [question]
        ranked = [self.rank(q) for q in dict.fromkeys(questions)]
        book_lists = {book_id: [] for book_id in self.chosen_books}
        seen = set()
        for position in range(max(map(len, ranked), default=0)):
            for ranking in ranked:
                if position >= len(ranking):
                    continue
                idx = ranking[position]
                if idx in seen:
                    continue
                seen.add(idx)
                book_id = str(self.passages[idx]["book_id"])
                if book_id in book_lists:
                    book_lists[book_id].append(idx)

        for book_id, candidates in book_lists.items():
            primary_rank = {i: rank for rank, i in enumerate(candidates)}
            scores = {i: passage_topic_score(
                self.passages[i]["text"], self.topic_terms, self.tokenize)
                for i in candidates}
            if len(self.topic_terms) >= 2 and any(
                coverage >= 2 for _, coverage in scores.values()
            ):
                candidates[:] = [i for i in candidates
                                 if scores[i][1] >= 2]
            candidates.sort(key=lambda i: (
                -scores[i][1], -scores[i][0],
                primary_rank[i]
            ))
        result = []
        for position in range(max(map(len, book_lists.values()), default=0)):
            for book_id in self.chosen_books:
                candidates = book_lists[book_id]
                if position < len(candidates):
                    result.append(self.passages[candidates[position]])
                    if len(result) == limit:
                        break
            if len(result) == limit:
                break
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
        """Match named people, never generic anthology bylines."""
        return named_author_groups(question, self.registry.entries)

    def _terms(self, question, author_groups):
        """Return indexed surface words for the actual subject, not commands."""
        return content_terms(question, self.tokenize, author_groups,
                             limit=MAX_TERMS)

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
            "work_title": (existing or {}).get("work_title") or entry.get("title"),
            "author": (existing or {}).get("author") or "",
            "subjects": (existing or {}).get("subjects") or [],
            "pdf_file_id": pdf_id,
            "corpus_version": self.registry.corpus_version,
        }

    @staticmethod
    def _diverse_page_hints(hits, count):
        """Keep strong matches while avoiding all hints from the first pages.

        The v47 inverted index stores term presence, not term positions or
        document frequencies within a page. On a one-word query, all pages
        therefore tie. Cover the argument's early, middle and late appearances
        rather than always choosing the earliest five PDF pages.
        """
        if len(hits) <= count:
            return list(hits)
        ranked = sorted(hits, key=lambda hit: (-hit[2], -hit[1], hit[0]))
        best = ranked[0]
        selected = [best]
        lower = min(h[0] for h in hits)
        upper = max(h[0] for h in hits)
        span = max(1, upper - lower)
        highest_score = max(h[1] for h in hits)
        highest_coverage = max(h[2] for h in hits)
        while len(selected) < count:
            remaining = [h for h in hits if h not in selected]
            def value(hit):
                quality = (hit[1] / max(.001, highest_score)
                           + .3 * hit[2] / max(1, highest_coverage))
                spread = min(abs(hit[0] - prev[0])
                             for prev in selected) / span
                return (quality + .45 * spread, hit[2], hit[1], -hit[0])
            selected.append(max(remaining, key=value))
        return selected

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
            top = self._diverse_page_hints(hits, MATCH_PAGES_PER_BOOK)
            size = self._book_counts.get(book_id, 1)
            best_concepts = max(x[2] for x in hits)
            cooccurring = sum(x[2] >= 2 for x in hits)
            fraction = cooccurring / max(size, 1)
            title_terms = set(self.tokenize(
                book["work_title"] + " " + " ".join(book["subjects"])
            ))
            title_matches = len(set(self.tokenize(" ".join(terms)))
                                & title_terms)
            author = canonical_author(book["author"])
            # Distinguish *subject concentration* from the volume of incidental
            # hits in a giant anthology. Explicit author comparisons still get
            # the requested author's works regardless of collection status.
            scored[book_id] = {
                "score": (top[0][1] * 1.7
                          + sum(x[1] for x in top[:3]) * .30
                          + best_concepts * 4.0
                          + math.log1p(60 * fraction) * 3.2
                          + title_matches * 1.8
                          - math.log1p(size) * .65
                          - (2.8 if not author else 0.0)),
                "pages": top, "matches": len(hits),
                "max_concepts": best_concepts,
                "multi_term_pages": cooccurring,
                "topic_density": round(fraction, 5),
                "title_overlap": title_matches,
                "author": author,
                "meta": book,
            }
        return scored, used, author_groups

    def _select_books(self, scored, author_groups, max_books):
        """Respect distinct authors, then choose complementary source works.

        For a named two-author comparison, don't spend three of four book
        slots on one author. For a broad question, privilege independent
        signed works over four anonymous/edited anthologies where possible.
        Selection always depends on actual matching page postings.
        """
        ranked = sorted(scored, key=lambda b: (
            -scored[b]["score"], -scored[b]["matches"], int(b)
        ))
        selected, requirements = [], []
        if author_groups:
            # Allocate at least one source per named PERSON, then at most
            # one more per person in round-robin order as space permits.
            for group in author_groups[:max_books]:
                choices = [
                    bid for bid in ranked if bid in group["book_ids"]
                ]
                if not choices:
                    requirements.append({
                        "author": group["author"], "book_ids": []
                    })
                    continue
                selected.append(choices[0])
                requirements.append({
                    "author": group["author"], "book_ids": [choices[0]]
                })
            for group in requirements:
                if len(selected) >= max_books:
                    break
                candidates = [
                    bid for bid in ranked
                    if bid in next((g["book_ids"] for g in author_groups
                                    if g["author"] == group["author"]), [])
                    and bid not in selected
                ]
                if candidates:
                    selected.append(candidates[0])
                    group["book_ids"].append(candidates[0])
            return selected, requirements

        # For broad topic discovery, require multi-concept relevance when
        # there is a page that genuinely matches two or more subject terms.
        # This avoids forcing incidental single-word hits into the answer.
        has_joint = any(item["max_concepts"] >= 2
                        for item in scored.values())
        if has_joint:
            ranked = [bid for bid in ranked
                      if scored[bid]["max_concepts"] >= 2]

        # One independently attributable work per person first. A collection
        # can still enter the pool, but a generic "Various authors" byline is
        # not considered a distinct philosopher or an explicit named author.
        chosen_authors = set()
        for book_id in ranked:
            author = scored[book_id]["author"]
            if author and author not in chosen_authors:
                selected.append(book_id)
                chosen_authors.add(author)
                if len(selected) == max_books:
                    return selected, []
        # If fewer than four named authors actually match, allow relevant
        # source collections (or another work from a known author).
        for book_id in ranked:
            if book_id not in selected:
                selected.append(book_id)
                if len(selected) == max_books:
                    break
        return selected, []

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
            if author_groups and any(
                not group["book_ids"] for group in required
            ):
                missing = [g["author"] for g in required
                           if not g["book_ids"]]
                raise LibrarySearchError(
                    "At least one explicitly named author's works had no "
                    "matching indexed pages with verified source PDFs: "
                    + ", ".join(missing)
                    + ". Try a more specific topic, or search separately."
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
                    "multi_term_pages": scored[book_id]["multi_term_pages"],
                    "topic_density": scored[book_id]["topic_density"],
                    "title_overlap": scored[book_id]["title_overlap"],
                    "author": scored[book_id]["meta"]["author"],
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
                "terms": terms,
                "authors_detected": len(author_groups),
                "required_author_groups": [
                    {"author": group["author"],
                     "book_ids": [bid for bid in group["book_ids"]
                                  if bid in used_ids]}
                    for group in required
                ],
                "required_book_ids": [
                    bid for group in required for bid in group["book_ids"]
                    if bid in used_ids
                ],
                "candidate_books": details,
                "book_shards_opened": len(books),
                "page_count": sum(len(pages) for _, pages in books),
                "all_indexed_books_opened": False,
            }
            index = DiversePassageIndex(
                books, self.tokenize, self.continuation, used_ids, discovery,
                topic_terms=terms
            )
            if not index.passages:
                raise LibrarySearchError(
                    "Selected book pages contain no indexable passages."
                )
            return index, discovery
