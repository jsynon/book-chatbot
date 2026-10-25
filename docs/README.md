# Reading Companion architecture and development guide

The Antilogicalism Reading Companion helps readers move from a question to relevant passages in the library and back to the original books. The public site is a pilot for accurate, question-aware answers with citations. Treat answers as guides to reading: valid page links and model review do not guarantee that every claim is correct or complete.

Use the [live Reading Companion](https://jsynon.github.io/antilogicalism/reading-companion/) to ask a question, inspect cited passages, open the original PDF page, and continue with a follow-up.

## The three repositories

| Repository | Responsibility |
| --- | --- |
| [antilogicalism](https://github.com/jsynon/antilogicalism) | Static website, Bookshelf, Library Search, Reading Companion interface, and live evaluation workflows. |
| [antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data) | Published catalog and v47 search data, extracted book pages, source fingerprints, and original PDF metadata. |
| [book-chatbot](https://github.com/jsynon/book-chatbot) | Cloudflare Worker API for the public pilot and a separate Python/Ollama workbench for local development. |

The repositories share published catalog and book data. The Worker does not host a second copy of the full library. The public site and local workbench use different answer-generation implementations, so a local answer is not a direct test of the live Worker.

## Public answer path

The live interface is in `antilogicalism/reading-companion/`. Its search module reads the published library index, finds candidate pages, and tags pages with the question parts that led to them. It sends the selected page text and locations to the Worker; the browser does not decide which text is trusted.

The Worker path in `hosting-poc/public-gateway.mjs` and `hosting-poc/evidence-answer.mjs` works as follows:

1. **Plan the question.** The planner identifies the reader's intent, named works or authors, question parts, and focused search queries. Author-wide questions keep that author's available works unless the reader names a distinctive work phrase; an author's name appearing inside a book title does not count as naming that work. For a hypothetical response between two thinkers, both thinkers' own works and a separately linked synthesis part are retained. Selected-book requests stay within that book.
2. **Retrieve and select pages.** The browser searches the published v47 data and selects a bounded set of passages. Each candidate records which question parts it may support. A part link is an eligibility hint, not proof that the passage supports an answer.
3. **Verify source text.** Before inference, the Worker checks each submitted page against published SHA-256 fingerprints and obtains canonical book, page, and PDF metadata. A mismatch is rejected. The verified page identity and PDF link come from the published data, not from model output.
4. **Compose by question part.** The composer receives the question parts and linked verified pages. It returns a short answer for each supported part and cites the page IDs that support it. Unsupported parts remain visible as gaps.
5. **Validate citations and review.** Deterministic checks reject unknown, out-of-scope, wrong-book, or wrong-part source IDs. Multiword text presented as a quotation is checked against a cited page; short single-word terms are treated as terminology. With review enabled, a second model call assesses each answer part against its cited pages and must provide exact supporting text to mark it supported. A failed or incomplete review can leave a checked draft explicitly unverified or partial.
6. **Return readable evidence.** The response includes source-linked citations, page details, and evidence highlights for the site to display. Readers can open the excerpt or follow its link to the original PDF page.

The public pilot uses the evidence pipeline unless `READER_PIPELINE=legacy` selects the rollback path. Public requests remain behind the Worker’s origin, Turnstile, visitor-rate, global-rate, and source-fingerprint checks. Full prompts, full source pages, and raw model responses are available only through the authenticated evaluation trace, not the ordinary public answer.

### Model calls

The Worker uses Cloudflare Workers AI with Gemma 4 26B A4B for answer composition and review. The planner is a separate call. A reviewed question normally uses one planning call, one composition call, and one review call. Compose-only skips review, so it uses one planning call and one composition call. The review is a fallible model judgment, not a truth certificate.

## Evaluation and quality limits

The website repository contains the live holdout and acceptance workflows. They report planner, retrieval, answer, and review progress while a run is underway. Authenticated runs can save the exact prompts, model outputs, source pages, rejection reasons, usage, and final answer for diagnosis.

Use the [evidence milestone release report](reader-evidence-milestone-release.md) for the project history, decisions, workflow findings, current fixes, and remaining validation. The seven-question development set is diagnostic; it is not evidence of general performance because it has informed changes. Reserve the unseen acceptance set for a frozen candidate.

The pipeline can still miss a passage because retrieval is limited and language in a question may differ from the book's wording. OCR damage can make a verified page hard to interpret. Fingerprints prove that submitted text matches the published page text; they do not prove that the OCR is correct or that a claim follows from the page. Model review can miss errors or downgrade supported prose. Structural tests check contracts such as source IDs, scope, and part links; they cannot establish philosophical, historical, or literary accuracy. Inspect cited passages whenever the interpretation matters.

## Code map

| Path | Purpose |
| --- | --- |
| `hosting-poc/public-gateway.mjs` | Worker routes, public pilot gates, page fingerprint verification, and response handling. |
| `hosting-poc/evidence-answer.mjs` | Question-part linking, composition and review prompts, citation checks, coverage status, and answer assembly. |
| `hosting-poc/reader-contract.mjs` | Worker planner, citation, and source contract. The website has a corresponding `antilogicalism/reading-companion/reader-contract.mjs`; keep shared behavior aligned when either copy changes. |
| `hosting-poc/*.test.mjs` | Offline Worker and pipeline regression tests. |
| `docs/reader-evidence-milestone-release.md` | Ongoing evidence and release record. |

Run the Worker checks from this repository:

```sh
node --test hosting-poc/*.test.mjs
```

Run browser search, interface, and evaluator checks from the `antilogicalism` repository:

```sh
node --test reading-companion/*.test.mjs
```

These suites use offline fixtures. They do not replace a live model run or source-based answer review.

## Separate local workbench

The repository also contains a Python application for local experimentation. It runs a local model through Ollama and does not call the Cloudflare Worker. On Windows, run `start.bat`; otherwise start it with `python app.py` and open `http://127.0.0.1:8765/`. Its developer view is at `http://127.0.0.1:8765/developer`.

For full-library local retrieval, the workbench needs local checkouts of `antilogicalism` and `antilogicalism-library-data` beside this repository. Follow the root [README](../README.md) for its setup. Local-model output tests the local pipeline only; use the website's authenticated workflow to test the public Worker.

**Guiding principle:** use AI to help readers find and understand the books while keeping the source text accessible and open to inspection.
