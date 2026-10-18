"""Catalog-backed, lazy single-book retrieval for the Antilogicalism collection.

The Antilogicalism WEBSITE supplies title/author/PDF metadata; the independent
library-data repository supplies versioned compressed page text. Neither is
duplicated or silently guessed. Only books that readers select are decompressed
and indexed. This is a bridge towards whole-library retrieval, NOT yet a
cross-book search engine.

No network request occurs at runtime; a locally checked-out catalog is used.
"""
from collections import OrderedDict
import gzip
import json
from pathlib import Path
import re
import threading

from grounded_pipeline import PassageIndex


DRIVE_FILE = re.compile(
    r"^https://drive\.google\.com/file/d/([A-Za-z0-9_-]{10,})/(?:view|preview)"
)
BOOK_ID = re.compile(r"^[0-9]+$")


class BookSelectionError(ValueError):
    """The requested work is not in the catalog or has no usable local text."""


def resolve_catalog_path(project_root, configured_path=None):
    """Locate the existing website catalog rather than build a new copy.

    The normal user checkout contains sibling folders 'book-chatbot',
    'antilogicalism' and 'antilogicalism-library-data'. A different path can
    be supplied with BOOK_CHATBOT_CATALOG.
    """
    if configured_path:
        return Path(configured_path).expanduser()
    return Path(project_root).parent / "antilogicalism" / "digital-library" / "library-catalog.json"


def read_catalog(path, fallback_book):
    """Return source-linked metadata keyed by numeric library catalog ID.

    Missing/invalid PDF links remain visible as unavailable entries rather
    than acquiring Aristotle's PDF identity or a made-up fallback link.
    """
    books = {}
    if Path(path).is_file():
        with open(path, "r", encoding="utf-8") as source:
            data = json.load(source)
        rows = data.get("books", [])
        if not isinstance(rows, list):
            raise ValueError("Library catalog must contain a books list")
        for row in rows:
            if not isinstance(row, dict):
                continue
            book_id = str(row.get("id", "")).strip()
            if not BOOK_ID.fullmatch(book_id):
                continue
            url = str(row.get("url") or "")
            match = DRIVE_FILE.match(url)
            title = str(row.get("title") or "").strip()
            if not title:
                continue
            if book_id in books:
                raise ValueError(f"Duplicate catalog book ID: {book_id}")
            books[book_id] = {
                "book_id": book_id,
                "title": title,
                "author": str(row.get("author") or "").strip(),
                "work_title": str(row.get("workTitle") or title).strip(),
                "subjects": list(row.get("subjects") or []),
                "pdf_file_id": match.group(1) if match else None,
            }
    default_id = str(fallback_book["book_id"])
    if default_id not in books:
        books[default_id] = {**fallback_book,
                             "author": fallback_book.get("author", ""),
                             "work_title": fallback_book["title"],
                             "subjects": []}
    return books


def _author_sort_name(author, work_title):
    """Use the primary contributor's surname, keeping multi-volume collections together.

    A named translator of one Sacred Books of the East volume is not the
    author of the whole series. Group that collective set under 'Various
    authors' rather than scattering individual volumes by translators.
    This grouping is for browsing only; original metadata is unchanged.
    """
    if re.match(r"^Sacred Books of the East(?:,|\b)", work_title, re.I):
        return ("various", "various authors")
    name = str(author or "").strip()
    name = re.sub(r"^Translated by\s+", "", name, flags=re.I)
    name = re.sub(r"\([^)]*\)", "", name).strip()
    name = re.split(r"\s+(?:and|&)\s+|,\s+(?=[A-Z])", name, maxsplit=1)[0].strip()
    if not name:
        return ("zzzz", "")
    if name.casefold().startswith(("various", "anonymous", "traditional")):
        return (name.casefold(), name.casefold())
    parts = name.split()
    # Last word is usually the surname; use the full name as a stable
    # secondary key. Collective authorship cannot be inferred reliably.
    return (parts[-1].casefold().strip("."), name.casefold())


def _natural_title(title):
    """Sort numbered volume titles numerically, not Volume 1, 10, 11, 2."""
    parts = re.split(r"(\d+)", str(title or "").casefold())
    return tuple((1, int(part)) if part.isdecimal() else (0, part)
                 for part in parts if part)


def catalog_sort_key(book):
    return (*_author_sort_name(book.get("author"), book.get("work_title") or
                               book.get("title", "")),
            _natural_title(book.get("work_title") or book.get("title")),
            int(book["book_id"]))


class LibraryIndexRegistry:
    """Bounded LRU index cache; all metadata is cheap, book text is loaded late.

    Building indexes is synchronized because ThreadingHTTPServer can receive
    simultaneous questions and should never build the same large book twice.
    """
    def __init__(self, catalog_path, corpus_root, corpus_version,
                 default_book, default_index, default_file, tokenize,
                 continuation, max_cached=2):
        self.catalog_path = Path(catalog_path)
        self.corpus_root = Path(corpus_root)
        self.corpus_version = str(corpus_version)
        self.default_id = str(default_book["book_id"])
        self.default_file = Path(default_file)
        self.entries = read_catalog(self.catalog_path, default_book)
        self.tokenize = tokenize
        self.continuation = continuation
        self.max_cached = max(1, int(max_cached))
        self._indexes = OrderedDict([(self.default_id, default_index)])
        self._lock = threading.RLock()

    def _path(self, book_id):
        if book_id == self.default_id:
            return self.default_file
        # IDs are digits ONLY. Never interpolate unchecked user data into
        # filenames or follow metadata-supplied filesystem paths.
        return self.corpus_root / f"data-{self.corpus_version}" / f"book-{book_id}.json.gz"

    def description(self, book_id):
        entry = self.entries.get(str(book_id))
        if not entry:
            raise BookSelectionError("That book is not in the Antilogicalism catalog.")
        return {**entry, "available": bool(
            entry.get("pdf_file_id") and self._path(str(book_id)).is_file()
        )}

    def list_books(self):
        """The full metadata catalog is cheap; never open a book text here."""
        return [self.description(entry["book_id"]) for entry in
                sorted(self.entries.values(), key=catalog_sort_key)]

    def get_index(self, book_id):
        book_id = str(book_id).strip()
        if not BOOK_ID.fullmatch(book_id):
            raise BookSelectionError("Choose a numeric book ID from the catalog.")
        info = self.description(book_id)
        if not info["pdf_file_id"]:
            raise BookSelectionError(
                "This book has no verified PDF link in the catalog; "
                "citations cannot be generated safely."
            )
        path = self._path(book_id)
        if not path.is_file():
            raise BookSelectionError(
                "This book's text shard is not installed locally. "
                "Check antilogicalism-library-data and data version."
            )
        with self._lock:
            if book_id in self._indexes:
                self._indexes.move_to_end(book_id)
                return self._indexes[book_id]
            try:
                with gzip.open(path, "rt", encoding="utf-8") as source:
                    document = json.load(source)
            except (OSError, ValueError, UnicodeDecodeError) as exc:
                raise BookSelectionError(
                    f"Book {book_id}'s compressed text could not be read: {exc}"
                ) from exc
            pages = []
            for page in document.get("pages", []):
                if not isinstance(page, dict):
                    continue
                text = page.get("text")
                if isinstance(text, str) and text.strip():
                    pages.append({"page": int(page["page"]), "text": text})
            if not pages:
                raise BookSelectionError(
                    "The selected book has no searchable text pages."
                )
            # The catalog's PDF ID and title belong to THIS selected book.
            source_book = {
                "book_id": book_id, "title": info["title"],
                "pdf_file_id": info["pdf_file_id"],
                "corpus_version": self.corpus_version,
            }
            index = PassageIndex([(source_book, sorted(
                pages, key=lambda p: p["page"]
            ))], self.tokenize, self.continuation)
            self._indexes[book_id] = index
            while len(self._indexes) > self.max_cached:
                self._indexes.popitem(last=False)
            return index

    def cached_ids(self):
        with self._lock:
            return list(self._indexes)
