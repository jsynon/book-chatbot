# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

[Antilogicalism](https://jsynon.github.io/antilogicalism/) brings together original writing, a Bookshelf and a searchable Digital Library covering philosophy, religion, literature, history, science and related fields. The Reading Companion is a conversational layer over those texts: ask a question, understand an author's reasoning, then inspect the source passages and original PDF pages.

**The long-term goal is a single companion that can discuss works throughout the entire library**, including comparisons across writers and traditions. Its job is to make primary sources more approachable and useful for independent inquiry, not to present its own confident prose as a substitute for reading.

## Version 1.5.1: Book Lite visual integration (local preview)

The Reading Companion now shares the *appearance* of Antilogicalism's existing Book Lite website: the same theme CSS, photograph-backed site masthead and tagline, six-item navigation, Century Schoolbook typography, narrow editorial content column, and three-column footer arrangement. The actual stylesheet from `jsynon/antilogicalism/wp-content/themes/book-lite/style.css` is committed as `book-lite.css` and served locally. Asset references point to the public site's original decorative images; these visuals need network access to display. The footer feed areas link to the live Arts & Letters Daily and Quanta websites rather than pretending to have synchronized RSS content.

This is a theme-matched **local demonstration**, not a published website page: `start.bat` continues to start a server bound to `127.0.0.1`; the existing chat API, catalog, v47 corpus, and Ollama inference remain unchanged. The menu links navigate to the actual live Antilogicalism pages, while the Reading Companion itself remains local. Changes to the site's Book Lite styles after this copy will need to be synced explicitly.

**Review:** run locally and inspect the header, navigation, book picker, source links, and footer at desktop and phone widths in Chrome Device Toolbar. Confirm one-book and cross-library chats still work. No additional model-quality benchmark campaign is required for this styling release.

## Version 1.5.0: reader-first local demo

The default page now prioritizes choosing a book, asking a question, and reading cited answers. Advanced model/pipeline settings, troubleshooting, and example-question collections are optional disclosures. Answers render safe paragraphs, emphasis, and linked source markers without interpreting model text as HTML. Source lists show physical PDF page numbers and disclose the known Google Drive limitation. The layout adapts to phone-sized browser windows, with clearer local-processing feedback, an explicit new-conversation control, and Ctrl+Enter/Command+Enter submission.

**Test locally:** start `start.bat`, open `http://127.0.0.1:8765` in Chrome, press F12, toggle Device Toolbar (Ctrl+Shift+M), and try a phone preset. No public hosting is needed. The server intentionally remains bound to `127.0.0.1`, so actual phones on the Wi-Fi cannot connect to this build yet. This is a *reader interface milestone*, not a new answer-accuracy certification or a solution to Google Drive's page-anchor behavior. The v1.4.6 source/retrieval pipeline is preserved.

## Version 1.4.6: final quality milestone before the v1.5 demo

This is the **last planned answer-quality-focused v1.4 release before the v1.5 usable-demo milestone**. Versions 1.4–1.4.5 established cross-book retrieval, cross-disciplinary benchmarks, source-form safeguards, hypothetical planning, and two-call evidence selection. **Version 1.4.6 addresses one structural problem**: the model could have access to correct source passages but still overlook a distinct part of the question or misread a multi-paragraph exchange. The same two-call local Ollama pipeline, original PDF citations, one-book mode and bounded whole-library pilot remain intact. Further routine prompt/model retuning is NOT a demo prerequisite.

- **One selected book:** The v1.3 path remains available. Find a title or author in the website catalog; only its compressed text shard is loaded and indexed, with an LRU cache of two book indexes by default.
- **Cross-disciplinary tests:** A fixed set of eight real-catalog questions covers scientific explanation, theory and uncertainty, historical causation and source criticism, fictional character versus author, literary thematic synthesis, and the two philosophical control cases. The new reader question picker is closed by default, works at mobile widths, and fills the composer **without sending a request**. A separate opt-in, single-model local CLI saves one resumable diagnostic report per selected case.
- **Honest evaluation:** Deterministic checks detect unknown source IDs, wrong book PDFs, page-link mismatches, missing author evidence and extra model calls. The reports explicitly leave **accuracy and interpretation ungraded** until someone reviews the original passages. Questions are not used as production retrieval rules or a hidden answer key.

- **Mandatory question-part evidence audit (v1.4.6):** The selected original text is checked against each existing question facet, without waiting for the first Ollama call to volunteer an extra search. At most two original indexed passages can replace low-priority evidence within the same six-slot/character budget. It may find an additional source for a scientific subquestion; if the historical/literary wording lacks enough searchable terms, **the gap is disclosed, not filled with a fabricated explanation**. These are lexical, not semantic, coverage checks.
- **Coherent source scenes (v1.4.6):** Adjacent selected passages from the same work are assembled ONCE in actual book reading order, retaining distinct source IDs and physical PDF page links. A scene might include a historian reporting someone else's argument and the response; scene grouping does not prove which speaker endorses a position and does not combine distant chapters.
- **Release gate instead of endless builds:** The existing 144 offline contracts plus six new source-structure regressions passed; a single read-only real-v47 audit checked Darwin, Thucydides and Dostoevsky. This audit confirmed both improvement and limits: a Darwin facet received another actual source; unnamed immediate historical disputes and some literary challenges were still lexically unresolved, and remain labeled as such. This is NOT a claim of solved interpretive accuracy. Work now advances to v1.5 rather than starting another open-ended quality iteration.

- **Evidence-gap recovery (v1.4.5):** The first evidence-selection call now sees the separate parts of a multipart question. When a part is unsupported by its current previews, it may propose up to **two short lexical search phrases**; the existing source index looks these up before the second model call. Only real original-source passages may be added, never model-created claims, PDF pages or authors. At most two additional core sources are retained inside the same six-passage and character budgets. A missing hint safely leaves the original evidence unchanged. Explicit author coverage safeguards still apply.
- **Original-book narrative links (v1.4.5):** Selected nearby paragraphs from the same work are linked in original page order, helping the model read an investigator's quotation or characterization alongside the character's own reply. These links **do not determine who is speaking** and do not turn conjecture into fact.
- **Source-form provenance (v1.4.5):** An entire contents page remains marked as navigation even when its text is split into later snippets without a visible heading. This prevents Thucydides' PDF page 19 and similar tables of contents from competing as explanatory evidence.
- **Verbatim quotation warnings (v1.4.5):** A deterministic checker flags long direct quotations that cannot be matched word-for-word to that paragraph's cited excerpts. If found, the reader sees a caution to check the original PDF. It neither rewrites the output nor claims to check its interpretation.

- **Evidence source-form filtering (v1.4.4):** The original paragraph index now strongly downranks obvious table-of-contents lists, running headers, and OCR-damaged chapter headings. Before the existing model selector runs, low-value navigation snippets are excluded **when substantive prose is also available**. The original source IDs and physical PDF page links remain unchanged; explicit contents/heading questions and sparse sources retain their headings. Diagnostics record any removed snippets.
- **Speech and argument context (v1.4.4):** The evidence preview and reading-order sections now expose cautious markers for quotations, reported statements, and clipped opening fragments. An excerpt beginning mid-sentence or in unattributed dialogue may receive its actual adjacent preceding passage, with a distinct citation. The composer is reminded to distinguish direct speakers from people they are *reporting*, and not to claim a scene is the final event without evidence. These observable markers **do not automatically identify a character or establish who endorses a position**.


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

## Cross-disciplinary acceptance tests

With the local app running, open the **Try questions from science, history, literature, and philosophy** disclosure. Choose a question: the UI selects the relevant source book and fills the text box, but never clicks Ask for you. The browser experience remains responsive for phones.

For reusable reports, run these commands in the repository on Windows (PowerShell or CMD):

```powershell
python scripts\run_cross_discipline.py --list
python scripts\run_cross_discipline.py --case science-darwin-selection
python scripts\run_cross_discipline.py --case history-thucydides-causes
python scripts\run_cross_discipline.py --case literature-dostoevsky-raskolnikov
python scripts\run_cross_discipline.py --summary
```

Each successful test writes a full JSON file in `reports/cross-disciplinary-v1/` (ignored by Git). **Nothing invokes Ollama with `--list` or `--summary`.** The runner defaults to Gemma3:12b, evidence-first and a fresh conversation for each question. Running all eight requires explicitly passing `--all`; `--resume` skips prior results and `--rerun` deliberately overwrites one. See [benchmarks/README.md](benchmarks/README.md) for question-by-question review criteria, the five 0–3 manual score dimensions, and the limits of automatic provenance checks.

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

**Modules:** app.py serves the UI and API; library_catalog.py manages single-book metadata/indexes; retrieval_relevance.py parses topical vocabulary and real authorship; conceptual_retrieval.py plans author-specific thematic searches for counterfactual comparisons; evidence_structure.py reserves original evidence for distinct question parts and marks unresolved facets; evidence_coverage.py retrieves model-suggested missing-topic passages without extra inference; quote_audit.py checks long literal quotations against cited text; passage_quality.py identifies source navigation and possible speaker/quotation ambiguity; whole_library.py locates and reranks bounded books/pages; grounded_pipeline.py builds source passages and PDF provenance; evidence_pipeline.py selects and assembles source arguments; direct_pipeline.py binds citations; inference.py calls Ollama. The index.html reader keeps model comparisons optional. Full technical details are in [docs/README.md](docs/README.md).

Tests use synthetic sources: **python -m unittest discover -s tests -p 'test_*pipeline.py' -v**, **python -m unittest discover -s tests -p 'test_library_catalog.py' -v** and **python -m unittest discover -s tests -p 'test_whole_library.py' -v**. Also run **python -m unittest discover -s tests -p 'test_retrieval_relevance.py' -v** and **python -m unittest discover -s tests -p 'test_conceptual_retrieval.py' -v** for author grouping, conceptual question recognition, bounded per-author retrieval and the two-call API contract. Run **python -m unittest discover -s tests -p 'test_evidence_structure.py' -v** for the final quality gate on question-part coverage and original-order scene assembly, and **python -m unittest discover -s tests -p 'test_evidence_coverage.py' -v** for bounded gap retrieval, original page links and quotation provenance, and **python -m unittest discover -s tests -p 'test_passage_quality.py' -v** for science, history and literary-voice source-form regressions. They do not require Ollama. GitHub Actions runs the same offline contracts. For an optional real-v47 read-only conceptual-source audit, run **python scripts/smoke_conceptual_v142.py**. It uses representative thematic hints for Nietzsche and Kierkegaard to demonstrate source selection **without calling Ollama**. For ordinary literal-index discovery, **python scripts/smoke_relevance_v141.py** remains available. This downloads a manifest, needed term partitions, the catalog, and at most four selected source books per question into a temporary directory. The audit identified *Man's Search for Meaning*, *A Confession*, and other individual works for the open-ended meaning-of-life question. It did not use Ollama.

The optional **python scripts/audit_source_quality_v144.py** downloads the real v47 Darwin, Thucydides and Dostoevsky source shards into a temporary directory and checks the passages reaching the model selection stage, without calling Ollama or modifying source data. It is an **index/source-quality check**, not proof that the generated answers are correct.

The optional **python scripts/audit_facet_recovery_v145.py** downloads three public v47 source shards temporarily and audits why Thucydides' contents page no longer appears, whether two missing-dispute searches retrieve actual passages, whether adjacent source pages link together, and whether a deliberately altered Darwin quotation is flagged. It does not call Ollama or modify the corpus.

## Next milestone: v1.5 usable desktop/mobile demo

**The quality-improvement cycle is frozen after v1.4.6**, except for major regressions that make the reader's experience untrustworthy or unusable. We will not run another full series of competing local models or incremental philosophy-specific patches before shipping a demo.

The v1.5 goals are to stabilize the responsive reading interface (including narrow phone screens), present clear linked source passages and original PDF pages, streamline book selection and reading conversation, show honest AI-error/evidence-coverage notices, and provide a straightforward local setup for testing. The read-only `python scripts/audit_release_gate_v146.py` verifies the final v1.4.6 source-assembly changes against selected public original texts without Ollama.

**Website integration:** GitHub Pages can host an Antilogicalism Reading Companion page and its responsive frontend, but it cannot serve local Python inference or Ollama. Public release requires a separately secured, hosted inference API with appropriate usage limits. That infrastructure is a v1.5 deployment investigation, not an excuse to delay a usable one-book/local demo.

The purpose remains **making the whole Antilogicalism digital library easier to find, understand and critically read**, with citations back to primary sources rather than false claims of verified correctness.
