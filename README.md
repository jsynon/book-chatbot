# Antilogicalism Reading Companion

The Antilogicalism Reading Companion lets readers ask questions about books, explore their ideas in ordinary language, and follow evidence back to the original pages. Its goal is a conversational entrance to the entire Antilogicalism library: a way to compare ideas, trace arguments, and return to the texts with better questions.

## Part of the Antilogicalism project

[Antilogicalism](https://jsynon.github.io/antilogicalism/) brings together essays, reading resources, and a growing library for exploring philosophy and related subjects. The companion supports close reading and further thought. Its answers should help readers engage with the books and the broader site while making the passages behind an interpretation easy to inspect.

Book text is maintained separately in [`antilogicalism-library-data`](https://github.com/jsynon/antilogicalism-library-data), the shared source of truth for extracted and repaired text. This application supplies retrieval, conversation, evidence handling, and a local reading interface. Keeping those responsibilities separate lets corpus improvements benefit the wider library project.

## Current prototype — Build 160

The pilot uses Aristotle's *Nicomachean Ethics*, running locally through Ollama with Llama 3.2 3B or Qwen 3 4B. Both models use the same pipeline. The five clickable regression questions remain at the top of the page. Source links retain Google Drive preview URLs and physical PDF page numbers; Drive may open at page 1, in which case navigate to the displayed page number.

Build 160 introduces a new passage-grounded pipeline. It searches contiguous paragraph contexts, presents bounded previews from a wider candidate pool for evidence selection, and supplies the selected full passages to answer composition. Each answer claim cites passage IDs. A separate model call reviews whether each claim follows from its own citations and whether the answer covers the question. Review returns decisions, not rewritten prose. One composition repair and a fresh review are allowed. The application rejects invented citation IDs, malformed claim records, and incomplete review records; only claims with a valid positive review can appear in a full or partial answer.

Normal chat now includes expandable source passages, without requiring troubleshooting mode. If no answer survives, retrieved passages are shown expanded so readers still have text to inspect. These are contiguous source contexts with per-book identity and physical page provenance, not model-generated quotations. Source contexts are whitespace-normalized, isolated numeric folios are excluded, and likely page continuations retain links to the actual pages spanned. This is not an OCR repair or an assurance that the extracted text is error-free.

The new path uses three model calls when the first answer passes, up to five when a repair is needed. A malformed composition may skip its review. Stage timings, provider token counts when available, candidate and selected passages, claims, review decisions, and failure categories are recorded in the downloadable report. There is no question-specific answer table. The older pipeline and its tests remain available for rollback.

A `verified` report status means the application's checks and model review accepted the answer; it is not proof of semantic correctness. The same model composes and reviews in separate requests, so it can repeat a mistake. Partial means only some reviewed content survived. Fallback means the app is showing retrieved text without a supported synthesis. Exact passage identity establishes where evidence came from; model review still has to judge what that evidence means. The new path uses full passage evidence rather than the legacy path's 45-word quote fields and lexical-overlap checks.

## Run locally

1. Install Python 3.10 or newer and Ollama. Make sure the selected model is installed in Ollama.
2. Extract the complete ZIP and open the `book-chatbot` folder. Keep `app.py`, `grounded_pipeline.py`, `inference.py`, `index.html`, and the `data` folder together.
3. Double-click `start.bat`, or run `python app.py`. The app opens at `http://127.0.0.1:8765`.
4. Choose an installed model and ask a question. Use **Run test set** to run exactly the existing five questions per selected model, then download the combined report.

No additional Python packages are required. The app contacts the configured local Ollama service for inference. It does not contact a hosted model provider. Opening a PDF source link contacts Google Drive.

### Configuration

The existing corpus configuration remains available. Selecting a different shard also requires its correct title and PDF identity; those are not automatically inferred from a catalog.

| Variable | Default / purpose |
| --- | --- |
| `BOOK_CHATBOT_LIBRARY_DATA` | Sibling `antilogicalism-library-data` repository |
| `BOOK_CHATBOT_DATA_VERSION` | `v47`; selects `data-v47` in that repository |
| `BOOK_CHATBOT_BOOK_ID` | `7`; selects `book-7.json.gz` |
| `BOOK_CHATBOT_BOOK_FILE` | Optional explicit shard path, overriding resolution |
| `BOOK_CHATBOT_BOOK_TITLE` | `Nicomachean Ethics — Aristotle` |
| `BOOK_CHATBOT_PDF_FILE_ID` | Pilot book's existing Google Drive file ID |
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `qwen3:4b` |
| `BOOK_CHATBOT_PORT` | `8765` |
| `BOOK_CHATBOT_PIPELINE` | `grounded`; set `legacy` to use the Build 159 answering path |
| `BOOK_CHATBOT_CONTEXT_TOKENS` | `8192` for the new Ollama pipeline; affects local memory use |

For rollback in PowerShell, run `$env:BOOK_CHATBOT_PIPELINE='legacy'` followed by `python app.py` in the same window. To return to the new path, set it to `grounded` and restart. The page's build label identifies the active pipeline. Selecting rollback does not modify the corpus or source links.

## Development and whole-library direction

`grounded_pipeline.py` owns passage indexing, evidence selection, composition, review, and bounded repair. `inference.py` defines the structured-completion provider boundary and its Ollama implementation. `app.py` supplies corpus configuration, HTTP handling, and the retained legacy implementation. `index.html` supplies chat, source passages, and the fixed five-prompt paired test. Extensive comments explain the decisions and trust boundaries.

Passage identities include book ID, corpus version, page range, and content. Citation links come from each passage's book metadata. The in-memory inverted index can represent passages from multiple books without page-number collisions, and tests exercise that property. The running app still loads only one configured shard. Build 160 does not provide a catalog, persistent whole-library indexing, book selection, cross-book search, or cross-book conversational synthesis. Those are the next architecture steps after establishing a useful one-book path. Alternative inference providers can implement the same completion interface; only Ollama is implemented and tested with mocked transport here.

Run the complete test suite with `python -m unittest discover -s tests -v`. Tests cover existing behavior and the new pipeline's citation integrity, book identity, page continuity, bounded calls, malformed outputs, semantic-review decisions, partial recovery, provider transport, and real local HTTP integration using scripted model responses. They do not measure live model answer quality. Packaging includes both pipelines and every test; the full suite must also pass after extraction into a fresh folder.

Build 159's live report had 5 verified, 1 partial, and 4 fallback answers. It removed the false complete friendship list, but review found weak explanations and unsupported combinations even among accepted answers. Build 160 is a substantive pipeline experiment responding to those failures. It has not yet been tested live with either Llama 3.2 3B or Qwen 3 4B. The next run must use the same five prompts and inspect the actual explanations, list membership, selected passages, coverage, unsupported claims, and stage timings. A higher verified count alone will not establish progress. Earlier implementation history is preserved in [docs/BUILD_HISTORY.md](docs/BUILD_HISTORY.md).
