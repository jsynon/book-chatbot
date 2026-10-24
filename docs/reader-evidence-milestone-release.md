# Reading Companion evidence milestone: release report

Date: October 24, 2026  
Status: implementation complete for offline review; live quality acceptance remains open  
Backend branch: `codex/reader-evidence-milestone`  
Website branch: `codex/reader-evidence-milestone`

## Goal

Move the Reading Companion toward thoughtful, accurate answers grounded in passages readers can reopen. This milestone changes the information path and answer contract so question interpretation, retrieval, evidence review, and citations remain connected. It keeps the existing corpus, fingerprint validation, source reader, UI, and Gemma deployment. The candidate answer path is opt-in and does not change production until deliberately configured and deployed.

## What changed

- Added a structured question contract for resolved questions, intent, named source roles, requested parts, scope, and search facets. Planner outputs are normalized and book IDs are checked against the server catalog. Selected-book requests are canonicalized to the chosen book.
- Centralized catalog identity parsing for titles, authors, and editors. Edited collections such as *The Portable Nietzsche* stay eligible for Nietzsche author searches without treating Walter Kaufmann as the author.
- Moved browser and evaluation retrieval into the same `retrieveEvidence` implementation. Given identical planner output, allowlists, book scope, and corpus, both now use the same facet search, candidate ordering, page hydration limits, and final six-page selector. The browser cache and evaluator shard reader are only page-loader differences.
- Kept full fingerprint-verified page text and its hash separate from the short UI preview. The candidate answer composer receives complete pages within existing request/page bounds. Explicit Bible verse ranges carry a separate quote-eligible scope while surrounding verified text remains context only.
- Added an opt-in `reader-evidence-v2` answer path: one structured claim composition, deterministic exact-span/citation checks, and one final claim review. It has no free-form rewrite after review. Rejected or unsupported claims cannot re-enter through repair. The answer service is capped at two calls, plus the existing planner call (three total per normal question).
- Each accepted claim has exact source page quotes and offsets. Quotes must occur on the cited page; when a verse restriction applies, they must also occur inside the requested verse range. Only claims the final reviewer marks supported are rendered. Citation IDs and quotation links are checked again after deterministic rendering.
- Added an authenticated evaluation-only trace containing the exact stage prompts, source pages, model responses, timing, rejection reasons, model identity, and usage counters. The public response never includes this trace. User-facing diagnostics expose only bounded plans, citations, exact validated claim anchors, and usage totals, not complete source pages.
- Fixed grouped citation auditing so `[S1, S99]` cannot hide an unknown source ID. Follow-up history is cleared on book-scope changes and only successful verified drafts enter history.

## Verification

| Check | Result |
|---|---|
| Backend Worker Node suites: `node --test hosting-poc/*.test.mjs` | 199 passed, 0 failed |
| Website companion Node suites: `node --test reading-companion/*.test.mjs` | 135 passed, 0 failed |
| Git whitespace checks | Passed on both branches before final report commit |
| Shared browser/Worker contract copies | Byte-identical at implementation review |
| Full-page input, exact source binding, verse-scope boundary, final deterministic rendering | Covered by offline tests |
| Public trace protection and authenticated evaluation trace | Covered by route test |
| Edited-author collection discovery and grouped citation regression | Covered by website tests |

The tests use controlled model responses and synthetic request fixtures. They verify contracts and failure boundaries; they do not establish answer quality from a live model.

## Acceptance status

| Audit criterion | Status |
|---|---|
| Unknown grouped citation IDs fail evaluation | Implemented and tested |
| A rewrite cannot bypass final checks | Candidate pipeline has no post-review prose rewrite; tested |
| A quote cannot be validated against an uncited source | Implemented and tested |
| Portable Nietzsche remains discoverable under Nietzsche scope | Implemented and tested |
| Browser and evaluator share retrieval assembly | Implemented; unit-tested through the shared module |
| Evaluation records the exact model context | Implemented for authenticated v2 runs; route-tested |
| Declared model-call budget | Three calls total including planning; answer path hard-limits two |
| Human-scored quality improves on development and unseen questions | Not yet measured |

## Remaining validation before enabling or describing this as a quality release

1. Run a live, paired legacy-versus-v2 evaluation on a frozen development set and a separately held-out set. Keep question, model, settings, retrieval pages, and scoring rubric fixed where each comparison requires them. Use independent human ratings for factual correctness, requested-part coverage, explanation quality, citation support, and citation completeness. Record failures and abstentions instead of tuning on the holdout.
2. Include correct-evidence and context-preservation comparisons. These distinguish model composition problems from retrieval misses and from loss caused by short excerpts. Include follow-ups, multi-work comparisons, absent evidence, reported speakers, and a manually checked verse-range case.
3. On an authorized evaluation run, save the exact front-end revision, Worker version/source build, corpus/index/fingerprint digests, prompt/model settings, selected evidence packet, stage outputs, actual calls/tokens/neurons, and latency. The trace implementation exists; no live run has been captured for this milestone.
4. Measure Cloudflare CPU, body size, inference availability, and latency using real pages near the current byte limit. The new path retains current request and page limits; no production capacity claim has been tested.
5. Verify retrieval quality and OCR semantics across the published corpus. Fingerprints establish byte identity with the published text, not OCR correctness, speaker identity, or semantic support. The 642-book fingerprint coverage and the audited seven-book local subset do not substitute for this check.
6. Run the paired workflow against the actual website and Worker revisions after the branch is integrated into their source repositories. The backend repository has an `origin`; the website checkout in this workspace has no Git remote configured, so its branch is currently local to this checkout.

Until these checks pass, keep `READER_PIPELINE` unset or different from `evidence-v2`. Do not interpret green unit tests, full citations, model self-review, or structural coverage labels as proof that an answer is correct. A citation proves where text came from; human review must still decide whether it supports the claim.
