"""Read-only v47 audit for the two-call *conceptual* source-discovery route.

This script provides illustrative *model-style search hints*, not an Ollama
inference or a hardcoded runtime plan. The production planner generates
themes per named author. We check that author-scoped search retrieves the
right ACTUAL works/pages instead of the former generic word "thought".

Run:
  python scripts/smoke_conceptual_v142.py

All public files are downloaded to a temporary directory. No source text
repository is modified, and no model/API call is made.
"""
import json
from pathlib import Path
import sys
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app
from library_catalog import LibraryIndexRegistry
from whole_library import WholeLibraryLocator

BASE = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v47/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")
QUESTION = "What would Nietzsche think about Kierkegaard's thought?"


def fetch(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=100) as response:
        blob = response.read()
    path.write_bytes(blob)
    return len(blob)


def main():
    with tempfile.TemporaryDirectory(prefix="conceptual-v142-") as temp:
        root = Path(temp)
        corpus = root / "antilogicalism-library-data" / "data-v47"
        catalog = root / "antilogicalism" / "digital-library" / "library-catalog.json"
        fetch(CATALOG, catalog)
        fetch(BASE + "manifest.json.gz", corpus / "manifest.json.gz")
        default = {
            "book_id": "7", "title": "Nicomachean Ethics — Aristotle",
            "pdf_file_id": "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY",
            "corpus_version": "v47",
        }
        default_index = app.PassageIndex([
            (default, [{"page": 1, "text":
                         "Reading primary source philosophy takes patience."}])
        ], app.tokenize)
        registry = LibraryIndexRegistry(
            catalog, root / "antilogicalism-library-data", "v47",
            default, default_index, corpus / "book-7.json.gz",
            app.tokenize, app.likely_page_continuation,
        )
        locator = WholeLibraryLocator(
            registry, app.tokenize, app.likely_page_continuation
        )
        groups = locator._authors_mentioned(QUESTION)
        print("AUTHORS", json.dumps(groups), flush=True)
        assert len(groups) == 2
        # Representative topic vocabulary for each thinker: only searched
        # if it exists in the real v47 postings. Not installed in production.
        illustrative = {
            "nietzsche": ["christian", "morality", "ascetic", "guilt"],
            "kierkegaard": ["faith", "paradox", "god", "religion"],
        }
        author_topics = {}
        for group in groups:
            label = group["author"]
            example = next(
                (words for suffix, words in illustrative.items()
                 if suffix in label), None
            )
            assert example is not None, label
            author_topics[label] = example
        print("SEARCH HINTS", json.dumps(author_topics), flush=True)
        manifest = locator._manifest_data()
        for words in author_topics.values():
            for prefix in {term[:2] for term in words}:
                dest = corpus / f"terms-{prefix}.json.gz"
                if not dest.exists():
                    fetch(BASE + dest.name, dest)
        # Placeholder shard paths let discovery rank each compatible book
        # without fetching all 644 source texts.
        for book_id in manifest["books"]:
            (corpus / f"book-{book_id}.json.gz").touch()
        scored = {}
        for group in groups:
            by_author, terms, _ = locator._rank_page_candidates(
                QUESTION, manifest,
                terms_override=author_topics[group["author"]]
            )
            for bid in group["book_ids"]:
                if bid in by_author:
                    scored[bid] = by_author[bid]
        ranked = sorted(scored, key=lambda bid: -scored[bid]["score"])
        for bid in ranked[:12]:
            item = scored[bid]
            print("RANK", bid, item["meta"]["title"],
                  "score", round(item["score"], 2),
                  "concepts", item["max_concepts"],
                  "multi_term_pages", item["multi_term_pages"],
                  flush=True)
        chosen, required = locator._select_books(scored, groups, 4)
        print("SELECTED BOOKS", chosen, flush=True)
        print("AUTHOR REQUIREMENTS", required, flush=True)
        for bid in chosen:
            fetch(BASE + f"book-{bid}.json.gz",
                  corpus / f"book-{bid}.json.gz")
        index, discovery = locator.search(
            QUESTION, concept_plan={"author_topics": author_topics}
        )
        passages = index.search(QUESTION, [QUESTION])
        for p in passages[:16]:
            print("PASSAGE", p["source_id"], p["book_id"],
                  p["title"], "PDF p.", p["pages"],
                  p["text"][:230].replace("\n", " "), flush=True)
        selected_authors = {
            g["author"]: set(g["book_ids"])
            for g in discovery["required_author_groups"]
        }
        assert len(selected_authors) == 2
        assert all(ids for ids in selected_authors.values())
        assert discovery["book_shards_opened"] <= 4
        assert discovery["page_count"] <= 36
        assert discovery["retrieval_strategy"] == "author_specific_concept_plan"
        assert {p["book_id"] for p in passages} == set(index.chosen_books)
        print("REAL V47 CONCEPTUAL SOURCE AUDIT OK", flush=True)


if __name__ == "__main__":
    main()
