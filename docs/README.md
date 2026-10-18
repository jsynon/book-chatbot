# Reading Companion: architecture and roadmap

The [Antilogicalism](https://jsynon.github.io/antilogicalism/) Reading Companion is a primary-source-grounded local reading assistant. It is intended to cover the full digital library, not only the current Aristotle pilot. The application deliberately separates bibliographic metadata, indexed PDF text, retrieval, answer composition and verification of citation identities.

## Architecture in v1.4

The library now has **two supported retrieval scopes** sharing the same answer pipeline.

**One selected book** resolves an ID against the existing website catalog and a matching compressed book shard. The app indexes that book on first use, caches a small number of indexes, and only discusses the chosen work. The user's conversation resets when switching books.

**Across the library (experimental)** uses the separate library-data repository's original **v47 full-text inverted index** to discover pages across the collection *before opening any source books*. It then loads only a few highly ranked book shards, selects a bounded set of matching pages and immediate context, and constructs one temporary passage index across those works.

### Source repositories

- **antilogicalism** supplies digital-library/library-catalog.json: title, author, subject tags and verified Google Drive PDF URLs for 643 known catalog entries.
- **antilogicalism-library-data** supplies data-v47/manifest.json.gz, terms-xx.json.gz and book-N.json.gz. Its manifest documents **644 books, 280,699 global page IDs and 1,332 term partitions**. It is authoritative for index version, book/page membership, and the extra indexed book absent from the website catalog.
- **book-chatbot** contains the conversation server, bounded retrieval logic and UI. It must not copy PDF text or recreate a second 644-book index.

The manifest maps each global page ID to a book ID. Each two-character term partition stores sorted **delta-encoded global page postings**; the compressed per-book source records carry matching global page IDs plus **physical PDF page numbers**. The two numbers are distinct and must not be confused. Term lookup opens only partitions needed by the reader's content words. The manifest is cached lazily, with at most eight decompressed term partitions retained by default.

### Query flow

1. **Scope and topic.** In one-book mode, use the v1.3 cached passage index. In across-library mode, normalize the reader's meaningful words, exclude generic question framing, and detect any explicitly named authors from real catalog metadata. No model call is needed for discovery.
2. **Find global page matches.** Read delta postings for at most eight query words, validate page IDs against the versioned manifest and aggregate evidence strength for each page. Words appearing on fewer pages get more weight. A malformed manifest or broken postings fails with an actionable error rather than fake evidence.
3. **Choose bounded books and pages.** Prefer books with strong multi-term pages and respect explicitly named author groups; if a requested author lacks matching indexed passages, report that limitation. Open no more than **four compressed book shards**, retain no more than **nine original PDF pages per book**, and diversify similarly scored pages across the book so later arguments are not systematically excluded. The global mode doesn't add these full-book indexes to the one-book cache.
4. **Retrieve passages with book diversity.** Reconstruct original passages from just those source pages and their immediate neighbors. The 24-candidate pool alternates relevant passages across selected books. Every passage includes its own book ID, title, PDF identity, data version, physical pages and deterministic passage ID.
5. **Choose evidence.** One local Ollama call selects up to six decisive candidates. For a specifically named author comparison, deterministic selection coverage preserves at least one *real retrieved source* per represented author if the model tries to omit it. This protects coverage, not interpretive correctness.
6. **Read the argument, then compose.** Preceding or following argument-dependent passages are arranged **in original reading order** with distinct citations. The second Ollama call writes an explanation grounded in the selected sections, maintaining which writer claims what. There is **no model reviewer or automatic rewrite loop**.
7. **Validate citation identity.** The shared Python binder checks every output source ID, including optional inline or grouped references, against the passages actually supplied. Unknown, conflicting or excessive references fail closed. The browser makes source links with the correct **individual book's PDF file ID**, and displays its title alongside the citation.

Source excerpts and page links come from the compressed texts and verified metadata, never from the model's own assertion of provenance. Book prose is treated as untrusted data and rendered as text, not as executable HTML.

## API and runtime

- **GET /api/health** — build, configured pilot book, catalog and availability of global manifest.
- **GET /api/books** — titles and locally available individual works.
- **GET /api/library/status** — whether the local versioned whole-library manifest is installed and current bounds.
- **POST /api/chat** — accepts question, model, history and pipeline. The optional **scope** is either **book** (default; optional numeric book_id) or **library** (across corpus). The returned response includes an explicit scope, book-specific sources and, for global mode, **library_discovery** listing selected books, matched page counts and actual opened pages. Diagnostics contain the model inputs and source selection details only when requested.

**Resource limits** in whole_library.py: at most 8 content terms, 4 source books, 5 matching page hints per book, 9 reconstructed physical pages per book, 24 evidence candidates, 6 model-selected core passages and two Ollama calls. The manifest and up to 8 term partitions are cached; book shards are loaded only for the active global query. Large book shards are still decompressed in full to locate selected pages. This is bounded **book count**, not true streaming I/O over compressed shards.

The browser defaults to **One selected book**, preserving the usable Aristotle demo; the **Across library (experimental)** scope is opt-in. It resets conversation history when switching scopes, disables the single-book picker in global mode and labels all cited books clearly. The old comparison controls remain collapsed and optional; Gemma3:12b is the primary local development model.

## Verified behavior and remaining limits

The v47 manifest, postings encoding and matching page IDs were inspected against the **actual public library-data repository**. A read-only smoke fetched just the manifest, relevant compressed partitions, Aristotle's *Nicomachean Ethics* and Tolstoy's *A Confession*. It confirmed both named works appear in the result pool, with correct original PDF IDs and pages, without loading the other 642 book shards. Offline fixtures exercise equivalent data structures with deterministic test providers.

A successful answer is deliberately labeled **draft**. It means source IDs are valid, not that the model's interpretation is true, complete or supported sentence by sentence. OCR damage, lexical mismatch, limited passage context, overconfident synthesis, and missing conceptual links remain real risks. A fixed set of passages cannot prove what an author *never* says across a book.

The library ranking currently relies on lexical term matches and page-level presence. It is not a pretrained semantic embedding system; references to the same idea using very different vocabulary may be missed. A broad question samples up to four books; it is **not an exhaustive overview of all 644 works**. When appropriate, ask a more specific question or open an individual book. Some Google Drive PDF previews ignore the page anchor, so the physical page is also displayed.

## Testing and future work

Run the Python synthetic contract suites for the pipeline, catalog and global index. The GitHub Actions workflow checks Python imports/compilation, browser script syntax and those offline contracts. For a manually requested compatibility check against the public v47 data, run **python scripts/audit_library_index.py --remote** or **python scripts/smoke_global_retrieval.py**. The real-data smoke makes public file downloads but **does not send requests to Ollama** or modify source data. A local question using Gemma3:12b is still necessary to test answer quality and latency.

Near-term goals:

1. Confirm that the new cross-book reader produces useful, book-specific citations on real questions, and calibrate evidence diversity using failed cases.
2. Improve interpretive fidelity, for example by preserving the right direction of a contrast, distinguishing an author's conclusion from an objection, and accurately connecting passages separated by chapters.
3. Stabilize an engaging one-book public demo and design a sustainable inference backend. GitHub Pages can host the static UI but cannot run Python/Ollama itself.

The aim is source-grounded reading and critical inquiry, not a competition between local LLM benchmarks.
