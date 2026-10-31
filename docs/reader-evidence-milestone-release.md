# Reading Companion: project status and next milestone

Last updated: October 31, 2026

## Goal

Build a useful public Reading Companion that answers the reader’s question in clear, sufficiently full prose; draws on relevant library passages; distinguishes source claims from general context; and makes citations easy to inspect. Judge answer quality independently from structural correctness. Do not add question-specific routes, required author lists, or fixed source-count rules.

## Current pipeline

1. The browser plans searches and retrieves candidate pages from the published v49 library. Retrieval hints identify possible question-part relationships; they do not prove support.
2. The Worker verifies submitted pages against published fingerprints, selects a bounded set of relevant evidence, and links it to the planned parts. The evidence selector’s direct/context cues are navigation only; source review remains authoritative.
3. The composer writes one connected response from reviewed evidence and may add useful general knowledge when the library is adjacent or silent. The review call checks cited claims and source spans, preserves accepted context, and keeps incomplete or unsupported work provisional.
4. The site renders answer paragraphs, citation links, selected passage cards, and the local passage reader. Offline replay checks saved reports without calling the Worker or models.

Trust boundaries to preserve: verified corpus identity; exact cited-source spans; source attribution and logical scope; honest partial/unsupported status; and clear distinction between general context and what the library establishes. Retrieval breadth, answer fullness, citation support, and human quality scores are separate measures.

## Most recent saved acceptance run

Workflow run [#41249199660](https://github.com/jsynon/antilogicalism/actions/runs/41249199660), artifact `13060940825`, completed all five handoff cases in baseline retrieval mode. All five passed structural checks; there were no request failures or planner fallbacks. Reviewer contracts were complete, with 59 claims answered, two partial, and 16 support concerns rejected before final output. The official answer and highlight rubrics remain pending. An independent offline review scored answers at 7.8/10 on average and passage highlights at 7.6/10; these are provisional editorial scores, not artifact labels.

The saved traces identify two handoff weaknesses. In the selected-book Mill case, retrieval and conditional gap search surfaced relevant pages about freedom of thought, but evidence selection retained only the harm-principle page and labeled it direct support for both requested parts. In the Odyssey case, answer evidence selection included the right lines, but the highlight packet also contained lower-ranked, unrelated spans for the same claims. Exact quote location passed in both cases; it did not establish relevance or question coverage.

## Current corrective changes

- Worker PR #333 normalizes repeated selector candidate IDs. Identical verified cues are merged; conflicting cues become context-only. The trace records duplicate count. Malformed entries, unknown IDs, and unverified excerpts remain guarded.
- The current candidate narrows polarity matching to related clauses, passes selector relation cues into the existing part-specific review as non-authoritative context, deduplicates near-identical verified pages before selection, and merges adjacent reviewed highlight spans only when claim and part match. It adds no model call or question-specific route.
- The site evaluator now links a highlight to answer sentences using the reviewer's claim point and the same source, marks uncertain matches unresolved, and carries a separate pending human highlight rubric. Exact quote location remains a mechanical check, not a relevance score.
- This candidate separates the reviewer's answer-completeness decision from the Worker’s library-evidence coverage. The existing review call explicitly retains or omits uncited context claims and marks whether the whole answer directly answers the reader; exact span and attribution checks for cited claims stay in place. No model call or question-specific route is added.
- This candidate treats a known, source-derived claim ID mistakenly repeated in `retainedContextClaimIds` as a non-blocking review warning. The ID is discarded from the context list and still passes or fails the ordinary cited-claim span and attribution checks. Unknown IDs remain blocking contract errors. The trace records the warning, so malformed model output remains observable without invalidating otherwise complete source review.
- The composer now asks for a direct, calibrated opening and an early distinction between established evidence and what remains possible for uncertain or disputed questions. This is general answer guidance and adds no model call or question-specific routing.
- This candidate makes the existing evidence selector and answer reviewer attend to the requested reasoning operation, and keeps passage highlights tied to the strongest claim-linked excerpts instead of filling spare slots with weaker spans. It adds no model call or question-specific route.
- Final citation normalization now rewrites only exact source-ID groups such as `[S1]` and `[S1, S2]`. Bracketed prose such as `[cannot]` is preserved; span locators remain recognized earlier in review.
- The Site report records `answerCompleteness` independently from `coverage`; its structural pass uses answer completeness while continuing to expose partial evidence coverage, citation integrity, and required source-group misses. Human rubric scores remain the answer-quality judgment.
- Local full suites passed for this candidate: Worker 344 tests; Site 236 tests. These results establish regression coverage, not a live quality improvement.

## Next validation and roadmap

This candidate updates two existing handoffs without adding a model call or a question-specific source route:

- Evidence selection and the existing answer reviewer now check the operation the reader requested. Explanatory questions need evidence and an answer that explain the requested reasoning or mechanism; a related rule or conclusion alone is not enough. The reviewer marks a missing central element partial.
- Passage-card excerpts are ranked primarily against their linked answer claim. The display keeps the strongest excerpt for each distinct claim, joins only adjacent reviewed spans for that claim, and does not fill spare slots with weaker spans from the same claim.

After merge and Worker deployment, replay the saved handoff artifact offline and run the one-dispatch handoff validation once. Check that Mill’s answer has relevant reasoning evidence for the first part or clearly signals its limits; do not require a fixed page or wording. Check that Odyssey’s displayed excerpt matches the cited claim and that adjacent excerpts remain readable. Also review a control case with multiple claims on one page and a fresh question, to confirm that claim coverage and general retrieval remain intact. Compare answer quality, highlight quality, citation integrity, and structural checks separately.

The milestone remains an average answer score of at least 8/10, no answer below 6/10, and no serious citation or meaning-reversal failure.

## Public enablement

Keep `PUBLIC_ENABLED=false` while the site uses `/api/pilot-plan` and `/api/pilot-answer`. The Worker’s `pilotReady` condition requires `PUBLIC_ENABLED` to remain false; switching it on disables those pilot routes and enables the separate `/api/answer` route. Change the flag only as part of an intentional endpoint migration, after confirming that the live client targets the intended route and its Turnstile, rate-limit, corpus-integrity, AI-binding, cost, and rollback controls are configured and verified. The checked-in example config intentionally defaults all public flags to false. Repository state cannot confirm the current Cloudflare deployment settings.

## Historical record

This brief replaces the run-by-run narrative so current decisions and next actions are easy to find. Earlier trace reviews and implementation notes remain recoverable from the repository’s Git history and saved workflow artifacts.
