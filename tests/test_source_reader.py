"""Bounded v1.6 source reader contracts; no Ollama or network required."""
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from source_reader import SourcePageReader, SourceReaderError


class StubRegistry:
    corpus_version = "v47"
    def __init__(self, root):
        self.root = root
        self.corpus_root = root
    def description(self, book_id):
        if book_id != "7":
            from library_catalog import BookSelectionError
            raise BookSelectionError("Unknown book")
        return {"book_id":"7", "title":"Nicomachean Ethics — Aristotle",
                "author":"Aristotle","pdf_file_id":"knownPdfDocument123"}
    def _path(self, book_id):
        return self.root / "book-7.json.gz"


class SourceReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        with gzip.open(root / "book-7.json.gz", "wt", encoding="utf-8") as file:
            json.dump({"pages":[{"page":3,"text":"Aristotle discusses virtue."},
                                {"page":4,"text":"The good is an end."},
                                {"page":6,"text":"Happiness is an activity."}]}, file)
        self.reader = SourcePageReader(StubRegistry(root))

    def test_navigate_real_pdf_pages(self):
        page = self.reader.page("7","4")
        self.assertEqual(page["previous_page"],3)
        self.assertEqual(page["next_page"],6)
        self.assertEqual(page["text"],"The good is an end.")
        self.assertIn("/knownPdfDocument123/view",page["pdf_url"])
        self.assertEqual(self.reader.page("7","6")["next_page"],None)

    def test_unavailable_page_not_substituted(self):
        with self.assertRaisesRegex(SourceReaderError,"no indexed text"):
            self.reader.page("7","5")

    def test_untrusted_path_and_numeric_bounds_rejected(self):
        for value in ("../7", "-1", "nan", "0", "99999999"):
            with self.subTest(value=value):
                with self.assertRaises(SourceReaderError):
                    self.reader.page(value,3)
        with self.assertRaises(SourceReaderError):
            self.reader.page("999",3)

    def test_cache_bounded_and_reused(self):
        self.reader.page("7",3)
        self.reader.page("7",4)
        self.assertEqual(list(self.reader._books),["7"])
