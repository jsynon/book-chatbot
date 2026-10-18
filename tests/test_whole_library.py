"""Offline regression contracts for v47 global page postings and cross-book QA.

The fixture copies v47's actual schema:
- manifest.page_books[GLOBAL_PAGE_ID] -> book catalog ID
- two-character terms-XX.json.gz maps literal terms to delta-encoded page IDs
- book-N.json.gz pages carry identical global page IDs and physical PDF pages
Nothing invokes Ollama or loads the user's local book repository.
"""
import gzip
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import app
from grounded_pipeline import PassageIndex, source_payload
from library_catalog import LibraryIndexRegistry
from whole_library import WholeLibraryLocator, LibrarySearchError
from evidence_pipeline import answer_evidence_first


DRIVE7 = "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY"
DRIVE88 = "1L6LzGc2IDOPLPhYOKZGF4yx2m-cBxoiD"
DRIVE9 = "1Y94qQmtad4jxdfGAK1tB2GSxbK8dyg3c"
DRIVE99 = "1T012345678901234567890123456789"


def gzwrite(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fp:
        json.dump(data, fp)


def deltas(ids):
    prev = 0
    output = []
    for idx in ids:
        output.append(idx - prev)
        prev = idx
    return output


class CrossLibraryFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.corpus = self.root / "antilogicalism-library-data" / "data-v47"
        self.corpus.mkdir(parents=True)
        self.catalog = self.root / "antilogicalism" / "digital-library" / "library-catalog.json"
        self.catalog.parent.mkdir(parents=True)
        works = [
            ("7", "Nicomachean Ethics — Aristotle", "Aristotle", DRIVE7),
            ("88", "A Confession — Leo Tolstoy", "Leo Tolstoy", DRIVE88),
            ("9", "Treatise on Celestial Motions — Astronomer", "Astronomer", DRIVE9),
        ]
        self.catalog.write_text(json.dumps({"books": [{
            "id": i, "title": title, "author": author,
            "workTitle": title.rsplit(" — ", 1)[0],
            "url": "https://drive.google.com/file/d/" + pdf + "/view"
        } for i, title, author, pdf in works]}), encoding="utf-8")
        page_records = [
            (7, 10, "Happiness requires virtue and active flourishing in a complete life. "
                    "Moral wisdom accompanies the stable habits of good character."),
            (7, 11, "Practical reasoning guides virtuous action and decision making. "
                    "Happiness is not merely momentary pleasure or transient enjoyment."),
            (7, 12, "The right means and the right goals support human goodness. "
                    "A rational and courageous character sustains happiness."),
            (88, 20, "Tolstoy questioned happiness when death made his life seem "
                     "meaningless, even while outward success continued."),
            (88, 21, "The meaning of life remained out of reach by abstract reason. "
                     "An unexpected discovery drew his attention toward faith."),
            (88, 22, "Happiness and meaning returned through lived faith and "
                     "the example of ordinary workers rather than elite society."),
            (9, 3, "Astronomy concerns the luminous stars, orbital motion and "
                   "predictable changes in the night sky."),
            (9, 4, "An orbit is an imagined path through celestial space and "
                   "a useful model of periodic motion."),
            (99, 3, "The meaning of existence is discussed by an author "
                    "not present in the website catalog."),
        ]
        self.pages = [{"id": pos, "book": book, "page": page, "text": text}
                      for pos, (book, page, text) in enumerate(page_records)]
        by_book = {}
        for page in self.pages:
            by_book.setdefault(page["book"], []).append({
                "id": page["id"], "page": page["page"],
                "text": page["text"]
            })
        for book, pages in by_book.items():
            gzwrite(self.corpus / f"book-{book}.json.gz", {"pages": pages})
        index_terms = {}
        for page in self.pages:
            for word in set(app.TOKEN_RE.findall(page["text"].lower())):
                index_terms.setdefault(word, []).append(page["id"])
        prefixes = {}
        for word, ids in index_terms.items():
            prefixes.setdefault(word[:2], {})[word] = deltas(ids)
        for prefix, postings in prefixes.items():
            gzwrite(self.corpus / f"terms-{prefix}.json.gz", postings)
        gzwrite(self.corpus / "manifest.json.gz", {
            "version": 47, "pages": len(self.pages),
            "postings_encoding": "delta-json-v1",
            "prefix_length": 2,
            "page_books": [p["book"] for p in self.pages],
            "partitions": sorted(prefixes),
            "books": {
                str(book): {
                    "title": next(
                        (title for bid, title, _, _ in works
                         if bid == str(book)),
                        "A work without website catalog metadata",
                    ),
                    "drive_url": "https://drive.google.com/file/d/"
                                 + next((pdf for bid, _, _, pdf in works
                                         if bid == str(book)), DRIVE99)
                                 + "/view",
                } for book in by_book
            }
        })
        default = {
            "book_id": "7", "title": "Nicomachean Ethics — Aristotle",
            "pdf_file_id": DRIVE7, "corpus_version": "v47",
        }
        default_index = PassageIndex([
            (default, [{"page": p["page"], "text": p["text"]}
                       for p in self.pages if p["book"] == 7])
        ], app.tokenize)
        self.registry = LibraryIndexRegistry(
            self.catalog, self.root / "antilogicalism-library-data",
            "v47", default, default_index,
            self.corpus / "book-7.json.gz", app.tokenize,
            app.likely_page_continuation
        )
        self.locator = WholeLibraryLocator(
            self.registry, app.tokenize, app.likely_page_continuation
        )

    def _serve(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(),
                                 thread.join()))
        return "http://127.0.0.1:" + str(server.server_port)

    def test_matching_pages_keep_global_ids_distinct_from_pdf_pages(self):
        index, metadata = self.locator.search(
            "How do Aristotle and Tolstoy understand happiness?"
        )
        ids = set(index.chosen_books)
        self.assertEqual(ids, {"7", "88"})
        self.assertEqual(metadata["book_shards_opened"], 2)
        self.assertTrue(metadata["page_count"] <= 2 * 9)
        self.assertEqual(set(metadata["required_book_ids"]), ids)
        self.assertEqual({
            group["author"] for group in metadata["required_author_groups"]
        }, {"aristotle", "leo tolstoy"})
        self.assertEqual(set(b["book_id"] for b in metadata["candidate_books"]), ids)
        self.assertTrue(all(p["pages"][0] in (10, 11, 12, 20, 21, 22)
                            for p in index.passages))

    def test_search_from_both_books_with_correct_drive_and_unique_source_ids(self):
        index, _ = self.locator.search(
            "Compare Aristotle and Tolstoy on happiness"
        )
        hits = index.search("happiness", ["happiness"])
        self.assertTrue(hits)
        self.assertEqual({p["book_id"] for p in hits}, {"7", "88"})
        self.assertEqual([p["source_id"] for p in hits],
                         [f"S{i + 1}" for i in range(len(hits))])
        for item in hits:
            source = source_payload(item)
            self.assertIn(
                DRIVE7 if item["book_id"] == "7" else DRIVE88,
                source["url"],
            )
            self.assertEqual(source["book_id"], item["book_id"])

    def test_stays_bounded_even_with_unrelated_books_in_index(self):
        read_log = []
        original = self.locator._read_gzip
        def observe(path):
            read_log.append(path.name)
            return original(path)
        with patch.object(self.locator, "_read_gzip", side_effect=observe):
            self.locator.search(
                "How do Aristotle and Tolstoy explain happiness?"
            )
        shards = [name for name in read_log if name.startswith("book-")]
        self.assertEqual(set(shards), {"book-7.json.gz", "book-88.json.gz"})
        self.assertNotIn("book-9.json.gz", read_log)
        self.assertNotIn("book-99.json.gz", read_log)
        self.assertEqual(self.registry.cached_ids(), ["7"])
        self.assertLessEqual(
            len(self.locator._partitions), self.locator._cache_size
        )

    def test_manifest_can_supply_missing_website_metadata_without_fake_pdf(self):
        index, metadata = self.locator.search("existence")
        self.assertIn("99", index.chosen_books)
        self.assertEqual(index.chosen_books[0], "99")
        source = source_payload(index.search("existence", ["existence"])[0])
        self.assertEqual(source["book_id"], "99")
        self.assertIn(DRIVE99, source["url"])

    def test_named_comparison_without_one_authors_topic_fails_closed(self):
        # The astronomy fixture has text in book 9, but neither Aristotle nor
        # Tolstoy has astronomy-matching pages in the synthetic inverted index.
        with self.assertRaisesRegex(LibrarySearchError, "named author's works"):
            self.locator.search(
                "How do Aristotle and Tolstoy approach astronomy?"
            )

    def test_equal_score_pages_span_an_argument_instead_of_first_pages(self):
        hits = [(i, 4.0, 1) for i in range(20)]
        chosen = WholeLibraryLocator._diverse_page_hints(hits, 5)
        ids = [p[0] for p in chosen]
        self.assertEqual(len(ids), 5)
        self.assertEqual(len(set(ids)), 5)
        self.assertEqual(ids[0], 0)
        self.assertIn(19, ids)
        self.assertTrue(any(7 <= pos <= 12 for pos in ids))

    def test_no_manifest_fails_with_actionable_error(self):
        (self.corpus / "manifest.json.gz").unlink()
        with self.assertRaisesRegex(LibrarySearchError, "manifest"):
            self.locator.search("happiness")

    def test_schema_mismatch_detected_not_silently_accepted(self):
        manifest_path = self.corpus / "manifest.json.gz"
        with gzip.open(manifest_path, "rt", encoding="utf-8") as fp:
            data = json.load(fp)
        data["postings_encoding"] = "unknown-v9"
        gzwrite(manifest_path, data)
        with self.assertRaisesRegex(LibrarySearchError, "incompatible"):
            self.locator.search("happiness")

    def test_unknown_partition_or_global_page_deltas_are_not_fabricated(self):
        prefix = self.corpus / "terms-ha.json.gz"
        gzwrite(prefix, {"happiness": [10_000]})
        with self.assertRaisesRegex(LibrarySearchError, "Out-of-range"):
            self.locator.search("happiness")

    def test_empty_content_query_does_not_read_all_books(self):
        with self.assertRaisesRegex(LibrarySearchError, "No locally installed"):
            self.locator.search("what is it")

    def test_author_comparison_has_required_source_coverage(self):
        class Model:
            def __init__(self):
                self.calls = []
            def complete(self, stage, system, user, schema, max_tokens):
                self.calls.append(stage)
                if stage == "evidence_selection":
                    # A model improperly takes only the first author's source.
                    return {"source_ids": ["S1"]}
                ids = [x for x in __import__("re").findall(
                    r'"source_id": "(S\d+)"', user
                )]
                selected = list(dict.fromkeys(ids))
                self.last_ids = selected
                return {"paragraphs": [{
                    "text": "Two works offer accounts of happiness and the meaningful "
                            "life that differ in their emphases and sources of reasoning.",
                    "source_ids": selected[:2],
                }], "follow_up_questions": []}
        index, _ = self.locator.search(
            "How do Aristotle and Tolstoy understand happiness?"
        )
        model = Model()
        result = answer_evidence_first(
            "How do Aristotle and Tolstoy understand happiness?", [],
            index, ["happiness"], model, "test-v1.4"
        )
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(model.calls, [
            "evidence_selection", "evidence_grounded_synthesis"
        ])
        self.assertTrue(result["diagnostics"]["retrieval"]
                        ["evidence_selection"].get("required_author_coverage"))
        self.assertEqual(len({
            p["book_id"] for p in result["diagnostics"]["retrieval"]["merged"]
            if p["source_id"] in model.last_ids
        }), 2)

    def test_cross_author_answer_reports_uncited_requested_book(self):
        class Provider:
            def complete(self, stage, system, user, schema, max_tokens):
                if stage == "evidence_selection":
                    return {"source_ids": ["S1"]}
                return {"paragraphs": [{
                    "text": "A single retrieved source offers an account of "
                            "happiness through meaningful human activity.",
                    "source_ids": ["S1"],
                }], "follow_up_questions": []}
        index, _ = self.locator.search(
            "How do Aristotle and Tolstoy understand happiness?"
        )
        output = answer_evidence_first(
            "How do Aristotle and Tolstoy understand happiness?", [],
            index, ["happiness"], Provider(), "test-v1.4"
        )
        self.assertEqual(output["outcome"], "draft")
        self.assertIn("does not cite evidence", output["coverage_notice"])
        self.assertEqual(
            len(output["diagnostics"]["evidence_check"]
                ["named_author_citation_coverage"]["missing_authors"]), 1
        )

    def test_citing_another_work_by_same_author_satisfies_coverage(self):
        # Regression: v1.4 mistakenly REQUIRED Aristotle's multi-volume Works
        # even when the answer properly cited the Ethics. The requirement
        # belongs to the person, not whichever work ranked first.
        index, _ = self.locator.search(
            "How do Aristotle and Tolstoy understand happiness?"
        )
        by_author = {
            g["author"]: g for g in
            index.discovery["required_author_groups"]
        }
        by_author["aristotle"]["book_ids"].append("293")
        candidates = index.search("happiness", ["happiness"])
        ethics = next(x for x in candidates if x["book_id"] == "7")
        confession = next(x for x in candidates if x["book_id"] == "88")
        wanted = [ethics["source_id"], confession["source_id"]]

        class Provider:
            def complete(self, stage, system, user, schema, max_tokens):
                if stage == "evidence_selection":
                    return {"source_ids": wanted}
                return {"paragraphs": [{
                    "text": "These two primary texts offer different ways "
                            "to understand happiness and lived meaning.",
                    "source_ids": wanted
                }], "follow_up_questions": []}

        result = answer_evidence_first(
            "How do Aristotle and Tolstoy understand happiness?", [],
            index, ["happiness"], Provider(), "test-v1.4.1"
        )
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(result["coverage_notice"], "")
        coverage = result["diagnostics"]["evidence_check"][
            "named_author_citation_coverage"
        ]
        self.assertEqual(coverage["missing_authors"], [])
        self.assertEqual(set(coverage["cited_book_ids"]), {"7", "88"})

    def test_http_scope_uses_two_calls_and_correct_library_book_labels(self):
        class Provider:
            def __init__(self):
                self.calls = []
            def complete(self, stage, system, user, schema, max_tokens):
                self.calls.append(stage)
                if stage == "evidence_selection":
                    return {"source_ids": ["S1", "S2"]}
                return {"paragraphs": [{
                    "text": "The selected writings offer contrasting explanations "
                            "of the good life and give distinct accounts of happiness.",
                    "source_ids": ["S1", "S2"],
                }], "follow_up_questions": []}
        provider = Provider()
        url = self._serve()
        with patch.object(app, "WHOLE_LIBRARY", self.locator), \
             patch.object(app, "OllamaProvider", return_value=provider):
            request = urllib.request.Request(
                url + "/api/chat", data=json.dumps({
                    "scope": "library", "pipeline": "evidence",
                    "question": "Compare Aristotle and Tolstoy on happiness",
                    "model": "fake-model", "diagnostics": True,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request) as response:
                payload = json.load(response)
        self.assertEqual(payload["outcome"], "draft")
        self.assertEqual(payload["scope"], "library")
        self.assertEqual(payload["book"]["book_id"], "library")
        self.assertEqual(len(provider.calls), 2)
        self.assertEqual(payload["library_discovery"]["book_shards_opened"], 2)
        self.assertTrue(all(s["book_id"] in {"7", "88"} for s in payload["sources"]))

    def test_http_library_mode_does_not_require_ollama_if_manifest_missing(self):
        (self.corpus / "manifest.json.gz").unlink()
        provider = object()
        url = self._serve()
        with patch.object(app, "WHOLE_LIBRARY", self.locator), \
             patch.object(app, "OllamaProvider", return_value=provider):
            request = urllib.request.Request(
                url + "/api/chat", data=json.dumps({
                    "scope": "library", "pipeline": "evidence",
                    "question": "Compare Aristotle and Tolstoy on happiness"
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(request)
            self.assertEqual(context.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
