"""Direct pipeline contract and provenance tests (not philosophical scoring).

A real citation still can support a false interpretation; direct mode is a
single-call *draft* pipeline, never a truth-certified 'verified' result.
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
from direct_pipeline import answer_direct, validate_paragraphs
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
TEXT_OTHER = (
    "Record the measurement after adjustment to document the new reading."
)
GOOD_PROSE = (
    "Calibration compares an instrument with a reference and uses the "
    "difference to identify a measurement offset that needs adjustment."
)
GOOD_OUTPUT = {
    "paragraphs": [{"text": GOOD_PROSE, "source_ids": ["S1"]}]
}
GOOD_ANSWER = GOOD_PROSE + " [S1]"


class StubProvider:
    def __init__(self, output=None):
        self.output = GOOD_OUTPUT if output is None else output
        self.calls = []

    def complete(self, stage, system, user, schema, max_tokens):
        self.calls.append({
            "stage": stage, "system": system, "user": user,
            "schema": schema, "max_tokens": max_tokens,
        })
        return self.output


class DirectPipelineTests(unittest.TestCase):
    def setUp(self):
        self.index = PassageIndex(
            [(BOOK, [{"page": 1, "text": TEXT}])], app.tokenize
        )

    def run_direct(self, output=None, question="What is calibration?"):
        provider = StubProvider(output)
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
        self.assertEqual(result["diagnostics"]["draft"]["raw_response"], GOOD_OUTPUT)

    def test_provenance_is_not_a_truth_verifier(self):
        incorrect = (
            "Calibration is unnecessary because instruments never drift; "
            "therefore no comparison to a reference is needed."
        )
        output = {"paragraphs": [{"text": incorrect, "source_ids": ["S1"]}]}
        result, _ = self.run_direct(output)
        self.assertEqual(result["outcome"], "draft")
        self.assertIn("Calibration is unnecessary", result["answer"])
        self.assertEqual(
            result["diagnostics"]["evidence_check"]["status"],
            "not_semantically_reviewed"
        )

    def test_unknown_citation_rejected_and_raw_output_preserved(self):
        generated = {
            "paragraphs": [{"text": GOOD_PROSE, "source_ids": ["S999"]}]
        }
        result, _ = self.run_direct(generated)
        self.assertEqual(result["outcome"], "fallback")
        self.assertNotIn("[S999]", result["answer"])
        self.assertEqual(result["sources"][0]["excerpt"], TEXT)
        self.assertTrue(result["sources"][0]["expanded"])
        self.assertEqual(
            result["diagnostics"]["draft"]["raw_response"], generated
        )
        self.assertEqual(result["diagnostics"]["draft"]["status"], "invalid_output")
        self.assertIn("unknown source", result["diagnostics"]["draft"]["reason"])

    def test_missing_source_ids_rejected_even_with_good_prose(self):
        output = {"paragraphs": [{"text": GOOD_PROSE, "source_ids": []}]}
        result, _ = self.run_direct(output)
        self.assertEqual(result["outcome"], "fallback")
        self.assertIn("one to four source IDs", result["diagnostics"]["draft"]["reason"])

    def test_multiple_paragraphs_cite_correct_individual_sources(self):
        index = PassageIndex(
            [(BOOK, [
                {"page": 1, "text": TEXT},
                {"page": 2, "text": TEXT_OTHER},
            ])], app.tokenize
        )
        candidates = index.search("measurement adjustment reference", [
            "measurement adjustment reference"
        ])
        self.assertEqual(len(candidates), 2)
        id_by_page = {p["page"]: p["source_id"] for p in candidates}
        generated = {"paragraphs": [
            {"text": GOOD_PROSE, "source_ids": [id_by_page[1]]},
            {
                "text": "After calibration, the adjusted measurement can be "
                        "recorded so the outcome is documented clearly.",
                "source_ids": [id_by_page[2]],
            },
        ]}
        provider = StubProvider(generated)
        result = answer_direct(
            "measurement adjustment reference", [], index,
            ["measurement adjustment reference"], provider, "v1-test"
        )
        self.assertEqual(result["outcome"], "draft")
        self.assertIn("[" + id_by_page[1] + "]", result["answer"])
        self.assertIn("[" + id_by_page[2] + "]", result["answer"])
        self.assertEqual(
            {p["page"] for p in result["sources"]}, {1, 2}
        )

    def test_inline_citation_recovery_without_another_model_call(self):
        generated = {
            "paragraphs": [{
                "text": GOOD_PROSE + " [S1]. A further explanatory " 
                        "sentence uses this source again [S1].",
                "source_ids": ["S1"]
            }]
        }
        result, provider = self.run_direct(generated)
        self.assertEqual(result["outcome"], "draft")
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(result["answer"].count("[S1]"), 1)
        self.assertIn("adjustment. A further", result["answer"])
        log = result["diagnostics"]["draft"]["citation_reconciliation"]
        self.assertEqual(len(log), 1)
        self.assertEqual(log[0]["markers_removed"], 2)
        self.assertEqual(log[0]["added_ids"], [])
        self.assertEqual(result["diagnostics"]["draft"]["raw_response"], generated)

    def test_merge_known_inline_reference_omitted_from_structured_ids(self):
        audit = []
        generated = {"paragraphs": [{
            "text": GOOD_PROSE + " [S1]. Other context explains " 
                    "how the work is documented [S2].",
            "source_ids": ["S1"]
        }]}
        rendered, used_ids = validate_paragraphs(
            generated, {"S1", "S2"}, audit
        )
        self.assertEqual(used_ids, {"S1", "S2"})
        self.assertEqual(rendered.count("[S1]"), 1)
        self.assertEqual(rendered.count("[S2]"), 1)
        self.assertIn("documented. [S1] [S2]", rendered)
        self.assertEqual(audit[0]["added_ids"], ["S2"])
        self.assertEqual(audit[0]["combined_ids"], ["S1", "S2"])

    def test_gemma_style_references_are_reconciled_per_paragraph(self):
        # Actual Gemma reports repeated inline IDs, omitted inline IDs,
        # and structured-only IDs, including four sources in one paragraph.
        generated = {"paragraphs": [
            {"text": GOOD_PROSE + " [S1].", "source_ids": ["S1"]},
            {"text": GOOD_PROSE + " [S2]. Further details [S3].",
             "source_ids": ["S2", "S3"]},
            {"text": GOOD_PROSE + " [S2] and related context [S4].",
             "source_ids": ["S2", "S5"]},
            {"text": GOOD_PROSE + " [S6]. Additional support [S7].",
             "source_ids": ["S6", "S7", "S8", "S9"]},
        ]}
        audit = []
        rendered, used = validate_paragraphs(
            generated, {f"S{i}" for i in range(1, 10)}, audit
        )
        self.assertEqual(len(rendered.split("\n\n")), 4)
        self.assertEqual(used, {f"S{i}" for i in range(1, 10)})
        self.assertEqual(audit[2]["added_ids"], ["S4"])
        self.assertEqual(audit[3]["combined_ids"], ["S6", "S7", "S8", "S9"])
        self.assertEqual(len(audit), 4)

    def test_reject_unknown_inline_citation_and_preserve_diagnostics(self):
        generated = {"paragraphs": [{
            "text": GOOD_PROSE + " [S999]", "source_ids": ["S1"]
        }]}
        result, _ = self.run_direct(generated)
        self.assertEqual(result["outcome"], "fallback")
        self.assertIn("unknown source", result["diagnostics"]["draft"]["reason"])
        self.assertEqual(
            result["diagnostics"]["draft"]["citation_reconciliation"][0]["status"],
            "rejected_unknown",
        )
        self.assertEqual(result["diagnostics"]["draft"]["raw_response"], generated)

    def test_reject_disjoint_valid_inline_and_structured_citations(self):
        audit = []
        generated = {"paragraphs": [{
            "text": GOOD_PROSE + " [S2]", "source_ids": ["S1"]
        }]}
        with self.assertRaisesRegex(CompletionError, "disjoint"):
            validate_paragraphs(generated, {"S1", "S2"}, audit)
        self.assertEqual(audit[0]["status"], "rejected_conflict")
        self.assertEqual(audit[0]["inline_ids"], ["S2"])

    def test_reject_unsupported_fifth_source_and_malformed_markers(self):
        for generated in [
            {"paragraphs": [{
                "text": GOOD_PROSE + " [S2] [S3] [S4] [S5]",
                "source_ids": ["S1", "S2", "S3", "S4"],
            }]},
            {"paragraphs": [{
                "text": GOOD_PROSE + " [S1,S2]", "source_ids": ["S1"]
            }]},
        ]:
            with self.subTest(generated=generated):
                with self.assertRaises(CompletionError):
                    validate_paragraphs(
                        generated, {"S1", "S2", "S3", "S4", "S5"}
                    )

    def test_duplicate_references_and_missing_paragraphs_rejected(self):
        for generated in [
            {"paragraphs": [{"text": GOOD_PROSE, "source_ids": ["S1", "S1"]}]},
            {"paragraphs": []},
            {"paragraphs": [{"text": "Too short", "source_ids": ["S1"]}]},
        ]:
            with self.subTest(generated=generated):
                result, _ = self.run_direct(generated)
                self.assertEqual(result["outcome"], "fallback")
                self.assertEqual(
                    result["diagnostics"]["draft"]["raw_response"], generated
                )

    def test_no_retrieval_does_not_call_model(self):
        result, provider = self.run_direct(question="uniquenevermentionedterm")
        self.assertEqual(result["outcome"], "fallback")
        self.assertEqual(provider.calls, [])

    def test_validator_rejects_model_reasoning_markup(self):
        with self.assertRaises(CompletionError):
            validate_paragraphs(
                {"paragraphs": [{
                    "text": "<think>hidden reasoning</think> " + GOOD_PROSE,
                    "source_ids": ["S1"],
                }]},
                {"S1"}
            )

    def test_http_route_uses_selected_direct_pipeline(self):
        provider = StubProvider()
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
            self.assertEqual(payload["answer"], GOOD_ANSWER)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
