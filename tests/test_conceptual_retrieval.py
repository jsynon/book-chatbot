"""Hypothetical author comparisons use planning + synthesis (TWO calls).

All source text is invented test prose, with synthetic v47 manifest/postings
from test_whole_library. Assertions check source coverage and the absence of a
third selector call; the planner's topic hints are never treated as evidence.
"""
import json
import unittest
import urllib.request
from unittest.mock import patch

import app
from conceptual_retrieval import (
    conceptual_search_plan, needs_concept_plan, _validated_topic_words
)
from inference import CompletionError
from tests import test_whole_library as fixtures


class PlannerProvider:
    def __init__(self, malformed=False):
        self.calls = []
        self.malformed = malformed

    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append(stage)
        if stage == "conceptual_retrieval_plan":
            if self.malformed:
                return {"author_1_topics": ["thought", "idea"]}
            return {
                "author_1_topics": ["virtue", "happiness", "practical wisdom"],
                "author_2_topics": ["faith", "meaning", "happiness"],
            }
        if stage == "evidence_grounded_synthesis":
            # The deterministic, book-balanced index gives S1 and S2
            # different real books. The composer must cite only those IDs.
            return {
                "paragraphs": [{
                    "text": "These are distinct original passages. One "
                            "describes happiness through virtue and another "
                            "describes meaning through faith and lived life.",
                    "source_ids": ["S1", "S2"],
                }],
                "follow_up_questions": [],
            }
        raise AssertionError("Unexpected EXTRA inference stage " + stage)


class ConceptPlanContracts(unittest.TestCase):
    # Reuse the fixture builders but do not inherit and rerun the entire
    # independent whole-library regression suite a second time.
    setUp = fixtures.CrossLibraryFixture.setUp
    _serve = fixtures.CrossLibraryFixture._serve

    def test_detect_hypothetical_interpretation_without_forcing_normal_comparison(self):
        group = needs_concept_plan(
            "What would Aristotle think about Tolstoy's thought?",
            self.registry.entries
        )
        self.assertEqual({g["author"] for g in group},
                         {"aristotle", "leo tolstoy"})
        self.assertFalse(needs_concept_plan(
            "How do Aristotle and Tolstoy understand happiness?",
            self.registry.entries))
        self.assertFalse(needs_concept_plan(
            "What does Aristotle mean by virtue?",
            self.registry.entries))

    def test_original_nietzsche_kierkegaard_failure_triggers_planner(self):
        entries = {
            "140": {"book_id": "140",
                    "author": "Søren Kierkegaard",
                    "title": "Fear and Trembling"},
            "144": {"book_id": "144",
                    "author": "Friedrich Nietzsche",
                    "title": "On the Genealogy of Morals"},
        }
        groups = needs_concept_plan(
            "what would nietzsche think about kierkegaard's thought?",
            entries
        )
        self.assertEqual(
            {g["author"] for g in groups},
            {"s ren kierkegaard", "friedrich nietzsche"}
        )
        self.assertEqual(
            _validated_topic_words(
                ["thought", "idea", "paradox", "religion", "faith"],
                app.tokenize, groups
            ),
            ["paradox", "religion", "faith"],
        )

    def test_plan_yields_independently_searchable_topics_for_each_real_author(self):
        names = needs_concept_plan(
            "What would Aristotle think about Tolstoy?", self.registry.entries
        )
        provider = PlannerProvider()
        plan, trace = conceptual_search_plan(
            "What would Aristotle think about Tolstoy?", names,
            app.tokenize, provider
        )
        self.assertEqual(provider.calls, ["conceptual_retrieval_plan"])
        self.assertEqual(trace["status"], "complete")
        self.assertEqual(plan["author_topics"]["aristotle"],
                         ["virtue", "happiness", "practical", "wisdom"])
        self.assertEqual(plan["author_topics"]["leo tolstoy"],
                         ["faith", "meaning", "happiness"])

    def test_bad_planner_output_has_controlled_fallback(self):
        groups = needs_concept_plan(
            "What would Aristotle think about Tolstoy?", self.registry.entries
        )
        provider = PlannerProvider(malformed=True)
        plan, trace = conceptual_search_plan(
            "What would Aristotle think about Tolstoy?", groups,
            app.tokenize, provider
        )
        self.assertIsNone(plan)
        self.assertEqual(trace["status"], "invalid_plan")
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(_validated_topic_words(
            ["thought", "idea", "faith"], app.tokenize, groups
        )[-1], "faith")

    def test_author_scoped_index_discovery_does_not_select_unrelated_book(self):
        query = "What would Aristotle think about Tolstoy?"
        author_topics = {
            "aristotle": ["virtue", "happiness"],
            "leo tolstoy": ["faith", "meaning"],
        }
        index, report = self.locator.search(
            query, concept_plan={"author_topics": author_topics}
        )
        self.assertEqual(set(index.chosen_books), {"7", "88"})
        self.assertEqual(report["retrieval_strategy"],
                         "author_specific_concept_plan")
        self.assertEqual(report["book_shards_opened"], 2)
        self.assertEqual(index.topic_terms_by_book["7"], author_topics["aristotle"])
        self.assertEqual(index.topic_terms_by_book["88"], author_topics["leo tolstoy"])
        self.assertEqual(report["conceptual_plan"]["author_topics"], author_topics)
        self.assertEqual(
            {p["book_id"] for p in index.search(query, [query])[:4]},
            {"7", "88"},
        )

    def test_invalid_plan_cannot_invent_an_author_or_raw_filename(self):
        query = "What would Aristotle think about Tolstoy?"
        for plan in (
            {"author_topics": {"aristotle": ["virtue", "happiness"]}},
            {"author_topics": {
                "aristotle": ["virtue", "happiness"],
                "leo tolstoy": ["faith", "../../../secrets"],
            }},
            {"author_topics": {
                "aristotle": ["virtue", "happiness"],
                "leo tolstoy": ["faith", "meaning"],
                "fake author": ["stranger", "words"],
            }},
        ):
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                self.locator.search(query, concept_plan=plan)

    def test_http_uses_two_and_only_two_calls_and_correct_pdf_provenance(self):
        provider = PlannerProvider()
        url = self._serve()
        with patch.object(app, "LIBRARY_REGISTRY", self.registry), \
             patch.object(app, "WHOLE_LIBRARY", self.locator), \
             patch.object(app, "OllamaProvider", return_value=provider):
            request = urllib.request.Request(
                url + "/api/chat",
                data=json.dumps({
                    "scope": "library", "pipeline": "evidence",
                    "question": "What would Aristotle think about Tolstoy?",
                    "model": "fake-model", "diagnostics": True,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(request) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as error:
                self.fail("Unexpected chat HTTP " + str(error.code)
                          + ": " + error.read().decode("utf-8"))

        self.assertEqual(payload["outcome"], "draft")
        self.assertEqual(provider.calls, [
            "conceptual_retrieval_plan", "evidence_grounded_synthesis"
        ])
        self.assertEqual(payload["scope"], "library")
        self.assertEqual(payload["library_discovery"]["book_shards_opened"], 2)
        self.assertEqual(payload["diagnostics"]["retrieval"]
                         ["selection_method"],
                         "conceptual topic-ranked source evidence")
        self.assertEqual(payload["diagnostics"]["stages"][0]["status"],
                         "complete")
        self.assertEqual(
            {s["book_id"] for s in payload["sources"]}, {"7", "88"}
        )
        for src in payload["sources"]:
            expected_pdf = (
                "1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY"
                if src["book_id"] == "7" else
                "1L6LzGc2IDOPLPhYOKZGF4yx2m-cBxoiD"
            )
            self.assertIn(expected_pdf, src["url"])

    def test_bad_plan_fallback_does_not_add_third_call(self):
        provider = PlannerProvider(malformed=True)
        url = self._serve()
        with patch.object(app, "LIBRARY_REGISTRY", self.registry), \
             patch.object(app, "WHOLE_LIBRARY", self.locator), \
             patch.object(app, "OllamaProvider", return_value=provider):
            request = urllib.request.Request(
                url + "/api/chat",
                data=json.dumps({
                    "scope": "library", "pipeline": "evidence",
                    "question": "What would Aristotle think about Tolstoy's happiness?",
                    "model": "fake-model", "diagnostics": True,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(request) as response:
                    payload = json.load(response)
            except urllib.error.HTTPError as error:
                self.fail("Unexpected chat HTTP " + str(error.code)
                          + ": " + error.read().decode("utf-8"))
        self.assertEqual(provider.calls, [
            "conceptual_retrieval_plan", "evidence_grounded_synthesis"
        ])
        self.assertEqual(payload["diagnostics"]["stages"][0]["status"],
                         "invalid_plan")
        self.assertEqual(payload["outcome"], "draft")


if __name__ == "__main__":
    unittest.main()
