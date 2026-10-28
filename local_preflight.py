"""Read-only startup diagnostics for the local Reading Companion workbench."""
from __future__ import annotations
import json
import os
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
LIBRARY = Path(os.getenv("BOOK_CHATBOT_LIBRARY_DATA", str(ROOT.parent / "antilogicalism-library-data"))).expanduser()
SITE = Path(os.getenv("BOOK_CHATBOT_SITE", str(ROOT.parent / "antilogicalism"))).expanduser()
VERSION = os.getenv("BOOK_CHATBOT_DATA_VERSION", "v48")
MODEL = os.getenv("OLLAMA_MODEL", "gemma3:12b")
OLLAMA = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")

def diagnose():
    result = {"workbench": str(ROOT), "site_checkout": SITE.is_dir(),
              "library_checkout": LIBRARY.is_dir(), "corpus_version": VERSION,
              "corpus_directory": str(LIBRARY / ("data-" + VERSION)),
              "corpus_present": (LIBRARY / ("data-" + VERSION)).is_dir(),
              "default_model": MODEL, "ollama_reachable": False,
              "model_installed": False, "models": []}
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3) as response:
            payload = json.load(response)
        result["models"] = sorted(m["name"] for m in payload.get("models", []) if isinstance(m, dict) and m.get("name"))
        result["ollama_reachable"] = True
        result["model_installed"] = MODEL in result["models"]
    except (OSError, ValueError) as error:
        result["ollama_error"] = str(error)
    return result

if __name__ == "__main__":
    state = diagnose()
    print(json.dumps(state, indent=2))
    if not state["corpus_present"]:
        print("\nLibrary snapshot missing. Set BOOK_CHATBOT_DATA_VERSION to an existing data-vXX folder.")
    if not state["ollama_reachable"]:
        print("Ollama is unavailable. Start Ollama before running model tests.")
    elif not state["model_installed"]:
        print("Default model missing. Run: ollama pull " + MODEL)
