"""ONE bounded, read-only real-v47 acceptance audit before the v1.5 demo.

Checks actual Darwin, Thucydides and Dostoevsky source passages against the
new deterministic question-part coverage and coherent original-scene format.
This does NOT call Ollama, certify answer truth, or modify either data repo.

    python scripts/audit_release_gate_v146.py
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
from evidence_structure import reserve_question_parts, final_part_coverage
from evidence_pipeline import render_argument_context
from grounded_pipeline import PassageIndex
from passage_quality import source_kind

BASE = ("https://raw.githubusercontent.com/jsynon/"
        "antilogicalism-library-data/main/data-v47/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")

CASES = (
    (
        "Darwin — mechanism",
        "529",
        "According to Darwin's On the Origin of Species, how does natural "
        "selection operate, and what roles do inherited variation and the "
        "struggle for existence play?",
    ),
    (
        "Thucydides — causes and immediate disputes",
        "152",
        "According to Thucydides, what were the underlying causes of the "
        "Peloponnesian War, and how did they differ from the immediate "
        "disputes that preceded it?",
    ),
    (
        "Dostoevsky — rationalization and challenge",
        "114",
        "In Crime and Punishment, how does Raskolnikov attempt to justify "
        "murder, and how does the novel challenge his reasoning?",
    ),
)


def fetch(url, dest):
    with urlopen(url, timeout=120) as response:
        blob = response.read()
    dest.write_bytes(blob)


def main():
    with TemporaryDirectory(prefix="reading-v146-quality-gate-") as directory:
        root = Path(directory)
        catalog_path = root / "catalog.json"
        fetch(CATALOG, catalog_path)
        catalog = {
            str(b["id"]): b
            for b in json.loads(catalog_path.read_text(encoding="utf-8"))["books"]
        }
        for name, bid, question in CASES:
            text_file = root / ("book-" + bid + ".json.gz")
            fetch(BASE + text_file.name, text_file)
            with gzip.open(text_file, "rt", encoding="utf-8") as stream:
                pages = json.load(stream)["pages"]
            entry = catalog[bid]
            source = {
                "book_id": bid, "title": entry["title"],
                "author": entry.get("author", ""),
                "subjects": entry.get("subjects", []),
                "pdf_file_id": entry["url"].split("/d/")[-1].split("/")[0],
                "corpus_version": "v47",
            }
            index = PassageIndex(
                [(source, pages)], app.tokenize,
                app.likely_page_continuation
            )
            facets = app.question_facets(question)
            assert len(facets) >= 2, (
                "Expected independent parts in the real benchmark question"
            )
            candidates = index.search(question, facets, limit=24)
            assert len(candidates) >= 2
            model_selection = candidates[:1]  # intentionally omitted later parts
            source_pool, selected, report = reserve_question_parts(
                index, facets, candidates, model_selection
            )
            evidence = final_part_coverage(index, facets, selected)
            assert len(evidence) == len(facets)
            assert all(not e["claim_semantically_verified"] for e in evidence)
            assert len(selected) <= 6
            assert len({p["source_id"] for p in source_pool}) == len(source_pool)
            assert all(p["book_id"] == bid for p in source_pool)
            assert all(source_kind(p) == "prose" for p in selected)
            scenes = json.loads(render_argument_context(
                index, selected, selected
            ))
            flattened = [
                p["source_id"] for scene in scenes
                for p in scene["reading_sequence"]
            ]
            assert len(flattened) == len(set(flattened))
            assert set(flattened) == {p["source_id"] for p in selected}
            print("\n" + name, flush=True)
            print("  facets", facets, flush=True)
            print("  source search", report["status"],
                  "new", len(report["added"]), flush=True)
            for p in report["added"]:
                original = next(x for x in selected
                                if x["source_id"] == p["source_id"])
                print("    original PDF pages", original["pages"],
                      "topic", p["part"],
                      "excerpt", repr(original["text"][:360]), flush=True)
            print("  lexical coverage", [
                {"part": x["part"], "present": x["lexical_evidence_present"]}
                for x in evidence
            ], flush=True)
            print("  original reading scenes", [
                (s["scene_type"], s["core_source_ids"])
                for s in scenes
            ], flush=True)
            if bid == "152":
                # The absent first-model hint is the specific v1.4.5 failure.
                # We expect at least one mandatory original to be recovered
                # without relying on Gemma to volunteer a named dispute.
                assert report["added"], (
                    "The question-part evidence gap remains unaddressed"
                )

        print("\nREAL V47 FINAL QUALITY-GATE SOURCE AUDIT OK", flush=True)


if __name__ == "__main__":
    main()
