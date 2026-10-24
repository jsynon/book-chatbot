# Reading Companion evidence milestone: release report

Date: October 24, 2026  
Status: recovery candidate implemented and offline suites pass; live human-scored acceptance remains open
Backend branch: `codex/reader-evidence-recovery`

Website branch: `codex/reader-evidence-recovery`

## Goal

Move the Reading Companion toward thoughtful, accurate answers grounded in passages readers can reopen. This milestone changes the information path and answer contract so question interpretation, retrieval, evidence review, and citations remain connected. It keeps the existing corpus, fingerprint validation, source reader, UI, and Gemma deployment. After the Worker PR is deployed, the existing public pilot route uses this answer path by default. Setting `READER_PIPELINE=legacy` is an explicit rollback; the pilot's existing Turnstile, rate-limit, source-verification, and public-enable gates remain in force.

## What changed

- Added a structured question contract for resolved questions, intent, named source roles, requested parts, scope, and search facets. Planner outputs are normalized and book IDs are checked against the server catalog. Selected-book requests are canonicalized to the chosen book.
- Centralized catalog identity parsing for titles, authors, and editors. Edited collections such as *The Portable Nietzsche* stay eligible for Nietzsche author searches without treating Walter Kaufmann as the author.
- Moved browser and evaluation retrieval into the same `retrieveEvidence` implementation. Given identical planner output, allowlists, book scope, and corpus, both now use the same facet search, candidate ordering, page hydration limits, and final six-page selector. The browser cache and evaluator shard reader are only page-loader differences.
- Kept full fingerprint-verified page text and its hash separate from the short UI preview. The candidate answer composer receives complete pages within existing request/page bounds. Explicit Bible verse ranges carry a separate quote-eligible scope while surrounding verified text remains context only.
- Added a `reader-evidence-v2` answer path: one structured claim composition, deterministic exact-span/citation checks, and one final claim review. It has no free-form rewrite after review. Rejected or unsupported claims cannot re-enter through repair. The recovery branch allows two calls normally, with one extra composition call only after malformed composer output; maximum three answer calls plus the planner. This milestone makes v2 the public pilot default after deployment, with `READER_PIPELINE=legacy` as a rollback switch.
- Each accepted claim has exact source page quotes and offsets. Quotes must occur on the cited page; when a verse restriction applies, they must also occur inside the requested verse range. Only claims the final reviewer marks supported are rendered. Citation IDs and quotation links are checked again after deterministic rendering.
- Added an authenticated evaluation-only trace containing the exact stage prompts, source pages, model responses, timing, rejection reasons, model identity, and usage counters. The public response never includes this trace. User-facing diagnostics expose only bounded plans, citations, exact validated claim anchors, and usage totals, not complete source pages.
- Live evaluation reports now identify the evaluator source commit and hash the published coverage manifest, corpus manifest, and each exact corpus/index file read during the run. Worker build IDs, model context, prompt text, and inference counters remain attached to each case.
- Fixed grouped citation auditing so `[S1, S99]` cannot hide an unknown source ID. Follow-up history is cleared on book-scope changes and only successful verified drafts enter history.

## Recovery milestone after the seven-question all-books failure

The latest seven-question run is the decision point for this revision. It passed 1/7. Five cases returned relevant retrieved pages but failed because the composer response could not be parsed as JSON; those were reported through the same fallback used for missing evidence. The Plato/Rousseau comparison also exposed question-part/source misalignment and an incomplete answer. Aristotle was the sole pass. This points to an answer-pipeline and evaluation-contract failure, not a reason to rebuild the corpus or retrieval stack.

The recovery branch makes five bounded changes:

- A malformed or truncated composition gets one format-only regeneration against the same question, plan, and verified pages. If it is still invalid, the result is `generation-failed` with `generation-format-failed` and a separate failure stage/code; it is not mislabeled as insufficient evidence. A malformed review is reported separately and is not retried.
- The evidence answer path allows at most three model calls: normal compose + review (two), or compose + one malformed-output regeneration + review (three). There is no automatic evidence-expansion loop. Cloudflare JSON mode is not assumed for the deployed Gemma model.
- Normalized question parts carry allowed source book IDs derived from the resolved source plan and catalog identity. Claim validation rejects named-work evidence that does not match its part. The evaluation suite has explicit part-to-source requirements for the cross-work cases, including Plato/Rousseau.
- The evaluation workflow can run `with-review`, `compose-only`, or `paired-review-ablation`. Paired mode calls the planner once, retrieves one page packet, then sends that identical packet through the reviewed and compose-only answer paths. It reports structural results for each variant and leaves semantic ratings to a human.
- A separate seven-question all-books acceptance set uses questions not present in the development and holdout suites. Its report includes blank 0–2 fields for accuracy, question coverage, explanation quality, citation support, and citation completeness. These prompts are reserved for acceptance; a failed acceptance result should lead to a new unseen set for the next frozen candidate.

The acceptance workflow must use **All Books** scope. For seven questions, paired mode estimates 28 Worker model calls (one planner plus three answer-stage calls per case) before format retries. With one malformed-composition retry in each answer variant, the upper estimate is 42 calls. This is a cost estimate, not a request to run the workflow during this implementation pass.

## Verification

| Check | Result |
|---|---|
| Backend Worker Node suites: `node --test hosting-poc/*.test.mjs` | 205 passed, 0 failed |
| Website companion Node suites: `node --test reading-companion/*.test.mjs` | 144 passed, 0 failed |
| Git whitespace checks | Passed on both recovery branches |
| Shared browser/Worker contract copies | Byte-identical on both recovery branches |
| Full-page input, exact source binding, verse-scope boundary, final deterministic rendering, malformed-composer retry and part/source binding | Covered by offline tests |
| Public trace protection and authenticated evaluation trace | Covered by route test |
| Edited-author collection discovery and grouped citation regression | Covered by website tests |
| Exact downloaded corpus-file digest capture | Covered by website test |
| Latest focused suites after the second holdout (historical baseline) | Backend 182 passed; website 62 passed |

## First live holdout result

The first all-books Hume/Kant holdout run completed without request failures and used the intended six-page evidence budget. The planner resolved the two named works and separated the question into Hume, Kant, and comparison parts. The answer correctly described Hume's account but only identified Kant's category of causality; it did not explain how Kant grounds causal necessity, so the run correctly failed with partial coverage.

This run does not test `reader-evidence-v2`: its `pipeline` field is null, even though the planner plan reports `reader-evidence-v2` as its contract version. The Worker was still using the legacy answer composer. The retrieved Kant results included page 86, which discusses the conditional a priori necessity of dynamical principles, but that page was absent from the six submitted pages. This points to evidence-packet selection as a second issue to investigate after the evaluation is confirmed to exercise the intended answer pipeline. The run's structural citation checks passed, but those checks do not establish semantic support.

To make the existing authenticated holdout workflow exercise v2 without changing public answers, the Worker now routes requests authenticated with `PILOT_EVALUATION_TOKEN` through the evidence pipeline even when `READER_PIPELINE` is unset. The route test verifies the returned `pipeline` marker. This code change has passed the focused backend suites locally; it must be merged and deployed before the next live run can validate the fix.

## Second live holdout result

The second all-books Hume/Kant run used `reader-evidence-v2` on Worker version `88a5d8e6-3192-4230-a3d6-bff382a14b80`. It completed the two answer stages with six submitted pages, two final citations, and no request failure. The automated result says `passed: true` and `coverage: full`, but those fields are not a human quality verdict.

The answer accurately explains Hume’s account and accurately identifies Kant’s category of causality as a priori. It still does not explain Kant’s argument for the objective necessity of causal judgments. The reviewer marked the Kant part answered from the category table on page 53, so the model review overstates completeness. Kant’s *Second Analogy* is available in the local corpus around pages 98–104, but none of those pages reached this run’s candidate set. The exact-question search did retrieve page 23, where Kant discusses Hume’s causal principle, but the selector sent page 24 instead. The planner’s Kant query changed to “causality categories synthetic a priori,” omitting “necessity,” which also explains why the earlier page 86 result was not retrieved this time.

The follow-up implementation now addresses this pattern in three shared rules: planner queries must retain the requested epistemic relation while seeking the source’s grounds or validity conditions; same-title direct-search near-ties use passage wording to select the page that actually matches the question; and composition/review prompts require an argument or conditions of validity when a question asks how a principle is known or necessary. These changes do not add an AI call. They are covered by focused offline regressions and remain subject to a fresh live run after merge and deployment.

The tests use controlled model responses and synthetic request fixtures. They verify contracts and failure boundaries; they do not establish answer quality from a live model.

## Paired all-books review ablation and per-part evidence milestone

The later seven-question paired run is the first direct diagnostic of the revised answer path. It held the planner output and retrieved page packet fixed between the reviewed and compose-only variants, then ran an independent composition for each variant. The reviewed variant reported two structurally full answers, two partial answers, and three malformed composer outputs. Across both variants, six of 14 composer outputs failed the expected format, so the reviewer never ran for those cases. The run therefore shows a real format reliability failure and does not establish that review improves answer quality. Its automated coverage labels are not substitutes for human ratings, and the five-dimension draft scores discussed during review were not saved as an independent human-scored artifact.

The source packets also exposed a question-part linkage failure: a useful Du Bois page was present but was not associated with the Wollstonecraft/Du Bois part it could answer, while the Plato common-good and Kant causal-necessity parts lacked matching pages in their submitted packets. The implementation now carries the planner's individual question parts into retrieval as separate search facets, tags each hydrated page with the parts whose facets found it, and reserves a selected page for each represented part within the existing page budget. The Worker builds an explicit source-ID list for each part before calling the composer. It rejects a claim unless its exact evidence span comes from a page linked to every part the claim covers.

The composer now returns a bounded line-record format with one ordered block per planned question part, explicit answered/partial/unanswered status, and claims or a gap for every part. Claims include exact evidence spans and source IDs. Parsing checks that every part appears once, statuses agree with claim/gap presence, claims use planned part IDs, and evidence is linked to those parts. The reviewer receives each draft part status and gap alongside the evidence-linked claims, then judges support and completeness. A malformed composition gets the existing single format retry; persistent malformed output fails closed. This replaces the nested JSON composition format while leaving JSON for the review response. It does not add an AI call: the answer path still uses two calls normally and at most three after a format retry.

## Verification after the paired-run diagnosis

| Check | Result |
|---|---|
| Backend Worker Node suites: `node --test hosting-poc/*.test.mjs` | 209 passed, 0 failed |
| Website companion Node suites: `node --test reading-companion/*.test.mjs` | 145 passed, 0 failed |
| Git whitespace checks | Passed on both recovery branches |
| Per-part retrieval facets, page-to-part tags, and selector reservation | Covered by offline retrieval and selector tests |
| Per-part composer format, completeness, exact evidence, and source-to-part binding | Covered by offline Worker tests |
| Planner, page packet, and answer-call count | No additional AI call; search adds local corpus queries |

These tests show that the format and linkage contracts work on controlled fixtures. They do not demonstrate that the deployed Gemma model reliably emits the format, that search returns semantically sufficient pages, or that the final prose is accurate. The paired run remains evidence of a failure mode, not evidence that this patch has fixed live answer quality.

## Acceptance status

| Audit criterion | Status |
|---|---|
| Unknown grouped citation IDs fail evaluation | Implemented and tested |
| A rewrite cannot bypass final checks | Candidate pipeline has no post-review prose rewrite; tested |
| A quote cannot be validated against an uncited source | Implemented and tested |
| Portable Nietzsche remains discoverable under Nietzsche scope | Implemented and tested |
| Browser and evaluator share retrieval assembly | Implemented; unit-tested through the shared module |
| Evaluation records exact model context and code/data identities | Implemented for authenticated v2 runs; unit- and route-tested |
| Declared model-call budget | Three answer calls maximum, plus one planner call in all-books evaluation |
| Per-part response structure and pre-composition evidence links | Implemented and covered by offline tests; live behavior remains unverified |
| Public pilot defaults to the per-part evidence pipeline | Implemented in the Worker PR; takes effect after merge and deployment; `READER_PIPELINE=legacy` rolls back |
| Human-scored quality improves on development and unseen questions | Not yet measured |

## Remaining validation before enabling or describing this as a quality release

1. Merge and deploy both recovery branches, then use a development run to check that the live composer follows the per-part record contract, that each part receives its own linked candidate pages, and that persistent format failures are reported distinctly. Keep the call budget at two normal answer calls and three maximum after a format retry.
2. Score new reviewed and compose-only drafts independently with the five-dimension human rubric. Include correct-evidence and context-preservation comparisons to distinguish composition failures from retrieval misses and loss caused by short excerpts. Cover follow-ups, multi-work comparisons, absent evidence, reported speakers, and a manually checked verse-range case.
3. Treat the already-used paired holdout as diagnostic only. For a fresh holdout, confirm that a Kant candidate includes a passage from the *Second Analogy* and that the response explains how Kant grounds causal necessity rather than only naming causality as a category. Have a human reviewer score prose and citations; automated `passed` is not quality acceptance.
4. Measure Cloudflare CPU, body size, inference availability, and latency using real pages near the current byte limit. The new path retains current request and page limits; no production capacity claim has been tested.
5. Verify retrieval quality and OCR semantics across the published corpus. Fingerprints establish byte identity with the published text, not OCR correctness, speaker identity, or semantic support. The 642-book fingerprint coverage and the audited seven-book local subset do not substitute for this check.
6. Once the candidate is frozen, run the seven-question acceptance suite with **All Books** and paired mode, then enter human scores in the artifact. Do not tune against these questions; if the candidate fails, retain the report as a measurement and choose a new unseen set for the next candidate.

The user has chosen to make the candidate the public pilot default after merge and Worker deployment. This is a live quality experiment, not a claim that answer quality has passed acceptance. If the live format or answer quality regresses, set `READER_PIPELINE=legacy` to return to the earlier composer while investigating. The authenticated evaluation route continues to use v2 regardless of that public rollback setting. Do not interpret green unit tests, full citations, model self-review, or structural coverage labels as proof that an answer is correct. A citation proves where text came from; human review must still decide whether it supports the claim.
