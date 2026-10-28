# Local workbench refresh (October 2026)

The Python/Ollama workbench at http://127.0.0.1:8765/ is **local-only**. Developer tools remain under /developer. Nothing here invokes or deploys the public Cloudflare Worker.

## Setup

Keep book-chatbot, antilogicalism and antilogicalism-library-data as sibling directories. Start Ollama, and install the configured model (default `ollama pull gemma3:12b`). From book-chatbot, run:

```powershell
py -3 local_preflight.py
py -3 -m unittest discover -s tests
py -3 app.py
```

Use `start.bat` as an alternative launcher. If your local library snapshot is v49, set `$env:BOOK_CHATBOT_DATA_VERSION="v49"` **before** launching. The workbench defaults to v48 for compatibility and does not automatically assume a future version is complete. Inspect preflight output for the actual folder and model availability.

## Interface

The local reader now includes a light/dark appearance toggle in the top navigation. Its preference is saved only in the local browser's storage and follows the operating-system theme until a preference is chosen. It uses a local CSS overlay rather than importing the entire public application's JavaScript or modifying its chat handlers. Developer Mode and the Reader Mode continue to share the same appearance setting.

This is a visual alignment, **not** a guarantee of pixel-for-pixel equivalence with the changing public website. Compare both modes at desktop and mobile widths after starting the application.

## Architecture and limitations

- `app.py`: legacy local API and pipeline controls; full-library search uses separate local Python modules.
- `index.html`: local interface, source browsing, model selection and batch tests.
- `local-workbench-theme.css` and `local-workbench-theme.js`: isolated appearance layer.
- `local_preflight.py`: read-only check for Ollama, chosen model, and shared data folders.
- `hosting-poc/`: JavaScript Worker pipeline, **not** executed by the local Ollama app.

A local answer cannot validate Worker planning, fingerprint checks, or production citation review. For end-to-end production evaluation use the website's authenticated workflow. Keep its seven-question development set separate from the unseen acceptance set. Do not treat an OCR fingerprint as proof of semantic support.

## Follow-up engineering work

A complete parity workbench would need a controlled adapter for the browser retriever and Worker evidence pipeline, plus recorded trace import, source alignment and result diffing. Do not silently replace Python evidence validation with Worker assumptions or copy credentials into the local UI.

## Checks before merging

1. Run Python tests and `node --test hosting-poc/*.test.mjs`.
2. Confirm localhost routes return the two new assets.
3. Confirm light/dark mode on / and /developer, desktop and mobile.
4. Confirm Enter-to-submit, Ollama model selection, sources, and benchmark controls still work.
5. Confirm no Worker code, deployment configuration, production rate limits, or Turnstile behavior changed.
