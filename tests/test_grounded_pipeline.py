"""Contract and provenance tests, not a substitute for live answer review.

Scripted model replies deliberately include false claims, bad IDs, incomplete
reviews, and failed repairs. The assertions test what the application permits
through its boundaries; they do not claim that a real model judges meaning well.
"""
import copy
import json
from pathlib import Path
import sys
import threading
import unittest
import urllib.request
from unittest.mock import patch
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from grounded_pipeline import PassageIndex, answer_question, check_review, source_payload
from inference import CompletionError, OllamaProvider


BOOK = {"book_id": "42", "title": "Workshop Handbook — Example",
        "pdf_file_id": "handbook-drive-id", "corpus_version": "test-v1"}
TEXT = ("Calibration compares the instrument with a known reference. "
        "It identifies a measurement offset so the instrument can be adjusted.")


class ScriptedProvider:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append({"stage": stage, "system": system, "user": user, "schema": schema})
        if not self.responses:
            raise AssertionError("The pipeline exceeded the expected model-call budget")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return copy.deepcopy(response)


def claim(text="Calibration compares measurements with a known reference.", ids=None):
    return {"claims": [{"text": text, "source_ids": ids or ["S1"]}]}


def review(verdict="supported", complete=True):
    return {"reviews": [{"claim_index": 1, "verdict": verdict, "reason": "Evidence assessment."}],
            "complete": complete, "missing": "" if complete else "The explanation is incomplete."}


class GroundedPipelineTests(unittest.TestCase):
    def setUp(self):
        self.index = PassageIndex([(BOOK, [{"page": 1, "text": TEXT}])], app.tokenize)

    def run_pipeline(self, responses):
        provider = ScriptedProvider(responses)
        result = answer_question("What is calibration?", [], self.index,
                                 ["What is calibration?"], provider, "test")
        return result, provider

    def test_complete_answer_uses_composed_prose_and_immutable_passage(self):
        assessed = review()
        assessed["rewritten_answer"] = "A reviewer must not replace the answer."
        result, provider = self.run_pipeline([{"source_ids": ["S1"]}, claim(), assessed])
        self.assertEqual(result["outcome"], "verified")
        self.assertNotIn("replace the answer", result["answer"])
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)
        self.assertEqual(result["sources"][0]["book_id"], "42")
        self.assertEqual([c["stage"] for c in provider.calls], ["evidence_selection", "composition", "review"])
        self.assertEqual(len(result["diagnostics"]["stages"]), 4)

    def test_repair_replaces_rejected_claim_and_is_independently_reviewed(self):
        result, provider = self.run_pipeline([
            {"source_ids": ["S1"]}, claim("Calibration guarantees perfect measurements."),
            review("unsupported", False), claim(), review(),
        ])
        self.assertEqual(result["outcome"], "verified")
        self.assertNotIn("guarantees", result["answer"])
        self.assertEqual([c["stage"] for c in provider.calls],
                         ["evidence_selection", "composition", "review", "repair", "review"])

    def test_nietzsche_style_topical_association_does_not_survive_review(self):
        """A related passage cannot license a stronger interpretation."""
        passages = [
            "Zarathustra says the old saint has not yet heard that God is dead.",
            "The speaker asks to be smitten more deeply by dull, indented arrows.",
        ]
        book = {**BOOK, "title": "Thus Spake Zarathustra — Friedrich Nietzsche"}
        class SelectedPassageIndex(PassageIndex):
            def search(self, question, facets, history=(), limit=24):
                return [
                    {**self.passages[0], "source_id": "S1"},
                    {**self.passages[1], "source_id": "S2"},
                ]

        index = SelectedPassageIndex([(book, [
            {"page": 2, "text": passages[0]},
            {"page": 101, "text": passages[1]},
        ])], app.tokenize)
        bad_claims = {"claims": [
            {"text": "Zarathustra tells the old saint that he has not heard that God is dead.",
             "source_ids": ["S1"]},
            {"text": "The torture passage shows that the death of God causes cultural disorientation and a search for new values.",
             "source_ids": ["S2"]},
        ]}
        initial_review = {"reviews": [
            {"claim_index": 1, "verdict": "supported", "reason": "The passage says this."},
            {"claim_index": 2, "verdict": "unsupported", "reason": "The passage mentions torture but not God, cultural change, or new values."},
        ], "complete": False, "missing": "The passages do not explain the phrase's meaning."}
        repaired = {"claims": [
            {"text": "The excerpt establishes that Zarathustra says the old saint has not heard that God is dead, but it does not explain the phrase's meaning.",
             "source_ids": ["S1"]},
        ]}
        repaired_review = {"reviews": [
            {"claim_index": 1, "verdict": "supported", "reason": "The first clause matches the excerpt and the limitation is accurate for these supplied passages."},
        ], "complete": True, "missing": ""}
        provider = ScriptedProvider([
            {"source_ids": ["S1", "S2"]}, bad_claims, initial_review,
            repaired, repaired_review,
        ])
        result = answer_question("What did Nietzsche mean by God is dead?", [], index,
                                 ["What did Nietzsche mean by God is dead?"], provider, "test")
        self.assertEqual(result["outcome"], "verified")
        self.assertIn("old saint", result["answer"])
        self.assertNotIn("cultural disorientation", result["answer"])
        self.assertNotIn("new values", result["answer"])


    def test_failed_repair_never_displays_unsupported_or_unreviewed_content(self):
        result, provider = self.run_pipeline([
            {"source_ids": ["S1"]}, claim(), review("supported", False),
            claim("Calibration guarantees immortality."), review("unsupported", False),
        ])
        self.assertEqual(result["outcome"], "partial")
        self.assertNotIn("immortality", result["answer"])
        self.assertIn("known reference", result["answer"])
        self.assertEqual(len(provider.calls), 5)

    def test_all_rejected_claims_fall_back_to_full_passages(self):
        result, _ = self.run_pipeline([
            {"source_ids": ["S1"]}, claim("Calibration guarantees perfection."),
            review("unsupported", False), claim("Calibration guarantees perfection."),
            review("unsupported", False),
        ])
        self.assertEqual(result["outcome"], "fallback")
        self.assertNotIn("perfection", result["answer"])
        self.assertTrue(result["sources"][0]["expanded"])
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)

    def test_unknown_citation_cannot_reach_semantic_review_or_display(self):
        result, provider = self.run_pipeline([
            {"source_ids": ["S1"]}, claim(ids=["S999"]), claim(ids=["S999"]),
        ])
        self.assertEqual(result["outcome"], "fallback")
        self.assertNotIn("S999", result["answer"])
        self.assertEqual([c["stage"] for c in provider.calls], ["evidence_selection", "composition", "repair"])
        self.assertEqual(result["diagnostics"]["evidence_check"]["failure_category"], "output_contract")

    def test_invalid_selection_stops_generation(self):
        for selected in [["S999"], ["S1", "S1"], "S1", [False]]:
            with self.subTest(selected=selected):
                result, provider = self.run_pipeline([{"source_ids": selected}])
                self.assertEqual(result["outcome"], "fallback")
                self.assertEqual(len(provider.calls), 1)

    def test_missing_review_and_malformed_repair_fail_closed(self):
        result, provider = self.run_pipeline([
            {"source_ids": ["S1"]}, claim(), {"reviews": [], "complete": True, "missing": ""},
            CompletionError("truncated response"),
        ])
        self.assertEqual(result["outcome"], "fallback")
        self.assertEqual(len(provider.calls), 4)

    def test_duplicate_review_indices_cannot_cover_two_claims(self):
        claims = [{"claim_index": 1}, {"claim_index": 2}]
        value = review()
        value["reviews"] *= 2
        with self.assertRaises(CompletionError):
            check_review(value, claims)

    def test_no_relevant_text_makes_no_inference_calls(self):
        provider = ScriptedProvider([])
        result = answer_question("unfindabletoken", [], self.index, ["unfindabletoken"], provider, "test")
        self.assertEqual(result["outcome"], "fallback")
        self.assertEqual(result["sources"], [])
        self.assertEqual(provider.calls, [])

    def test_same_page_in_two_books_keeps_identity_and_links_separate(self):
        other = {**BOOK, "book_id": "43", "title": "Other book", "pdf_file_id": "other-drive-id"}
        index = PassageIndex([(BOOK, [{"page": 1, "text": TEXT}]),
                              (other, [{"page": 1, "text": TEXT}])], app.tokenize)
        passages = index.search("calibration", ["calibration"])
        self.assertEqual(len({p["passage_id"] for p in passages}), 2)
        urls = {source_payload(p)["url"] for p in passages}
        self.assertEqual(len(urls), 2)
        self.assertTrue(any("other-drive-id" in url for url in urls))

    def test_full_context_and_stable_identity_survive_separate_same_page_hits(self):
        text = TEXT + "\n\nCalibration is followed by a separate review of the recorded measurement offsets."
        index = PassageIndex([(BOOK, [{"page": 1, "text": text}])], app.tokenize)
        first = index.search("calibration", ["calibration"])
        second = index.search("calibration", ["calibration"])
        self.assertEqual(len(first), 2)
        self.assertEqual(first, second)
        self.assertTrue(all(p["text"] in text for p in first))

    def test_page_continuation_excludes_folio_and_preserves_both_links(self):
        pages = [{"page": 8, "text": "Calibration is performed by comparing each instrument reading with\n\n8"},
                 {"page": 9, "text": "a known reference under controlled and repeatable conditions.\n\n9"}]
        index = PassageIndex([(BOOK, pages)], app.tokenize, app.likely_page_continuation)
        passages = index.search("calibration", ["calibration"])
        self.assertEqual(passages[0]["pages"], [8, 9])
        self.assertIn("with a known", passages[0]["text"])
        self.assertNotIn("8", passages[0]["text"])
        self.assertEqual(len(source_payload(passages[0])["page_urls"]), 2)

    def test_split_context_attributes_only_pages_actually_spanned(self):
        first = " ".join(["calibration reference"] * 120) + "."
        pages = [{"page": 8, "text": first + " Next we compare measurements with"},
                 {"page": 9, "text": "a known reference and carefully record instrument offsets."}]
        index = PassageIndex([(BOOK, pages)], app.tokenize, app.likely_page_continuation)
        self.assertEqual(index.passages[0]["pages"], [8])
        self.assertEqual(index.passages[1]["pages"], [8, 9])

    def test_facet_retrieval_reserves_evidence_for_each_topic(self):
        pages = [{"page": i, "text": "Calibration uses a known reference and identifies measurement offsets."}
                 for i in range(1, 9)]
        pages.append({"page": 9, "text": "Maintenance preserves machinery by inspecting components and replacing worn parts."})
        index = PassageIndex([(BOOK, pages)], app.tokenize)
        found = index.search("calibration and maintenance", ["calibration", "maintenance"], limit=4)
        self.assertIn(9, [p["page"] for p in found])


class ProviderAndHTTPTests(unittest.TestCase):
    def test_provider_records_timing_and_uses_shared_structured_contract(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps({"message": {"content": '{"source_ids": []}'},
                                               "eval_count": 7}).encode()
        provider = OllamaProvider("http://localhost:11434", "example-model")
        with patch("inference.urllib.request.urlopen", return_value=Response()) as transport:
            result = provider.complete("selection", "system", "question", {"type": "object"}, 240)
        body = json.loads(transport.call_args.args[0].data)
        self.assertFalse(body["think"])
        self.assertEqual(body["options"]["num_ctx"], 8192)
        self.assertEqual(result, {"source_ids": []})
        self.assertEqual(provider.calls[0]["output_tokens"], 7)
        self.assertIn("elapsed_ms", provider.calls[0])

    def post(self, provider, mode="grounded", diagnostics=True, scope="book"):
        index = PassageIndex([(BOOK, [{"page": 1, "text": TEXT}])], app.tokenize)
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(app, "PIPELINE_MODE", mode), patch.object(app, "GROUNDED_INDEX", index), \
                 patch.object(app, "OllamaProvider", return_value=provider):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/chat",
                    data=json.dumps({"question": "What is calibration?", "diagnostics": diagnostics,
                                     "scope": scope}).encode(),
                    headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(request) as response:
                    return json.load(response)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_default_http_route_returns_readable_evidence_and_stage_diagnostics(self):
        provider = ScriptedProvider([{"source_ids": ["S1"]}, claim(), review()])
        result = self.post(provider)
        self.assertEqual(result["outcome"], "verified")
        self.assertEqual(result["diagnostics"]["pipeline"], "grounded")
        self.assertEqual(result["diagnostics"]["summary"]["outcome"], "verified")
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)

    def test_normal_http_chat_retains_passages_without_diagnostics(self):
        result = self.post(ScriptedProvider([{"source_ids": ["S1"]}, claim(), review()]), diagnostics=False)
        self.assertNotIn("diagnostics", result)
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)

    def test_claim_review_prototype_routes_across_library(self):
        index = PassageIndex([(BOOK, [{"page": 1, "text": TEXT}])], app.tokenize)
        discovery = {"scope": "library", "candidate_books": [{"book_id": "42"}]}
        provider = ScriptedProvider([{"source_ids": ["S1"]}, claim(), review()])
        with patch.object(app.WHOLE_LIBRARY, "search", return_value=(index, discovery)):
            result = self.post(provider, scope="library")
        self.assertEqual(result["outcome"], "verified")
        self.assertEqual(result["scope"], "library")
        self.assertEqual(result["diagnostics"]["pipeline"], "grounded")
        self.assertEqual(result["library_discovery"], discovery)

    def test_legacy_route_is_still_available(self):
        with patch.object(app, "retrieve", return_value=[]):
            result = self.post(ScriptedProvider([]), mode="legacy")
        self.assertIn("couldn't find", result["answer"])


if __name__ == "__main__":
    unittest.main()
