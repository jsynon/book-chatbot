"""Manual-review helpers operate only on saved JSON and never call models."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.review_cross_discipline import (
    load_reports, report_source_lines, review_record, save_report,
)


class ManualReviewTests(unittest.TestCase):
    def test_load_reports_filters_suite_and_optional_case_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            valid = {
                "suite_id": "antilogicalism-cross-disciplinary-v1",
                "case_id": "science-darwin-selection",
            }
            (folder / "science.json").write_text(json.dumps(valid), encoding="utf-8")
            (folder / "other-suite.json").write_text(
                json.dumps({"suite_id": "other", "case_id": "history-test"}),
                encoding="utf-8",
            )
            self.assertEqual(len(load_reports(folder)), 1)
            self.assertEqual(load_reports(folder, {"history-test"}), [])

    def test_review_source_preview_includes_citation_pages_and_passage(self):
        lines = report_source_lines({
            "response": {"sources": [{
                "id": "S1", "title": "Origin of Species", "pages": [80, 81],
                "excerpt": "Variation is inherited.", "url": "https://example.test/page",
            }]}
        })
        joined = "\n".join(lines)
        self.assertIn("[S1] Origin of Species (PDF p. 80, 81)", joined)
        self.assertIn("Variation is inherited.", joined)
        self.assertIn("https://example.test/page", joined)

    def test_save_report_replaces_json_with_unicode_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "review.json"
            save_report(path, {"answer": "phronēsis", "human_review": {"reviewed": True}})
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["answer"], "phronēsis")
            self.assertTrue(saved["human_review"]["reviewed"])
            self.assertEqual(list(Path(temp).glob("*.tmp")), [])

    def test_completed_review_saves_all_five_human_scores(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "science.json"
            record = {
                "case_id": "science-darwin-selection",
                "discipline": "science",
                "model": "gemma3:12b",
                "build": "local-test",
                "question": "How does this sample question test selection and variation?",
                "review_focus": [],
                "structural_checks": {"provenance_pass": True},
                "response": {"answer": "A cited sample explanation. [S1]", "sources": []},
            }
            answers = iter(["3", "2", "2", "3", "3", "Clear and mostly complete.", "y"])
            with patch("builtins.input", side_effect=lambda _prompt: next(answers)):
                self.assertTrue(review_record(path, record))
            saved = json.loads(path.read_text(encoding="utf-8"))
            review = saved["human_review"]
            self.assertEqual(review["scores_0_to_3"], {
                "accuracy": 3, "completeness": 2, "explanatory_value": 2,
                "citation_support": 3, "readability": 3,
            })
            self.assertEqual(review["notes"], "Clear and mostly complete.")
            self.assertTrue(review["reviewed"])


if __name__ == "__main__":
    unittest.main()
