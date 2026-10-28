import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).resolve().parents[1] / "local_preflight.py"
SPEC = importlib.util.spec_from_file_location("local_preflight", PATH)
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)

class LocalPreflightTests(unittest.TestCase):
    def test_missing_checkout_reports_failure_without_crashing(self):
        with tempfile.TemporaryDirectory() as location:
            missing = pathlib.Path(location) / "missing-library"
            with patch.object(preflight, "LIBRARY", missing), patch.object(preflight, "SITE", missing), patch("urllib.request.urlopen", side_effect=OSError("offline")):
                state = preflight.diagnose()
        self.assertFalse(state["corpus_present"])
        self.assertFalse(state["ollama_reachable"])
        self.assertEqual(state["models"], [])

    def test_version_selection_is_explicit(self):
        with tempfile.TemporaryDirectory() as location:
            root = pathlib.Path(location)
            (root / "data-v49").mkdir()
            with patch.object(preflight, "LIBRARY", root), patch.object(preflight, "VERSION", "v49"), patch("urllib.request.urlopen", side_effect=OSError("offline")):
                state = preflight.diagnose()
        self.assertTrue(state["corpus_present"])
        self.assertEqual(state["corpus_version"], "v49")

if __name__ == "__main__":
    unittest.main()
