# Local workbench setup and limits

The Python/Ollama workbench at http://127.0.0.1:8765/ is local-only. Developer tools are available under /developer. The workbench does not invoke or deploy the public Cloudflare Worker.

## Setup

Keep book-chatbot, antilogicalism, and antilogicalism-library-data as sibling directories. Start Ollama and install the configured model (default `ollama pull gemma3:12b`). From book-chatbot, run:

```powershell
py -3 local_preflight.py
py -3 -m unittest discover -s tests
py -3 app.py
```

Use `start.bat` as an alternative launcher on Windows. The workbench currently defaults to corpus v48 for compatibility. If your local library snapshot is v49, set `$env:BOOK_CHATBOT_DATA_VERSION="v49"` before launching. Check preflight output for the actual data folder and model availability.

## Interface

The local reader includes a light/dark appearance toggle. Its preference is saved in local browser storage and otherwise follows the operating-system theme. The theme layer is separate from the public website's chat handlers.

This is a visual alignment, not a guarantee of pixel-for-pixel equivalence with the changing public website. Compare both modes at desktop and mobile widths when making interface changes.

## Architecture and limitations

- `app.py`: local API and pipeline controls.
- `index.html`: local interface, source browsing, model selection, and batch tests.
- `local-workbench-theme.css` and `local-workbench-theme.js`: isolated appearance layer.
- `local_preflight.py`: read-only check for Ollama, the selected model, and shared data folders.
- `hosting-poc/`: JavaScript Worker pipeline; the local Ollama app does not execute it.

A local answer cannot validate Worker planning, fingerprint checks, or production citation review. Use the website's authenticated workflow for end-to-end evaluation of the public Worker. Keep development questions separate from the unseen acceptance set. An OCR fingerprint proves identity with the indexed text, not semantic support.

## Comparing local and live answers

Offline saved-trace comparison and fixed-packet replay are available in [Offline trace comparison](local-trace-testing.md). They help inspect stage handoffs and compare composition on fixed evidence, but do not make the local and live pipelines equivalent.

## Checks before merging workbench changes

1. Run Python tests and `node --test hosting-poc/*.test.mjs`.
2. Confirm localhost routes serve the interface and theme assets.
3. Check light and dark modes on `/` and `/developer`, at desktop and mobile widths.
4. Check Enter-to-submit, Ollama model selection, sources, and benchmark controls.
5. Confirm no Worker deployment configuration, production rate limits, or Turnstile behavior changed unless that was part of the change.
