"""Read-only v47 audit of passage quality in three disciplines.

This audit loads exactly the THREE already-existing books used in the live
v1.4.3 test reports, into a TEMP directory, and verifies that the retrieval
stage now prefers original prose over table-of-contents fragments.

It does not call Ollama, score semantic truth, rewrite any book shard, or
alter the user's indexed corpus. Network access required.

    python scripts/audit_source_quality_v144.py
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
from grounded_pipeline import PassageIndex
from passage_quality import source_form, curate_candidates, discourse_cues

BASE = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v47/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")

CHECKS = (
    (
        "Darwin — mechanism",
        "529",
        "According to Darwin's On the Origin of Species, how does natural "
        "selection operate, and what roles do inherited variation and the "
        "struggle for existence play?",
        80,
    ),
    (
        "Thucydides — underlying versus immediate causes",
        "152",
        "According to Thucydides, what were the underlying causes of the "
        "Peloponnesian War, and how did they differ from the immediate "
        "disputes that preceded it?",
        38,
    ),
    (
        "Dostoevsky — character's justification and novel's response",
        "114",
        "In Crime and Punishment, how does Raskolnikov attempt to justify "
        "murder, and how does the novel challenge his reasoning?",
        465,
    ),
)


def fetch(url, dest):
    with urlopen(url, timeout=90) as request:
        data = request.read()
    dest.write_bytes(data)
    return len(data)


def main():
    with TemporaryDirectory(prefix="v144-source-quality-") as directory:
        temp = Path(directory)
        catalog_file = temp / "catalog.json"
        fetch(CATALOG, catalog_file)
        entries = {
            str(e["id"]): e
            for e in json.loads(catalog_file.read_text(encoding="utf-8"))["books"]
        }
        for label, book_id, question, key_page in CHECKS:
            entry = entries[book_id]
            path = temp / f"book-{book_id}.json.gz"
            bytes_read = fetch(BASE + path.name, path)
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                raw = json.load(stream)
            book = {
                "book_id": book_id,
                "title": entry["title"],
                "author": entry.get("author", ""),
                "subjects": entry.get("subjects", []),
                "pdf_file_id": "actual-id-remains-in-original-catalog",
                "corpus_version": "v47",
            }
            index = PassageIndex(
                [(book, raw["pages"])], app.tokenize,
                app.likely_page_continuation,
            )
            facets = app.question_facets(question)
            original = index.search(question, facets, limit=24)
            curated, removed = curate_candidates(original, question)
            prose = [p for p in curated
                     if source_form(p["text"])["kind"] == "prose"]
            print("\n" + label, flush=True)
            print("  downloaded", bytes_read, "bytes;",
                  "passages", len(index.passages), flush=True)
            print("  retrieved", len(original), "retained", len(curated),
                  "navigation removed", len(removed), flush=True)
            assert len(original) > 8, "The real source index is unexpectedly empty"
            assert len(prose) >= 4, "Not enough meaningful prose reached the selector"
            assert not removed or all(x["source_id"] not in {
                p["source_id"] for p in curated
            } for x in removed)
            assert all(p["book_id"] == book_id for p in curated)
            assert len({p["source_id"] for p in curated}) == len(curated)
            relevant = [
                p for p in curated if key_page in p["pages"]
            ]
            print("  diagnostic key page", key_page,
                  "retained", len(relevant) > 0, flush=True)
            for p in curated[:5]:
                flags = discourse_cues(p["text"])
                print("   ", p["source_id"], "PDF", p["pages"],
                      source_form(p["text"])["kind"],
                      "report:", flags["reported_speech_present"],
                      "opening_fragment:", flags["opening_fragment"],
                      repr(p["text"][:150]), flush=True)
            print("  retained references:", [
                {"page": p["pages"][0],
                 "form": source_form(p["text"])["kind"]}
                for p in curated[:8]
            ], flush=True)
        print("\nREAL V47 THREE-DISCIPLINE SOURCE-QUALITY AUDIT OK",
              flush=True)


if __name__ == "__main__":
    main()
