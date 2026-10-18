"""v1.4.4 source-quality and attribution contracts from three live failures.

Regression passages are short real/synthetic *test inputs*. Runtime has no
Darwin/Thucydides/Dostoevsky rules and no human answer key. These tests only
establish ranking, context visibility, and stable source citations; they do
not establish that Gemma's resulting interpretation is semantically true.
"""
import json
import unittest

import app
from evidence_pipeline import (
    answer_evidence_first, context_dependencies, render_argument_context,
    select_neighbor_context, choose_evidence,
)
from grounded_pipeline import PassageIndex
from passage_quality import (
    source_form, discourse_cues, curate_candidates, asks_for_book_structure
)


BOOK = {
    "book_id": "61", "title": "A Work on Natural Science — Example",
    "pdf_file_id": "placeholder-original-pdf-id", "corpus_version": "test-v47",
}
CONTENTS = (
    "Causes of variability—Effects of habit and the use or disuse of parts—"
    "Correlated variation—Inheritance—Character of domestic varieties—"
    "Origin of domestic varieties from one or more species—Principles of "
    "selection—Unknown origin of our domestic productions—Circumstances "
    "favourable to selection."
)
HEADING = "STRUGGLE FOR ExISTENCE . . . . . . . CHAPTER IV"
THUCYDIDES_HEADING = "16 CAUSES OF THE PELOPONNESIAN WAR {24"
DARWIN_CORE = (
    "Owing to this struggle, variations, however slight and from whatever "
    "cause proceeding, if they be in any degree profitable to the individuals "
    "of a species, will tend to the preservation of such individuals, and "
    "will generally be inherited by the offspring. I have called this "
    "principle Natural Selection."
)
HISTORY_REPORT = (
    "The Corinthians spoke as follows: These Corcyraeans in the speech "
    "we have just heard do not confine themselves to the question of their "
    "reception into your alliance. According to them their old policy of "
    "refusing all offers of alliance was a policy of moderation."
)
NOVEL_DIALOGUE = (
    "have no right to transgress the law, because they are ordinary. "
    "But extraordinary men have a right to commit any crime and to "
    "transgress the law in any way, just because they are extraordinary. "
    "That was your idea, if I am not mistaken? The listener smiled, "
    "and decided to take up the challenge."
)
COMPLETE_PROSE = (
    "An explanation makes clear why useful differences among organisms "
    "become more common when their descendants inherit those differences."
)


def index_of(pages, book=BOOK):
    return PassageIndex(
        [(book, [{"page": i + 1, "text": text}
                 for i, text in enumerate(pages)])], app.tokenize,
    )


class Provider:
    def __init__(self):
        self.calls = []
    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append({
            "stage": stage, "system": system, "user": user,
        })
        if stage == "evidence_selection":
            ids = [x["source_id"] for x in
                   json.loads(user.split("Candidate primary-source passages:\n", 1)[1])]
            return {"source_ids": ids[:2]}
        if stage == "evidence_grounded_synthesis":
            # The test is checking the protocol and source provenance, NOT
            # whether this synthetic explanation is philosophically right.
            passages = json.loads(user.split(
                "Do not mistake an example or an objection for the "
                "author's conclusion:\n", 1)[1])
            sid = passages[0]["core_source_id"]
            return {
                "paragraphs": [{
                    "text": "The cited original source passage contains "
                            "substantive prose rather than a contents entry.",
                    "source_ids": [sid],
                }],
                "follow_up_questions": [],
            }
        raise AssertionError("An unexpected extra inference call occurred")


class PassageQualityTests(unittest.TestCase):
    def test_darwin_chapter_heading_is_not_substantive_evidence(self):
        verdict = source_form(HEADING)
        self.assertEqual(verdict["kind"], "navigation")
        self.assertLess(verdict["ranking_multiplier"], .10)

    def test_long_contents_list_is_detected_even_with_many_topic_words(self):
        self.assertEqual(source_form(CONTENTS)["reason"], "contents_list")
        self.assertEqual(source_form(THUCYDIDES_HEADING)["kind"], "navigation")

    def test_full_original_argument_and_short_definition_remain_eligible(self):
        self.assertEqual(source_form(DARWIN_CORE)["kind"], "prose")
        self.assertEqual(source_form(HISTORY_REPORT)["kind"], "prose")
        self.assertEqual(source_form(NOVEL_DIALOGUE)["kind"], "prose")
        self.assertEqual(source_form("A cause produces an effect.")["kind"],
                         "prose")

    def test_scientific_ranking_deprioritizes_navigation(self):
        idx = index_of([
            CONTENTS, HEADING, DARWIN_CORE, COMPLETE_PROSE,
        ])
        q = "How does natural selection work in the struggle for existence?"
        hits = idx.search(q, [q], limit=4)
        substantive = [
            x["source_id"] for x in hits
            if source_form(x["text"])["kind"] == "prose"
        ]
        self.assertTrue(substantive)
        self.assertEqual(source_form(hits[0]["text"])["kind"], "prose")

    def test_quality_curation_removes_navigation_only_when_prose_is_available(self):
        passages = [
            {"source_id": f"S{i+1}", "pages": [i+1], "text": body}
            for i, body in enumerate([
                CONTENTS, DARWIN_CORE, HEADING, COMPLETE_PROSE,
                HISTORY_REPORT, NOVEL_DIALOGUE, DARWIN_CORE,
            ])
        ]
        remaining, excluded = curate_candidates(
            passages, "How does natural selection relate to inheritance?"
        )
        self.assertEqual({p["source_id"] for p in excluded},
                         {"S1", "S3"})
        self.assertEqual([p["source_id"] for p in remaining],
                         ["S2", "S4", "S5", "S6", "S7"])

    def test_navigation_is_not_erased_for_an_explicit_contents_request(self):
        self.assertTrue(asks_for_book_structure(
            "List the chapters in this book's table of contents."))
        cases = [{"source_id": "S1", "pages": [2], "text": CONTENTS},
                 {"source_id": "S2", "pages": [3], "text": DARWIN_CORE}]
        remaining, excluded = curate_candidates(
            cases, "What is in the table of contents?")
        self.assertEqual(len(remaining), 2)
        self.assertEqual(excluded, [])

    def test_thin_ocr_retrieval_preserves_available_sources(self):
        cases = [{"source_id": "S1", "pages": [3], "text": HEADING},
                 {"source_id": "S2", "pages": [4], "text": COMPLETE_PROSE}]
        remaining, excluded = curate_candidates(
            cases, "How is selection explained?")
        self.assertEqual(remaining, cases)
        self.assertFalse(excluded)

    def test_historical_report_marked_as_possible_attribution_risk(self):
        flags = discourse_cues(HISTORY_REPORT)
        self.assertTrue(flags["reported_speech_present"])
        self.assertFalse(flags["opening_fragment"])

    def test_dialogue_opening_fragment_not_claimed_to_be_author_view(self):
        flags = discourse_cues(NOVEL_DIALOGUE)
        self.assertTrue(flags["opening_fragment"])
        self.assertTrue(context_dependencies(NOVEL_DIALOGUE)[0])

    def test_dialogue_can_recover_preceding_same_book_source(self):
        idx = index_of([
            "The investigator challenged the theory in a conversation. "
            "He then asked the young man to explain his distinction.",
            NOVEL_DIALOGUE,
        ])
        q = "How do extraordinary people justify transgression?"
        hits = idx.search(q, [q], limit=24)
        anchor = next(p for p in hits if p["page"] == 2)
        selected, added = select_neighbor_context(idx, [anchor], hits)
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]["context_role"], "preceding")
        self.assertEqual(added[0]["pages"], [1])
        sections = json.loads(render_argument_context(
            idx, [anchor], selected
        ))
        seq = sections[0]["reading_sequence"]
        self.assertEqual([p["pages"] for p in seq], [[1], [2]])
        self.assertTrue(seq[1]["discourse_cues"]["opening_fragment"])
        self.assertIsInstance(sections[0]["core_original_position"], int)

    def test_model_selection_excludes_contents_entries_and_remains_two_calls(self):
        idx = index_of([
            CONTENTS, HEADING, DARWIN_CORE, COMPLETE_PROSE,
            "Some individuals have inherited useful properties that "
            "contribute to their survival when resources are scarce.",
            "Over many generations successful variants leave more "
            "offspring, thereby changing the population gradually.",
            "The limited supply of food means that not all organisms "
            "can survive and reproduce successfully.",
            HISTORY_REPORT,
        ])
        q = "What is natural selection and inherited variation?"
        provider = Provider()
        result = answer_evidence_first(
            q, [], idx, [q], provider, "reading-companion-v1.4.4"
        )
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual([x["stage"] for x in provider.calls],
                         ["evidence_selection", "evidence_grounded_synthesis"])
        stage = result["diagnostics"]["retrieval"]["evidence_selection"]
        removed = stage["passage_quality"]["excluded_navigation"]
        self.assertTrue(removed)
        self.assertTrue(all(
            source_form(p["text"])["kind"] == "prose"
            for p in result["diagnostics"]["retrieval"]["primary"]
        ))
        self.assertTrue(all(
            source_form(p["excerpt"])["kind"] == "prose"
            for p in result["sources"]
        ))

    def test_composer_has_explicit_attribution_and_chronology_constraints(self):
        idx = index_of([HISTORY_REPORT, NOVEL_DIALOGUE, DARWIN_CORE])
        provider = Provider()
        q = "How do extraordinary people transgress the law?"
        result = answer_evidence_first(
            q, [], idx, [q], provider, "reading-companion-v1.4.4"
        )
        self.assertEqual(result["outcome"], "draft")
        system = provider.calls[-1]["system"]
        self.assertIn("Historical speeches may report", system)
        self.assertIn("FINAL admission", system)
        self.assertNotIn("Dostoevsky", system)
        self.assertNotIn("Thucydides", system)


if __name__ == "__main__":
    unittest.main()
