import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

PATH = Path(__file__).resolve().parents[1] / "scripts" / "compare_traces.py"
SPEC = importlib.util.spec_from_file_location("compare_traces", PATH)
traces = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(traces)


class TraceComparisonTests(unittest.TestCase):
    def test_stage_discovery_preserves_actual_paths(self):
        record = {"trace": {"planner": {"questionParts": ["a", "b"]},
                            "retrieval": {"candidates": [{"page": 5}]},
                            "review": {"sourceDecisions": []}}}
        summary = traces.summarize(record)
        self.assertIn("trace.planner.questionParts", [x["path"] for x in summary["stages"]["planning"]])
        self.assertIn("trace.retrieval.candidates", [x["path"] for x in summary["stages"]["retrieval"]])

    def test_comparison_detects_missing_review(self):
        a = {"trace": {"review": {"sourceDecisions": [{"ok": True}]}}}
        b = {"trace": {"answer": "draft"}}
        report = traces.compare(a, b, "Worker", "Local")
        self.assertIn("trace.review.sourceDecisions", report["differences"]["review"]["only_left"])
        self.assertEqual(report["schema"], traces.SCHEMA)

    def test_sensitive_fields_are_excluded(self):
        record = {"token": "NEVER_OUTPUT", "api_key": "ALSO_HIDDEN",
                  "review": {"status": "partial"}}
        report = traces.compare(record, {}, "a", "b")
        text = json.dumps(report)
        self.assertNotIn("NEVER_OUTPUT", text)
        self.assertNotIn("ALSO_HIDDEN", text)

    def test_html_escapes_untrusted_label(self):
        report = traces.compare({}, {}, "<script>alert(1)</script>", "safe")
        html_report = traces.render_html(report)
        self.assertNotIn("<script>", html_report)
        self.assertIn("&lt;script&gt;", html_report)

    def test_refuses_oversized_input(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "trace.json"
            path.write_text("{}", encoding="utf-8")
            with unittest.mock.patch.object(traces, "MAX_FILE_BYTES", 1):
                with self.assertRaises(ValueError):
                    traces.load_json(path)


if __name__ == "__main__":
    unittest.main()
