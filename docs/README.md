# Reading Companion: architecture and roadmap

The [Antilogicalism](https://jsynon.github.io/antilogicalism/) Reading Companion is a primary-source-grounded local reading assistant. It is intended to cover the full digital library, not only the current Aristotle pilot. The application deliberately separates bibliographic metadata, indexed PDF text, retrieval, answer composition and verification of citation identities.

## Architecture in v1.4.3

Version 1.4.3 introduces reproducible **cross-disciplinary evaluation**, not a new question-specific answer generator. The normal one-book, across-library, and two-call conceptual planning routes remain as implemented in v1.4.2. The benchmark and the optional question picker are isolated from the production retrieval ranking.


The library now has **two supported retrieval scopes** sharing the same answer pipeline.

**One selected book** resolves an ID against the existing website catalog and a matching compressed book shard. The app indexes that book on first use, caches a small number of indexes, and only discusses the chosen work. The user's conversation resets when switching books.

**Across the library (experimental)** uses the separate library-data repository's original **v47 full-text inverted index** to discover pages across the collection *before opening any source books*. It then loads only a few highly ranked book shards, selects a bounded set of matching pages and immediate context, and constructs one temporary passage index across those works.

### Source repositories

- **antilogicalism** supplies digital-library/library-catalog.json: title, author, subject tags and verified Google Drive PDF URLs for 643 known catalog entries.
- **antilogicalism-library-data** supplies data-v47/manifest.json.gz, terms-xx.json.gz and book-N.json.gz. Its manifest documents **644 books, 280,699 global page IDs and 1,332 term partitions**. It is authoritative for index version, book/page membership, and the extra indexed book absent from the website catalog.
- **book-chatbot** contains the conversation server, bounded retrieval logic and UI. It must not copy PDF text or recreate a second 644-book index.

The manifest maps each global page ID to a book ID. Each two-character term partition stores sorted **delta-encoded global page postings**; the compressed per-book source records carry matching global page IDs plus **physical PDF page numbers**. The two numbers are distinct and must not be confused. Term lookup opens only partitions needed by the reader's content words. The manifest is cached lazily, with at most eight decompressed term partitions retained by default.

### Query flow

1. **Scope and topic.** In one-book mode, use the established cached passage index. In across-library mode, separate subject terms from question framing such as "different authors," "library," or "question." Normalize possessives and exclude generic catalog bylines (including "Various authors") from named-person detection. Group all catalog works by each actually named author. This deterministic extraction supports any topic words; it is not an encyclopedia of philosophy or a paid semantic search call.
2. **Find global page matches.** For ordinary questions, read delta postings for up to eight literal topic words. For a genuine hypothetical comparison between **two to four verified named authors**, the first of the two Ollama calls instead generates **2-5 distinct topic hints per author**. Each author's hinted words are matched only against THAT person's actual catalog works, never treated as quotations or historical claims. If the plan is invalid or has no usable indexed matches, bounded literal retrieval replaces it without adding a third model call. Versioned page IDs are always verified; malformed postings fail closed.
3. **Choose bounded books and pages.** Prefer books with multiple subject terms on the same page, strong topic density, and title/subject metadata matches; discourage incidental matches in giant collections without excluding collections altogether. Explicit named-author comparisons allocate coverage by *person*, with up to two works per author when space permits. General surveys prioritize distinct individually attributed authors over four generic anthology bylines. If a requested author's matched books are unavailable, report that limitation. Open no more than **four compressed book shards**, retain no more than **nine original PDF pages per book**, and diversify similarly scored pages across the argument. The global mode doesn't add full-book indexes to the one-book cache.
4. **Retrieve passages with book diversity.** Reconstruct original passages from just those source pages and their immediate neighbors. Rerank original passages by coverage of the reader's *subject terms* and their proximity in the actual text, rather than accepting results that happen to mention "library" or "question." The 24-candidate pool alternates across selected books. Every passage includes its own book ID, title, author metadata (when available), PDF identity, data version, physical pages and deterministic passage ID.
5. **Choose evidence.** Ordinary questions use the first local Ollama call to select up to six decisive passages. A hypothetically planned question uses a deterministic, topic-ranked set of up to six original passages instead: the first inference call has already prepared the search plan. In both cases, author coverage is enforced using only actual retrieved sources. A citation to Aristotle's *Ethics* satisfies Aristotle even if the Works anthology also ranked highly. This protects representation, not interpretive correctness.
6. **Read the argument, then compose.** Preceding or following argument-dependent passages are arranged **in original reading order** with distinct citations. The model sees author and subject metadata plus whether a source is an edited collection. It is reminded to distinguish editorial commentary and a fictional character's speech from an author's endorsed view. For a hypothetical question it must explicitly label conjectural reconstruction as such; the passages cannot establish that one author actually read or responded to the other. The second Ollama call writes the explanation. There is **no reviewer or automatic repair loop**, and this does not guarantee accuracy.
7. **Validate citation identity.** The shared Python binder checks every output source ID, including optional inline or grouped references, against the passages actually supplied. Unknown, conflicting or excessive references fail closed. The browser makes source links with the correct **individual book's PDF file ID**, and displays its title alongside the citation.

Source excerpts and page links come from the compressed texts and verified metadata, never from the model's own assertion of provenance. Book prose is treated as untrusted data and rendered as text, not as executable HTML.

## API and runtime

- **GET /api/health** — build, configured pilot book, catalog and availability of global manifest.
- **GET /api/books** — titles and locally available individual works.
- **GET /api/library/status** — whether the local versioned whole-library manifest is installed and current bounds.
- **POST /api/chat** — accepts question, model, history and pipeline. The optional **scope** is either **book** (default; optional numeric book_id) or **library** (across corpus). The returned response includes an explicit scope, book-specific sources and, for global mode, **library_discovery** listing selected books, matched page counts and actual opened pages. Diagnostics contain the model inputs and source selection details only when requested.

**Resource limits** in whole_library.py: at most 8 literal topic terms for ordinary questions (up to 5 validated thematic terms per named author in planned comparisons), 4 source books, 5 matching page hints per book, 9 reconstructed physical pages per book, 24 evidence candidates, 6 source passages and **two Ollama calls**. The manifest and up to 8 term partitions are cached; book shards are loaded only for the active global query. Large book shards are still decompressed in full to locate selected pages. This is bounded **book count**, not true streaming I/O over compressed shards.

The browser defaults to **One selected book**, preserving the usable Aristotle demo; the **Across library (experimental)** scope is opt-in. It resets conversation history when switching scopes, disables the single-book picker in global mode and labels all cited books clearly. The old comparison controls remain collapsed and optional; Gemma3:12b is the primary local development model.

## What v1.4.1 changed on real v47 data

The real library smoke now extracts only **happiness, good, life** from the Aristotle/Tolstoy question and retrieves candidates from Aristotle's *Nicomachean Ethics* and *Politics* plus Tolstoy's *A Confession* and *War and Peace*. In particular, it no longer gives three of four selected book slots to Aristotle.

For the broad meaning-of-life question it extracts only **life, meaning**, recognizes **zero** named authors (correctly ignoring the words "different authors"), and selects *Man's Search for Meaning* (Frankl), *A Confession* (Tolstoy), *Man Has No Nature* (Ortega), and *How to Make Our Ideas Clear* (Peirce). Some of those passages may still be tangential. The smoke validates **retrieval**, not Gemma's eventual answer.

## What v1.4.2 adds: hypothetical cross-author reasoning

The test question “What would Nietzsche think about Kierkegaard's thought?” originally collapsed to a single vague index term, **thought**, and gave both models a pool of irrelevant passages. In v1.4.2 a validated catalog lookup determines the two authors; the first model call chooses possible **thematic lookup words separately** for each writer. It may recommend concepts such as faith, paradox and religion for one, and Christian morality, guilt and ascetic criticism for the other. **These are model-proposed search terms, not source-derived historical facts.**

The read-only real-v47 audit of that mechanism (using representative terms, no Ollama) retrieved *Fear and Trembling*, *The Sickness Unto Death*, Nietzsche's *On the Genealogy of Morals*, and an edited Nietzsche collection. Passages now concern the paradox of faith, individual versus universal, Christian morality and guilt, rather than random uses of “thought.” Ranking gently discounts collections when comparable standalone works exist; it does not exclude valuable anthologies. Source provenance is recorded in the diagnostics.

The first model call is repurposed, **not added**. The evidence composer still cites only real original text and must distinguish hypothetical comparisons from documented historical commentary. The system does not know whether Nietzsche encountered Kierkegaard, and the library evidence alone cannot prove their personal reactions.

## Verified behavior and remaining limits

The v47 manifest, postings encoding and matching page IDs were inspected against the **actual public library-data repository**. A read-only smoke fetched just the manifest, relevant compressed partitions, Aristotle's *Nicomachean Ethics* and Tolstoy's *A Confession*. It confirmed both named works appear in the result pool, with correct original PDF IDs and pages, without loading the other 642 book shards. Offline fixtures exercise equivalent data structures with deterministic test providers.

A successful answer is deliberately labeled **draft**. It means source IDs are valid, not that the model's interpretation is true, complete or supported sentence by sentence. OCR damage, lexical mismatch, limited passage context, overconfident synthesis, and missing conceptual links remain real risks. A fixed set of passages cannot prove what an author *never* says across a book.

The library ranking currently relies on lexical term matches and page-level presence. It is not a pretrained semantic embedding system; references to the same idea using very different vocabulary may be missed. A broad question samples up to four books; it is **not an exhaustive overview of all 644 works**. When appropriate, ask a more specific question or open an individual book. Some Google Drive PDF previews ignore the page anchor, so the physical page is also displayed.

## Evaluation across the library's disciplines

The fixed [cross-disciplinary evaluation manifest](../benchmarks/cross-disciplinary-v1.json) pairs seven specific catalog book IDs with questions and adds an eighth cross-author philosophy control. Each discipline has two distinct reasoning requirements: science (mechanisms versus theory/uncertainty), history (causes versus source criticism), literature (character versus author and recurring themes), philosophy (conceptual synthesis versus hypothetical comparison).

The local **GET /api/benchmarks/cross-disciplinary** returns sanitized evaluation metadata only and never calls Ollama. The browser renders these as a closed, responsive question picker; selecting an entry sets the book or whole-library scope, clears the old conversation, and populates the question field. The user must click Ask to run the model.

The separate `scripts/run_cross_discipline.py` CLI uses the same `POST /api/chat` contract, with Gemma3:12b and evidence-first as defaults, explicit opt-in to selected questions or all eight, fresh conversation histories, serialized requests, and one resumable report per case under gitignored `reports/`. `benchmark_suite.py` validates benchmark scope and expected book groups and checks basic source/citation/PDF identity, but explicitly marks *human interpretation unchecked*. Neither the benchmark nor its expected book IDs influence live source ranking, the generation prompt, or inference selection.

The evaluation deliberately asks different disciplines different critical questions: historical claims versus reported traditions; scientific observations versus theoretical predictions; a narrator or character versus the author's point of view; and documented ideas versus conjectural philosophical comparisons. Existing caveats about OCR corruption, limited context, and false inferences remain in force.

## Testing and future work

Run the Python synthetic contract suites for the pipeline, catalog, global index and intent-aware author/topic retrieval. The GitHub Actions workflow checks Python imports/compilation, browser script syntax and those offline contracts. For a manually requested compatibility check against the public v47 data, run **python scripts/audit_library_index.py --remote**, **python scripts/smoke_relevance_v141.py**, or **python scripts/smoke_conceptual_v142.py**. The real-data smoke makes public file downloads but **does not send requests to Ollama** or modify source data. A local question using Gemma3:12b is still necessary to test answer quality and latency.

Near-term goals:

1. Confirm that the new cross-book reader produces useful, book-specific citations on real questions, and calibrate evidence diversity using failed cases.
2. Improve interpretive fidelity, for example by preserving the right direction of a contrast, distinguishing an author's conclusion from an objection, and accurately connecting passages separated by chapters.
3. Stabilize an engaging one-book public demo and design a sustainable inference backend. GitHub Pages can host the static UI but cannot run Python/Ollama itself.

The aim is source-grounded reading and critical inquiry, not a competition between local LLM benchmarks.
