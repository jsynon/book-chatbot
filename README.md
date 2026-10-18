# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

[Antilogicalism](https://jsynon.github.io/antilogicalism/) brings together original writing, a Bookshelf and a searchable Digital Library covering philosophy, religion, literature, history, science and related fields. The Reading Companion is a conversational layer over those texts: ask a question, understand an author's reasoning, then inspect the source passages and original PDF pages.

**The long-term goal is a single companion that can discuss works throughout the entire library**, including comparisons across writers and traditions. Its job is to make primary sources more approachable and useful for independent inquiry, not to present its own confident prose as a substitute for reading.

## Version 1.4.2: question-aware conceptual retrieval

Version 1.4 established the first across-library reading mode. **Version 1.4.1 improves relevance and attribution** after real-reader tests exposed keyword-only false matches, unrelated edited anthologies, and an incorrect requirement to cite one arbitrary volume rather than an author. The established **one-book** Aristotle demo remains available and unchanged.

- **One selected book:** The v1.3 path remains available. Find a title or author in the website catalog; only its compressed text shard is loaded and indexed, with an LRU cache of two book indexes by default.
- **Hypothetical cross-author questions (v1.4.2):** For questions such as “What would Nietzsche think about Kierkegaard's thought?”, the system recognizes the kind of question, then uses the **first of the existing two Ollama calls** to propose distinct topical search words for each *catalog-recognized* author. It retrieves original passages from the v47 index using those concepts and uses the **second** call for a cited, expressly hypothetical explanation. Ordinary questions still use first-call evidence selection and second-call synthesis. **No third model request, model judge, embedding service, or hardcoded philosopher answer** has been introduced.
- **Edited-volume caution:** The ranking now modestly prefers standalone works over edited collections when comparable primary material is available. Collected editions remain searchable and are flagged as such so an editor's introduction is not automatically attributed to the author. This is a safeguard, not proof of who wrote each excerpt.

- **Across the Antilogicalism library (experimental):** Search the existing v47 inverted index for relevant pages throughout the corpus, then fetch and reconstruct passages from **up to four matching source books**. It opens a bounded number of pages per chosen book, rather than reading all 644 books into memory.
- **Subject-focused discovery:** The search distinguishes the topic of a question from reader instructions such as "different authors," "library," and "question." It favors pages discussing multiple topic words together, work-title/subject relevance, and concentrated evidence over incidental hits in enormous anthologies. This is deterministic lexical relevance, **not** a semantic understanding engine.
- **Author-aware comparisons:** Questions naming authors now recognize their works as an author *group*, including common short surnames. Generic bylines such as "Various authors" cannot be mistaken for named people. With two named authors, up to two works per author can supply evidence, and citation coverage is checked **per person**, not per arbitrary first-ranked volume.
- **Careful narrative attribution:** The evidence selector and answer composer are reminded that dialogue spoken by fictional characters is not necessarily an authorial thesis. These prompts do not guarantee correct literary interpretation.
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

1. **Discovers sources:** in a selected book, its local passage index; across the library, intent-filtered content terms query the global v47 page postings before opening the best-matched book shards. For hypothetical two-author questions with no clear subject, one model call first plans author-specific concept terms. The plan is *search guidance*, not a factual source. The ranking considers term co-occurrence, density across a work, original titles/subjects, and the presence of actual named authors. Independently attributable works are prioritized for broad author surveys; explicit named-author comparisons balance up to two works each. Selected pages are spread across a work rather than always taking the earliest occurrence.
2. **Selects evidence:** passages are ranked by actual topic coverage and proximity. In ordinary questions, one Ollama call selects decisive evidence. In planned hypothetical comparisons, a deterministic, author-balanced set of original passages replaces that call, since the model call was already spent on planning. Both paths maintain author-level coverage where available.
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

**Modules:** app.py serves the UI and API; library_catalog.py manages single-book metadata/indexes; retrieval_relevance.py parses topical vocabulary and real authorship; conceptual_retrieval.py plans author-specific thematic searches for counterfactual comparisons; whole_library.py locates and reranks bounded books/pages; grounded_pipeline.py builds source passages and PDF provenance; evidence_pipeline.py selects and assembles source arguments; direct_pipeline.py binds citations; inference.py calls Ollama. The index.html reader keeps model comparisons optional. Full technical details are in [docs/README.md](docs/README.md).

Tests use synthetic sources: **python -m unittest discover -s tests -p 'test_*pipeline.py' -v**, **python -m unittest discover -s tests -p 'test_library_catalog.py' -v** and **python -m unittest discover -s tests -p 'test_whole_library.py' -v**. Also run **python -m unittest discover -s tests -p 'test_retrieval_relevance.py' -v** and **python -m unittest discover -s tests -p 'test_conceptual_retrieval.py' -v** for author grouping, conceptual question recognition, bounded per-author retrieval and the two-call API contract. They do not require Ollama. GitHub Actions runs the same offline contracts. For an optional real-v47 read-only conceptual-source audit, run **python scripts/smoke_conceptual_v142.py**. It uses representative thematic hints for Nietzsche and Kierkegaard to demonstrate source selection **without calling Ollama**. For ordinary literal-index discovery, **python scripts/smoke_relevance_v141.py** remains available. This downloads a manifest, needed term partitions, the catalog, and at most four selected source books per question into a temporary directory. The audit identified *Man's Search for Meaning*, *A Confession*, and other individual works for the open-ended meaning-of-life question. It did not use Ollama.

## What's next

**Local acceptance first:** verify a cross-author answer, its sources and latency using the real installation. Then improve the reliability of book/page ranking and interpretive accuracy using the actual failures that readers encounter, not more Aristotle-specific prompt patches or a loop of model-vs-model experiments.

**Public demo:** the browser and its source links can live on GitHub Pages, but serving real chat requests requires a sustainable Python/Ollama inference host; GitHub Pages alone cannot run the model. The architecture retains the usable one-book mode even if future global retrieval is imperfect.

Antilogicalism's purpose remains **making the great texts easier to find, read, understand and question**.
