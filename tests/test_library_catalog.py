"""Catalog-backed, on-demand multi-book index selection contracts.

Fixture books use invented instructional prose and local fake Drive IDs.
No Ollama connection, network, or actual Antilogicalism PDF is required.
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
from grounded_pipeline import PassageIndex
from library_catalog import (
    BookSelectionError, LibraryIndexRegistry, read_catalog, resolve_catalog_path
)

ID7 = "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY"
ID2 = "1NtLNRtVh0fA9g3zS4PMRTqMAlOnfAgGL"
BOOK7 = {
    "book_id": "7", "title": "A Practice Book — Author One",
    "pdf_file_id": ID7, "corpus_version": "v47"
}
TEXT7 = "Practice is a repeated effort, and experience improves judgment."
TEXT2 = ("Justice is the practice of treating participants fairly. "
         "In this manual, justice requires listening carefully before acting.")


class ModelForBookTests:
    def __init__(self):
        self.calls = []
    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append({"stage": stage, "user": user})
        if stage == "evidence_selection":
            return {"source_ids": ["S1"]}
        return {"paragraphs": [{
            "text": "Justice requires treating people fairly and listening before action.",
            "source_ids": ["S1"]
        }], "follow_up_questions": []}


class MultiBookTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.site = self.root / "antilogicalism" / "digital-library"
        self.site.mkdir(parents=True)
        self.data_root = self.root / "antilogicalism-library-data"
        (self.data_root / "data-v47").mkdir(parents=True)
        self.catalog = self.site / "library-catalog.json"
        self.catalog.write_text(json.dumps({"count": 3, "books": [
            {"id": "7", "title": BOOK7["title"], "workTitle": "A Practice Book",
             "author": "Author One",
             "url": "https://drive.google.com/file/d/" + ID7 + "/view"},
            {"id": "2", "title": "Manual of Justice — Author Two",
             "workTitle": "Manual of Justice", "author": "Author Two",
             "url": "https://drive.google.com/file/d/" + ID2 + "/view"},
            {"id": "3", "title": "No text available — Author Three",
             "workTitle": "No text available", "author": "Author Three",
             "url": ""},
        ]}), encoding="utf-8")
        self.book7_path = self.data_root / "data-v47" / "book-7.json.gz"
        with gzip.open(self.book7_path, "wt", encoding="utf-8") as stream:
            json.dump({"pages": [{"page": 1, "text": TEXT7}]}, stream)
        with gzip.open(self.data_root / "data-v47" / "book-2.json.gz",
                       "wt", encoding="utf-8") as stream:
            json.dump({"pages": [{"page": 7, "text": TEXT2}]}, stream)
        self.default_index = PassageIndex(
            [(BOOK7, [{"page": 1, "text": TEXT7}])], app.tokenize
        )
        self.registry = LibraryIndexRegistry(
            self.catalog, self.data_root, "v47", BOOK7, self.default_index,
            self.book7_path, app.tokenize, app.likely_page_continuation,
            max_cached=2
        )

    def test_catalog_matches_existing_sibling_website_layout(self):
        path = resolve_catalog_path(self.root / "book-chatbot")
        self.assertEqual(path, self.catalog)
        books = read_catalog(self.catalog, BOOK7)
        self.assertEqual(len(books), 3)
        self.assertEqual(books["2"]["pdf_file_id"], ID2)
        self.assertEqual(books["2"]["author"], "Author Two")

    def test_catalog_listing_does_not_load_all_books(self):
        descriptions = self.registry.list_books()
        self.assertEqual(len(descriptions), 3)
        self.assertEqual(self.registry.cached_ids(), ["7"])
        self.assertTrue(next(b for b in descriptions if b["book_id"] == "2")["available"])
        self.assertFalse(next(b for b in descriptions if b["book_id"] == "3")["available"])

    def test_catalog_author_surname_and_natural_volume_sort(self):
        from library_catalog import catalog_sort_key
        entries = [
            {"book_id":"1", "author":"George Orwell", "work_title":"1984"},
            {"book_id":"2", "author":"Aristotle", "work_title":"Nicomachean Ethics"},
            {"book_id":"3", "author":"Various authors", "work_title":"Sacred Books of the East, Volume 10"},
            {"book_id":"4", "author":"Various authors", "work_title":"Sacred Books of the East, Volume 2"},
            {"book_id":"5", "author":"Julius Eggeling (translator)", "work_title":"Sacred Books of the East, Volume 3"},
            {"book_id":"6", "author":"Jane Austen", "work_title":"Persuasion"},
        ]
        ordered = sorted(entries, key=catalog_sort_key)
        self.assertEqual([x["book_id"] for x in ordered], ["2", "6", "1", "4", "5", "3"])

    def test_lazy_selected_book_cites_its_own_pdf_not_aristotle(self):
        index = self.registry.get_index("2")
        self.assertEqual(self.registry.cached_ids(), ["7", "2"])
        hits = index.search("What is justice?", ["What is justice?"])
        self.assertTrue(hits)
        self.assertTrue(all(s["book_id"] == "2" for s in hits))
        self.assertTrue(all(s["pdf_file_id"] == ID2 for s in hits))
        self.assertTrue(all(s["pages"] == [7] for s in hits))
        self.assertNotIn(ID7, hits[0]["pdf_file_id"])
        self.assertIs(self.registry.get_index("2"), index)

    def test_validation_rejects_unknown_id_missing_shard_or_pdf(self):
        for book_id in ("../../README", "999", "3"):
            with self.subTest(book_id=book_id):
                with self.assertRaises(BookSelectionError):
                    self.registry.get_index(book_id)
        (self.data_root / "data-v47" / "book-2.json.gz").unlink()
        with self.assertRaisesRegex(BookSelectionError, "not installed"):
            self.registry.get_index("2")

    def test_lru_bound_holds_when_another_book_is_selected(self):
        with gzip.open(self.data_root / "data-v47" / "book-3.json.gz", "wt",
                       encoding="utf-8") as stream:
            json.dump({"pages": [{"page": 3, "text": TEXT2}]}, stream)
        # The catalog has a missing PDF for book 3; add one in the local test
        # registry so this test checks LRU logic, not source-link policy.
        self.registry.entries["3"]["pdf_file_id"] = "ValidFakeDriveId123"
        self.registry.get_index("2")
        self.registry.get_index("3")
        self.assertEqual(self.registry.cached_ids(), ["2", "3"])
        self.assertIs(self.registry.get_index("2"), self.registry._indexes["2"])

    def _serve(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(),
                                 thread.join()))
        return "http://127.0.0.1:" + str(server.server_port)

    def test_books_api_exposes_catalog_and_availability(self):
        url = self._serve()
        with patch.object(app, "LIBRARY_REGISTRY", self.registry):
            with urllib.request.urlopen(url + "/api/books") as response:
                result = json.load(response)
        self.assertEqual(len(result["books"]), 3)
        self.assertEqual(result["default_book_id"], "7")
        self.assertTrue(result["catalog_available"])
        self.assertEqual(self.registry.cached_ids(), ["7"])

    def test_http_chat_other_book_has_correct_source_and_no_extra_model(self):
        model = ModelForBookTests()
        url = self._serve()
        with patch.object(app, "LIBRARY_REGISTRY", self.registry), \
             patch.object(app, "OllamaProvider", return_value=model):
            request = urllib.request.Request(
                url + "/api/chat",
                data=json.dumps({
                    "question": "What is justice?", "book_id": "2",
                    "pipeline": "evidence", "model": "fake-model",
                    "diagnostics": True
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request) as response:
                result = json.load(response)
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(result["book"]["book_id"], "2")
        self.assertEqual(len(model.calls), 2)
        self.assertEqual(result["sources"][0]["book_id"], "2")
        self.assertEqual(result["sources"][0]["pages"], [7])
        self.assertIn(ID2, result["sources"][0]["url"])
        self.assertNotIn(ID7, result["sources"][0]["url"])
        self.assertEqual(result["diagnostics"]["book"]["book_id"], "2")

    def test_http_bad_book_returns_clear_client_error_without_inference(self):
        model = ModelForBookTests()
        url = self._serve()
        with patch.object(app, "LIBRARY_REGISTRY", self.registry), \
             patch.object(app, "OllamaProvider", return_value=model):
            request = urllib.request.Request(
                url + "/api/chat",
                data=json.dumps({
                    "question": "What is justice?", "book_id": "999",
                    "pipeline": "evidence"
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(request)
            self.assertEqual(ctx.exception.code, 400)
        self.assertFalse(model.calls)


if __name__ == "__main__":
    unittest.main()
