"""Read-only source availability and lexical retrieval audit for benchmark works.

Optionally downloads the real public v47 book shards for the one-book cases,
checks catalog/PDF identity and reports original passages that the current
local selected-book index would find. No Ollama calls and no corpus edits.

Run: python scripts/audit_cross_discipline_sources.py
"""
import gzip
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import app
from benchmark_suite import load_suite
from grounded_pipeline import PassageIndex
from library_catalog import DRIVE_FILE

DATA = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v47/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")


def download(url, output):
    with urlopen(url, timeout=90) as result:
        data = result.read()
    output.write_bytes(data)
    return len(data)


def main():
    suite = load_suite(ROOT / "benchmarks" / "cross-disciplinary-v1.json")
    with TemporaryDirectory(prefix="reading-cross-disc-") as scratch:
        scratch = Path(scratch)
        cat_path = scratch / "library-catalog.json"
        download(CATALOG, cat_path)
        records = json.loads(cat_path.read_text(encoding="utf-8"))["books"]
        catalog = {str(b["id"]): b for b in records}
        analyzed = 0
        for case in suite["cases"]:
            if case["scope"] != "book":
                continue
            book_id = case["book_id"]
            assert book_id in catalog, f"Book {book_id} absent from website catalog"
            info = catalog[book_id]
            matched = DRIVE_FILE.match(info["url"])
            assert matched, f"Book {book_id} has no verified PDF file ID"
            path = scratch / f"book-{book_id}.json.gz"
            n = download(DATA + path.name, path)
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                document = json.load(handle)
            pages = document.get("pages", [])
            assert pages, f"Book {book_id} has no indexed text pages"
            meta = {
                "book_id": book_id, "title": info["title"],
                "author": info.get("author", ""),
                "subjects": info.get("subjects", []),
                "pdf_file_id": matched.group(1), "corpus_version": "v47",
            }
            index = PassageIndex(
                [(meta, pages)], app.tokenize,
                app.likely_page_continuation
            )
            results = index.search(case["question"], [case["question"]],
                                   limit=3)
            print(f"CASE {case['id']} | {info['title']} | "
                  f"compressed {n} bytes | {len(pages)} pages | "
                  f"{len(index.passages)} passages | "
                  f"{len(results)} lexical hits", flush=True)
            assert results, f"No original passage matches {case['id']}"
            for hit in results[:2]:
                assert hit["book_id"] == book_id
                assert hit["pdf_file_id"] == matched.group(1)
                assert hit["pages"] and hit["pages"][0] > 0
                print("  PDF p.", hit["pages"],
                      repr(hit["text"][:230]), flush=True)
            analyzed += 1
        assert analyzed == 7
        print("REAL V47 CROSS-DISCIPLINARY SOURCE AUDIT OK", flush=True)


if __name__ == "__main__":
    main()
