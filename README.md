# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

[Antilogicalism](https://jsynon.github.io/antilogicalism/) brings together original writing, a Bookshelf and a searchable Digital Library covering philosophy, religion, literature, history, science and related fields. The Reading Companion is a conversational layer over those texts: ask a question, understand an author's reasoning, then inspect the source passages and original PDF pages.

**The long-term goal is a single companion that can discuss works throughout the entire library**, including comparisons across writers and traditions. Its job is to make primary sources more approachable and useful for independent inquiry, not to present its own confident prose as a substitute for reading.

## Version 1.4: cross-library retrieval

Version 1.4 makes the first **across-library** reading mode available in the local prototype, alongside the established **one-book** Aristotle demo and selectable individual books.

- **One selected book:** The v1.3 path remains available. Find a title or author in the website catalog; only its compressed text shard is loaded and indexed, with an LRU cache of two book indexes by default.
- **Across the Antilogicalism library (experimental):** Search the existing v47 inverted index for relevant pages throughout the corpus, then fetch and reconstruct passages from **up to four matching source books**. It opens a bounded number of pages per chosen book, rather than reading all 644 books into memory.
- **Explicit comparisons:** A question naming two authors gives each author's matching work a chance to contribute evidence. If one named author's material cannot be located for the topic, the app reports the coverage problem instead of silently answering for only the other.
- **Provenance:** Every source preserves its own book ID, title, full-text version, original PDF page and Google Drive document. Multiple books never share the same source ID within a response.
- **Reading context:** When a selected excerpt depends on preceding/following argument, those original passages are shown in book order with separate citations, not fabricated summaries.

The v47 manifest already maps **280,699 PDF pages** to **644 books**; **1,332 compressed term partitions** store delta-encoded page IDs. The Reading Companion reuses this infrastructure **without rebuilding it**. The website's separate catalog currently has 643 entries; the v47 manifest can supply verified title/PDF information for the additional indexed book. Metadata disagreement causes that work to be skipped rather than assigned a false PDF.

**Important limit:** This is **bounded discovery and cross-book synthesis**, not exhaustive research across every work for each question. An answer may omit relevant authors or passages. The original lexical search and OCR can miss concepts expressed in different wording. A valid source citation does not certify correct interpretation.

## How to run

Requirements: Python 3.10+, [Ollama](https://ollama.com/), and local sibling checkouts of:

1. **book-chatbot** — this application.
2. **antilogicalism-library-data** — the shared v47 corpus, including manifest.json.gz, terms-xx.json.gz and book-N.json.gz in data-v47.
3. **antilogicalism** — the main website, providing digital-library/library-catalog.json for the book browser. The global search can still use the manifest's book metadata if this catalog is unavailable, but author recognition and the book browser work best with it.

Install Gemma3:12b using **ollama pull gemma3:12b**. Start the local server with **start.bat** on Windows or **python app.py**, then open **http://127.0.0.1:8765**. There is no paid API or dependency on a hosted language model.

Keep the default **One selected book** mode for Aristotle's *Nicomachean Ethics* or choose another title. To compare works, change **What would you like to search?** to **Across the Antilogicalism library (experimental)**, then ask something like:

> How do Aristotle and Tolstoy understand happiness and the good life?

The console prints progress from evidence selection and answer composition. The first global search may take slightly longer to load the compressed manifest and term partitions; subsequent searches reuse a bounded partition cache. PDF links open Google Drive previews, which sometimes ignore page fragments; the companion always displays the physical page number.

The optional **Development tests and model comparisons** section preserves the established Aristotle test questions. We use Gemma3:12b as our primary local baseline and test different models only when there is a concrete reason.

## Answer architecture

For each question, the application:

1. **Discovers sources:** in a selected book, its local passage index; across the library, the global v47 page postings and only the top few compatible book shards. Explicitly named authors receive coverage safeguards, and selected pages are diversified across a work's argument rather than always taking the earliest occurrence.
2. **Selects evidence:** one local Ollama call chooses up to six primary-source passages from a bounded pool, with book diversity maintained when an explicit comparison requires it.
3. **Preserves context:** independently cited passages are arranged in original reading order, with context added only for excerpts that appear to depend on it.
4. **Explains:** a second Ollama call writes a readable response with paragraph-level source IDs and optional follow-up questions.
5. **Binds citations:** Python validates structured and inline source markers against passages actually provided and renders clickable book-specific links. Missing/unknown/conflicting source IDs are rejected; valid grouped markers are reconciled without a new model call.

The result is labeled **draft**, because source identity and quotation integrity are deterministic but philosophical correctness is **not** independently verified. In particular, an LLM can misunderstand the relationship between ideas while accurately quoting the relevant passage. Keep reading with the original text in view.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| BOOK_CHATBOT_LIBRARY_DATA | Sibling antilogicalism-library-data | Shared v47 source and search partitions |
| BOOK_CHATBOT_CATALOG | Sibling antilogicalism/digital-library/library-catalog.json | Browsing and author metadata |
| BOOK_CHATBOT_DATA_VERSION | v47 | Source and index snapshot |
| BOOK_CHATBOT_CACHED_BOOKS | 2 | Bounded in-memory single-book passage indexes |
| BOOK_CHATBOT_PARTITION_CACHE | 8 | Maximum decompressed global term partitions retained |
| BOOK_CHATBOT_BOOK_ID | 7 | Startup book (Aristotle pilot) |
| BOOK_CHATBOT_BOOK_FILE | Not set | Optional explicit pilot book file |
| OLLAMA_MODEL | gemma3:12b | Local development baseline |
| OLLAMA_URL | http://127.0.0.1:11434 | Inference endpoint |
| BOOK_CHATBOT_PORT | 8765 | Local HTTP port |
| BOOK_CHATBOT_PIPELINE | evidence | Default answer method |
| BOOK_CHATBOT_CONTEXT_TOKENS | 8192 | Ollama context size |
| BOOK_CHATBOT_PROGRESS | 1 | Enable CMD progress messages |

**Modules:** app.py serves the UI and API; library_catalog.py manages single-book metadata/indexes; whole_library.py locates matching books/pages without reading the full corpus; grounded_pipeline.py builds book-specific passage and PDF provenance; evidence_pipeline.py selects and assembles source arguments; direct_pipeline.py binds citations and retains the v1.1 baseline; inference.py calls Ollama. The index.html reader keeps model comparisons optional. Full technical details are in [docs/README.md](docs/README.md).

Tests use synthetic sources: **python -m unittest discover -s tests -p 'test_*pipeline.py' -v**, **python -m unittest discover -s tests -p 'test_library_catalog.py' -v** and **python -m unittest discover -s tests -p 'test_whole_library.py' -v**. They do not require Ollama. GitHub Actions runs the same contracts. For an optional real-v47 read-only check against the public corpus, run **python scripts/smoke_global_retrieval.py**; it downloads only a manifest, three partitions, two books and the catalog into a temporary directory.

## What's next

**Local acceptance first:** verify a cross-author answer, its sources and latency using the real installation. Then improve the reliability of book/page ranking and interpretive accuracy using the actual failures that readers encounter, not more Aristotle-specific prompt patches or a loop of model-vs-model experiments.

**Public demo:** the browser and its source links can live on GitHub Pages, but serving real chat requests requires a sustainable Python/Ollama inference host; GitHub Pages alone cannot run the model. The architecture retains the usable one-book mode even if future global retrieval is imperfect.

Antilogicalism's purpose remains **making the great texts easier to find, read, understand and question**.
