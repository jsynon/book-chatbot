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

Workflow run [#41230269589](https://github.com/jsynon/antilogicalism/actions/runs/41230269589), artifact `13053752837`, completed all 11 cases without request failures or planner fallbacks. The original and offline structural checks both passed 4/11. Raw reviewer responses show the same `invalid-retained-context-claim-id` contract error in six cases: the model put known source-derived claim IDs into the uncited-context retention list. The corresponding part decisions and direct-answer claim checks were answered, but the Worker treated the schema mix-up as a blocking review failure and downgraded every part to an unreviewed partial draft. The simulation case is separately partial because its answer discusses Bostrom and Baudrillard without directly stating what is known or uncertain about the hypothesis. The Buddha selector had direct, high-ranked passages from Nārada Mahāthera; the alternate Bukkyo Dendo Kyokai candidates were lower-ranked and their excerpts were less directly useful, so this run does not justify a source-count rule. The workflow rubric remains pending; an independent editorial read averaged about 7.8/10, with simulation below the 6/10 floor. This is a provisional judgment, not a saved human score.

## Current corrective changes

- Worker PR #333 normalizes repeated selector candidate IDs. Identical verified cues are merged; conflicting cues become context-only. The trace records duplicate count. Malformed entries, unknown IDs, and unverified excerpts remain guarded.
- The current candidate narrows polarity matching to related clauses, passes selector relation cues into the existing part-specific review as non-authoritative context, deduplicates near-identical verified pages before selection, and merges adjacent reviewed highlight spans only when claim and part match. It adds no model call or question-specific route.
- The site evaluator now links a highlight to answer sentences using the reviewer's claim point and the same source, marks uncertain matches unresolved, and carries a separate pending human highlight rubric. Exact quote location remains a mechanical check, not a relevance score.
- This candidate separates the reviewer's answer-completeness decision from the Worker’s library-evidence coverage. The existing review call explicitly retains or omits uncited context claims and marks whether the whole answer directly answers the reader; exact span and attribution checks for cited claims stay in place. No model call or question-specific route is added.
- This candidate treats a known, source-derived claim ID mistakenly repeated in `retainedContextClaimIds` as a non-blocking review warning. The ID is discarded from the context list and still passes or fails the ordinary cited-claim span and attribution checks. Unknown IDs remain blocking contract errors. The trace records the warning, so malformed model output remains observable without invalidating otherwise complete source review.
- The composer now asks for a direct, calibrated opening and an early distinction between established evidence and what remains possible for uncertain or disputed questions. This is general answer guidance and adds no model call or question-specific routing.
- Final citation normalization now rewrites only exact source-ID groups such as `[S1]` and `[S1, S2]`. Bracketed prose such as `[cannot]` is preserved; span locators remain recognized earlier in review.
- The Site report records `answerCompleteness` independently from `coverage`; its structural pass uses answer completeness while continuing to expose partial evidence coverage, citation integrity, and required source-group misses. Human rubric scores remain the answer-quality judgment.
- Local full suites passed for this candidate: Worker 344 tests; Site 236 tests. These results establish regression coverage, not a live quality improvement.

## Next validation and roadmap

The latest handoff trace exposed two handoff problems. First, a technology-change question in All Books mode was narrowed to one work because “change” matched the final word of a corporate byline; the site now requires a recognizable author mention before author-based scope is applied. Second, the planner should separate two distinct requested outcomes while keeping one causal or explanatory relationship intact; the Worker prompt now states that distinction more operationally. These changes add no answer route, no source prescriptions, and no model calls.

After merging and publishing the Worker and site changes, run the one-dispatch **Reading Companion handoff validation** workflow once. It combines the technology-change and Odyssey cases with three unseen controls: three All Books and two selected-book questions. Inspect whether technology-change queries remain in All Books scope unless a source is explicitly named, whether independent requested outcomes appear as separate plan parts while single relationships stay together, and whether useful evidence reaches the final packet. Score answer quality, source relevance, citations, and structural integrity separately. If these handoffs improve without false-positive retries or source steering, move on to a new question set rather than tuning the regression cases further.

The milestone remains an average answer score of at least 8/10, no answer below 6/10, and no serious citation or meaning-reversal failure.

## Public enablement

Keep `PUBLIC_ENABLED=false` while the site uses `/api/pilot-plan` and `/api/pilot-answer`. The Worker’s `pilotReady` condition requires `PUBLIC_ENABLED` to remain false; switching it on disables those pilot routes and enables the separate `/api/answer` route. Change the flag only as part of an intentional endpoint migration, after confirming that the live client targets the intended route and its Turnstile, rate-limit, corpus-integrity, AI-binding, cost, and rollback controls are configured and verified. The checked-in example config intentionally defaults all public flags to false. Repository state cannot confirm the current Cloudflare deployment settings.

## Historical record

This brief replaces the run-by-run narrative so current decisions and next actions are easy to find. Earlier trace reviews and implementation notes remain recoverable from the repository’s Git history and saved workflow artifacts.
