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

Workflow run [#39](https://github.com/jsynon/antilogicalism/actions/runs/41219189815) completed 11 cases with no request failures or planner fallback. Ten cases passed structural checks; simulation produced an explicitly reviewed source-free general-context answer; Aristotle was the remaining miss after a review timeout. The Worker selector repeated a candidate ID in the Aristotle trace, which caused retrieval-order fallback. Buddha cited three useful passages from one work; source diversity remains a qualitative judgment, not a quota. Human answer-quality labels were absent.

Offline replay of run #39 refreshed labels and structural summaries with zero AI and network calls. It passes 10/11; the Aristotle review miss remains. The replay cannot rerun the selector or review model and cannot change answer quality.

## Current corrective changes

- Worker PR #333 normalizes repeated selector candidate IDs. Identical verified cues are merged; conflicting cues become context-only. The trace records duplicate count. Malformed entries, unknown IDs, and unverified excerpts remain guarded.
- Site PR #310 preserves the saved general-context classification during replay and splits repeated single-space inline bullet runs into readable prose blocks without treating ordinary italics as bullets.
- Local full suites passed: Worker 341 tests; site 233 tests. These results establish regression coverage, not a live quality improvement.

## Next validation and roadmap

After both PRs merge and deploy, run the current acceptance set once. Check that the Worker selector stays in semantic-selection mode when candidate IDs repeat, and inspect whether Aristotle review completes. Review answer quality and citations separately from structural pass. If those handoffs are clean, move to a different, previously unseen question set; do not keep tuning only the calibration questions. Preserve human labels for the five dimensions: directness/coverage, explanation/fullness, source relevance, citation support, and readability.

## Public enablement

Keep `PUBLIC_ENABLED=false` while the site uses `/api/pilot-plan` and `/api/pilot-answer`. The Worker’s `pilotReady` condition requires `PUBLIC_ENABLED` to remain false; switching it on disables those pilot routes and enables the separate `/api/answer` route. Change the flag only as part of an intentional endpoint migration, after confirming that the live client targets the intended route and its Turnstile, rate-limit, corpus-integrity, AI-binding, cost, and rollback controls are configured and verified. The checked-in example config intentionally defaults all public flags to false. Repository state cannot confirm the current Cloudflare deployment settings.

## Historical record

This brief replaces the run-by-run narrative so current decisions and next actions are easy to find. Earlier trace reviews and implementation notes remain recoverable from the repository’s Git history and saved workflow artifacts.
