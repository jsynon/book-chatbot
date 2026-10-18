# Antilogicalism Reading Companion

**A conversational way into the books, not a replacement for reading them.**

The Reading Companion belongs to [Antilogicalism](https://jsynon.github.io/antilogicalism/): a website bringing together writing, a curated Bookshelf, and a full-text searchable Digital Library covering philosophy, literature, religion, history, science, and more. The purpose of this application is to make those primary sources more accessible through dialogue: ask a question, understand the argument, and open the original book to inspect the evidence.

**Our long-term goal is conversation across the entire Antilogicalism library.** Readers should be able to examine passages across works and authors, explore connections, and discover what to read next. A compelling explanation should lead back to the texts, not replace them.

## Current state: Version 1.3

**Aristotle remains the pilot**, but the application now supports selecting other locally available works. It has two new architectural improvements:

**Argument continuity.** The evidence-first model receives central passages grouped with relevant preceding or following text in **their original reading order**, while each passage retains its own citation and PDF page. We add context for genuinely dependent excerpts, not just every short passage; this reduces distractions and helps distinguish a writer's conclusion from an objection, a qualification, or an illustration. This is a better input structure, not a guarantee of correct interpretation.

**Catalog-backed book selection.** The app reads titles, authors and PDF links from the existing Antilogicalism website catalog and compressed text from the separate antilogicalism-library-data repository. It builds an in-memory lexical index **only when a book is selected**, retaining at most two by default. Switching books clears the conversation. Missing shards or uncertain PDF identities are reported rather than invented.

The browser remains a local prototype with Ollama. It **does not yet search across multiple books in one question**. The next milestone is candidate discovery across the complete corpus and bounded cross-book retrieval using the library's already-existing index partitions.

## Run it locally

You need Python 3.10+, [Ollama](https://ollama.com/), and sibling checkouts:

1. **book-chatbot** — this application.
2. **antilogicalism-library-data** — existing compressed source text in data-v47.
3. **antilogicalism** — the main website; its digital-library/library-catalog.json supplies real titles, author names, and PDF links.

The third checkout is optional for the **Aristotle-only fallback**; other titles require its catalog, or an explicit BOOK_CHATBOT_CATALOG file path.

Install the baseline model with **ollama pull gemma3:12b**. Launch **start.bat** on Windows (or python app.py) and open **http://127.0.0.1:8765**. Select a book, ask a question, and follow the original PDF page links. A newly selected book may take longer on its first question while its index is built.

The optional expandable **Development tests and model comparisons** section retains the five historical Aristotle questions, the synthesis question, and the older pipelines. For ordinary development, use Gemma3:12b as the baseline and run the fixed tests after substantive changes; we do not need continuous comparisons of every model.

## How answers work

The default **evidence-first** method searches a broader set of primary passages (up to 24), then asks the local model to choose up to six decisive pieces of evidence. Dependent excerpts receive separately cited local context in reading order. A second Ollama call explains the selected evidence in coherent prose with structured citations. Python checks every cited ID against the actual source passages, tolerates verified individual and grouped citation markers, and renders its own clickable links. Optional verbatim excerpts and follow-up questions encourage further reading.

A **draft** means citation identities are intact, not that an interpretation has been independently verified. The previous single-call v1.1 method and a historical model-review pipeline remain accessible for targeted comparisons; they are not the default.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| BOOK_CHATBOT_LIBRARY_DATA | Sibling antilogicalism-library-data | Local corpus |
| BOOK_CHATBOT_CATALOG | Sibling antilogicalism/digital-library/library-catalog.json | Real metadata and PDF links |
| BOOK_CHATBOT_DATA_VERSION | v47 | Versioned text shards |
| BOOK_CHATBOT_CACHED_BOOKS | 2 | Maximum live book indexes |
| BOOK_CHATBOT_BOOK_ID | 7 | Default startup/pilot book |
| BOOK_CHATBOT_BOOK_FILE | Not set | Optional explicit pilot shard |
| BOOK_CHATBOT_BOOK_TITLE | Nicomachean Ethics — Aristotle | Pilot metadata fallback |
| BOOK_CHATBOT_PDF_FILE_ID | Configured Aristotle PDF ID | Pilot PDF fallback |
| OLLAMA_MODEL | gemma3:12b | Initial local model |
| OLLAMA_URL | http://127.0.0.1:11434 | Ollama service |
| BOOK_CHATBOT_PORT | 8765 | Local website port |
| BOOK_CHATBOT_PIPELINE | evidence | Default answer method |
| BOOK_CHATBOT_CONTEXT_TOKENS | 8192 | Model context/VRAM setting |
| BOOK_CHATBOT_PROGRESS | 1 | Print inference progress |

The existing website catalog currently has **643 records** and the text repository documents **644 indexed books**. Catalog entries without a verified PDF URL or a locally installed shard remain unavailable; the application does not invent metadata.

## Code and roadmap

- **app.py:** local server, the original pilot, and book-aware API routing.
- **library_catalog.py:** metadata validation and bounded lazy passage indexes.
- **grounded_pipeline.py:** lexical search and original page provenance.
- **evidence_pipeline.py:** argument context and the evidence-first answer.
- **direct_pipeline.py / inference.py:** citation binding and Ollama interface.
- **index.html:** book search and conversation UI; developer diagnostics.
- **tests/**, **docs/README.md**, **docs/evaluation.md:** contracts and further architecture.

Run **python -m unittest discover -s tests -v** to check the deterministic contracts (no Ollama needed). GitHub Actions tests the same synthetic-source behavior, not philosophical accuracy or live inference.

**Next:** try the Aristotle demo and one other book, then build source candidate discovery across the full library without loading all 644 texts into memory. Add stable cross-book citations, test cross-work comparisons, and design a sustainable inference service. GitHub Pages can host a frontend but not Python or Ollama.

The goal throughout is simple: help people **read, investigate and think for themselves**.
