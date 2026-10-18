"""Read an original PDF page from the locally indexed Antilogicalism corpus.

This is deliberately independent of retrieval and Ollama. The physical page
number in the original v47 book shard is authoritative; a global search page
ID is never a physical PDF page. The reader only accepts catalog/manifest
book identities with verified Drive PDF IDs.
"""
from bisect import bisect_left
from collections import OrderedDict
import gzip
import json
import re
import threading

from library_catalog import BookSelectionError


_DIGITS = re.compile(r"^[0-9]{1,7}$")
_MAX_PAGE = 1_000_000


class SourceReaderError(ValueError):
    """Invalid or unavailable source identity, page, or shard."""


class SourcePageReader:
    """Small thread-safe cache of source pages, not a second inference index.

    Decompression is lazy; navigating within a work reuses its loaded pages.
    The cache is bounded by book count and does not modify the corpus.
    """
    def __init__(self, registry, locator=None, max_cached=2, max_page_chars=50000):
        self.registry = registry
        self.locator = locator
        self.max_cached = max(1, int(max_cached))
        self.max_page_chars = max(1000, int(max_page_chars))
        self._books = OrderedDict()
        self._lock = threading.RLock()

    @staticmethod
    def _number(value, label):
        literal = str(value)
        if not _DIGITS.fullmatch(literal):
            raise SourceReaderError(f"{label} must be a positive numeric value.")
        number = int(literal)
        if not 1 <= number <= _MAX_PAGE:
            raise SourceReaderError(f"{label} is outside the supported range.")
        return number

    def _book_details(self, book_id):
        # Only a validated catalog ID or an identity verified by the v47
        # manifest can be used to locate a compressed source shard.
        try:
            metadata = self.registry.description(str(book_id))
            path = self.registry._path(str(book_id))
        except BookSelectionError:
            if self.locator is None:
                raise SourceReaderError("The source book was not found in the catalog.")
            try:
                manifest = self.locator._manifest_data()
                metadata = self.locator._book_metadata(str(book_id), manifest)
            except (OSError, ValueError, KeyError) as exc:
                raise SourceReaderError("The library manifest is unavailable.") from exc
            if not metadata:
                raise SourceReaderError("This source book has no verified PDF identity.")
            path = (self.registry.corpus_root /
                    f"data-{self.registry.corpus_version}" /
                    f"book-{book_id}.json.gz")
        if not metadata.get("pdf_file_id"):
            raise SourceReaderError("This book has no verified original PDF link.")
        if not path.is_file():
            raise SourceReaderError("The source text shard is not installed locally.")
        return metadata, path

    def page(self, book_id, page):
        book_number = self._number(book_id, "Book ID")
        page_number = self._number(page, "PDF page")
        book_id = str(book_number)
        metadata, path = self._book_details(book_id)
        with self._lock:
            if book_id in self._books:
                self._books.move_to_end(book_id)
                pages, numbers = self._books[book_id]
            else:
                try:
                    with gzip.open(path, "rt", encoding="utf-8") as source:
                        document = json.load(source)
                except (OSError, ValueError, UnicodeDecodeError) as exc:
                    raise SourceReaderError("The source book could not be read.") from exc
                if not isinstance(document, dict) or not isinstance(document.get("pages"), list):
                    raise SourceReaderError("The source book has invalid page data.")
                pages = {}
                for entry in document["pages"]:
                    if not isinstance(entry, dict):
                        continue
                    try:
                        physical = self._number(entry.get("page"), "PDF page")
                    except SourceReaderError:
                        continue
                    excerpt = entry.get("text")
                    if isinstance(excerpt, str) and excerpt.strip():
                        pages[physical] = excerpt
                if not pages:
                    raise SourceReaderError("The source book has no readable indexed pages.")
                numbers = sorted(pages)
                self._books[book_id] = (pages, numbers)
                while len(self._books) > self.max_cached:
                    self._books.popitem(last=False)
            position = bisect_left(numbers, page_number)
            if position >= len(numbers) or numbers[position] != page_number:
                raise SourceReaderError("This physical PDF page has no indexed text.")
            original_text = pages[page_number]
            text = original_text[:self.max_page_chars]
            drive = metadata["pdf_file_id"]
            return {
                "book_id": book_id,
                "title": metadata["title"],
                "author": metadata.get("author", ""),
                "corpus_version": self.registry.corpus_version,
                "page": page_number,
                "text": text,
                "truncated": len(original_text) > len(text),
                "previous_page": numbers[position - 1] if position else None,
                "next_page": numbers[position + 1] if position + 1 < len(numbers) else None,
                "pdf_url": (f"https://drive.google.com/file/d/{drive}/view"
                            f"?usp=sharing#page={page_number}"),
            }
