"""Read-only v1.4.1 source-selection audit against the real public v47 index.

Fetches a manifest, the original website catalog, only required term shards,
and at most four book text shards per query. No Ollama call is made and no
source corpus is altered. Prints *retrieval evidence*, not a model answer.
Run: python scripts/smoke_relevance_v141.py
"""
import json
from pathlib import Path
import sys
import tempfile
from urllib.request import urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app
from whole_library import WholeLibraryLocator
from library_catalog import LibraryIndexRegistry

BASE = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v47/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")
QUESTIONS = (
    "How do Aristotle and Tolstoy understand happiness and the good life?",
    "How do different authors in the library approach the question of life's meaning?",
)


def fetch(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=90) as response:
        raw = response.read()
    path.write_bytes(raw)
    return len(raw)


def main():
    with tempfile.TemporaryDirectory(prefix="relevance-v141-") as temp:
        temp = Path(temp)
        corpus = temp / "antilogicalism-library-data" / "data-v47"
        catalog_path = temp / "antilogicalism" / "digital-library" / "library-catalog.json"
        fetch(CATALOG, catalog_path)
        fetch(BASE + "manifest.json.gz", corpus / "manifest.json.gz")
        default = {
            "book_id": "7", "title": "Nicomachean Ethics — Aristotle",
            "pdf_file_id": "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY",
            "corpus_version": "v47",
        }
        default_index = app.PassageIndex([
            (default, [{"page": 1, "text":
                        "A practice of virtue helps readers consider the good life."}])
        ], app.tokenize)
        registry = LibraryIndexRegistry(
            catalog_path, temp / "antilogicalism-library-data", "v47",
            default, default_index, corpus / "book-7.json.gz",
            app.tokenize, app.likely_page_continuation,
        )
        locator = WholeLibraryLocator(
            registry, app.tokenize, app.likely_page_continuation
        )
        manifest = locator._manifest_data()
        # Empty files allow *ranking* any indexed book without downloading
        # its shard. The search itself overwrites ONLY the chosen shards.
        for bid in manifest["books"]:
            (corpus / f"book-{bid}.json.gz").touch()
        for question in QUESTIONS:
            groups = locator._authors_mentioned(question)
            terms = locator._terms(question, groups)
            print("QUESTION", question, flush=True)
            print("AUTHOR GROUPS", json.dumps(groups), flush=True)
            print("SUBJECT TERMS", terms, flush=True)
            for prefix in {term[:2] for term in terms}:
                path = corpus / f"terms-{prefix}.json.gz"
                if not path.exists():
                    fetch(BASE + path.name, path)
            scored, terms, groups = locator._rank_page_candidates(question, manifest)
            ranked = sorted(scored, key=lambda bid: -scored[bid]["score"])
            for bid in ranked[:10]:
                hit = scored[bid]
                print("RANKED", bid,
                      round(hit["score"], 2),
                      hit["meta"]["title"][:85],
                      "coverage", hit["max_concepts"],
                      "multi_term_pages", hit["multi_term_pages"],
                      "topic_density", hit["topic_density"],
                      "matched_pages", hit["matches"], flush=True)
            chosen, required = locator._select_books(scored, groups, 4)
            print("SELECTED", chosen, flush=True)
            print("REQUIRED", required, flush=True)
            for bid in chosen:
                fetch(BASE + f"book-{bid}.json.gz",
                      corpus / f"book-{bid}.json.gz")
            result, discovery = locator.search(question)
            print("CANDIDATES", json.dumps([
                {"book_id": x["book_id"], "page": x["pages"],
                 "text": x["text"][:160]}
                for x in result.search(question, [question])[:14]
            ], ensure_ascii=False), flush=True)
            print("OPENED", discovery["book_shards_opened"],
                  "source books", discovery["page_count"],
                  "pages", flush=True)
            if "Aristotle" in question:
                assert len(discovery["required_author_groups"]) == 2
                authors = {
                    k["author"] for k in discovery["required_author_groups"]
                }
                assert authors == {"aristotle", "leo tolstoy"}
                candidate_books = set(result.chosen_books)
                assert candidate_books & {"7", "12", "293"}
                assert candidate_books & {"88", "258"}
            else:
                assert discovery["authors_detected"] == 0, (
                    "Generic phrase 'different authors' is not a named author"
                )
                assert discovery["terms"] == ["life", "meaning"]
            print("AUDIT QUERY OK", flush=True)
        print("REAL V47 RELEVANCE AUDIT OK")


if __name__ == "__main__":
    main()
