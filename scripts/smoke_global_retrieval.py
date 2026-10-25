"""Optional real-v48 smoke test for the existing full-text partitions.

This is separate from deterministic CI tests because it downloads public
corpus data. It DOES NOT call Ollama or modify the site's source repositories.

Use: python scripts/smoke_global_retrieval.py
"""
import gzip
import json
from pathlib import Path
import tempfile
import urllib.request

import sys
PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))
import app
from library_catalog import LibraryIndexRegistry
from whole_library import WholeLibraryLocator


BASE = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v48/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=80) as response:
        dest.write_bytes(response.read())
    return dest.stat().st_size


def main():
    with tempfile.TemporaryDirectory(prefix="reading-companion-v48-") as temp:
        root = Path(temp)
        corpus = root / "antilogicalism-library-data" / "data-v48"
        cat = root / "antilogicalism" / "digital-library" / "library-catalog.json"
        size = download(CATALOG, cat)
        print("Catalog bytes:", size, flush=True)
        filenames = [
            "manifest.json.gz", "terms-ha.json.gz", "terms-vi.json.gz",
            "terms-me.json.gz", "book-7.json.gz", "book-88.json.gz",
        ]
        for name in filenames:
            length = download(BASE + name, corpus / name)
            print("Fetched", name, length, "compressed bytes", flush=True)
        default = {
            "book_id": "7", "title": "Nicomachean Ethics — Aristotle",
            "pdf_file_id": "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY",
            "corpus_version": "v48",
        }
        index = app.PassageIndex(
            [(default, [{"page": 1,
                         "text": "The good life involves practical judgment and "
                                 "the gradual development of stable moral virtue."}])],
            app.tokenize,
        )
        registry = LibraryIndexRegistry(
            cat, root / "antilogicalism-library-data", "v48", default,
            index, corpus / "book-7.json.gz", app.tokenize,
            app.likely_page_continuation,
        )
        locator = WholeLibraryLocator(
            registry, app.tokenize, app.likely_page_continuation
        )
        questions = [
            "How do Aristotle and Tolstoy understand happiness?",
            "How do Aristotle and Tolstoy connect virtue and meaning?",
        ]
        for question in questions:
            result, metadata = locator.search(question)
            book_ids = set(result.chosen_books)
            print("QUERY", question)
            print("TERMS", metadata["terms"])
            print("MATCHED", json.dumps(metadata["candidate_books"],
                                        ensure_ascii=False)[:2500])
            print("INDEXED", len(result.passages), "passages from",
                  len(book_ids), "books")
            hits = result.search(question, [question])
            print("SELECTOR CANDIDATES", [(p["book_id"], p["pages"],
                                           p["source_id"]) for p in hits[:12]])
            assert {"7", "88"} <= book_ids, (
                "Expected both named authors to have matching source pages"
            )
            assert set(p["book_id"] for p in hits) == {"7", "88"}
            assert all(p["pdf_file_id"] in {
                "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY",
                "1L6LzGc2IDOPLPhYOKZGF4yx2m-cBxoiD",
            } for p in hits)
        print("REAL V48 CROSS-BOOK SMOKE OK")


if __name__ == "__main__":
    main()
