"""Read-only source audit of v1.4.5 across three real v47 books.

Uses existing indexed original texts only: no Ollama, source modifications,
embeddings or remote inference. Representative gap searches in this SCRIPT
are evaluation fixtures, NOT production rules for authors/questions.

Run: python scripts/audit_facet_recovery_v145.py
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
from evidence_coverage import recover_gap_evidence
from evidence_pipeline import render_argument_context
from grounded_pipeline import PassageIndex
from passage_quality import curate_candidates, source_kind
from quote_audit import audit_quotes

BOOK_BASE = ("https://raw.githubusercontent.com/jsynon/"
             "antilogicalism-library-data/main/data-v47/")
CATALOG = ("https://raw.githubusercontent.com/jsynon/"
           "antilogicalism/main/digital-library/library-catalog.json")

CASES = {
    "529": (
        "According to Darwin's On the Origin of Species, how does natural "
        "selection operate, and what roles do inherited variation and the "
        "struggle for existence play?"
    ),
    "152": (
        "According to Thucydides, what were the underlying causes of the "
        "Peloponnesian War, and how did they differ from the immediate "
        "disputes that preceded it?"
    ),
    "114": (
        "In Crime and Punishment, how does Raskolnikov attempt to justify "
        "murder, and how does the novel challenge his reasoning?"
    ),
}


def read(url, dest):
    with urlopen(url, timeout=100) as source:
        data = source.read()
    dest.write_bytes(data)
    return len(data)


def main():
    with TemporaryDirectory(prefix="v145-facet-") as tmp:
        root = Path(tmp)
        catalog_file = root / "library-catalog.json"
        read(CATALOG, catalog_file)
        catalog = {
            str(x["id"]): x for x in
            json.loads(catalog_file.read_text(encoding="utf-8"))["books"]
        }
        for bid, question in CASES.items():
            path = root / f"book-{bid}.json.gz"
            size = read(BOOK_BASE + path.name, path)
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                pages = json.load(stream)["pages"]
            meta = {
                "book_id": bid,
                "title": catalog[bid]["title"],
                "author": catalog[bid].get("author", ""),
                "subjects": catalog[bid].get("subjects", []),
                "corpus_version": "v47",
                "pdf_file_id": "verified-by-existing-catalog",
            }
            idx = PassageIndex(
                [(meta, pages)], app.tokenize,
                app.likely_page_continuation,
            )
            retrieved = idx.search(question, app.question_facets(question))
            kept, removed = curate_candidates(retrieved, question)
            print(f"\nBOOK {bid}: {size} compressed bytes; "
                  f"{len(idx.passages)} passages; {len(kept)}/{len(retrieved)} "
                  f"prose candidates; {len(removed)} nav removed",
                  flush=True)
            assert kept and all(p["book_id"] == bid for p in kept)
            assert all(source_kind(p) == "prose" for p in kept), (
                "A full contents page or OCR heading passed evidence curation"
            )

            if bid == "152":
                # The v1.4.4 model found the hidden underlying cause on page
                # 38 but lacked detailed prewar dispute passages. Show what
                # subject-directed supplemental search can find in the book.
                toc = [p for p in retrieved if 19 in p["pages"]]
                print("  PDF 19 original candidates:", [
                    (p["source_id"], source_kind(p)) for p in toc
                ], flush=True)
                assert toc, "Thucydides contents page fixture not retrieved"
                assert all(source_kind(p) == "navigation" for p in toc), (
                    "Original PDF contents page 19 must be navigational"
                )
                expanded, anchors, report = recover_gap_evidence(
                    idx, kept, kept[:6], ["Epidamnus", "Potidaea"]
                )
                print("  gap search:", report, flush=True)
                assert report["admitted"], (
                    "Real prewar disputes were not found in v47"
                )
                assert all(p["book_id"] == "152" for p in expanded)
                assert len(set(p["source_id"] for p in expanded)) == len(expanded)
                for source in report["admitted"]:
                    print("  NEW ORIGINAL", source["source_id"],
                          source["pages"], source["query"], flush=True)

            if bid == "114":
                # Check that two REAL selected fragments of the Porfiry
                # exchange are presented with original-order links; do not
                # claim that those links identify the speaker.
                original = [
                    p for p in idx.passages
                    if ("That wasn't quite my contention" in p["text"]
                        or "That wasn’t quite my contention" in p["text"])
                    and 465 in p["pages"]
                ]
                reported = [
                    p for p in idx.passages
                    if "In his article all men are divided" in p["text"]
                    and 464 in p["pages"]
                ]
                if original and reported:
                    a = {**original[0], "source_id": "S8"}
                    b = {**reported[0], "source_id": "S17"}
                    sections = json.loads(render_argument_context(
                        idx, [a, b], [a, b]
                    ))
                    print("  linked dialogue:",
                          sections[0]["nearby_selected_evidence"], flush=True)
                else:
                    print("  Speaker-specific test quotations unavailable "
                          "in this OCR edition; no synthetic attribution "
                          "is asserted.", flush=True)

            if bid == "529":
                source = next((p for p in idx.passages
                               if 80 in p["pages"] and
                               "struggle" in p["text"].lower()), None)
                assert source, "Darwin PDF page 80 unavailable"
                quote = audit_quotes(
                    {"paragraphs": [{
                        "text": 'Darwin wrote “an struggle for existence '
                                'inevitably follows from the high rate” '
                                'when describing natural selection.',
                        "source_ids": ["S1"],
                    }]},
                    [{**source, "source_id": "S1"}]
                )
                print("  quote mismatch caught:", quote["unmatched_count"],
                      flush=True)
                assert quote["unmatched_count"] == 1

        print("\nREAL V47 FACET-EVIDENCE SOURCE AUDIT OK", flush=True)


if __name__ == "__main__":
    main()
