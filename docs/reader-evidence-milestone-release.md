# Reading Companion evidence milestone: release report

Last updated: October 25, 2026
Status: The October 25 post-merge seven-question all-books reviewed run [40147644388](https://github.com/jsynon/antilogicalism/actions/runs/40147644388) exposed active evidence-v2 quote-validation, part-context retrieval, OCR page-boundary, and semantic-selection gaps. Focused fixes are proposed in [Worker PR #217](https://github.com/jsynon/book-chatbot/pull/217) and companion [website PR #186](https://github.com/jsynon/antilogicalism/pull/186). Offline targeted regression suites and the current GitHub checks pass; a fresh deployed reviewed run remains pending.
Historical implementation branches: `codex/live-eval-progress-and-part-evidence-20261024`, `codex/review-contract-salvage-20261024`, `codex/evidence-recovery-web`, and `codex/evidence-recovery-backend`.

## Goal

Move the Reading Companion toward thoughtful, accurate answers grounded in passages readers can reopen. This milestone changes the information path and answer contract so question interpretation, retrieval, evidence review, and citations remain connected. It keeps the existing corpus, fingerprint validation, source reader, UI, and Gemma deployment. In the merged Worker, ordinary public pilot traffic uses the evidence path by default; the explicit `READER_PIPELINE=legacy` value is the rollback switch. Authenticated evaluation requests select the evidence path regardless of that setting. The repository cannot verify the current deployed Cloudflare configuration. The user showed `READER_PIPELINE=evidence-v2` on the production settings page and added it to Wrangler configuration; whether that configuration was included in the deployed Worker is not established by repository evidence. Turnstile, rate-limit, source-verification, and public-enable gates remain in force.

## Project record since the full audit

The full code and answer-quality audit, delivered October 23 as `reading-companion-full-audit.md`, judged the project salvageable. It found that correct evidence could be lost between question interpretation, catalog scope, retrieval, Worker excerpt selection, answer generation, and evaluation. It also reproduced final-quote and wrong-source citation defects, an edited-author catalog exclusion, and a grouped-citation evaluator bug. Its recommendation was to keep the corpus, fingerprint/source-reader trust boundary, current deployment, and useful lexical search, while simplifying the answer flow and measuring claim-level support instead of adding more prompt patches, repair loops, or AI ranking calls.

The audit report is the detailed baseline; this release log records the implementation decisions and subsequent evidence. The audit's historical snapshots, test counts, and findings describe the October 23 code, not the current merged code. Workspace recovery interrupted one early implementation session. Only repository commits, merged PRs, and saved test artifacts are treated as durable project progress; unsaved work from the interrupted session is not assumed to have survived.

The work since that baseline followed this sequence:

1. The evidence milestone introduced a shared normalized plan for named works, source roles, requested parts, and part-specific queries; aligned browser and evaluator retrieval; preserved full fingerprint-verified page text for the answer path; and added authenticated traces. It also exposed that the live evaluation route was still using the old answer path even when the plan advertised v2, which was corrected before using the holdout to judge v2.
2. Seven-question and paired runs showed that the early claim-record composer could fail to format its output, lose otherwise valid drafts when review mapped claims to the wrong parts, and give model coverage labels too much authority. The pipeline was then simplified to one answer paragraph per planned part with source IDs, deterministic part/source checks, and an optional final review. The deployed reviewed path uses one compose call plus one review call; compose-only uses one compose call. The old malformed-output regeneration and nested claim-record contract are historical and are no longer the active path.
3. Live Hume/Kant tests showed that a structurally complete answer could still name Kant's category without explaining the argument for causal necessity. The response to “what is transcendental idealism?” also first failed for lack of evidence; a later compose-only response explained appearances and things-in-themselves but still did not establish the requested definition. This kept evidence selection and semantic review on the milestone list; the answer format alone was not considered success.
4. The user reported that workflow logs had disappeared. The evaluator added visible stage progress and startup heartbeat; the user confirmed that real-time progress was visible in the latest run. These logs show evaluation stages and request waits, not the Worker’s internal model steps while a request is executing.
5. The pre-deployment seven-question holdout exposed part-link recovery, malformed optional planner facets, overlong/ellipsis review quotes, and answer parts lost to strict citation validation. Those findings drove website PR #183 and Worker PR #210. Both are now merged. The website Pages build completed successfully; the user reports pulling and deploying the Worker. The post-deployment rerun is recorded at the end of this report.

The current live pipeline keeps source identity and scope checks strict. Retrieval part tags are eligibility links, not semantic proof. The Worker still decides whether each answer paragraph's citations are known, in scope, and linked to that part. With review enabled, an `answered` status additionally requires an exact contiguous quote from every cited source ID plus a substantive rationale; a valid but unsupported review is downgraded. A one-word term in quotation marks is treated as terminology, while multiword quotations remain source-checked. None of these checks alone proves entailment, accuracy, or completeness.

Current model-call budget for seven all-books cases is 21 calls for with-review (one planner plus two answer calls per case), 14 for compose-only (one planner plus one compose call per case), and 28 for paired review ablation (one planner plus three answer calls per case). Part-facet recovery adds local corpus searches, not AI calls. The latest run recorded 14 answer-stage calls; planner usage is not included in the Worker usage field.

Deployment routing is verified from `hosting-poc/public-gateway.mjs`: public visitors use the evidence path unless `READER_PIPELINE=legacy`, while authenticated workflow requests always use the evidence path. The user showed `evidence-v2` in the production settings and reports deploying the Worker. This confirms intended configuration, but the repository and saved workflow artifact cannot independently establish the currently active Cloudflare deployment or variable value.

## What changed

- Added a structured question contract for resolved questions, intent, named source roles, requested parts, scope, and search facets. Planner outputs are normalized and book IDs are checked against the server catalog. Selected-book requests are canonicalized to the chosen book.
- Centralized catalog identity parsing for titles, authors, and editors. Edited collections such as *The Portable Nietzsche* stay eligible for Nietzsche author searches without treating Walter Kaufmann as the author.
- Moved browser and evaluation retrieval into the same `retrieveEvidence` implementation. Given identical planner output, allowlists, book scope, and corpus, both now use the same facet search, candidate ordering, page hydration limits, and final six-page selector. The browser cache and evaluator shard reader are only page-loader differences.
- Kept full fingerprint-verified page text and its hash separate from the short UI preview. The candidate answer composer receives complete pages within existing request/page bounds. Explicit Bible verse ranges carry a separate quote-eligible scope while surrounding verified text remains context only.
- The active `reader-evidence-v2` path uses one short answer paragraph per planned part, with citations bound to that part's candidate pages and named-work scope. It does not ask Gemma to emit claim IDs or exact evidence spans. The earlier structured-claim version was replaced after live traces showed that its format and recovery logic were too fragile.
- The active reviewed path uses two Worker answer calls: composition and per-part review. Compose-only uses one. There is no automatic composer regeneration or free-form rewrite after review. A malformed review can leave a citation-checked answer explicitly unverified/partial; unsupported parts stay visible as gaps.
- Citation IDs are checked against supplied source IDs and part scope. Quoted text in the answer is checked against a cited page, while one-word terms are treated as terminology. The review's exact contiguous quotes and rationale feed the evidence map. These checks establish provenance and review traceability, not semantic entailment.
- Added an authenticated evaluation-only trace containing the exact stage prompts, source pages, model responses, timing, rejection reasons, model identity, and usage counters. The public response never includes this trace. User-facing diagnostics expose only bounded plans, citations, exact validated claim anchors, and usage totals, not complete source pages.
- Live evaluation reports now identify the evaluator source commit and hash the published coverage manifest, corpus manifest, and each exact corpus/index file read during the run. Worker build IDs, model context, prompt text, and inference counters remain attached to each case.
- Fixed grouped citation auditing so `[S1, S99]` cannot hide an unknown source ID. Follow-up history is cleared on book-scope changes and only successful verified drafts enter history.

## Historical checkpoint: recovery milestone after the early seven-question all-books failure

The early seven-question run described in this section was the decision point for that revision. It passed 1/7. Five cases returned relevant retrieved pages but failed because the then-active composer response could not be parsed as JSON; those were reported through the same fallback used for missing evidence. The Plato/Rousseau comparison also exposed question-part/source misalignment and an incomplete answer. Aristotle was the sole pass. That result pointed to an answer-pipeline and evaluation-contract failure, not a reason to rebuild the corpus or retrieval stack. The later simpler paragraph contract superseded this section's format-retry design.

At this checkpoint, the recovery branch made five bounded changes:

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

## Historical checkpoint: first live holdout result

The first all-books Hume/Kant holdout run completed without request failures and used the intended six-page evidence budget. The planner resolved the two named works and separated the question into Hume, Kant, and comparison parts. The answer correctly described Hume's account but only identified Kant's category of causality; it did not explain how Kant grounds causal necessity, so the run correctly failed with partial coverage.

This run does not test `reader-evidence-v2`: its `pipeline` field is null, even though the planner plan reports `reader-evidence-v2` as its contract version. The Worker was still using the legacy answer composer. The retrieved Kant results included page 86, which discusses the conditional a priori necessity of dynamical principles, but that page was absent from the six submitted pages. This points to evidence-packet selection as a second issue to investigate after the evaluation is confirmed to exercise the intended answer pipeline. The run's structural citation checks passed, but those checks do not establish semantic support.

At that point, the Worker was changed to route requests authenticated with `PILOT_EVALUATION_TOKEN` through the evidence pipeline even when `READER_PIPELINE` was unset, without changing public answers. The route test verified the returned `pipeline` marker. That change was later merged and deployed; subsequent live runs validated the path.

## Historical checkpoint: second live holdout result

The second all-books Hume/Kant run used `reader-evidence-v2` on Worker version `88a5d8e6-3192-4230-a3d6-bff382a14b80`. It completed the two answer stages with six submitted pages, two final citations, and no request failure. The automated result says `passed: true` and `coverage: full`, but those fields are not a human quality verdict.

The answer accurately explains Hume’s account and accurately identifies Kant’s category of causality as a priori. It still does not explain Kant’s argument for the objective necessity of causal judgments. The reviewer marked the Kant part answered from the category table on page 53, so the model review overstates completeness. Kant’s *Second Analogy* is available in the local corpus around pages 98–104, but none of those pages reached this run’s candidate set. The exact-question search did retrieve page 23, where Kant discusses Hume’s causal principle, but the selector sent page 24 instead. The planner’s Kant query changed to “causality categories synthetic a priori,” omitting “necessity,” which also explains why the earlier page 86 result was not retrieved this time.

The follow-up implementation at that checkpoint addressed this pattern in three shared rules: planner queries retained the requested epistemic relation while seeking the source’s grounds or validity conditions; same-title direct-search near-ties used passage wording to select the page that matched the question; and composition/review prompts required an argument or conditions of validity when a question asked how a principle is known or necessary. Those changes did not add an AI call and were covered by focused offline regressions. Later runs continued to show that these checks did not guarantee complete live answers.

The tests use controlled model responses and synthetic request fixtures. They verify contracts and failure boundaries; they do not establish answer quality from a live model.

## Historical checkpoint: with-review trace and recovery milestone

The October 24 all-books Hume/Kant with-review trace completed without HTTP failures but returned the generic failure answer. The worker made three answer-pipeline calls: an initial composition, one format recovery, and review. The first composition used malformed evidence headers; the recovery produced a draft, but the reviewer assigned claims across the wrong question parts. The Worker treated the review-contract problem as a total pipeline failure and discarded source-validated claims. This is a separate failure from the earlier malformed composer responses: the composer had recovered, but the review response contract then erased the usable draft.

The submitted six-page packet also omitted Kant *Critique of Pure Reason*, page 23, even though exact-question retrieval found it. Page 23 directly discusses Kant's response to Hume's causal principle and the a priori status of causal knowledge. Page 24 was selected instead, alongside a general category table. This is a retrieval-to-selection handoff miss: the evidence existed in the direct-question results but did not reach the composer. The automated review's positive claim verdicts do not establish answer quality; its part mapping was invalid, and `manualReview.status` remained `not-reviewed`.

The corrective candidate changes the failure behavior at both boundaries:

- Review decisions are normalized against exact eligible claim IDs and planned parts. A bad part map downgrades only the affected coverage instead of throwing away all valid source-checked claims. If the review response is malformed or unavailable, qualifying exact-evidence claims can remain visible as an explicitly unreviewed, partial draft. The result retains a failure code, so structural evaluation still marks it as a miss.
- Synthetic comparison coverage links the exact reader question to the synthesis part without adding another search. Retrieval reserves the strongest two results from each part-linked facet before filling the shared candidate pool, preserving second-ranked direct-question pages. The selector then carries a representative page for every part and uses the existing six-page source budget.
- The evaluator now prints case, planner, retrieval, and answer request stages as they happen; it periodically prints a 15-second heartbeat while a Worker request is pending, and still prints each case's structural pass/miss when it completes. The current Worker API returns only after its compose/review pipeline finishes, so these logs cannot expose individual inner Worker steps during that request. The exact authenticated Worker trace remains the source for compose/recovery/review substeps.

The changes do not increase the Worker inference-call budget or add a semantic judge. Recovery is designed to preserve a useful, honestly labeled partial answer when one exists, while keeping review/part-map failures visible to evaluation.

## Verification after latest trace

| Check | Result |
|---|---|
| Worker Node suite: `node --test` | 223 passed, 0 failed |
| Website/evaluation Node suite: `node --test reading-companion/*.test.mjs` | 150 passed, 0 failed |
| Git whitespace checks | Passed on both candidate branches |
| Reviewer assigns claims to wrong parts | Regression verifies correctly mapped parts remain supported, the invalid part becomes partial, and the answer remains a structural miss |
| Reviewer response malformed | Regression verifies exact-evidence claims survive only as an explicitly unreviewed partial draft |
| Second-ranked directly relevant Kant page | Regression verifies it survives candidate capping and reaches the selected answer packet |
| Workflow progress events | Regression covers planner/retrieval/answer start and completion; live output also emits periodic wait heartbeats |

These offline results validated the control-flow contracts at that checkpoint. They did not prove live Gemma output quality or establish that a partial answer was semantically sufficient. PRs #183 and #210 were later merged and deployed; the post-deployment run below supplies the next live measurement.

## Historical checkpoint: paired all-books review ablation and per-part evidence milestone

The later seven-question paired run is the first direct diagnostic of the revised answer path. It held the planner output and retrieved page packet fixed between the reviewed and compose-only variants, then ran an independent composition for each variant. The reviewed variant reported two structurally full answers, two partial answers, and three malformed composer outputs. Across both variants, six of 14 composer outputs failed the expected format, so the reviewer never ran for those cases. The run therefore shows a real format reliability failure and does not establish that review improves answer quality. Its automated coverage labels are not substitutes for human ratings, and the five-dimension draft scores discussed during review were not saved as an independent human-scored artifact.

The source packets also exposed a question-part linkage failure: a useful Du Bois page was present but was not associated with the Wollstonecraft/Du Bois part it could answer, while the Plato common-good and Kant causal-necessity parts lacked matching pages in their submitted packets. The implementation now carries the planner's individual question parts into retrieval as separate search facets, tags each hydrated page with the parts whose facets found it, and reserves a selected page for each represented part within the existing page budget. The Worker builds an explicit source-ID list for each part before calling the composer. It rejects a claim unless its exact evidence span comes from a page linked to every part the claim covers.

The composer now returns a bounded line-record format with one ordered block per planned question part, explicit answered/partial/unanswered status, and claims or a gap for every part. Claims include exact evidence spans and source IDs. Parsing checks that every part appears once, statuses agree with claim/gap presence, claims use planned part IDs, and evidence is linked to those parts. The reviewer receives each draft part status and gap alongside the evidence-linked claims, then judges support and completeness. A malformed composition gets the existing single format retry; persistent malformed output fails closed. This replaces the nested JSON composition format while leaving JSON for the review response. It does not add an AI call: the answer path still uses two calls normally and at most three after a format retry.

## Verification after the paired-run diagnosis

| Check | Result |
|---|---|
| Backend Worker Node suites: `node --test hosting-poc/*.test.mjs` | 212 passed, 0 failed |
| Website companion Node suites: `node --test reading-companion/*.test.mjs` | 147 passed, 0 failed |
| Git whitespace checks | Passed on both corrective branches |
| Per-part retrieval facets, page-to-part tags, and selector reservation | Covered by offline retrieval and selector tests |
| Per-part composer format, completeness, exact evidence, and source-to-part binding | Covered by offline Worker tests |
| Planner, page packet, and answer-call count | No additional AI call; search adds local corpus queries |
| Trace-shaped comparison plan, query-to-part linkage, and malformed record recovery | Covered by focused Worker and website regressions |

These tests show that the format and linkage contracts work on controlled fixtures. They do not demonstrate that the deployed Gemma model reliably emits the format, that search returns semantically sufficient pages, or that the final prose is accurate.

## Historical checkpoint: authenticated trace diagnosis and corrective candidate

The one-case all-books compose-only run for “How do Hume’s *Enquiry* and Kant’s *Critique of Pure Reason* differ over how we can know causal necessity?” used Worker version `e071ea59-a87a-4475-8593-a05454c90936`. It made two answer calls and used 161.3 neurons. Both composer responses ended normally (`finish_reason: stop`); neither was truncated. The first response and its format retry both failed the parser, so review did not run and the public result was the generation-failed fallback.

The trace identifies three independent issues. First, the composer omitted the `TEXT` marker, emitted an empty duplicate claim header, and added a third `PART` even though the plan contained only two. Second, the plan represented Hume and Kant separately but did not make the requested comparison its own coverage part; the model's extra third block acknowledged that gap. Third, source-specific planner queries were not used as per-part retrieval facets. Kant page 54 appeared in the six-page packet and discusses the category of causality, but had no part link; Hume page 41 was linked to the Hume part but its selected passage framed a commonly accepted doctrine rather than establishing Hume's account through custom or habit.

The corrective candidate now adds a bounded comparison part when an explicit multi-source comparison plan omits it. It associates planner queries with matching source parts, passes those focused queries to both browser and evaluator retrieval, and links pages found through those facets to their parts. The composer no longer requires the redundant `TEXT` marker; it can discard an empty duplicate claim header and assigns internal claim IDs deterministically. It still requires the exact planned part sequence, validates evidence against linked pages, and fails closed on missing parts or unsupported citations. This adds no model call.

This fixes the reproduced contract and query-linking failures in deterministic tests; it does not establish that the live model will make a sound Hume/Kant comparison. The used holdout case remains diagnostic, not acceptance evidence.

## Acceptance status

| Audit criterion | Status |
|---|---|
| Unknown grouped citation IDs fail evaluation | Implemented and tested |
| A rewrite cannot bypass final checks | Candidate pipeline has no post-review prose rewrite; tested |
| Multiword quoted text is checked against a cited source page | Implemented and tested; single-token terms are treated as terminology |
| Portable Nietzsche remains discoverable under Nietzsche scope | Implemented and tested |
| Browser and evaluator share retrieval assembly | Implemented; unit-tested through the shared module |
| Evaluation records exact model context and code/data identities | Implemented for authenticated v2 runs; unit- and route-tested |
| Declared model-call budget | Current: 1 planner + 2 answer calls per with-review case; 1 planner + 1 answer call per compose-only case; paired mode uses one planner and three answer calls per case |
| Per-part response structure and pre-composition evidence links | Paragraph contract and source-to-part checks pass offline; latest live run linked pages for all cases but only 7 of 18 parts were marked supported, and no case passed the structural gate |
| Public pilot answer pipeline | PR #208/#209 and follow-up PRs #183/#210 are merged; Pages deployment succeeded and the user reports the Worker was pulled and deployed |
| Human-scored quality improves on development and unseen questions | Not yet measured |

## Remaining validation before describing this as a quality release

1. Re-run the same seven-question with-review diagnostic after merging and deploying this citation-placement correction. The old review response cannot validate an answer paragraph it never received, so a fresh review is needed to measure the restored Aristotle and Du Bois parts.
2. Keep the seven-question set labeled diagnostic/regression: its prompts guided the fixes and a repeat cannot establish generalization. Run the separate unseen acceptance suite only after the candidate is frozen, with All Books and review enabled.
3. Recheck the live “what is transcendental idealism?” question for both its definition and the appearances/things-in-themselves distinction.
4. Improve or supplement the actual evidence packet for Hamlet's afterlife uncertainty and Kant's positive argument for causal necessity. The inspected pages do not establish those requested parts.
5. Investigate malformed reviewer output using the saved Herodotus trace. The fenced response contains invalid JSON (an extra quote before the second evidence object); the parser already removes a valid Markdown fence.
6. Measure Cloudflare CPU, request size, inference availability, and latency with pages near current limits. Check OCR and attribution semantics across the corpus; fingerprints establish byte identity, not OCR correctness or semantic support.

The user has chosen to test the merged pipeline on the live site. This is a quality experiment, not acceptance. Do not interpret green unit tests, full citations, model self-review, or structural coverage labels as proof that an answer is correct. A citation proves where text came from; source-based review must still decide whether it supports the claim. The user confirmed that workflow progress was visible in the latest run.

## Historical checkpoint: revised answer-flow fix after early October 24 traces

The October 24 compose-only and reviewed traces show that the record-based composer contract is still too demanding for Gemma: it has to emit per-part status markers, claim IDs and kinds, exact copied spans, and nested end markers. The traces produced useful Hume and Kant passages but failed on duplicate part records, rejected comparison claims, and a reviewer `partial` claim verdict that was outside the old claim-verdict enum. Those are answer-contract failures; they do not demonstrate that retrieval or corpus provenance failed.

That corrective branch replaced the record composer with one labeled answer block per planned question part. Each paragraph ends with page-source IDs. The Worker checks that IDs exist, are allowed for that part, and match its named-work scope. Comparisons cannot receive full coverage unless citations include every named primary source group. The reviewer returns one completeness status per planned part and sees only the pages cited for that part; `partial` is valid, and a missing or malformed review preserves citation-checked text as an explicitly unverified partial draft. Authenticated verse questions send the requested verse text as support and keep the remaining page as context. The later PR #208 simplified the composer further by removing the record/status format.

The normal reviewed path now uses one composition call and one part-completeness review call. Compose-only uses one call. The Worker no longer spends an additional inference call regenerating malformed composer records or exact evidence spans. The final citation audit still rejects unknown IDs and binds any quotation to a cited page; the composer is instructed to paraphrase and cite the page rather than manufacture quote anchors. Citation IDs establish source location, while semantic support and answer accuracy remain questions for human scoring.

The holdout runner already emitted per-stage progress once corpus loading finished. It now reports initialization immediately and prints a 15-second heartbeat while fingerprint coverage and the corpus manifest load, closing the previously silent startup interval. Evaluation metadata now describes the revised call budget and per-part citation checks.

## Historical checkpoint: evidence selection and auditable review (October 24)

The reviewed Hume/Kant result available at that checkpoint showed that the simplified paragraph path could produce a useful response, but it omitted Hume's custom/habit explanation and Kant's argument for causal necessity. The review marked the parts fully answered without an exact passage or rationale. This pointed to evidence-selection and review-calibration work; it did not justify returning to the earlier claim-ID and quote-extraction composer.

At that stage, the candidate made two changes within the existing pipeline. First, final answer-packet selection compared each part-linked candidate's passage text against that part's actual question, so a directly relevant ground/argument passage could beat a higher-ranked topical page. The public UI and live evaluator pass the same planned part questions to the selector. Second, the review call had to return a concise rationale and exact quote from each source it judged as support. The Worker verified each quote against the exact cited page text (or verse-scoped support text) and checked that comparison evidence covered the named source groups. A full review without that evidence was downgraded to partial and recorded as a support issue; it did not trigger a retry or extra model call. The diagnostic `evidenceMap` and highlights contain those validated review quotes. Follow-up PR #210 later tightened this evidence contract by requiring a quote for every cited source ID.

This makes a positive review auditable and prevents status-only review output from promoting an answer to full coverage. It is not a semantic entailment proof: a model can still select a real but weakly related quote or give a mistaken rationale. Human inspection of the answer and page remains necessary. The change adds no AI calls: compose-only remains one answer call, and with-review remains composition plus review.

| Verification | Result |
|---|---|
| Backend Worker full suite: `node --test` | 211 passed, 0 failed |
| Website companion full suite: `node --test` | 151 passed, 0 failed |
| Git whitespace and JavaScript syntax checks | Passed in both repositories |
| Reviewer claims full support without exact quote or rationale | Regression downgrades to partial, records both support issues, and emits no verified evidence map entry |
| Part-specific selection prefers the causal-necessity argument passage over a higher-ranked category passage | Regression passed |
| Live model quality and published-site behavior | Pending; offline fixtures do not measure model judgment or corpus retrieval quality |

The next single-case validation was later superseded by the post-deploy seven-question run below. That run used the deployed website revision and Worker build and is diagnostic; the unseen acceptance set remains reserved.

### Validation status at that historical checkpoint

| Check | Result |
|---|---|
| Worker answer-flow regression suite | Passed on the corrective branch; covers citation-to-part binding, comparison source groups, missing parts, valid partial reviews, legacy-format recovery, compose-only budget, and verse scope |
| Full Worker Node test suite | 209 passed after the final answer-format, legacy-recovery, source-group, and verse-scope regressions |
| Website companion suite | 150 passed after the startup progress and evaluation-metadata change |
| Live model evaluation | Pending; run the one-case Hume/Kant compose-only variant, then reviewed mode, and score accuracy, question coverage, explanation quality, citation support, and citation completeness independently |
| Public production deployment | Not performed; this branch is not live until reviewed, merged, and deployed |

That first live check has since occurred: the user reported that the “transcendental idealism” response distinguished appearances from things-in-themselves but still failed to define the theory. Later work moved to per-part evidence linking and source-level review quotes. The unresolved acceptance checks are listed above and include another live definition question after the deployed changes.

## Fixes motivated by the seven-question all-books holdout (October 24)

The holdout that motivated PRs #183 and #210 used `all-books` scope and `with-review` mode. It completed seven cases with one retrieval failure and no human rubric scores. None of the seven met the structural gate. Among the six cases that reached composition, the answer/review data recorded four supported parts, three partial parts, and six unsupported parts; the Plato/Rousseau case stopped before answer-stage part data was available. This run is diagnostic and does not measure acceptance quality.

The failures identify four concrete seams in the current pipeline:

- Herodotus had one page that contained both the Egyptian priests' account and Herodotus's reason for preferring it, but retrieval linked the page only to the first part. The Worker then correctly rejected using it for the second part.
- Aristotle and James had relevant verified pages, but the candidate-to-part links and exact-quote rules prevented their prose from surviving. In Aristotle's case the composer used a short quoted term as ordinary terminology; James's planned part had no candidate source links.
- The Hume/Kant review returned exact passages longer than the old 220-character limit, and a Du Bois review quote used an ellipsis that was not an exact contiguous passage. A topical quote also received too much weight in the Kant completeness decision.
- One malformed optional planner facet made the entire Plato/Rousseau retrieval request fail with `Part-specific retrieval queries are invalid.` The report did not expose enough facet-level detail to diagnose the bad item after the fact.

The follow-up candidate keeps the existing paragraph composer and two-call reviewed path. Website retrieval now tolerates malformed optional part facets, falls back to the valid part question where possible, bounds facet work to 12 links and six unique queries, and records warnings in progress events and case reports. After a page is loaded, its own text may link it to an additional question part only when it overlaps at least two distinctive terms from that part's query. This is an eligibility signal, not proof of support; the Worker still enforces source identity, part scope, citations, and review.

The Worker now treats short one-word quoted terms as terminology rather than exact-quotation claims, while keeping multiword quotes bound to cited source text. Review evidence may be up to 320 characters, must be exact contiguous text, and an `answered` part must provide a validated quote from every source ID cited for that part. This keeps the evidence map consistent with the answer citations and avoids rejecting long but valid review excerpts. It does not make semantic review infallible: a real quote can still be only topically related, so the model rationale and human source check remain necessary.

| Verification | Result |
|---|---|
| Website full Node suite: `node --test reading-companion/*.test.mjs` | 154 passed, 0 failed after the final adjustment |
| Worker full Node suite: `node --test hosting-poc/*.test.mjs` | 213 passed, 0 failed |
| Malformed optional part facets | Regression confirms invalid hints are dropped/fallback is used within bounded facet budgets instead of aborting base retrieval |
| Shared page across question parts | Regression confirms a page found through one facet can be linked to another part when its full text contains that part's distinctive terms |
| Review quote contract | Regression confirms exact 260-character review quotes are accepted and an answer citing two pages is downgraded unless both pages have exact review evidence |
| Live model answer quality, OCR fidelity, and published-site behavior | Not yet validated on this candidate |

PR #183 and PR #210 have since been merged. The Pages workflow succeeded, the user reports deploying the Worker, and the post-deploy rerun is recorded below. Because this holdout has guided code changes, neither run is acceptance evidence; the separate unseen acceptance suite remains reserved for a frozen candidate. The user confirmed that the workflow's real-time progress output was visible.

## Post-deployment seven-question holdout (October 24, 2026)

The user ran the all-books, with-review holdout after merging PRs #183 and #210 and deploying the Worker. [GitHub Actions run 40142267190](https://github.com/jsynon/antilogicalism/actions/runs/40142267190) completed all seven cases and published artifact `reading-companion-holdout-answer-evaluation-with-review-all-books-all` (artifact ID `12579058117`). The workflow conclusion is `failure` because its structural gate found 0/7 passing answers; it was not a request outage: there were zero request failures, zero skipped cases, and zero planner fallbacks. Real-time stage progress was visible during this run, as the user confirmed.

The run used all-books scope, `with-review`, website source revision `bd3f478afa06d2d302902c5e45f6911152bd7d2e`, Worker version `335d572f-5027-4acf-82e0-5614dfc86112`, and library v47. The report records hashes for the published corpus/index inputs. Its estimated budget was 21 Worker AI calls (one planner plus two answer calls for each case); actual answer-stage usage recorded 14 calls, 67,594 input tokens, 4,419 output tokens, and 735.009 neurons. Planner usage is not included in that answer-stage usage total.

All 18 planned parts were represented in the result: 7 supported, 8 partial, and 3 unsupported. The workflow's own reviewer-score fields remain blank; an independent source-based assistant assessment is recorded below. Automated statuses alone do not tell us whether each passage supports its prose. The case-level evidence shows where the latest changes helped and where the answer path still breaks:

| Case | What the run shows |
|---|---|
| Herodotus / Helen | Retrieval linked page evidence to both requested parts, including the credibility part, but the review response failed format validation. A usable draft was preserved as unverified/partial; this is a review-contract failure, not missing retrieval. |
| Hamlet | The alternatives in the soliloquy were supported, but the afterlife-uncertainty part remained unsupported. |
| Aristotle | The soul/body part was supported; the form-and-matter explanation remained unsupported after citation/evidence validation. |
| James 2 | Faith and works were supported; Abraham/Rahab remained partial because the review evidence did not fully support the cited material. |
| Hume / Kant | Hume's account and the comparison were marked supported, while Kant's basis for causal necessity remained partial. The response itself acknowledged the supplied Kant text did not establish that basis. |
| Plato / Rousseau | All four parts remained partial. Retrieval completed despite malformed optional facet data, but reported `part-query-budget-exceeded`; the available citations did not establish the full requested claims. |
| Wollstonecraft / Du Bois | Wollstonecraft's part was supported; Du Bois's remained unsupported even though Du Bois pages were retrieved, because no Du Bois citation survived into the answer. |

The clearest verified improvements are operational and contract-level: the run completed all cases without request failure; progress output was visible; Herodotus evidence was associated with both parts; and Plato/Rousseau retrieval survived malformed optional facet data instead of aborting. The run does **not** demonstrate answer-quality acceptance: structural success was 0/7, the workflow's own score fields were blank, and retrieval linkage alone is not semantic evidence. Compared with previous seven-question rounds, treat aggregate part counts cautiously because the planner's decomposition differs across runs; this was not a controlled paired comparison.

At the time of initial review, no code changes had yet been made in response to this run. The assistant source-based scores and trace inspection are recorded in the next section; the workflow's own review-score fields remain blank. The follow-up exact-trace audit and resulting correction are documented at the end of this report. Keep the separate unseen acceptance suite untouched until a candidate is frozen. Re-test “what is transcendental idealism?” as an explicit definition-and-appearance distinction check.

## Assistant source-based review of the post-deployment drafts (October 24, 2026)

The artifact was retrieved directly from GitHub Actions run 40142267190 (artifact ID `12579058117`). No user download was needed. For each case, `evidenceTrace.evidence` contains the exact verified text sent to the answer path, with source ID, title, page, and page hash; `submittedSources` shows the shorter excerpts and part links; `stages` records the compose and review prompts/responses; and `rejected`, `reviewContract`, `evidenceMap`, and `final` show validation decisions and the final user-facing draft. The review below compares the final draft with those source passages. It is an independent assistant assessment, not a human score entered into the workflow artifact; that artifact still has 0/7 reviewer entries.

Scores use the agreed 0–2 scale (2 strong, 1 partial, 0 absent/incorrect). The score order is accuracy / question coverage / explanation quality / citation support / citation completeness. Coverage reflects whether the final draft answers every requested part. Citation support and completeness assess the claims actually present in the final draft; a missing part is reflected primarily under coverage.

| Case | Scores | Source-based assessment |
|---|---:|---|
| Herodotus / Helen | 2 / 2 / 2 / 2 / 2 | Both parts are answered accurately: the Egyptian account is given on Herodotus pp. 145–146, and his reasoning about why Troy would have surrendered Helen appears on p. 146. The citations match those passages. The workflow left the answer unverified because the review response was invalid JSON. It was fenced, but the parser accepts fences; the model inserted an extra quote before the second evidence object. |
| Hamlet | 2 / 1 / 1 / 2 / 2 | The alternatives in the soliloquy are accurately summarized and cited to Shakespeare's text and a second printed version. The answer leaves the afterlife-uncertainty part blank, so coverage is partial; its explanation of the part it does answer is concise but basic. |
| Aristotle | 2 / 1 / 2 / 2 / 2 | The deployed final answer accurately explains soul as actuality/form related to an organized living body and cites *De Anima* pp. 14–18, but omits the requested form-and-matter comparison. The raw compose response contained a supported wax/shape analogy and exact phrases; the post-composition audit rejected P2 as `quotation-citation-mismatch`. The exact cause is documented below: validation first removed sentence-level citations and then moved them to the paragraph end. |
| James 2 | 2 / 2 / 2 / 2 / 2 | Both parts are accurately summarized. The submitted NKJV page 5493 explicitly covers Abraham's offering of Isaac, faith working with works, and Rahab receiving the messengers; pages 5492–5493 support the faith/works explanation. The reviewer did not provide an accepted exact support quote for P2, so the automated result downgraded it to partial despite the directly relevant text on the cited page. |
| Hume / Kant | 2 / 1 / 1 / 1 / 1 | Hume's custom and constant-conjunction account is directly supported by *Enquiry* pp. 42 and 48. The Kant paragraph accurately admits that the submitted *Critique* evidence does not establish Kant's positive account of causal necessity; p. 239 supports a limit on applying causality outside the sensible world, not the requested argument for its a priori necessity. The answer therefore does not fully answer the comparison and repeats Hume's account. |
| Plato / Rousseau | 2 / 2 / 2 / 2 / 2 | All four parts are supported by the submitted pages: Plato p. 176 connects wise and virtuous rulers, refusal of private advantage, and a well-ordered state; Rousseau pp. 14 and 24 connect the social compact, the general will, equal conventions, and the general good. The model review supplied incomplete per-source quote records and downgraded every part, but direct inspection of the cited pages supports the final paragraphs. |
| Wollstonecraft / Du Bois | 2 / 1 / 2 / 2 / 1 | The Wollstonecraft paragraph is accurate and supported by *Vindication* pp. 58, 125, and 138. The deployed final answer contains no Du Bois paragraph, so it does not answer the comparison fully. The raw compose response did contain a Du Bois paragraph supported by *Souls of Black Folk* pp. 131 and 141; its exact “double life” and “morbid sense of personality” phrases were rejected by the same citation-relocation bug described below. |

The assessment changes how the 0/7 structural result should be interpreted, but does not overturn it. The final user-facing answers were not structurally complete, yet several of their included claims are directly supported. In particular, Aristotle and Du Bois show that relevant text and a plausible answer could be present in the raw compose response and then disappear at the final citation-validation boundary. Herodotus shows invalid reviewer JSON, not a Markdown-fence parsing failure. James and Plato/Rousseau show that the automated review can be more conservative than direct inspection of the exact source pages. Hume/Kant remains a genuine evidence-selection and coverage gap: the supplied Kant pages do not establish the requested positive argument.

## Exact-trace audit and citation-placement correction (October 25, 2026)

I traced the live route from `companion-v110.mjs` and `live-answer-evaluation.mjs` through shared `evidence-search.mjs`, then through `/api/pilot-plan`, page fingerprint verification, `/api/pilot-answer`, `composeEvidenceAnswer`, per-part citation checks, optional semantic review, final answer construction, and the workflow's structural gate. The website sends bounded full page text plus candidate part IDs; the Worker re-fetches canonical fingerprint metadata, checks the exact page hash, attaches source IDs, constrains each answer part to linked/in-scope sources, composes, validates citations/quotes, reviews cited passages, and returns both answer and trace. The workflow progress events cover planner/retrieval/answer calls and waits, not internal Worker steps.

The Aristotle and Du Bois trace exposed a deterministic bug in the final Worker boundary. `validatePartAnswers` removed every inline citation from the paragraph, merged the source IDs, and appended that group after the full paragraph before calling `auditFinalAnswer`. The quote checker binds each multiword quotation to a citation in the same sentence or paragraph. Moving a citation past later sentences therefore made exact quotations such as Aristotle's “formulable essence” and Du Bois's “double life” appear unsupported, even though the original composer response placed the correct citation immediately after the quoted sentence and the cited fingerprint-verified page contained the phrase. The paragraph was then dropped.

The candidate fix validates each paragraph with its original citation placement, retains the validated rendered paragraph through final assembly, and runs the final integrity check against that same text. The non-rendered `answerText` remains citation-free for coverage reporting, while the reader-facing answer retains sentence-level citations. This preserves the exact location relationship the validator is designed to enforce; it does not weaken quote checks or semantic review and adds no AI call.

Offline regression tests now cover a multi-sentence answer with a verified quote and citations after separate sentences, repeated IDs from the same source, and the final answer audit. Replaying the original compose responses as compose-only accepts both the Aristotle and Du Bois second paragraphs with no rejection and retains their source IDs. The saved review responses were generated from packets that did not contain those previously rejected paragraphs, so they cannot be reused to measure the new reviewed result; a fresh with-review workflow is required. Hamlet's missing afterlife evidence and Kant's missing positive argument remain retrieval/coverage gaps.

The Herodotus trace was also inspected byte-for-byte. The review output is fenced JSON, which `parseJson` already supports, but it is invalid because the model emits an extra quotation mark immediately before the second evidence object. The pipeline correctly preserves the answer as unverified rather than accepting a malformed review. This is a separate reviewer-output reliability issue and remains open.

The browser and Worker `reader-contract.mjs` copies had drifted despite the contract's explicit byte-identity comment. The website copy lacked the current planner behavior for linking source-specific queries to their question parts and for adding a synthetic comparison coverage part without spending a generic retrieval facet. The web candidate synchronizes this file with the Worker and updates the selector regression to expect only the two planned source queries for the synthetic comparison. The live Worker already returns this normalized plan; the sync prevents local contract and test fixtures from describing older behavior.

| Validation | Candidate result |
|---|---|
| Worker suite: `node --test hosting-poc/*.test.mjs` | 214 passed, 0 failed |
| Website suite: `node --test reading-companion/*.test.mjs` | 154 passed, 0 failed |
| GitHub PR checks at that checkpoint | Worker contract workflow and website smoke workflow passed; PR #213 and PR #184 have since merged |
| Exact saved compose-response replay, Aristotle P2 and Du Bois P2 | Both retained; no `quotation-citation-mismatch` rejection |
| Browser/Worker contract copies | Byte-identical in candidate branches |
| Fresh reviewed quality run, unseen acceptance suite, and live transcendental-idealism check | Still required |

The source-based scores above describe the deployed artifact's final answers, not a new live result from this candidate. The next meaningful measurement is one fresh all-books with-review run with visible progress, followed by the unseen acceptance set only if the candidate behavior is stable. Do not interpret the regression or replay as proof that Gemma's new reviewer will accept the restored paragraphs or that overall answer quality has passed.

## Latest live trace and evidence-handoff correction (October 25, 2026)

The user ran the seven-question all-books evaluation after the previous merged changes. [GitHub Actions run 40145430668](https://github.com/jsynon/antilogicalism/actions/runs/40145430668) completed all cases with zero request failures and 4/7 structural passes. Three structural misses remained: Hamlet, Plato/Rousseau, and Wollstonecraft/Du Bois. This is progress over the prior 0/7 run, but not an acceptance result; the remaining misses expose specific handoffs.

The authenticated trace for Hamlet shows that the useful primary-text page was found: *Elizabethan Drama, Vol. I*, p. 152 contains the “To be, or not to be” soliloquy. Retrieval assigned that candidate no question-part IDs, so the part-aware selector could not reserve it. The final answer instead cited a clipped *Complete Works* excerpt and a secondary translation. The part question included a distinctive quoted phrase, but ordinary overlap dropped common words and did not recognize OCR that split “To” into “T o”.

The Rousseau review supplied a 462-character quotation that was exact in its source excerpt. The Worker rejected it solely because review quotes were capped at 220 characters; without a verified quote, the affected evidence map and part coverage were incomplete. In the Du Bois trace, the reviewer attached a quote to the wrong page and used an ellipsis to join separated text. Those quotations correctly failed exact-source verification. The correction must recover valid long quotations while preserving that fail-closed behavior for wrong-source or stitched text.

Website PR #185 passes each part's natural-language question through both live and evaluation retrieval. For a distinctive quoted phrase in that question, it checks the hydrated page for the phrase in order and tolerates OCR splitting a short word into adjacent letters. This can link the page to that part and gives a phrase-matching eligible page priority in the answer packet. The tag only makes the page eligible and prioritizes it; the Worker still validates source identity, scope, part citations, and semantic review. A regression models the Hamlet failure, confirms the p. 152 page receives the part link despite `T o`, and confirms it is selected ahead of a higher-ranked related page.

Worker PR #215 still requires the entire supplied quote to match the same source excerpt before it can accept it. When that full quote is longer than 220 characters, it stores a contiguous sentence or word-bounded span of at most 220 characters as the verified anchor. Altered quotes and quotes joined across text with ellipses stay unverified. Both the initial review and compact retry prompts now direct the reviewer to quote one exact contiguous span, never join text with ellipses, and never attribute a quote to another source. This adds no model call and does not weaken source checks.

| Validation | Candidate result |
|---|---|
| Website suite: `node --test reading-companion/*.test.mjs` | 155 passed, 0 failed |
| Worker suite: `node --test hosting-poc/*.test.mjs` | 215 passed, 0 failed |
| GitHub required workflows | Worker contracts passed in [run 40147464886](https://github.com/jsynon/book-chatbot/actions/runs/40147464886); website smoke and library evaluation passed in [runs 40147444696](https://github.com/jsynon/antilogicalism/actions/runs/40147444696) and [40147444732](https://github.com/jsynon/antilogicalism/actions/runs/40147444732) |
| Targeted regressions | Hamlet-style quoted phrase links and reserves the OCR-spaced source page; exact long quote is bounded; altered and non-contiguous quotes remain rejected |
| `git diff --check` and JavaScript syntax checks | Passed |
| Fresh production run, new citation trace, unseen acceptance suite | Not yet run against these candidate branches |

These changes address the concrete failures in the latest artifact without reopening the broad pipeline design. The live quality question remains whether the source pages and reviewer now support complete, accurate answers. After these branches are reviewed, merged, and deployed, run the same seven-question all-books with-review workflow once with its real-time progress visible. Inspect the three prior misses plus all seven citations and part statuses; compare the structural result with 4/7, but do not treat the repeated holdout as unseen acceptance evidence. If that run is stable, use the reserved unseen acceptance suite for the release decision.


## October 25, 2026: post-merge reviewed holdout run

The seven-question `holdout`, `all-books`, `with-review` workflow [run 40147644388](https://github.com/jsynon/antilogicalism/actions/runs/40147644388) completed all seven cases against corpus v47. It used Worker version `702d954d-28c7-421e-b139-ff4f9c6691fe` and website source revision `0be54f5504369373e8649503cc6018f07657d38d` (the merge commit for website PR #185). The workflow estimated 21 Worker AI calls: one planner and two answer-pipeline calls per case. There were no request failures, planner fallbacks, or skipped cases.

The machine marked two cases structurally passed (Herodotus/Helen and Aristotle’s soul/body) and five failed. Across 18 question parts, 11 were marked supported, six partial, and one unsupported. These are structural/evidence-review outcomes, not semantic quality scores. Independent draft review on the existing 0–2 rubric:

| Case | Accuracy | Question coverage | Explanation | Citation support | Citation completeness | Assessment |
|---|---:|---:|---:|---:|---:|---|
| Herodotus and Helen | 1 | 2 | 2 | 1 | 2 | Complete answer, but it reverses whether Proteus was detaining Helen. |
| Hamlet’s soliloquy | 2 | 1 | 1 | 2 | 2 | The suffering-versus-resistance choice is supported; the answer omits how uncertainty about death affects Hamlet. |
| Aristotle on soul and body | 2 | 2 | 2 | 2 | 2 | Strong, directly supported explanation of actuality/form, matter, and the analogies. |
| James on faith and works | 2 | 2 | 2 | 2 | 2 | The answer covers faith, works, Abraham, and Rahab; the retrieved NKJV page contains the cited material. |
| Hume and Kant on causal necessity | 1 | 2 | 1 | 1 | 2 | Hume is well supported; the Kant discussion uses a passage about regulative principles and absolute necessity that does not establish Kant’s account of causal necessity. |
| Plato and Rousseau on political order | 2 | 2 | 2 | 2 | 2 | The submitted pages support the claims about virtuous rulers, the social compact, general will, and common good. |
| Wollstonecraft and Du Bois on unequal conditions | 2 | 2 | 2 | 2 | 2 | The cited pages support the answer’s claims about social formation, reciprocal prejudice, and Du Bois’s examples of response. |

These manual scores assess the answer text against the submitted page excerpts; they were not entered into the artifact’s human-review fields, which remain pending. A score of 2 for citation completeness means the answer attached citations to its claims; it does not imply every cited page is semantically adequate. In particular, the Kant answer has a completeness score of 2 but weak citation support.

### What the traces establish

The workflow ran the `reader-evidence-v2` pipeline. Its review prompt still requires an exact contiguous quote of 12–320 characters, and the active validator in `hosting-poc/evidence-answer.mjs` enforces the same 320-character ceiling. Worker PR #215 is merged, but its bounded-quote change is in the separate legacy review path in `public-gateway.mjs`; the live evidence-v2 route calls `composeEvidenceAnswer` from `evidence-answer.mjs`. Therefore PR #215 does not change the validator exercised by this run. This is a code-path mismatch, not evidence that PR #215 failed to deploy.

The trace shows examples of review evidence longer than 320 characters for Plato/Rousseau and Du Bois. Their exact source text appears in the submitted pages, while the review contract rejects the quotes and downgrades those parts. James is another distinct case: the NKJV excerpt contains OCR ligatures such as `jusƟﬁed` and `oﬀered`, while the reviewer quotes normalized spellings. The page contains the argument, but exact quote matching does not accept those strings. These cases point to a mismatch between source-text normalization and quote validation, alongside the hard length cap; they should not be treated as proof that the answer prose lacked evidence.

There are also real content/retrieval issues. The Hamlet packet lacks the page containing the afterlife reasoning, so the second part is genuinely unanswered in this draft; PR #185’s phrase-to-part linking cannot help when the needed page is absent from the submitted packet. The Hume/Kant draft has all parts populated, but its Kant claims outrun the retrieved Kant passage. The Herodotus draft makes a material attribution/negation error despite passing the structural checks. These examples confirm that structural pass rates alone cannot serve as release quality evidence.

### Remaining validation and next milestone

1. Align the exact-quote bound and OCR/Unicode normalization in the active evidence-v2 prompt and validator, with tests for long exact source spans, OCR ligatures, altered quotes, and non-contiguous text. Keep the verifier fail-closed when a quote is genuinely unsupported.
2. Improve Hamlet retrieval so the page containing the afterlife passage enters the candidate packet, then verify that the live page-to-question-part linking reserves it for the right part.
3. Correct Kant evidence selection for causal necessity and require direct support for Kant’s relevant argument before composition; retain the existing abstention behavior when the needed passage is unavailable.
4. Add semantic checks for attribution and negation, including the Herodotus/Proteus claim, and review all final citations against page text.
5. Rerun the same seven-question reviewed holdout after the focused fixes, inspect live progress and traces, then run the reserved unseen acceptance suite. Require complete part coverage and source-supported claims; do not equate a structural pass with factual accuracy.


## October 25, 2026: focused evidence-handoff fixes (PRs #217 and #186)

The reviewed holdout was traced through both sides of the active pipeline. Website retrieval hydrates and selects page candidates, attaches question-part eligibility, and submits the original page text; the Worker revalidates fingerprints and scope, composes the answer, checks per-part citations, and reviews exact source quotes. This split matters: fixing a legacy validator alone would not have fixed the active evidence-v2 route, and retrieval-side part labels cannot establish that a passage entails the final answer.

Worker PR #217 changes the active v2 review contract and the shared quote-verification boundary. The reviewer can return a complete exact contiguous quote up to 2,000 characters. The Worker verifies that full quote against the specific cited page before storing a bounded contiguous anchor (up to 220 characters) for the evidence map. Known OCR ligature substitutions are normalized only for matching; the displayed anchor is taken from original page text. Altered, over-limit, too-short, wrong-source, or stitched quotes remain rejected. The same helper is used by the legacy route, removing the code-path mismatch that let the active v2 validator retain its old 320-character cap.

The Worker prompts now explicitly require the requested concept, actor, action, polarity, qualification, and reasoning to match the cited evidence. When a question asks how a principle is justified or known, the answer must explain the source's grounds or conditions. Kant causal-necessity planning is directed toward the Second Analogy, and a nearby discussion of regulative or absolute necessity is not accepted as a substitute. Dependent non-comparison parts may carry the resolved parent question into retrieval, so pronouns such as “he” or “this soliloquy” do not become the only search context.

Website PR #186 keeps its reader-contract copy synchronized with the Worker, connects a distinctive quoted phrase in a question part to hydrated page text despite OCR spacing, and detects a page cutoff where OCR joined the next sentence's capitalization (for example, “sleepNo”). It requests the adjacent page only when that page independently passes the existing relevance check. Part tags continue to affect eligibility and selection only; Worker source, scope, citation, and review checks remain authoritative.

| Validation | Candidate result |
|---|---|
| Worker evidence-answer and shared review-quote suites: `node --test hosting-poc/review-evidence.test.mjs hosting-poc/evidence-answer.test.mjs` | 26 passed, 0 failed |
| Worker search-planner suite: `node --test hosting-poc/search-planner.test.mjs` | 20 passed, 0 failed |\n| Website evidence-search and scoped remote-library suites: `node --test reading-companion/evidence-search.test.mjs reading-companion/remote-library.scoped.test.mjs` | 63 passed, 0 failed |
| New regression coverage | Long exact quote bounded after verification; OCR ligature normalization; altered, non-contiguous, too-short, and oversized quotes rejected; contextual part-query and quoted-phrase link; relevant adjacent continuation; irrelevant adjacent page excluded |
| GitHub PR checks | Worker contract workflow [40149970497](https://github.com/jsynon/book-chatbot/actions/runs/40149970497) passed; website smoke [40149943090](https://github.com/jsynon/antilogicalism/actions/runs/40149943090) and library evaluation [40149943005](https://github.com/jsynon/antilogicalism/actions/runs/40149943005) passed |
| Fresh deployed reviewed run | Not run; this change did not spend live model calls |
| Reserved unseen acceptance suite | Still required for release confidence |

The fixes address several concrete failures exposed by run 40147644388, but do not establish that the live model will choose the right passage, preserve attribution/negation, or produce complete answers. After both PRs pass checks and merge, deploy the Worker and website, then run the same seven-question all-books reviewed holdout with visible progress. Inspect Hamlet's afterlife part, Kant's causal-necessity support, Herodotus's attribution, and every reviewer quote against the traced source page. If those results are stable, evaluate the reserved unseen acceptance set; the repeated holdout is regression evidence, not unseen acceptance evidence.
