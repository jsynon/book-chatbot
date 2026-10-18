"""Evidence-first v1.2 contracts: source identity, context, answers, and API.

These tests use synthetic passages; they never claim to measure whether a
model interprets Aristotle (or any other author) philosophically correctly.
"""
import json
import sys
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app
from evidence_pipeline import (
    answer_evidence_first, choose_evidence, passage_spotlight,
    select_neighbor_context,
)
from grounded_pipeline import PassageIndex
from inference import CompletionError


BOOK = {
    "book_id": "42", "title": "A Manual of Measurement — Example",
    "pdf_file_id": "test-drive-id", "corpus_version": "test-v1",
}
SECOND_BOOK = {
    "book_id": "43", "title": "Another Manual — Example",
    "pdf_file_id": "second-drive-id", "corpus_version": "test-v1",
}
TEXT_1 = (
    "Calibration compares an instrument against an established reference. "
    "The comparison determines whether a measurement error is present."
)
TEXT_2 = (
    "But this comparison alone is not sufficient for sound calibration. "
    "One must adjust the instrument according to the identified offset."
)
TEXT_3 = (
    "The record of the adjustment should include both the previous "
    "reading and the new measurement for independent review."
)
ANSWER_TEXT = (
    "Calibration compares a measurement with a trusted reference, then "
    "adjusts the instrument according to the difference detected."
)
FOLLOW_UP = "Why should a calibration record include both readings?"


class StubProvider:
    def __init__(self, selected_ids=None, output=None, selector_error=None):
        self.selected_ids = selected_ids or ["S1"]
        self.output = output or {
            "paragraphs": [{"text": ANSWER_TEXT, "source_ids": ["S1"]}],
            "follow_up_questions": [FOLLOW_UP],
        }
        self.selector_error = selector_error
        self.calls = []

    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append({
            "stage": stage, "system": system, "user": user,
            "schema": schema, "max_tokens": max_tokens,
        })
        if stage == "evidence_selection":
            if self.selector_error:
                raise CompletionError(self.selector_error)
            return {"source_ids": self.selected_ids}
        if stage == "evidence_grounded_synthesis":
            return self.output
        raise AssertionError("Unexpected inference stage " + stage)


class EvidenceFirstTests(unittest.TestCase):
    def setUp(self):
        self.index = PassageIndex([
            (BOOK, [
                {"page": 1, "text": TEXT_1},
                {"page": 2, "text": TEXT_2},
                {"page": 3, "text": TEXT_3},
            ])
        ], app.tokenize)
        self.question = "How does calibration compare and adjust an instrument?"

    def run_evidence(self, provider=None):
        provider = provider or StubProvider()
        result = answer_evidence_first(
            self.question, [], self.index, [self.question], provider, "v1.2-test"
        )
        return result, provider

    def test_two_model_calls_and_source_bound_answer(self):
        result, provider = self.run_evidence()
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(
            [x["stage"] for x in provider.calls],
            ["evidence_selection", "evidence_grounded_synthesis"]
        )
        self.assertEqual(result["answer"], ANSWER_TEXT + " [S1]")
        self.assertEqual(len(result["follow_up_questions"]), 1)
        self.assertEqual(result["follow_up_questions"][0], FOLLOW_UP)
        self.assertEqual(result["diagnostics"]["pipeline"], "evidence")
        self.assertEqual(result["diagnostics"]["summary"]["outcome"], "draft")
        self.assertNotEqual(result["diagnostics"]["summary"]["outcome"], "verified")

    def test_evidence_first_recovers_known_inline_markers(self):
        generated = {
            "paragraphs": [{
                "text": ANSWER_TEXT + " [S1]. The original evidence also "
                        "explains why a suitable reference is important [S1].",
                "source_ids": ["S1"],
            }],
            "follow_up_questions": [FOLLOW_UP],
        }
        result, provider = self.run_evidence(StubProvider(output=generated))
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(len(provider.calls), 2)
        self.assertEqual(result["answer"].count("[S1]"), 1)
        self.assertEqual(result["follow_up_questions"], [FOLLOW_UP])
        self.assertEqual(
            result["diagnostics"]["draft"]["citation_reconciliation"][0]["status"],
            "reconciled",
        )
        self.assertEqual(
            result["diagnostics"]["draft"]["raw_response"], generated
        )
        self.assertEqual(len(result["sources"]), 1)

    def test_evidence_first_rejects_unknown_inline_reference(self):
        generated = {
            "paragraphs": [{
                "text": ANSWER_TEXT + " [S999]",
                "source_ids": ["S1"],
            }],
            "follow_up_questions": [],
        }
        result, _ = self.run_evidence(StubProvider(output=generated))
        self.assertEqual(result["outcome"], "fallback")
        self.assertIn(
            "unknown source", result["diagnostics"]["draft"]["reason"]
        )
        self.assertEqual(
            result["diagnostics"]["draft"]["citation_reconciliation"][0]["status"],
            "rejected_unknown",
        )

    def test_spotlights_are_verbatim_source_sentences(self):
        result, _ = self.run_evidence()
        self.assertTrue(result["evidence_highlights"])
        by_source = {x["id"]: x for x in result["sources"]}
        for item in result["evidence_highlights"]:
            self.assertIn(item["quote"], by_source[item["source_id"]]["excerpt"])
            self.assertEqual(item["page"], by_source[item["source_id"]]["page"])
            self.assertIn("test-drive-id", item["url"])

    def test_short_primary_passage_adds_neighbor_with_own_citation(self):
        candidates = self.index.search(self.question, [self.question])
        self.assertGreaterEqual(len(candidates), 2)
        anchor = next(p for p in candidates if p["page"] == 1)
        passages, added = select_neighbor_context(self.index, [anchor], candidates)
        self.assertTrue(added)
        self.assertEqual(added[0]["context_for"], anchor["source_id"])
        self.assertEqual(added[0]["pages"], [2])
        self.assertEqual(len({p["source_id"] for p in passages}), len(passages))
        self.assertNotEqual(passages[0]["passage_id"], passages[1]["passage_id"])
        self.assertEqual(passages[1]["book_id"], passages[0]["book_id"])

    def test_avoid_cross_book_neighbor_contamination(self):
        index = PassageIndex([
            (BOOK, [{"page": 1, "text": TEXT_1}]),
            (SECOND_BOOK, [{"page": 2, "text": TEXT_2}]),
        ], app.tokenize)
        candidates = index.search(self.question, [self.question])
        anchor = next(p for p in candidates if p["book_id"] == BOOK["book_id"])
        selected, added = select_neighbor_context(index, [anchor], candidates)
        self.assertFalse(added)
        self.assertEqual(len(selected), 1)

    def test_unknown_selection_reverts_to_ranked_evidence_without_fake_sources(self):
        provider = StubProvider(selected_ids=["S999"])
        result, provider = self.run_evidence(provider)
        self.assertEqual(result["outcome"], "draft")
        stage = result["diagnostics"]["retrieval"]["evidence_selection"]
        self.assertEqual(stage["status"], "ranked_fallback")
        self.assertTrue(all(p["id"].startswith("S") for p in result["sources"]))
        self.assertEqual(len(provider.calls), 2)

    def test_selector_can_choose_decisive_evidence_outside_old_top_eight(self):
        pages = [
            {"page": page, "text": (
                "Calibration requires a comparison with a reference instrument. "
                "The subsequent measurement varies with the individual case "
                "and the measurement conditions in the laboratory. "
                + " ".join(["Additional explanatory context"] * 3)
            )}
            for page in range(1, 13)
        ]
        index = PassageIndex([(BOOK, pages)], app.tokenize)
        candidates = index.search("calibration", ["calibration"], limit=24)
        self.assertGreater(len(candidates), 8)
        decisive = candidates[9]
        source_id = decisive["source_id"]
        provider = StubProvider(
            selected_ids=[source_id],
            output={
                "paragraphs": [{
                    "text": ANSWER_TEXT,
                    "source_ids": [source_id],
                }],
                "follow_up_questions": [],
            }
        )
        result = answer_evidence_first(
            "calibration", [], index, ["calibration"], provider, "v1.2-test"
        )
        self.assertEqual(result["outcome"], "draft")
        self.assertIn("[" + source_id + "]", result["answer"])
        self.assertIn(decisive["pages"][0], [
            page for source in result["sources"] for page in source["pages"]
        ])
        self.assertEqual(
            result["diagnostics"]["retrieval"]["evidence_selection"]["selected_ids"],
            [source_id]
        )

    def test_selector_exception_reverts_to_ranked_evidence(self):
        provider = StubProvider(selector_error="Invalid selection JSON")
        result, _ = self.run_evidence(provider)
        self.assertEqual(result["outcome"], "draft")
        stage = result["diagnostics"]["stages"][0]
        self.assertEqual(stage["status"], "ranked_fallback")
        self.assertIn("Invalid selection JSON", stage["reason"])

    def test_citation_without_source_integrity_falls_back_and_keeps_diagnostics(self):
        invalid = {
            "paragraphs": [{"text": ANSWER_TEXT, "source_ids": ["S999"]}],
            "follow_up_questions": [],
        }
        result, _ = self.run_evidence(StubProvider(output=invalid))
        self.assertEqual(result["outcome"], "fallback")
        self.assertNotIn("[S999]", result["answer"])
        self.assertEqual(result["diagnostics"]["draft"]["raw_response"], invalid)
        self.assertEqual(result["follow_up_questions"], [])

    def test_spotlight_prefers_relevant_complete_sentence(self):
        passage = {"text": (
            "An opening sentence introduces a large general topic. "
            "Calibration compares a measured value with a reference instrument. "
            "This is a short conclusion."
        )}
        excerpt = passage_spotlight(
            passage, "How does calibration compare measurements?",
            app.tokenize
        )
        self.assertEqual(
            excerpt,
            "Calibration compares a measured value with a reference instrument."
        )

    def test_no_evidence_leads_to_no_model_calls(self):
        provider = StubProvider()
        result = answer_evidence_first(
            "nonexistentunrelatedconcept", [], self.index,
            ["nonexistentunrelatedconcept"], provider, "v1.2-test"
        )
        self.assertEqual(result["outcome"], "fallback")
        self.assertEqual(provider.calls, [])
        self.assertEqual(result["sources"], [])

    def test_http_api_routes_evidence_pipeline_without_semantic_verification(self):
        provider = StubProvider()
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(app, "GROUNDED_INDEX", self.index), \
                 patch.object(app, "OllamaProvider", return_value=provider):
                request = urllib.request.Request(
                    "http://127.0.0.1:" + str(server.server_port) + "/api/chat",
                    data=json.dumps({
                        "question": self.question,
                        "pipeline": "evidence",
                        "model": "synthetic-test-model", "diagnostics": True
                    }).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request) as response:
                    payload = json.load(response)
            self.assertEqual(payload["outcome"], "draft")
            self.assertEqual(payload["diagnostics"]["model"], "synthetic-test-model")
            self.assertEqual(payload["diagnostics"]["pipeline"], "evidence")
            self.assertEqual(payload["answer"], ANSWER_TEXT + " [S1]")
            self.assertEqual(len(provider.calls), 2)
            self.assertTrue(payload["evidence_highlights"])
            self.assertEqual(payload["follow_up_questions"], [FOLLOW_UP])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
