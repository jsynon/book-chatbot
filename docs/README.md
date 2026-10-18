# Reading Companion: architecture and roadmap

[Antilogicalism](https://jsynon.github.io/antilogicalism/) combines an independent publishing project, a Bookshelf, and a full-text digital library. The Reading Companion adds source-grounded dialogue to the primary texts. The long-term aim is to enable discussions **across the entire collection**, without losing the argument structure or source provenance that makes serious reading possible.

## Version 1.3: an Aristotle demo that can open other books

There are three separate components of the source library:

1. **Catalog metadata** from the main Antilogicalism website repository: digital-library/library-catalog.json, containing book ID, author, title, subjects and Google Drive PDF URL. There are currently 643 catalog entries; this is not a new copy of the catalog inside the chatbot.
2. **Text data** from antilogicalism-library-data: compressed data-v47/book-N.json.gz files. This separate repository describes 644 indexed books. A book absent from the catalog or lacking a valid PDF URL cannot silently acquire citation information from another work.
3. **Local in-memory indexes** built from the chosen book's text by PassageIndex. LibraryIndexRegistry verifies the numeric ID, links it to the correct catalog metadata, loads the compressed pages only when selected, and caches up to two indexes. The server has a per-request book choice while retaining the original Aristotle index for backward compatibility.

The book browser calls GET /api/books to display metadata and local text availability. POST /api/chat can accept a numeric book_id; source IDs, title, corpus version and physical PDF pages follow that book through the entire evidence-first or direct pipeline. Invalid IDs or missing shards produce a controlled client error *before* Ollama is called. The browser clears conversation history when switching books, and Aristotle-specific regression questions disappear while reading other works.

**Boundary:** This is on-demand **single-book QA**, not corpus-wide simultaneous retrieval. We have avoided loading all book texts or building hundreds of duplicate in-memory indexes.

## Evidence-first flow and argument continuity

1. **Retrieve broadly:** An in-book lexical passage search collects up to 24 candidates and keeps unique book/version/page identities. Multi-part question facets remain supported.
2. **Select decisive evidence:** The first local Ollama call chooses up to six passages that best address the reader's question. On invalid model selection the app falls back transparently to ranked results.
3. **Recover dependent context:** v1.3 detects snippets beginning with connective phrases or pointers like "But", "Therefore" and "This", or ending mid-sentence. It adds only required preceding/following original passages, up to the bounded budget, without crossing book/version boundaries. A complete short passage alone no longer attracts arbitrary neighbors.
4. **Render argument sections:** The central excerpt and its relevant preceding/following passages are presented **in original text order**, explicitly labeled by role and separately citable. Different evidence sections are not implicitly treated as the same continuous argument.
5. **Explain:** The second local Ollama call writes a direct answer using those original source sections and paragraph-level source IDs. The model is instructed to distinguish conclusions from examples, reported opinions, objections and qualifications. No third review or rewriting call is involved.
6. **Bind citations:** Python validates each model-supplied source ID against the actual offered passages. Known individual [S1] or grouped [S1, S2] markers are recovered deterministically. Unknown, disjoint, malformed or excessive source references fail closed. The browser displays app-owned clickable references and short exact source excerpts, plus optional follow-up questions.

A response marked **draft** has valid provenance, not verified interpretation. Philosophical errors remain possible even when the right quotation appears in the source. See [evaluation.md](evaluation.md).

## Supported modes

| Pipeline | Book support | Inference path |
| --- | --- | --- |
| evidence (default) | Selected catalog book | Broad retrieval, source selector, argument-ordered context, synthesis, deterministic citation binding |
| direct | Selected catalog book | First eight ranked passages, one synthesis call, deterministic binding |
| grounded | Selected catalog book | Historical claim/review method, only for comparison |
| legacy | Startup pilot only | Original pre-v1 experimental workflow |

The website still defaults to Aristotle's *Nicomachean Ethics* and a local Gemma3:12b model, if installed. The old model-comparison controls remain under optional development tools; they should not dictate the entire project roadmap.

## Tests, integrity and limitations

Run **python -m unittest discover -s tests -v** to verify offline synthetic contracts. Tests cover source order, dependency-triggered expansion, book/version boundaries, numerical ID validation, valid PDF provenance when changing books, missing metadata, lazy index-cache limits, citation handling and HTTP routes. Automated tests do **not** assess the philosophical accuracy of Ollama outputs. Browser and Python syntax are checked by GitHub Actions.

Local inference stays on the user's Ollama installation. The PDFs remain on Google Drive and some previews ignore a PDF page fragment. Source text is treated as untrusted data, never executed or accepted as a new instruction. A book's PDF ID must come from its own catalog entry; author/title identity is not guessed from its prose.

## Next: whole-library search rather than another model contest

The next major architecture step is **corpus-wide candidate discovery** against the library's existing compressed term-to-page index partitions, followed by a bounded fetch of book text shards for the best matching passages. This should avoid scanning/decompressing 644 books per question. It will require an explicit book-ranking policy, a stable catalog-to-shard mapping for the 643/644 discrepancy, source diversity safeguards for cross-book comparisons, and a global citation identity that cannot collide between books.

Then test carefully chosen cross-work questions on at least two authors, retain the one-book demo as the reliable fallback, and plan a public inference backend. GitHub Pages only serves static frontend content and cannot run Python or Ollama. Long term, on-demand reading, multi-book retrieval and human-readable sources should share the **same** citation/provenance model rather than becoming separate chatbots.

The measure of success is how reliably the companion helps a reader understand an argument and return to the original book.
