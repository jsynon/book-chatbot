"""Version 1 source provenance and API tests.

These tests validate trustworthy citation *identities*, not whether a model's
philosophical interpretation is correct. A wrong claim with a real citation is
intentionally only a draft, never 'verified' by this pipeline.
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
from direct_pipeline import answer_direct, validate_answer
from grounded_pipeline import PassageIndex
from inference import CompletionError


BOOK = {
    "book_id": "42", "title": "Calibration Handbook — Example",
    "pdf_file_id": "test-drive-id", "corpus_version": "test-v1",
}
TEXT = (
    "Calibration compares the instrument against a known reference. "
    "This identifies an offset so the instrument can be adjusted."
)
GOOD_ANSWER = (
    "Calibration compares an instrument with a reference and uses the "
    "difference to identify an error that needs adjustment. [S1]"
)


class StubProvider:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append({
            "stage": stage, "system": system, "user": user,
            "schema": schema, "max_tokens": max_tokens,
        })
        return {"answer": self.answer}


class DirectPipelineTests(unittest.TestCase):
    def setUp(self):
        self.index = PassageIndex(
            [(BOOK, [{"page": 1, "text": TEXT}])], app.tokenize
        )

    def run_direct(self, answer=GOOD_ANSWER, question="What is calibration?"):
        provider = StubProvider(answer)
        result = answer_direct(question, [], self.index, [question], provider, "v1-test")
        return result, provider

    def test_one_synthesis_call_and_source_page_link(self):
        result, provider = self.run_direct()
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual([c["stage"] for c in provider.calls], ["direct_synthesis"])
        self.assertEqual(result["answer"], GOOD_ANSWER)
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(result["sources"][0]["book_id"], "42")
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)
        self.assertIn("test-drive-id", result["sources"][0]["url"])
        self.assertEqual(result["sources"][0]["pages"], [1])
        self.assertEqual(result["diagnostics"]["summary"]["outcome"], "draft")

    def test_provenance_is_not_a_truth_verifier(self):
        # A citation can point to a real passage while its associated claim
        # is false. The pipeline must never call this 'verified'.
        incorrect = (
            "Calibration is unnecessary because instruments never drift; "
            "therefore no comparison to a reference is needed. [S1]"
        )
        result, _ = self.run_direct(incorrect)
        self.assertEqual(result["outcome"], "draft")
        self.assertIn("not_semantically_reviewed", result["diagnostics"]["evidence_check"]["status"])
        self.assertIn("incorrect", "incorrect")  # Explicitly documents the limitation.

    def test_rejects_invented_citations_and_exposes_passages(self):
        result, _ = self.run_direct(
            "Calibration uses a reference to measure drift and errors, "
            "according to an unknown book passage. [S999]"
        )
        self.assertEqual(result["outcome"], "fallback")
        self.assertNotIn("[S999]", result["answer"])
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)
        self.assertTrue(result["sources"][0]["expanded"])

    def test_rejects_uncited_or_partly_uncited_text(self):
        for answer in [
            "Calibration compares an instrument against a reference and "
            "detects an offset that needs adjustment.",
            GOOD_ANSWER + "\n\nAnother full paragraph explains that "
            "instruments never need adjustment because they are perfect "
            "forever and always operate without calibration.",
        ]:
            with self.subTest(answer=answer):
                result, _ = self.run_direct(answer)
                self.assertEqual(result["outcome"], "fallback")

    def test_no_retrieval_does_not_call_model(self):
        result, provider = self.run_direct(question="uniquenevermentionedterm")
        self.assertEqual(result["outcome"], "fallback")
        self.assertEqual(provider.calls, [])

    def test_validator_rejects_model_reasoning_markup(self):
        with self.assertRaises(CompletionError):
            validate_answer("<think>reasoning</think> Calibration is useful. [S1]", {"S1"})

    def test_http_route_uses_selected_direct_pipeline(self):
        provider = StubProvider(GOOD_ANSWER)
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(app, "GROUNDED_INDEX", self.index), \
                 patch.object(app, "OllamaProvider", return_value=provider):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/chat",
                    data=json.dumps({
                        "question": "What is calibration?", "pipeline": "direct",
                        "model": "test-model", "diagnostics": True,
                    }).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request) as response:
                    payload = json.load(response)
            self.assertEqual(payload["outcome"], "draft")
            self.assertEqual(payload["diagnostics"]["pipeline"], "direct")
            self.assertEqual(payload["diagnostics"]["model"], "test-model")
            self.assertEqual(len(provider.calls), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
