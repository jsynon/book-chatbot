"""Final v1.4.6 quality-gate contracts: content, not another model contest.

These tests exercise the structural improvement across generic history,
science and literature-style prose without author-specific retrieval rules.
They CANNOT certify semantic correctness. The one-book demo, full-library
source IDs and two-call ceiling are checked by the existing test suites.
"""
import json
import unittest

import app
from evidence_structure import reserve_question_parts, final_part_coverage
from evidence_pipeline import answer_evidence_first, render_argument_context
from grounded_pipeline import PassageIndex


BOOK = {
    "book_id": "51", "title": "A Primary History — Example",
    "pdf_file_id": "ExamplePrimaryOriginalPdf", "corpus_version": "test-v47",
}
OTHER = {
    "book_id": "52", "title": "A Separate Original Novel",
    "pdf_file_id": "SecondOriginalPdf", "corpus_version": "test-v47",
}

CORE = (
    "The principal underlying cause of the conflict was the increasing "
    "power of the empire, which alarmed neighboring states. The historian "
    "carefully distinguishes structural rivalry from the immediate "
    "diplomatic quarrels, and explains that neither should be treated "
    "as a full account on its own."
)
FILLER = (
    "The historian describes the imperial rivalry in broad terms and "
    "observes that different states interpreted the regional balance "
    "differently. This paragraph contains some additional background "
    "on political fears and changing alignments, but provides no "
    "particular account of the immediate diplomatic incidents."
)
EVIDENCE = (
    "The immediate disputes arose from incompatible demands over trading "
    "ports and the protection of small allied cities. Rival commanders "
    "sent emissaries to negotiate before fighting began, but the demands "
    "could not be reconciled. These local diplomatic incidents therefore "
    "accelerated a conflict whose underlying causes had developed earlier."
)
OTHER_EVIDENCE = (
    "A second immediate dispute concerned the divided allegiance of a "
    "coastal colony. The imperial side ordered the removal of defenses "
    "while local leaders refused. Their rival alliances brought a "
    "long-standing power struggle into the open before the major war."
)

REPORTED = (
    "The investigator explained that the accused had written an article "
    "defending an exceptional person's right to cross ordinary moral "
    "boundaries. The investigator then exaggerated this claim, saying "
    "that the writer believed there should be no constraints whatsoever."
)
REPLY = (
    "The accused replied that the interpretation was not quite accurate. "
    "His argument, he said, had been qualified by a proposed benefit to "
    "others; he had never claimed that exceptional people were entitled "
    "to do anything without distinction."
)


def make_index(pages, second=None):
    books = [(BOOK, [
        {"page": n + 1, "text": text} for n, text in enumerate(pages)
    ])]
    if second:
        books.append((OTHER, [
            {"page": n + 1, "text": text} for n, text in enumerate(second)
        ]))
    return PassageIndex(books, app.tokenize)


def numbered(index, positions):
    return [{**index.passages[i], "source_id": f"S{j + 1}"}
            for j, i in enumerate(positions)]


class FirstSelectorProvider:
    """Select original sources and expressly request NO gap lookup."""
    def __init__(self):
        self.calls = []
        self.sections = None

    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append(stage)
        if stage == "evidence_selection":
            previews = json.loads(user.split(
                "Candidate primary-source passages:\n", 1)[1])
            # The model only picks one item and never volunteers a search.
            return {
                "source_ids": [previews[0]["source_id"]],
                "supplemental_queries": [],
            }
        if stage == "evidence_grounded_synthesis":
            self.sections = json.loads(user.split(
                "Do not mistake an example or an objection for the "
                "author's conclusion:\n", 1)[1])
            ids = [
                sid for unit in self.sections
                for sid in unit["core_source_ids"]
            ]
            return {
                "paragraphs": [{
                    "text": "The historical evidence distinguishes the "
                            "underlying explanation from the immediately "
                            "preceding diplomatic incidents.",
                    "source_ids": ids[:2],
                }],
                "follow_up_questions": [],
            }
        raise AssertionError("Unexpected third inference call")


class SourceStructureTests(unittest.TestCase):
    def test_two_facets_reserve_original_evidence_even_without_model_hints(self):
        idx = make_index([CORE, FILLER, FILLER, FILLER, EVIDENCE,
                          OTHER_EVIDENCE])
        selected = numbered(idx, [0, 1, 2, 3, 4, 5])
        # One model-selected passage concerns only the underlying cause.
        candidates, anchors, audit = reserve_question_parts(
            idx,
            ["What is the principal underlying cause of the conflict?",
             "How did immediate disputes over trading ports precede it?"],
            selected, selected[:1]
        )
        self.assertEqual(audit["model_calls_added"], 0)
        self.assertEqual(audit["status"], "facet_passages_reserved")
        self.assertTrue(audit["added"])
        self.assertTrue(any("trading ports" in p["text"] for p in anchors))
        self.assertTrue(all(p["book_id"] == "51" for p in anchors))
        self.assertEqual(len({p["source_id"] for p in candidates}),
                         len(candidates))
        self.assertLessEqual(len(anchors), 6)

    def test_nearby_moral_theory_and_reply_become_one_ordered_source_scene(self):
        idx = make_index([REPORTED, REPLY, CORE])
        late, early = numbered(idx, [1, 0])
        scene = json.loads(render_argument_context(
            idx, [late, early], [late, early]
        ))
        self.assertEqual(len(scene), 1)
        self.assertEqual(scene[0]["scene_type"], "adjacent_original_argument")
        self.assertFalse(scene[0]["speaker_identity_verified"])
        self.assertEqual(set(scene[0]["core_source_ids"]), {"S1", "S2"})
        sequence = scene[0]["reading_sequence"]
        self.assertEqual([p["text"] for p in sequence], [REPORTED, REPLY])
        self.assertEqual(len(sequence), 2)  # no duplicated source prose

    def test_distant_novel_and_history_excerpts_never_join_scenes(self):
        idx = make_index([REPORTED], [REPLY])
        a, b = numbered(idx, [0, 1])
        scenes = json.loads(render_argument_context(idx, [a, b], [a, b]))
        self.assertEqual(len(scenes), 2)
        self.assertTrue(all(
            unit["scene_type"] == "individual_original_argument"
            for unit in scenes
        ))

    def test_explicit_gap_lookup_not_needed_for_two_call_coverage(self):
        idx = make_index([CORE, FILLER, EVIDENCE, OTHER_EVIDENCE])
        question = (
            "What was the underlying cause of the conflict, "
            "and how did immediate disputes over trading ports precede it?"
        )
        facets = [
            "What was the underlying cause of the conflict?",
            "How did immediate disputes over trading ports precede it?"
        ]
        provider = FirstSelectorProvider()
        result = answer_evidence_first(
            question, [], idx, facets, provider,
            "reading-companion-v1.4.6"
        )
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(provider.calls, [
            "evidence_selection", "evidence_grounded_synthesis"
        ])
        stage = result["diagnostics"]["retrieval"]["evidence_selection"]
        self.assertEqual(
            stage["gap_retrieval"]["reason"], "not_needed_or_single_part"
        )
        self.assertTrue(
            stage["question_part_coverage"]["added"],
            "Coverage must not depend on Gemma volunteering gap queries."
        )
        self.assertLessEqual(len(stage["bounded_ids"]), 6)
        parts = stage["final_facet_evidence"]
        self.assertEqual(len(parts), 2)
        self.assertTrue(all(
            not record["claim_semantically_verified"] for record in parts
        ))
        self.assertTrue(any(
            "trading ports" in unit["text"]
            for scene in provider.sections
            for unit in scene["reading_sequence"]
        ))

    def test_short_or_unrelated_text_does_not_manufacture_facet_coverage(self):
        idx = make_index([CORE, "A trading port.", REPORTED, REPLY])
        # The short "A trading port." fragment is correctly omitted
        # by the underlying passage index's minimum-term threshold.
        original = numbered(idx, [0, 1, 2])
        candidates, anchors, trace = reserve_question_parts(
            idx, [
                "What caused the conflict?",
                "How did maritime trading disputes begin?",
            ], original, original[:1]
        )
        self.assertEqual(trace["added"], [])
        self.assertTrue(all(p["book_id"] == "51" for p in anchors))
        coverage = final_part_coverage(idx, [
            "What caused the conflict?",
            "How did maritime trading disputes begin?",
        ], anchors)
        self.assertEqual(len(coverage), 2)
        self.assertFalse(coverage[-1]["claim_semantically_verified"])

    def test_source_scene_retains_one_book_page_identity_across_context(self):
        idx = make_index([REPORTED, REPLY, EVIDENCE])
        before, after = numbered(idx, [0, 1])
        units = json.loads(render_argument_context(
            idx, [after, before], [after, before]
        ))
        self.assertEqual(len(units), 1)
        self.assertEqual(
            [entry["pages"] for entry in units[0]["reading_sequence"]],
            [[1], [2]]
        )
        self.assertEqual(
            {entry["source_id"] for entry in units[0]["reading_sequence"]},
            {"S1", "S2"}
        )


if __name__ == "__main__":
    unittest.main()
