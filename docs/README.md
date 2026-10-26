# Reading Companion architecture and development guide

The Antilogicalism Reading Companion helps readers move from a question to relevant passages in the library and back to the original books. The public site is a pilot for accurate, question-aware answers with citations. Treat answers as guides to reading: valid page links and model review do not guarantee that every claim is correct or complete.

Use the [live Reading Companion](https://jsynon.github.io/antilogicalism/reading-companion/) to ask a question, inspect cited passages, open the original PDF page, and continue with a follow-up.

## The three repositories

| Repository | Responsibility |
| --- | --- |
| [antilogicalism](https://github.com/jsynon/antilogicalism) | Static website, Bookshelf, Library Search, Reading Companion interface, and live evaluation workflows. |
| [antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data) | Published catalog and v48 search data, extracted book pages, source fingerprints, and original PDF metadata. |
| [book-chatbot](https://github.com/jsynon/book-chatbot) | Cloudflare Worker API for the public pilot and a separate Python/Ollama workbench for local development. |

The repositories share published catalog and book data. The Worker does not host a second copy of the full library. The public site and local workbench use different answer-generation implementations, so a local answer is not a direct test of the live Worker.

## Public answer path

The live interface is in `antilogicalism/reading-companion/`. Its search module reads the published library index, finds candidate pages, and tags pages with the question parts that led to them. It sends the selected page text and locations to the Worker; the browser does not decide which text is trusted.

The Worker path in `hosting-poc/public-gateway.mjs` and `hosting-poc/evidence-answer.mjs` works as follows:

1. **Plan the question.** The planner identifies the reader's intent, named works or authors, question parts, and focused search queries. A broad, single-author topic remains one required coverage part; distinct model search leads may still help retrieve examples or qualifications. Author-wide questions keep that author's available works unless the reader names a distinctive work phrase; an author's name appearing inside a book title does not count as naming that work. For a hypothetical response between two thinkers, the plan assigns source-side parts and searches to each author's own works, then adds a synthesis part linked to both. Selected-book requests stay within that book.
2. **Retrieve and select pages.** The browser searches the published v48 data and selects a bounded set of passages. The shared index retriever recognizes only explicit, source-attested phrase equivalents (currently “dependent origination” and “dependent arising”); alternate wording is searched as one relevance concept, so the two words of the phrase do not count as separate evidence matches. This leaves the existing relevance threshold unchanged and does not add a model call. OCR index and publication pages are screened out of substantive evidence, including index scans where the folio and `INDEX` heading occur after several locator entries. If a planned side of a two-author comparison has no results while the other side does, it can retry once with the same topic terms restricted to the empty side's already planned book IDs. This is a local corpus search, adds no model call, and leaves the side empty if it still finds nothing. Within the existing packet budget, selection reserves an additional linked book for a part when available before unlinked facet hits. In a one-part plan, a planner facet can link to the sole part when it shares one subject term after generic search wording is removed; multi-part plans retain the existing two-term matching rule. Each candidate records which question parts it may support. A part link is an eligibility hint, not proof that the passage supports an answer.
3. **Verify source text.** Before inference, the Worker checks each submitted page against published SHA-256 fingerprints and obtains canonical book, page, and PDF metadata. A mismatch is rejected. The verified page identity and PDF link come from the published data, not from model output. The answer and review inputs also carry credited-author, editor, translator, planner-role, explicit page-heading context, and title-guarded known work/page voice metadata. Those fields guide attribution but do not prove who speaks in an individual passage. When a known editorial-commentary page is cited, the citation preserves the commentator separately from the book's credited author.
4. **Compose by question part.** The composer receives the question parts and linked verified pages. For a broad, single-part question, it should answer directly in a concise 3–5 sentence response, treating planner search queries as retrieval leads rather than extra topics the reader asked to cover. Each factual sentence should make one main claim; the composer should not bundle distinct assertions into one sentence. It must distinguish authorial text from pseudonymous voice, quoted or reported speech, narration, editorial introductions, translator notes, and commentary. A credited book author or planner role is not automatically the speaker on a page. It cites the page IDs that support each sentence. Unsupported parts remain visible as gaps.
5. **Validate citations and review.** Deterministic checks reject unknown, out-of-scope, wrong-book, or wrong-part source IDs. Multiword text presented as a quotation is checked against a cited page; short single-word terms are treated as terminology. With review enabled, a second model call assesses every cited answer sentence separately. The review input has per-part question and page evidence plus one flat root `claims` array; each claim carries its `partId` and a compact `sourceEvidence` index with up to three claim-ranked span IDs per cited page. The exact page spans appear once in the evidence list. The reviewer returns one source decision for every source cited by a claim and may select up to three exact spans per answered cited page (six per claim total) when several passages are needed to support its material clauses. The Worker checks every source/span relationship against the fingerprint-verified page. A claim normally requires every cited source to be marked supported with a valid span. For a non-comparison factual claim linked to one planned source group, citation cleanup is allowed only when the whole part is marked answered, the claim decision is answered or partial, every cited source has an explicit decision, at least one page has an exact approved span, and any removed page was explicitly marked partial or unanswered. Missing decisions or spans do not qualify; comparisons and hypothetical inferences remain strict. Final citations and evidence maps use only retained source IDs, and the trace records this bounded recovery. The prompt caps total spans at six per claim, and normalization accepts at most three spans per source. Older flat span responses are normalized by source ID and pass the same all-cited-sources gate. Known title/page-guarded editorial pages must be attributed to the commentator or introduction; known pseudonymous work voices must be identified. An accepted, reviewed attribution can carry across later answer parts, but an unsupported claim cannot establish that context. Direct author pages do not inherit an editorial label. Unknown, duplicate, or missing decisions and source spans remain incomplete. One supported clause does not validate a different clause in the same sentence. For explicit hypothetical questions about one author responding to another, the answer must include a standalone, cautious inference in the synthesis part, supported by directly relevant pages for both authors, or clearly state that the passages support a comparison but not a reliable inference. Positive inferences still require both authors' evidence in the inference sentence. It should use the smallest relevant citation set. A comparison alone leaves that part incomplete. The inference must stay on the specific point established by both cited passages. Unsupported sentences are omitted; supported neighboring sentences can remain with partial coverage. If review output is cut off, the trace reports `review-output-truncated` and the answer remains unverified without another model call.
6. **Return readable evidence.** The response maps each exact approved span to its answer claim and uses that same text for visible highlights. When a cited page has several approved spans, the Worker ranks them by wording fit with the linked claim. It measures readability without counting whitespace against OCR line-wrapped text and can trim a recognized leading running header by taking the remaining exact substring of the verified span. Short fragments and low-readability excerpts remain filtered. It then returns up to six highlights across cited pages. Six is a cap, not a quota, so the interface may show fewer when no useful approved excerpt remains. This deterministic filter improves excerpt readability but is not a semantic support judgment; only reviewer-approved spans are eligible. Readers can open the excerpt or follow its link to the original PDF page. A structurally valid quote-to-claim mapping improves auditability but does not prove semantic entailment; model review can still be wrong.

The public pilot uses the evidence pipeline unless `READER_PIPELINE=legacy` selects the rollback path. Public requests remain behind the Worker’s origin, Turnstile, visitor-rate, global-rate, and source-fingerprint checks. Full prompts, full source pages, and raw model responses are available only through the authenticated evaluation trace, not the ordinary public answer.

### Model calls

The Worker uses Cloudflare Workers AI with Gemma 4 26B A4B for answer composition and review. The planner is a separate call. A reviewed question normally uses one planning call, one composition call, and one review call. Compose-only skips review, so it uses one planning call and one composition call. The review is a fallible model judgment, not a truth certificate. Review output is bounded to 1,800 completion tokens; any truncation remains fail-closed and does not trigger a retry. Worker responses include the Cloudflare version ID and, when deployed with a 40-character Git SHA as the version tag, a validated `workerSourceRevision`. Deploy with the checked-out source SHA as the version tag. From the repository root in PowerShell, run `npx.cmd wrangler deploy --config .\hosting-poc\wrangler.public-pilot.jsonc --tag $sha`, where `$sha` is the 40-character SHA of the checked-out commit. Use the production config in your checkout; `wrangler.public.example.jsonc` is example-only. The live evaluator records the SHA in each case and the artifact's `workerSourceRevisions` list, independently of Cloudflare's deployment-generated version ID. A missing revision means the run cannot establish which Worker source was tested.

The authenticated review trace now records each claim/source handoff: a bounded answer-claim excerpt, candidate span IDs sent to the reviewer, IDs it returned, the exact source span retained by deterministic validation, and any validation reason. This makes it possible to distinguish “the reviewer chose an unrelated span and the Worker accepted it” from “the reviewer chose valid evidence that still does not semantically support the claim.” It adds no model call and is not exposed in public answers.

## Evaluation and quality limits

The website repository contains the live holdout and acceptance workflows. They report planner, retrieval, answer, and review progress while a run is underway. Authenticated runs can save the exact prompts, model outputs, source pages, rejection reasons, usage, and final answer for diagnosis. The saved answer audit also reports citation-to-highlight coverage and cited source IDs without a page-located highlight; this is diagnostic context, not a structural gate.

Use the [evidence milestone release report](reader-evidence-milestone-release.md) for the project history, decisions, workflow findings, current fixes, and remaining validation. The seven-question development set is diagnostic; it is not evidence of general performance because it has informed changes. Reserve the unseen acceptance set for a frozen candidate.

The pipeline can still miss a passage because retrieval is limited and language in a question may differ from the book's wording. OCR damage can make a verified page hard to interpret. Fingerprints prove that submitted text matches the published page text; they do not prove that the OCR is correct or that a claim follows from the page. Model review can miss errors or downgrade supported prose. Structural tests check contracts such as source IDs, scope, and part links; they cannot establish philosophical, historical, or literary accuracy. Inspect cited passages whenever the interpretation matters.

## Code map

| Path | Purpose |
| --- | --- |
| `hosting-poc/public-gateway.mjs` | Worker routes, public pilot gates, page fingerprint verification, and response handling. |
| `hosting-poc/evidence-answer.mjs` | Question-part linking, composition and review prompts, citation checks, coverage status, and answer assembly. |
| `hosting-poc/reader-contract.mjs` | Worker planner, citation, and source contract, including separate editor and translator bylines. The website has a corresponding `antilogicalism/reading-companion/reader-contract.mjs`; keep shared behavior aligned when either copy changes. |
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
