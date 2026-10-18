"""Cross-disciplinary evaluation is reproducible and does NOT grade meaning.

These contracts exercise the real case manifest, local HTTP picker, report
generation and citation/book-source checks. Only synthetic examples appear
here; philosophical, historical, scientific and literary accuracy is for
manual evaluation against the actual indexed books.
"""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.request import urlopen

import app
from benchmark_suite import (
    DISCIPLINES, InvalidBenchmark, SCORE_DIMENSIONS, empty_review,
    inspect_response, load_suite,
)
from scripts import run_cross_discipline

ROOT = Path(__file__).resolve().parent.parent
SUITE = ROOT / "benchmarks" / "cross-disciplinary-v1.json"
FAKE_ID = "FakeVerifiablePdfId12345"


def fake_source(number="S1", book_id="529", pdf_id=FAKE_ID, page=27):
    url = (f"https://drive.google.com/file/d/{pdf_id}/"
           f"view?usp=sharing#page={page}")
    return {
        "id": number, "book_id": str(book_id), "title": "Sample Primary Work",
        "pages": [page], "page": page,
        "url": url, "page_urls": [{"page": page, "url": url}],
        "excerpt": ("The printed source argues that explanations must "
                    "be grounded in exact observable evidence."),
    }


def fake_result(sources, answer=None):
    if answer is None:
        answer = ("This explanation must be checked against its original "
                  "passages. " + " ".join(f"[{s['id']}]" for s in sources))
    return {
        "outcome": "draft", "answer": answer, "sources": sources,
        "diagnostics": {"provider_calls": [
            {"stage": "evidence_selection"},
            {"stage": "evidence_grounded_synthesis"},
        ]},
    }


class BenchManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.suite = load_suite(SUITE)
        cls.cases = {c["id"]: c for c in cls.suite["cases"]}

    def test_two_questions_for_each_discipline(self):
        counts = {name: 0 for name in DISCIPLINES}
        for case in self.suite["cases"]:
            counts[case["discipline"]] += 1
            self.assertTrue(case["review_focus"])
        self.assertEqual(counts, {name: 2 for name in DISCIPLINES})
        self.assertEqual(len(self.cases), 8)

    def test_exact_book_ids_and_scope_for_real_catalog_examples(self):
        expected = {
            "science-darwin-selection": "529",
            "science-hawking-black-holes": "102",
            "history-thucydides-causes": "152",
            "history-herodotus-reports": "149",
            "literature-dostoevsky-raskolnikov": "114",
            "literature-orwell-language": "89",
            "philosophy-aristotle-synthesis": "7",
        }
        for name, book_id in expected.items():
            self.assertEqual(self.cases[name]["book_id"], book_id)
            self.assertEqual(self.cases[name]["scope"], "book")
            self.assertEqual(self.cases[name]["source_expectation"],
                             {"mode": "only", "book_ids": [book_id]})
        cross = self.cases["philosophy-nietzsche-kierkegaard"]
        self.assertEqual(cross["scope"], "library")
        self.assertEqual(len(cross["source_expectation"]["groups"]), 2)

    def test_manifest_rejects_duplicate_ids_and_corrupted_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "corrupt.json"
            data = json.loads(SUITE.read_text(encoding="utf-8"))
            data["cases"][1]["id"] = data["cases"][0]["id"]
            p.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(InvalidBenchmark, "Duplicate"):
                load_suite(p)
            data["cases"][1]["id"] = "science-new"
            data["cases"][1]["book_id"] = "../../outside"
            p.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(InvalidBenchmark, "scope/book_id"):
                load_suite(p)

    def test_human_rubric_has_no_automatic_grades(self):
        manual = empty_review()
        self.assertFalse(manual["reviewed"])
        self.assertEqual(set(manual["scores_0_to_3"]), set(SCORE_DIMENSIONS))
        self.assertTrue(all(value is None
                            for value in manual["scores_0_to_3"].values()))

    def test_science_source_identity_and_valid_citation(self):
        case = self.cases["science-darwin-selection"]
        result = inspect_response(case, fake_result([fake_source()]))
        self.assertTrue(result["provenance_pass"], result["issues"])
        self.assertEqual(result["provider_call_count"], 2)
        self.assertFalse(result["human_interpretation_checked"])
        self.assertEqual(result["source_book_ids"], ["529"])

    def test_wrong_book_fails_even_with_otherwise_valid_link(self):
        case = self.cases["history-thucydides-causes"]
        result = inspect_response(case, fake_result([
            fake_source(book_id="149")
        ]))
        self.assertFalse(result["provenance_pass"])
        self.assertIn("wrong_book", [i["code"] for i in result["issues"]])

    def test_unprovided_citations_and_wrong_pdf_page_fail(self):
        case = self.cases["literature-orwell-language"]
        broken = fake_source(book_id="89")
        broken["url"] = broken["url"].replace("page=27", "page=3")
        result = inspect_response(case, fake_result(
            [broken], answer="The passage supports the topic. [S1] [S999]"
        ))
        self.assertFalse(result["provenance_pass"])
        issues = {i["code"] for i in result["issues"]}
        self.assertIn("wrong_page_link", issues)
        self.assertIn("unknown_answer_citations", issues)

    def test_cross_author_missing_group_is_error(self):
        case = self.cases["philosophy-nietzsche-kierkegaard"]
        result = inspect_response(case, fake_result([
            fake_source("S1", "144")
        ]))
        self.assertFalse(result["provenance_pass"])
        self.assertIn("missing_author_evidence",
                      [i["code"] for i in result["issues"]])
        complete = inspect_response(case, fake_result([
            fake_source("S1", "144"),
            fake_source("S2", "140", "SeparateKierkegaardId789"),
        ]))
        self.assertTrue(complete["provenance_pass"], complete["issues"])

    def test_provenance_is_not_semantic_verification(self):
        case = self.cases["science-darwin-selection"]
        # This text is false, but a link-only checker cannot judge truth.
        result = inspect_response(case, fake_result(
            [fake_source()], answer=
            "Darwin demonstrated that giraffes inherit steel wings. [S1]"
        ))
        self.assertTrue(result["provenance_pass"])
        self.assertFalse(result["human_interpretation_checked"])

    def test_more_than_two_model_calls_flagged(self):
        case = self.cases["science-darwin-selection"]
        response = fake_result([fake_source()])
        response["diagnostics"]["provider_calls"].append(
            {"stage": "unrequested_extra_review"}
        )
        result = inspect_response(case, response)
        self.assertFalse(result["provenance_pass"])
        self.assertIn("extra_model_calls",
                      [i["code"] for i in result["issues"]])

    def test_library_source_ids_can_repeat_page_numbers_across_books(self):
        case = self.cases["philosophy-nietzsche-kierkegaard"]
        output = inspect_response(case, fake_result([
            fake_source("S1", "144", "NietzschePdf12345678", 14),
            fake_source("S2", "140", "KierkegaardPdf12345678", 14),
        ]))
        self.assertTrue(output["provenance_pass"], output["issues"])
        self.assertEqual(set(output["source_book_ids"]), {"140", "144"})


class BenchServerTests(unittest.TestCase):
    def test_public_local_question_picker_has_no_inference(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        process = threading.Thread(target=server.serve_forever, daemon=True)
        process.start()
        self.addCleanup(lambda: (
            server.shutdown(), server.server_close(), process.join()
        ))
        class ForbiddenModel:
            def __init__(self, *args, **kwargs):
                raise AssertionError("A benchmark listing must not call Ollama")
        with patch.object(app, "OllamaProvider", ForbiddenModel):
            with urlopen(f"http://127.0.0.1:{server.server_port}"
                         "/api/benchmarks/cross-disciplinary") as response:
                data = json.load(response)
        self.assertEqual(data["suite_id"], "antilogicalism-cross-disciplinary-v1")
        self.assertEqual(len(data["cases"]), 8)


class BenchRunnerTests(unittest.TestCase):
    def test_list_does_not_contact_local_server(self):
        with patch.object(run_cross_discipline, "_json_request",
                          side_effect=AssertionError("Unexpected model call")):
            self.assertEqual(run_cross_discipline.main(["--list"]), 0)

    def test_one_case_produces_report_then_resume_skips_all_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            def fake_request(url, payload=None, timeout=300):
                calls.append((url, payload))
                if url.endswith("/api/health"):
                    return 200, {"build": "reading-companion-test"}
                if url.endswith("/api/books"):
                    return 200, {"books": [{"book_id": "529", "available": True}]}
                if url.endswith("/api/chat"):
                    self.assertEqual(payload["book_id"], "529")
                    self.assertEqual(payload["scope"], "book")
                    self.assertEqual(payload["model"], "gemma3:12b")
                    self.assertEqual(payload["history"], [])
                    self.assertTrue(payload["diagnostics"])
                    return 200, fake_result([fake_source()])
                raise AssertionError("Unrecognized local endpoint")
            options = ["--case", "science-darwin-selection",
                       "--output", directory]
            with patch.object(run_cross_discipline, "_json_request",
                              side_effect=fake_request):
                self.assertEqual(run_cross_discipline.main(options), 0)
            with (Path(directory) / "science-darwin-selection.json").open(
                    "r", encoding="utf-8") as stream:
                record = json.load(stream)
            self.assertTrue(record["structural_checks"]["provenance_pass"])
            self.assertEqual(record["build"], "reading-companion-test")
            self.assertFalse(record["human_review"]["reviewed"])
            self.assertEqual(len([c for c in calls if c[0].endswith("/api/chat")]), 1)
            with patch.object(run_cross_discipline, "_json_request",
                              side_effect=fake_request):
                self.assertEqual(run_cross_discipline.main(
                    options + ["--resume"]), 0)
            self.assertEqual(len([c for c in calls if c[0].endswith("/api/chat")]), 1)


if __name__ == "__main__":
    unittest.main()
