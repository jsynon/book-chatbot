# Reading Companion evidence milestone: release report

Last updated: October 25, 2026
Status: Worker PRs #217, #220, #221, #227 and website PRs #186, #187, #188, #193 are merged. The latest five-question all-books with-review run [40168960976](https://github.com/jsynon/antilogicalism/actions/runs/40168960976) completed without request failures, fallbacks, or skipped cases but passed only 3/5 structural cases. It exposed an over-expanded Sunyata definition plan, broken possessive cleanup in the Nietzsche/Kierkegaard source queries, and a quote-to-claim mismatch in a passing Kierkegaard answer. Paired follow-up PRs [#228](https://github.com/jsynon/book-chatbot/pull/228) and [#194](https://github.com/jsynon/antilogicalism/pull/194) address those failures across the Worker planner/reviewer and website source selector. Local suites pass 231/231 and 172/172; all three PR checks also passed. The PRs remain open pending review/merge, and a fresh deployed live-model run is still required. The earlier James 2:14–26 miss from run [40157017806](https://github.com/jsynon/antilogicalism/actions/runs/40157017806) was traced to scripture scope being dropped from part queries; that fix is merged in website PR #188.
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

The current live pipeline keeps source identity and scope checks strict. Retrieval part tags are eligibility links, not semantic proof. The Worker still decides whether each answer paragraph's citations are known, in scope, and linked to that part. In the current PR #220 candidate, an `answered` status additionally requires a Worker-resolved exact span from every cited source ID plus a substantive rationale; the reviewer selects source-scoped span IDs, which the Worker resolves only against fingerprint-verified text. A valid but unsupported review is downgraded. A one-word term in quotation marks is treated as terminology, while multiword quotations remain source-checked. None of these checks alone proves entailment, accuracy, or completeness.

Current model-call budget for seven all-books cases is 21 calls for with-review (one planner plus two answer calls per case), 14 for compose-only (one planner plus one compose call per case), and 28 for paired review ablation (one planner plus three answer calls per case). Part-facet recovery adds local corpus searches, not AI calls. The latest run recorded 14 answer-stage calls; planner usage is not included in the Worker usage field.

Deployment routing is verified from `hosting-poc/public-gateway.mjs`: public visitors use the evidence path unless `READER_PIPELINE=legacy`, while authenticated workflow requests always use the evidence path. The user showed `evidence-v2` in the production settings and reports deploying the Worker. This confirms intended configuration, but the repository and saved workflow artifact cannot independently establish the currently active Cloudflare deployment or variable value.

## What changed

- Added a structured question contract for resolved questions, intent, named source roles, requested parts, scope, and search facets. Planner outputs are normalized and book IDs are checked against the server catalog. Selected-book requests are canonicalized to the chosen book.
- Centralized catalog identity parsing for titles, authors, and editors. Edited collections such as *The Portable Nietzsche* stay eligible for Nietzsche author searches without treating Walter Kaufmann as the author.
- Moved browser and evaluation retrieval into the same `retrieveEvidence` implementation. Given identical planner output, allowlists, book scope, and corpus, both now use the same facet search, candidate ordering, page hydration limits, and final six-page selector. The browser cache and evaluator shard reader are only page-loader differences.
- Kept full fingerprint-verified page text and its hash separate from the short UI preview. The candidate answer composer receives complete pages within existing request/page bounds. Explicit Bible verse ranges carry a separate quote-eligible scope while surrounding verified text remains context only.
- The active `reader-evidence-v2` path uses one short answer paragraph per planned part, with citations bound to that part's candidate pages and named-work scope. It does not ask Gemma to emit claim IDs or exact evidence spans. The earlier structured-claim version was replaced after live traces showed that its format and recovery logic were too fragile.
- The active reviewed path uses two Worker answer calls: composition and per-part review. Compose-only uses one. There is no automatic composer regeneration or free-form rewrite after review. A malformed review can leave a citation-checked answer explicitly unverified/partial; unsupported parts stay visible as gaps.
- Citation IDs are checked against supplied source IDs and part scope. Quoted text in the answer is checked against a cited page, while one-word terms are treated as terminology. In the current evidence-v2 candidate, Worker-generated exact page spans and the review rationale feed the evidence map; its website/evaluator response shape remains unchanged. These checks establish provenance and review traceability, not semantic entailment.
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
| Worker search-planner suite: `node --test hosting-poc/search-planner.test.mjs` | 20 passed, 0 failed |
| Website evidence-search and scoped remote-library suites: `node --test reading-companion/evidence-search.test.mjs reading-companion/remote-library.scoped.test.mjs` | 63 passed, 0 failed |
| New regression coverage | Long exact quote bounded after verification; OCR ligature normalization; altered, non-contiguous, too-short, and oversized quotes rejected; contextual part-query and quoted-phrase link; relevant adjacent continuation; irrelevant adjacent page excluded |
| GitHub PR checks | Worker contract workflow [40149970497](https://github.com/jsynon/book-chatbot/actions/runs/40149970497) passed; website smoke [40149943090](https://github.com/jsynon/antilogicalism/actions/runs/40149943090) and library evaluation [40149943005](https://github.com/jsynon/antilogicalism/actions/runs/40149943005) passed |
| Fresh deployed reviewed run | Not run; this change did not spend live model calls |
| Reserved unseen acceptance suite | Still required for release confidence |

The fixes address several concrete failures exposed by run 40147644388, but do not establish that the live model will choose the right passage, preserve attribution/negation, or produce complete answers. After both PRs pass checks and merge, deploy the Worker and website, then run the same seven-question all-books reviewed holdout with visible progress. Inspect Hamlet's afterlife part, Kant's causal-necessity support, Herodotus's attribution, and every reviewer quote against the traced source page. If those results are stable, evaluate the reserved unseen acceptance set; the repeated holdout is regression evidence, not unseen acceptance evidence.


## October 25, 2026: fresh reviewed holdout after PRs #217 and #186

The user ran the seven-question all-books with-review workflow [40150160023](https://github.com/jsynon/antilogicalism/actions/runs/40150160023) after both focused PRs merged. The artifact records website source revision 156f955bfd782477a9fe072bc7eba271b281ee33 (the merge commit for PR #186), Worker version df24e0df-5033-4adb-8118-c4e7147f42bb, and pipeline reader-evidence-v2. The trace contains the updated reviewer contract allowing full exact contiguous quotes up to 2,000 characters, plus the requested concept/actor/action/polarity/qualification check. Thus this run exercised the intended website candidate and the active v2 review path.

All seven cases completed. There were zero request failures, planner fallbacks, or skipped cases; the run used the expected 21 Worker AI calls. The GitHub workflow concluded failure because only one case passed the structural gate, not because the workflow or model requests crashed. The case and part totals were:

| Metric | Run 40147644388, before focused fixes | Run 40150160023, after focused fixes |
|---|---:|---:|
| Structurally passed cases | 2 / 7 | 1 / 7 |
| Supported parts | 11 / 18 | 5 / 16 |
| Partial parts | 6 / 18 | 9 / 16 |
| Unsupported parts | 1 / 18 | 2 / 16 |
| Request failures | 0 | 0 |

The second run's 16 parts rather than 18 reflect the planner splitting some questions differently. These automated coverage numbers are not semantic quality scores. They worsened overall, but the traces show that the change corrected one narrow verifier limitation and that several of the new structural misses come from the reviewer producing invalid or incomplete evidence records.

### Independent draft scores

I reviewed the final displayed answers against the exact pages in the artifact. Scores use the existing 0–2 rubric: accuracy, question coverage, explanation quality, citation support, and citation completeness, in that order. They are independent of the automated structural outcome.

| Case | Accuracy | Coverage | Explanation | Citation support | Citation completeness | Assessment |
|---|---:|---:|---:|---:|---:|---|
| Herodotus and Helen | 2 | 2 | 2 | 2 | 2 | The answer gives the Egyptian account and Herodotus's reason for preferring it; the cited pages directly support both parts. This was the only structural pass. |
| Hamlet's soliloquy | 2 | 1 | 1 | 1 | 1 | The surviving paragraph accurately explains the endure-versus-resist choice. The answer omits the afterlife part, despite the primary page containing the “dread of something after death” and “undiscovered country” passage. |
| Aristotle on soul and body | 2 | 2 | 2 | 2 | 2 | The two paragraphs accurately explain actuality/form, matter/potentiality, the wax analogy, and the eye/sight example; the cited pages support them. |
| James on faith and works | 2 | 2 | 2 | 2 | 2 | The final text accurately covers faith, Abraham, and Rahab from the submitted NKJV page, including the OCR-normalized Rahab quotation. |
| Hume and Kant on causal necessity | 1 | 2 | 1 | 1 | 2 | Hume is well supported. Kant's paragraph names categories and a priori synthesis but does not establish Kant's argument for causal necessity; the submitted Kant pages are not the needed direct evidence. |
| Plato and Rousseau on political order | 1 | 2 | 1 | 1 | 2 | Rousseau is directly supported. Plato's cited pages support unity and shared interests among guardians, but the answer overstates these passages as establishing political legitimacy generally. |
| Wollstonecraft and Du Bois | 2 | 1 | 1 | 2 | 1 | The Wollstonecraft paragraph is accurate and cited. The final answer omits Du Bois, although the raw composition contained a relevant paragraph. |

No human scores were entered in the workflow artifact; the table above is my separate source-based review.

### What the trace shows about the fixes

The long-quote path is working when the model returns one exact contiguous quote. Herodotus's reviewer supplied quotes of 832 and 738 characters; the Worker verified them against the cited pages and stored short anchors. The James/Rahab quote also matched despite the source OCR spelling “jusƟﬁed.” This confirms that the active v2 path no longer has the old 320-character ceiling and that the Ɵ ligature normalization helped.

The fail-closed boundary also remains active. The reviewer continued to use ellipses to join separate text for Plato, Rousseau, James P1, and other parts, despite the prompt explicitly forbidding ellipses. Those stitched quotes were rejected. Aristotle P1 was downgraded because the reviewer did not provide a valid quote for every source cited by the part; its Aristotle P2 quote contained ellipses and was rejected. These are reviewer-output failures, not a reason to relax exact-source verification.

Hamlet exposed a distinct retrieval-to-part-link defect. The primary Hamlet page 152 was in the six-page packet and contains the afterlife reasoning verbatim. The source was tagged for P1 only, however, so the Worker rejected its use for P2 as source-not-linked-to-question-part. The reviewer then reported no evidence for the afterlife question. Retrieval found the needed passage; question-part eligibility failed to carry it through.

Wollstonecraft/Du Bois exposed a deterministic loss before review. Three relevant Du Bois pages were in the packet and linked to P2, and the raw composition included a paragraph with independently useful claims. `validatePartAnswers` audited the paragraph as one unit; one non-verbatim quoted phrase (`“double consciousness”` against a page spelling the term `double-consciousness`) caused it to reject the entire paragraph with `quotation-citation-mismatch`. The reviewer therefore received no Du Bois answer and marked P2 unanswered. The trace does **not** show the review boundary rejecting that paragraph.

The Kant issue remains a retrieval/selection and semantic-support failure. The planner search results included Kant, Critique of Pure Reason, page 86, but the six-page packet submitted pages 54, 24, and 157 instead. The answer therefore described categories and metaphysical synthesis generally; it did not explain the Second Analogy or establish causal necessity. The new prompt instruction did not ensure that the needed page survived selection.

### Next milestone

The run does not justify moving to the unseen acceptance set yet. It confirms the long exact-quote correction, while exposing three independent handoffs: part-focused retrieval facets did not make the Hamlet and Kant pages eligible for the relevant parts, and the Worker's pre-review quote audit discarded an entire Du Bois paragraph when one sentence failed. The source page and query result already existed for each retrieval miss; the problem was preserving their part association and selection. The reviewer itself remains a semantic quality risk, but it did not cause the Du Bois omission in this trace.

### Integrated handoff candidate (October 25)

The current candidate addresses those concrete failures across the website retriever and Worker:

- A focused planner query can associate its discovered page with a question part when it shares at least two distinctive terms with that part. This reuses existing searches, preserves the part's named-book scope, and does not treat the original question as evidence. Regression coverage reproduces the Hamlet afterlife page and keeps Kant's Second Analogy page in the bounded six-page packet.
- The Worker now asks for citations after each factual sentence and validates each sentence independently. A sentence with an invalid quote is dropped while neighboring sentences with valid source IDs and exact-quote checks survive. The exact quote verifier remains fail-closed; the existing maximum of two answer calls is unchanged.
- The `benchmarks/` and `data/` READMEs now distinguish the local Python/Ollama workbench from the deployed website workflows and accurately describe the local app's default book versus library-wide search.

Local validation passed: 221 Worker tests, 160 website tests, and `git diff --check` on both code candidates. The focused Du Bois regression confirms the valid surrounding sentences survive while the mismatched quoted sentence is removed. These are deterministic checks, not a new model evaluation. No live AI calls were made at that checkpoint; the post-merge live run is recorded below. Keep the unseen acceptance set reserved until a reviewed holdout demonstrates stable complete coverage and source support.

The Worker and README changes were merged in [PR #219](https://github.com/jsynon/book-chatbot/pull/219) at 02:01:45 UTC; the retrieval and part-scope changes were merged in [website PR #187](https://github.com/jsynon/antilogicalism/pull/187) at 02:01:57 UTC.

## October 25, 2026: reviewed holdout after PRs #219 and #187

The user ran the seven-question all-books with-review workflow [40152944637](https://github.com/jsynon/antilogicalism/actions/runs/40152944637) after both code PRs merged. It completed all seven cases with zero request failures, planner fallbacks, or skipped cases, using the expected 21 Worker calls. GitHub marked the workflow failed because its structural gate passed only 2/7 cases; the workflow and model requests completed normally. Human-review scores in the artifact remain blank.

The artifact records website revision `2ad2ff13d23aba2bb5a6812336cf6caa295aed71`, one commit after the merge of PR #187, and Worker version `bc8e68c7-eb47-4b08-b1a4-6f1e22ee68b4` (source build label `public-gateway-evidence-selection-v3`). The Worker version differs from the prior run, although the artifact does not expose a source commit for that Worker UUID. This is strong evidence the revised paths were exercised; the exact Worker source commit cannot be proven from this artifact alone.

| Metric | Run 40150160023 | Run 40152944637 |
|---|---:|---:|
| Structural passes | 1 / 7 | 2 / 7 |
| Supported parts | 5 / 16 | 9 / 17 |
| Partial parts | 9 / 16 | 8 / 17 |
| Unsupported parts | 2 / 16 | 0 / 17 |
| Request failures | 0 | 0 |

This is measurable progress: four more parts reached `supported`, no part was left `unsupported`, and the case pass count doubled. It is not release-ready. The eight partial parts all had a review-evidence contract issue, even where the final answer prose and cited page appeared relevant.

### What the critical traces show

- **Hamlet:** The afterlife answer now appears, and page 152 of *Elizabethan Drama* is linked to P2 and cited. The previous retrieval-to-part handoff failure is resolved in this run. P2 is still partial because the reviewer did not supply an exact quote the Worker could verify: one quote came from another page, and the primary-page quote reproduced OCR-spaced text such as “N o” and “A n d.” The displayed answer otherwise explains the fear of the unknown after death and its effect on action.
- **Kant:** Page 86 of *Critique of Pure Reason* is now in the six-page packet and is cited for Kant's P2 answer. The reviewer marked that part supported. This resolves the specific page-selection miss from run 401501. The Hume/Kant synthesis remains partial because the reviewer did not provide verifiable support for every source cited in P3; the trace also records one uncited draft sentence being removed.
- **Du Bois:** The P2 paragraph survives in the final answer, including the “double life,” painful self-consciousness, and its effects. This confirms the whole-paragraph loss is fixed. P2 remains partial because the reviewer supplied one quote stitched across separated text with ellipses; the strict exact-contiguous quote check correctly rejected it. Wollstonecraft P1 is partial for the same review-support reason on one cited source.
- **Aristotle:** Both requested parts are present and the prose tracks the cited definitions and analogies. The reviewer gave a valid quote for one source per part but used ellipses to combine separated passages from the other cited page. The Worker therefore downgraded both parts rather than treating the stitched text as exact evidence.
- **James:** Both paragraphs directly summarize James 2:14–26, including faith and works, Abraham, and Rahab, with citations to the NKJV page containing those verses. The reviewer joined noncontiguous verse text with ellipses for both parts, so neither received a verified review quote and both remain partial.
- **Herodotus and Plato/Rousseau:** These are the two structural passes. Both cover every planned part and have exact review quotes tied to the cited source pages.

Across the eight partial parts, four failed because the reviewer supplied no exact support quote, and four because at least one cited source lacked a valid exact quote. In these traces the cause is mostly reviewer output that is stitched, OCR-altered, or incomplete, not the earlier retrieval omissions. The fail-closed quote verifier is behaving as designed; accepting ellipses or weakening source matching would make the citations less trustworthy.

### Independent draft scores

I reviewed the displayed answers against the submitted page text. These are separate from the artifact's automated statuses and blank human rubric. Scores are 0–2 in this order: accuracy, question coverage, explanation quality, citation support, citation completeness.

| Case | Scores | Assessment |
|---|---|---|
| Herodotus and Helen | 2 / 2 / 2 / 2 / 2 | The Egyptian account and Herodotus's reason for preferring it are distinguished and supported by the cited pages. |
| Hamlet's soliloquy | 2 / 2 / 2 / 1 / 2 | The answer covers both parts. The primary page supports the reasoning, but the response also cites a Shakespeare page unrelated to this soliloquy. |
| Aristotle on soul and body | 2 / 2 / 2 / 2 / 2 | The actuality/form relation and form–matter analogies are explained clearly and cited to the relevant *De Anima* pages. |
| James on faith and works | 2 / 2 / 2 / 2 / 2 | Both claims and examples are directly present in the cited James passage; the partial machine status comes from the reviewer's stitched quotes. |
| Hume and Kant on causal necessity | 2 / 1 / 2 / 2 / 2 | The answer presents the contrast and cites relevant pages, but Kant's account remains comparatively general and the synthesis is less fully evidenced by the reviewer. |
| Plato and Rousseau on political order | 2 / 2 / 2 / 2 / 2 | The answer explains the ruler/common-good connection in Plato and sovereignty/general will in Rousseau, with direct citations. |
| Wollstonecraft and Du Bois | 2 / 2 / 2 / 2 / 2 | Both sides are now present and well supported by their cited pages; exact reviewer evidence still failed for one source on each part. |

### Next milestone

Do not run paired ablation or the unseen acceptance suite yet. The latest holdout demonstrates that the two retrieval/selection changes work on their target cases and that sentence-level salvage preserves useful prose. The remaining bottleneck is the reviewer returning one or more short, contiguous, source-verbatim quotes for every cited source in each part. Inspect the exact reviewer prompt and response constraints against the four no-quote and four missing-source cases, then make one general change that improves this evidence handoff without loosening quote verification or adding AI calls. After that candidate is merged and deployed, rerun the same reviewed holdout once; keep the unseen acceptance set reserved until coverage and source support hold across all seven cases.

## October 25, 2026: deterministic reviewer-span handoff candidate

The post-merge seven-question run [40152944637](https://github.com/jsynon/antilogicalism/actions/runs/40152944637) showed that the Worker correctly rejected OCR-altered, wrong-page, and ellipsis-stitched quotes, but copied quote text remained a fragile interface: eight parts were partial because the reviewer did not return verifiable quote text for every cited source. PR #220 changes this handoff without weakening source checks or adding a model call.

For the active `reader-evidence-v2` path, the Worker splits each cited fingerprint-verified page (or verse-scoped support text) into bounded exact spans and assigns source-scoped IDs such as `S1-Q2`. The reviewer returns IDs only. The Worker accepts a selected ID only if it belongs to the exact supplied source and the answer part cites that source, then resolves it to the original source substring. Invented IDs, cross-source IDs, uncited pages, and copied quotations without IDs cannot become review evidence. An `answered` decision still requires a selected span from every cited source, a substantive rationale, and the existing comparison-source-group check. Partial and unanswered outcomes remain supported.

The resolved spans flow through the existing `evidenceMap` and `evidenceHighlights` fields as verbatim text. The website renderer and evaluator contracts therefore remain unchanged. With-review remains two answer calls; compose-only remains one. The explicit legacy rollback route retains its separate quote-based contract. This is provenance and auditability work, not proof of semantic entailment; the reviewer may still choose a real but irrelevant span, so live traces must be inspected.

| Validation | Result |
|---|---|
| Worker suite: `node --test hosting-poc/*.test.mjs` | 223 passed, 0 failed |
| Website suite: `node --test reading-companion/*.test.mjs` | 160 passed, 0 failed |
| GitHub Worker contract workflow | [Run 40154847989](https://github.com/jsynon/book-chatbot/actions/runs/40154847989) passed on the current PR #220 head |
| New regressions | Exact span resolution; invented and cross-source ID rejection; verbatim OCR text; verse-scoped support; authenticated evidence-v2 route and unchanged call count |
| `git diff --check` and Worker syntax checks | Passed |
| Fresh deployed reviewed holdout | Pending; no model calls were made for this candidate |

After PR #220 was merged and deployed, the user reran the same seven-question all-books with-review workflow. The run and the next focused handoff candidate are recorded below.

## October 25, 2026: post-PR #220 reviewer-handoff run and follow-up

The user ran the seven-question all-books with-review workflow [40155204645](https://github.com/jsynon/antilogicalism/actions/runs/40155204645) after merging and deploying PR #220. The artifact completed all seven cases using Worker `423ffc3d-5505-495e-8f96-b8883012ba0c`, source build `public-gateway-evidence-selection-v3`, and website revision `61c6022bd063025ff8e01d93e484f6c11862c69b`. It used the expected 21 Worker AI calls, with zero request failures, planner fallbacks, or skipped cases. GitHub marked the workflow failed because two answers did not meet the structural evidence gate.

The result improved from run 40152944637: structurally complete answers rose from 2/7 to 5/7, and supported parts rose from 9/17 to 16/18. The part denominator changed because the planner split the James question into three parts in this run instead of two; use case-level passes as the cleaner comparison. Hamlet, Aristotle, and James moved from partial to full. Herodotus and Plato/Rousseau stayed full. Hume/Kant and Wollstonecraft/Du Bois remained partial. The artifact's own five-dimension human-review fields remain blank.

| Case | Automated result | Trace finding |
|---|---|---|
| Herodotus / Helen | Full | Both planned parts have reviewed source spans and complete citations. |
| Hamlet | Full | Both the alternatives and afterlife-uncertainty parts are supported. |
| Aristotle | Full | The soul/body relation and form/matter comparison are supported. |
| James | Full | The planner split this into three supported parts: faith/works, Abraham, and Rahab. |
| Hume / Kant | Partial | The three source-specific/comparison parts were planned. The comparison answer cites Hume page S2, but the reviewer selected no S2 span for P3; the Worker correctly records `missing-cited-source-span`. |
| Plato / Rousseau | Full | Four parts are supported, with evidence from both works. |
| Wollstonecraft / Du Bois | Partial | Du Bois is supported. For Wollstonecraft P1, the reviewer selected S1, S4, and S6 spans, but the final map omitted S6. |

The Wollstonecraft trace exposed a Worker-side truncation: `normalizeReview` added up to three spans from each early source, then stopped at six total spans before preserving the reviewer's selected span from the later cited S6 source. The Hume/Kant trace is different: the reviewer response itself omitted S2 from P3 even though the answer cited it. The existing strict validator therefore downgraded P3 as intended. These failures should not be collapsed into a single source-specific exception or hidden by loosening the validator.

The follow-up candidate in this branch makes two general changes in `hosting-poc/evidence-answer.mjs`:

- Each review part now carries a deterministic `requiredSourceIds` list derived from its answer citations. The reviewer prompt explicitly requires a relevant selected span for every listed source and directs it to mark the part partial if a source has no relevant span. The Worker keeps the existing strict validation, so an omitted source still fails closed.
- Review normalization first preserves one reviewer-selected span for each cited source, then spends remaining slots from the existing six-span per-part map budget on additional spans. It resolves only IDs the reviewer actually selected; it does not fabricate or copy evidence between parts.

The candidate adds trace-based contract regressions for the Hume/Kant omission and Wollstonecraft's late-source span, including checks that missing Hume evidence remains partial and that a selected S6 span reaches both the final evidence map and highlights. Replaying the two actual run-40155204645 traces through this candidate, with the saved model responses and source text and no new model calls, confirms the distinction: Wollstonecraft now has full evidence coverage, while Hume/Kant remains partial because the saved reviewer response still omits S2 for P3. The new required-source checklist may change a future live reviewer response; this replay cannot establish that. The candidate keeps the existing two answer-stage calls and adds no model calls.

| Validation | Result |
|---|---|
| Targeted Worker answer suite: `node --test hosting-poc/evidence-answer.test.mjs` | 28 passed, 0 failed |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 225 passed, 0 failed |
| Website companion suite: `node --test reading-companion/*.test.mjs` in the website worktree | 160 passed, 0 failed |
| Worker/website shared reader contract files | Byte-identical |
| JavaScript syntax and `git diff --check` | Passed |
| GitHub checks | PR #221 Reading Companion v1.4.6 contracts workflow passed: [run 40156797965](https://github.com/jsynon/book-chatbot/actions/runs/40156797965) |

My separate source-based draft scores for run 40155204645 use the agreed 0–2 scale, in order: accuracy / question coverage / explanation quality / citation support / citation completeness. They are not artifact scores:

| Case | Scores | Assessment |
|---|---|---|
| Herodotus / Helen | 2 / 2 / 2 / 2 / 2 | The priests' account and Herodotus's reasoning are clearly distinguished and supported. |
| Hamlet | 2 / 2 / 2 / 2 / 2 | The alternatives and the effect of uncertainty about death are both explained with relevant citations. |
| Aristotle | 2 / 2 / 2 / 2 / 2 | The answer explains actuality/form and the body as matter, including the wax and eye analogies. |
| James | 2 / 2 / 2 / 2 / 2 | Faith/works and the Abraham and Rahab examples are directly addressed. |
| Hume / Kant | 1 / 1 / 1 / 1 / 1 | The Hume account is strong, but the comparison's source mapping is incomplete and Kant's causal-necessity grounds remain comparatively thin. |
| Plato / Rousseau | 2 / 2 / 2 / 2 / 2 | The answer gives distinct accounts of legitimacy and their relation to the common good. |
| Wollstonecraft / Du Bois | 2 / 2 / 2 / 1 / 1 | The answer is substantively strong, but the final evidence map omits a selected cited source for Wollstonecraft. |

The next validation should be the same seven-question reviewed holdout after this candidate merges and the Worker is deployed. It should confirm that all selected source spans survive in the final per-part evidence map and that the reviewer returns evidence for every source named in each answer part. Do not move to the unseen acceptance suite until those checks and independent semantic review are stable. If the reviewer still omits Hume S2, keep that part partial and investigate its prompt/evidence selection behavior; do not treat the presence of S2 in another question part as automatic proof for the comparison.


## October 25, 2026: reviewed holdout and James scripture retrieval correction

The user ran the seven-question all-books with-review workflow [40157017806](https://github.com/jsynon/antilogicalism/actions/runs/40157017806) after Worker PR #221 and website PR #187 were merged and deployed. The workflow completed all seven cases with zero request failures, planner fallbacks, or skipped cases. Six of seven cases passed the structural gate; the report counted 15 supported parts and three unsupported parts. Hume/Kant and Wollstonecraft/Du Bois completed, consistent with the Worker evidence-map changes. The remaining James case had no linked evidence for the planned parts, so the Worker safely returned an abstention. This was a retrieval/handoff failure, not a composer outage.

The exact trace shows the causal chain:

- The main question asks about “James 2:14–26.” The full-question facet found the requested NKJV Bible page (Book ID 335, page 5493), but at rank six.
- The planner's natural-language part queries for Abraham and Rahab omitted the scripture reference. In all-books mode, the bare name “James” caused those searches to target William James; neither part received a Bible candidate link.
- The Bible page did not survive into the bounded hydrated candidate set, leaving both relevant parts with no answer sources. The Worker correctly abstained rather than inventing a source-backed response.

Website PR [#188](https://github.com/jsynon/antilogicalism/pull/188) addresses this at the retrieval-to-part handoff. When the original question contains exactly one explicit Bible reference, unscoped part queries inherit that reference for retrieval; their original wording remains in place for part-link checks and the inherited scope is exposed in bounded search diagnostics. Relevant direct-question results are reserved during facet merging when their retrieved page text overlaps a planned part, which preserves the rank-six NKJV page within the existing candidate and answer-source budgets. For a scripture-scoped question, a matching unannotated Bible page is preferred among qualifying direct-question results. Explicit selected-book scopes remain authoritative, and questions containing multiple references do not inherit an ambiguous scope.

The regression reproduces the artifact's ranking and routing pattern: the NKJV page is absent from stronger unrelated facet results but present at rank six in the direct-question results; the rewritten P2/P3 searches otherwise return William James pages. With the correction, the NKJV page survives the bounded candidate set, links to P1/P2/P3 from its page text, and reaches the Worker answer packet. William James does not become linked evidence. This is a deterministic saved-trace-shaped replay, not a new model answer or proof of semantic quality.

| Validation | Result |
|---|---|
| Website suite: `node --test reading-companion/*.test.mjs` | 161 passed, 0 failed |
| Changed module syntax checks and `git diff --check` | Passed |
| Saved-trace-shaped retrieval replay | NKJV page retained and linked to the matching parts; no William James link |
| GitHub PR #188 checks | Website smoke [40158758745](https://github.com/jsynon/antilogicalism/actions/runs/40158758745) and production retrieval evaluation [40158758766](https://github.com/jsynon/antilogicalism/actions/runs/40158758766) passed |
| Added AI calls or answer-source budget | None |
| Live deployed answer quality | Pending merge/deploy and a fresh reviewed holdout |

At that point, the next step was to merge website PR #188, let Pages publish, and rerun the same seven-question all-books with-review workflow with visible progress. The following run and its new failures are recorded below.

## October 25, 2026: post-PR #188 reviewed holdout and shared retrieval fix

After merging PR #188, the user ran the seven-case all-books with-review holdout [40158981841](https://github.com/jsynon/antilogicalism/actions/runs/40158981841) on website revision `c325d32b176cf0f536afaec4c218f649bff17304` and Worker version `7edb8da2-5c3e-4240-a01d-1e75dbebd5e6`. All seven cases completed with no request failures, planner fallbacks, or skipped cases. The structural gate passed 6/7; all 17 question parts were marked supported, but the workflow's human review remained pending for all seven answers. The run estimated 21 Worker calls: one planner and two answer-stage calls per case. The 14 answer-stage calls used 76,564 input tokens, 4,587 output tokens, and 821.14 neurons; planner usage is not included in those answer-stage totals.

The only structural miss was Hamlet. The expected source group was Shakespeare books 212 and 564. Those books were retrieved, but neither was cited; the six-page answer packet instead included Voltaire's anthology (book 552, p. 140), which reproduces the soliloquy. The focused Shakespeare search had also returned *Elizabethan Drama* p. 152 at rank six, with the soliloquy's decisive lines, but that page did not reach the answer packet. This is a source-aware candidate-selection and part-scope failure, not a missing-text or Worker outage.

Hume/Kant passed the structural gate, but that does not establish semantic completeness. Hume's *Enquiry* evidence on constant conjunction and custom was direct. The answer cited Kant's *Critique of Pure Reason*, p. 58, for the need to justify the pure concepts of understanding, but did not explain Kant's positive argument for the necessity of causal judgments. The corpus's *Second Analogy* (pp. 98–104) explains that objective succession requires a rule connecting cause and effect; none of those pages reached the six-page packet. The planner prompt already requested the *Second Analogy*, but the saved planner query omitted it and retrieval returned general deduction passages instead.

Website PR [#189](https://github.com/jsynon/antilogicalism/pull/189) addresses these two traces in shared retrieval logic:

- Part-specific facets now retain up to two high-ranked pages per catalog-resolved source, rather than spending the reservation on two pages from the first source returned. When the planner leaves a part's source IDs blank, retrieval carries forward the catalog IDs resolved from that part's own focused query. The same resolved scope governs part eligibility, so a global quotation from a secondary anthology cannot stand in for a requested Shakespeare source.
- When searching Kant's named *Critique of Pure Reason* for causality, local lexical search also uses the work's source-native terms—*Second Analogy*, succession, rule, cause/effect, experience, and objective. It retains the reader's query and stays within the existing search and answer flow.

The answer packet remains capped at six full pages, the request-byte and verified-text limits are unchanged, and the source fingerprint/citation checks remain in force. No model or retry calls were added. Regression tests use the saved Hamlet retrieval pattern and the corpus wording of the *Second Analogy*; they verify that Shakespeare p. 152 survives to the packet, the Voltaire page cannot satisfy the scoped Hamlet parts, and the direct Kant passage outranks the generic deduction passage. These deterministic checks do not establish what the live planner or composer will produce after deployment.

| Validation | Result |
|---|---|
| Focused retrieval, citation-scope, and source-index tests | 72 passed, 0 failed |
| Full website Reading Companion suite: `node --test reading-companion/*.test.mjs` | 163 passed, 0 failed |
| Existing scripture, Hume/Kant, named-work, and source-budget regressions | Passed |
| Additional model calls or answer-packet pages | None; existing two-call reviewed path and six-page limit retained |
| Fresh deployed seven-case all-books with-review run | Pending; required to assess the 7/7 milestone and semantic quality |

The next step was to merge website PR #189 and rerun the full seven-question all-books with-review holdout after Pages published. The October 25 run below records that validation.

## October 25, 2026: first post-PR #189 seven-case reviewed holdout

After PR #189 merged, the live answer-evaluation workflow ran [#40161350052](https://github.com/jsynon/antilogicalism/actions/runs/40161350052) against website revision `91a0749e2d97fabf3e3344def7b9901490692596` and Worker version `1cf155d3-db05-4998-9853-3536c1a2ee69` (`public-gateway-evidence-selection-v3`). This is the first all-books, with-review seven-case holdout on the merged retrieval fix.

All seven cases completed: **7/7 structural pass**, 17/17 question parts marked supported, no request failures, planner fallbacks, or skipped cases. Each answer used two answer-pipeline calls; the workflow estimated 21 calls total, including one planner call per case. The 14 answer-pipeline calls used 77,038 input tokens, 4,537 output tokens, and 824.08 neurons; those usage figures do not include planner usage. All seven automated review contracts were valid. The artifact's separate human-review fields remain pending (0 reviewed, 7 pending), so this establishes structural completion, not the final semantic-quality gate.

The two targeted retrieval failures are resolved in this live run:

- **Hamlet:** the answer cites Shakespeare book 212, pp. 453–454, and *Elizabethan Drama* book 564, p. 152. Both expected Shakespeare source IDs were retrieved and cited. The cited p. 152 contains the alternatives and the death/unknown-dream passage; the prior run instead cited Voltaire's reproduction and failed the source-group gate.
- **Hume/Kant:** the answer cites Hume's *Enquiry* (book 35, pp. 23 and 38) and Kant's *Critique of Pure Reason* (book 40, pp. 104 and 218). Page 104 now supplies the Second Analogy account of temporal succession under a causal rule and its role in possible experience. Both named source groups are linked to their own supported parts; the prior run's Kant packet contained only a general deduction page.

The other cases also passed their structural checks: Herodotus (book 149, pp. 144, 146–147); Aristotle's *De Anima* (book 4, pp. 15–17); James 2:14–26 (NKJV book 335, p. 5493); Plato/Rousseau (books 74 and 245, pp. 125, 176, 24, and 43); and Wollstonecraft/Du Bois (books 87 and 454, pp. 125, 138, 131, and 143). All expected named-work groups were cited in the three cross-work comparisons. The Plato/Rousseau trace carries a `part-query-budget-exceeded` warning, but all four parts still have cited mapped evidence and both source groups align; monitor this cap warning rather than treating that case as a structural failure.

The saved drafts still need semantic review before calling the quality milestone complete. In particular, Aristotle's answer states that the soul is inseparable from the body, while its cited passage qualifies that “certain parts” are inseparable; preserve that qualification. The Hume/Kant draft now has the direct Kant passage but also adds a page 218 claim about reason's faculty of causality that appears to concern a distinct Kantian issue and should not be conflated with theoretical causal necessity. The Wollstonecraft/Du Bois answer is well sourced but mostly juxtaposes the two accounts instead of making their comparison explicit. These are draft-review findings, not additional retrieval failures.

| Validation | Result |
|---|---|
| Run #40161350052: all-books, with-review, seven cases | 7/7 structural; 17/17 parts supported |
| Request failures / planner fallbacks / skipped cases | 0 / 0 / 0 |
| Worker AI-call estimate | 21 total; 14 answer-stage calls (two per case) |
| Hamlet source-group routing | Shakespeare books 212 and 564 retrieved and cited; p. 152 cited |
| Hume/Kant named-source alignment | Both works cited; Kant p. 104 supplies the Second Analogy evidence |
| Automated review-contract validity | 7/7 valid |
| Human rubric entries in artifact | 0 reviewed; 7 pending |
| Next milestone | Review factual accuracy, part coverage, explanation, citation support, and citation completeness; structural 7/7 alone does not close semantic quality |

Next, hold the retrieval implementation steady while reviewing these seven saved drafts and traces against the cited passages. Keep the two scoped issues above visible, check the Plato/Rousseau query-budget warning, and test a fresh reader-authored live question such as “What is transcendental idealism?” The acceptance milestone requires both a stable 7/7 structural run and answers that are accurate, sufficiently explanatory, and fully supported by the cited pages. Keep the unseen acceptance suite reserved until those quality checks are satisfied.


## October 25, 2026: five-question focused run and source-scope correction

The latest five live cases were all-books, with-review runs on Worker source build public-gateway-evidence-selection-v3. The first four used quality with one focused case selected; the last used focused with one case selected. All five requests completed with no planner fallback or skipped planning. Two passed structural coverage (Kant and sunyata); three were partial (Kierkegaard on faith, Nietzsche on Christianity, and Nietzsche on Kierkegaard). The human semantic rubric remains unscored in the artifacts, so this is a diagnosis of answer structure and evidence flow, not a truth or quality score.

| Case | Run | Structural result | Main finding |
|---|---|---|---|
| Kant: transcendental idealism | [40164524550](https://github.com/jsynon/antilogicalism/actions/runs/40164524550) | Pass | Both parts were supported and cited from *Prolegomena*, p. 22. This is a useful control, though structural pass does not certify every interpretation. |
| Kierkegaard: faith | [40164827676](https://github.com/jsynon/antilogicalism/actions/runs/40164827676) | Partial, 2/3 parts | The shared plan normalization narrowed each author-wide faith part to book 436 (*Attack Upon “Christendom”*) because the catalog work title contains “Kierkegaard.” Relevant pages from *Fear and Trembling* and *Philosophical Fragments* reached the packet with empty part links, so the Worker could not use them for the missing movement-of-faith part. |
| Nietzsche: Christianity | [40164925542](https://github.com/jsynon/antilogicalism/actions/runs/40164925542) | Partial, 2/3 parts | The planner added nihilism as a separate required part to a broad question about Christianity, then left it unsupported. This is avoidable coverage debt from over-decomposition. |
| Sunyata | [40165032709](https://github.com/jsynon/antilogicalism/actions/runs/40165032709) | Pass | Both parts had evidence links and citations from Nishida and *The Teaching of Buddha*. Review the cited text semantically before treating the broad definition as established. |
| Nietzsche on Kierkegaard | [40165202141](https://github.com/jsynon/antilogicalism/actions/runs/40165202141) | Partial, 1/2 parts | The planner kept only Nietzsche in its source plan and both parts' allowed book IDs. A *Fear and Trembling* page reached retrieval and submission but had no part link; the final answer cited Nietzsche alone. A cross-source inference was therefore impossible to support. |

The Worker candidate fix addresses these causes in the shared contracts and planner:

- Author-level question parts now narrow to a book only when the question contains a distinctive work phrase. The author name alone cannot select a title that happens to contain it. The website's matching reader-contract copy is updated with the same behavior.
- The planner preserves both explicitly named authors in a counterfactual “what would A think of B?” question, retains its semantic query terms, and marks the plan as comparative. The normalized plan adds a synthesis part linked to both authors' books. Composition guidance requires evidence for both positions and labels any conclusion as an inference, not a historical exchange.
- The planner prompt now discourages turning adjacent themes, consequences, or background into mandatory answer parts unless the reader asked about them. Existing missing-part behavior remains strict: unsupported requested parts stay partial and visible.

These changes reuse the existing planner, composition, and review calls; they add no model calls and do not raise the six-page answer-packet limit. The focused five-case run is already available as one workflow job: select focused, case ID all, All Books, and with-review. The single-case runs above did not test the all-five dispatch.

| Validation | Result |
|---|---|
| Full Worker suite (`hosting-poc/*.test.mjs`) | 227 passed, 0 failed |
| Full website suite (`reading-companion/*.test.mjs`) | 169 passed, 0 failed |
| Worker/website shared reader contract copies | Byte-identical |
| Model calls and answer-source budget | Unchanged; no extra calls or pages |
| Fresh live five-case focused run after merge/deploy | Pending |
| Semantic review of the five saved answers and cited passages | Pending |

That combined run is recorded in the next section.

## October 25, 2026: five-case focused run and end-to-end handoff findings

After PR #226 (Worker) and PR #192 (website) merged, the user ran the five-case all-books, with-review suite together in focused mode: [run 40167280477](https://github.com/jsynon/antilogicalism/actions/runs/40167280477). All five requests completed with no request failures, planner fallbacks, or skipped cases. The run estimated 15 Worker calls (one planner plus composition and review per case) and 696.5 neurons. The structural gate passed 2/5: Kant and sunyata passed; Kierkegaard/faith, Nietzsche/Christianity, and Nietzsche/Kierkegaard were partial. Artifact human-rubric fields were not populated, so this is structural and trace evidence, not a scored semantic evaluation.

This run confirms that the author-scope and two-author planning changes from PR #226 are active in the saved trace: Kierkegaard's author-wide source group was retained across books 140, 192, 253, and 436, and the hypothetical Nietzsche/Kierkegaard plan retained both named authors. The earlier single-case diagnosis that those source groups were being dropped no longer describes this run. The remaining failures occur later in the pipeline:

| Case | Result | Trace finding |
|---|---|---|
| Kant: transcendental idealism | Pass | The answer's two planned parts have source citations and aligned highlights. |
| Kierkegaard: faith | Partial, 2/3 parts | The planner still promotes “specific examples or conditions” into a required third part. For the part about the transition from probability to faith, the reviewer receives S5-Q9 from *Philosophical Fragments*, p. 55, whose text directly addresses that relation, but returns no S5 span and reports no evidence. This is a reviewer selection miss, not missing retrieved text. |
| Nietzsche: Christianity | Partial | The planner still makes will-to-power/slave-revolt discussion a separate required part and the answer overstates a connection among will to power, freedom, and herd formation. These themes are context for the broad Christianity question unless the reader separately asks for them; the cited text must not be made to prove a stronger relation than it states. |
| Sunyata | Structural pass | The evidence map contains relevant approved spans from Nishitani, p. 224, and Nishida, p. 48, but the public highlights show different snippets from those same pages. The gateway reads `anchorQuote`, while evidence-v2 writes the exact approved span under `quote`; it therefore falls back to a topical preview. |
| Nietzsche on Kierkegaard | Partial | Both author groups survive planning, but one Nietzsche query mixes both names and returns no usable Nietzsche passage; the other query retrieves Kierkegaard only. The plan also attaches both author groups to side parts, so query ownership and part scope are not yet aligned. A hypothetical response needs Nietzsche's own relevant position, Kierkegaard's own position, and a two-source synthesis; if either side is absent, the answer must label the inference as ungrounded rather than imply an historical response. |

The current paired Worker/website candidate fixes these connected contracts as one milestone:

- `reader-contract.mjs` now normalizes a broad one-author question such as “What did Nietzsche think about Christianity?” to one central coverage part, while retaining distinct planner search queries as retrieval leads. Explicitly requested multiple facets remain separate parts.
- A counterfactual two-author question is normalized into a stance-author part, an object-author part, and one synthesis/inference part. Query names are sanitized so each source-side query targets its corresponding author's catalog group only. The website's `partQuestions` source IDs then restrict candidate eligibility to those same groups; the synthesis can reuse the two side searches without a new generic search.
- Reviewer spans remain exact, stable, and all present in the prompt, but deterministic term overlap puts spans most relevant to the cited answer sentence and part question first. The review prompt explicitly asks the model to inspect those spans before declaring evidence absent. This addresses the faith trace without changing the reviewer's authority or converting lexical overlap into a support decision.
- Public highlights now accept the evidence-v2 `quote` field (while retaining the legacy `anchorQuote` shape) and continue requiring `quoteVerified === true`. The selected exact reviewer span can therefore be displayed instead of a fallback excerpt.

The candidate adds no model calls, does not increase the six-page answer packet, and does not relax citation, source-scope, fingerprint, reviewer-span, or comparison-source checks. It changes interpretation normalization, search ownership, reviewer evidence ordering, and response rendering together so the same evidence identity stays connected from question part through visible highlight.

| Candidate validation | Result |
|---|---|
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | 229 passed, 0 failed |
| Full website suite (`node --test reading-companion/*.test.mjs`) | 170 passed, 0 failed |
| Worker/website shared `reader-contract.mjs` | Byte-identical after synchronization |
| JavaScript syntax checks and `git diff --check` | Passed in both repositories |
| Worker PR #227 contract workflow | [Run 40168651429](https://github.com/jsynon/book-chatbot/actions/runs/40168651429) passed |
| Website PR #193 smoke workflow | [Run 40168668807](https://github.com/jsynon/antilogicalism/actions/runs/40168668807) passed |
| Model-call budget and answer packet | Unchanged: two answer calls with review; six-page maximum |
| Fresh five-case reviewed holdout after merge and deployment | Pending; both PR checks pass, but the fixes are not yet merged/deployed. The rerun must determine whether the reviewer selects S5-Q9, highlights match the evidence map, and source-scoped questions improve |
| Unseen acceptance suite and final semantic milestone | Reserved until the same focused holdout and cited-passage review support promotion |

At the time this candidate was prepared, PR #227 in `book-chatbot` and paired website PR #193 in `antilogicalism` had passed checks but had not yet been merged or deployed. The following section records the user's merge, deployment, and live validation.

## October 25, 2026: post-merge five-case run and claim-level evidence handoff

After PR #227 and website PR #193 merged, the user ran the five-question all-books with-review workflow [40168960976](https://github.com/jsynon/antilogicalism/actions/runs/40168960976). The website source revision was `a67b9b5eb2d3f9d102169ece41693c3b75f679da`; the Worker build was `public-gateway-evidence-selection-v3`. All five requests completed with no request failures, planner fallbacks, or skipped cases. The run used the existing 15-call estimate (one planner plus composition and review per case). The structural result was 3/5: Kant, Kierkegaard's faith, and Nietzsche on Christianity passed; Sunyata and Nietzsche-on-Kierkegaard did not. The artifact did not contain human rubric scores, so 3/5 is a structure-and-handoff result, not a semantic-quality score. A subsequent run, [40169083831](https://github.com/jsynon/antilogicalism/actions/runs/40169083831), was cancelled after 30 seconds and provides no validation evidence.

Trace inspection showed three distinct defects:

- **Unrequested coverage inflation:** the direct definition “What is Sunyata?” was expanded into a second required part about how Sunyata operates. A sound definition answer therefore could not pass full structural coverage. The user had observed the same class of issue earlier with the transcendental-idealism question. A single-concept definition should remain one required part unless the reader explicitly coordinates another question.
- **Two-author search corruption and packet loss:** the Nietzsche/Kierkegaard planner produced author-side queries containing detached possessive fragments (`Nietzsche s … of s religious existentialism` and `Kierkegaard s … individual s relationship`). Retrieval did not produce a useful Nietzsche source; the six-page browser packet retained Kierkegaard evidence but no usable Nietzsche page, so the inference was correctly withheld. Query ownership was already present; the remaining defect was malformed query cleanup and source-packet balancing for a hypothetical cross-author question.
- **Part-level evidence hid a sentence-level mismatch:** Kierkegaard's faith answer passed structurally, but the reviewer selected an S5 passage about the movement of infinity and faith through the absurd for a part that also contained claims about inwardness and the individual's relation to the absolute. Because evidence was attached to the whole part, that trace did not show which sentence the exact quote supported. The selected quote was authentic, but the handoff could not justify every neighboring sentence.

The follow-up candidate addresses these as linked pipeline contracts, without adding model calls or broadening the answer packet:

- The shared Worker/browser reader contract collapses a plain “What is X?” or “Define X” plan to one required coverage part, while preserving explicitly requested coordinated facets such as “What is X and how does it work?” This avoids treating optional planner elaborations as reader requirements; retrieval can still use separate search leads.
- Worker counterfactual query cleanup removes author names and detached possessive suffixes before author-scoped searches are formed. The website packet selector recognizes a question asking what one named author would think about another as a two-author comparison and reserves a candidate from each author group when available. Both changes reuse existing query and candidate budgets.
- The composer’s already-cited sentence units receive deterministic IDs such as `P1-C1`. The existing review call must now decide support and select exact, source-scoped span IDs for each sentence separately. The Worker accepts a sentence only when each source that sentence cites has a valid selected span; a reviewer-partial or unsupported sentence is omitted while independently supported sentences may remain with partial coverage. The evidence map uses that sentence's own claim ID and text as its point, and the same verified span continues to drive the visible highlight. If the reviewer returns the previous part-only schema, the checked composer draft is retained only as explicitly unverified rather than being presented as reviewed.
- The five-case evaluator's existing stage progress and 15-second startup heartbeat remain unchanged. These fixes do not add planning, composition, review, repair, or retry calls: reviewed cases still use one planner call and two answer-stage calls.

The claim-level regression reproduces the Kierkegaard handoff: a source span that supports the movement-of-infinity sentence cannot also validate an adjacent “inwardness” sentence. The latter is removed, coverage is partial, and the evidence map names only the supported sentence. Other regressions verify Sunyata stays one coverage part unless a second facet is explicit; malformed apostrophe/suffix artifacts disappear from author-side queries; and the hypothetical answer packet reserves a page from each named author. Existing comparison completeness, citation scope, source fingerprint, exact span, and public security gates remain in place.

| Candidate validation | Result |
|---|---|
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 231 passed, 0 failed |
| Full website suite: `node --test reading-companion/*.test.mjs` | 172 passed, 0 failed |
| JavaScript syntax checks and `git diff --check` | Passed in both worktrees |
| Shared Worker/site reader contract | Byte-identical |
| Answer-stage call budget / source packet | Unchanged: composition plus review; six pages maximum |
| Workflow stage progress and startup heartbeat | Existing behavior preserved and its tests pass |
| GitHub PR checks for this follow-up | Passed: Worker contracts [40170911108](https://github.com/jsynon/book-chatbot/actions/runs/40170911108), website smoke [40170802873](https://github.com/jsynon/antilogicalism/actions/runs/40170802873), and website retrieval evaluation [40170802893](https://github.com/jsynon/antilogicalism/actions/runs/40170802893) |
| Fresh five-case deployed with-review run | Pending; must check structure, selected quote per sentence, both author pages in the Nietzsche/Kierkegaard packet, and the two definition questions |
| Human semantic evaluation and unseen acceptance suite | Pending; keep the unseen suite frozen until the deployed candidate is reviewed |

At that point, the next release gate was review and merge of PRs #228 and #194, Worker deployment, and a fresh five-case all-books with-review run. The user completed that gate; the results and remaining checks are recorded below.

## October 25, 2026: post-merge five-case run #39

After Worker PR #228 and website PR #194 merged and the Worker was deployed, the user ran the same five-case all-books, with-review focused workflow: [run #39](https://github.com/jsynon/antilogicalism/actions/runs/40171341219). The site revision was `f69032774bedfd1169c2ee794b35b329c7b07cfa`, which includes website PR #194; the Worker version was `0b621531-5199-4207-ad0e-017e1748c846`. All five requests completed: no request failures, planner fallbacks, skips, or stopped cases. The run used the existing 15-call estimate (one planner and two answer-stage calls for each of five cases). The artifact reports 4/5 structural passes, compared with 3/5 in the previous deployed five-case run. It does not contain formal human rubric scores (0/5 reviewed); structural pass rate must not be read as semantic quality.

The job log also confirms that stage progress is visible during execution: it emits per-case planner, retrieval, and answer start/completion events, reports the selected page count, and emits an `ANSWER WAITING` heartbeat while a Worker request is still running. This meets the previously requested real-time observability behavior for this run.

| Case | Automated result | Evidence-based assessment |
|---|---|---|
| Kant: transcendental idealism | Pass; one requested part, full coverage | Five cited sentences link to a single page of the *Prolegomena*. The selected spans directly cover representation, space/time and appearances, Kant's use of “transcendental,” and the limits of experience. The direct-definition normalization now matches the reader's one-part question. |
| Kierkegaard: faith | Pass; one requested part, full coverage | The earlier unsupported inwardness sentence is now linked to its own matching claim evidence, rather than borrowing the movement-of-infinity quote. The answer is very long for this broad question and expands into multiple examples and conditions; structural validity does not show that this level of detail is helpful. |
| Nietzsche on Christianity | Pass; one requested part, full coverage | Most claim spans match the associated statement. The final sentence bundles several claims: selected evidence supports the church's description as an obstruction to the spread of the “poison,” but the claim that Nietzsche called the church “gross and vulgar” is not present in the mapped spans. This is a residual sentence-level support gap despite the structural pass. |
| Sunyata | Pass; one requested part, full coverage | The planner's extra “how it operates” requirement is gone. The citations support the Zen-centered description and examples. The answer gives only a brief “concept of emptiness” definition and then proceeds into Zen associations; it still does not explain the underlying philosophical sense of emptiness in much depth. |
| Nietzsche on Kierkegaard | Fail; no supported parts, no citations | The assistant safely abstained. The Nietzsche-scoped search returned zero candidates; the Kierkegaard-side search returned 13 and the broad question search 26, yet the six-page packet contained Kierkegaard sources only. Without a Nietzsche passage the reviewer had no basis to support either author's position or the inferred comparison. This is now a retrieval/source-availability failure, earlier than composition or claim-level review. |

The paired selector change did its intended conditional job: it reserves both authors when a candidate from each is present. This trace shows the limit of that fix—selection cannot preserve a Nietzsche page that upstream retrieval never found. The next implementation should target author-scoped retrieval for this prompt family, using terms that occur in Nietzsche's indexed books (for example Christianity, Christian morality, religion, faith, ascetic ideal, or God) rather than relying on “religious existentialism.” Keep each side's query restricted to its own author, preserve the current source and call budgets, and verify the actual indexed query results before expecting an answer. Do not force a synthesis from Kierkegaard-only evidence.

As an independent, provisional review of the answer text and its linked spans in this artifact—not a score recorded by GitHub—the cases score as follows on the project's 0–2 rubric:

| Case | Accuracy | Question coverage | Explanation | Citation support | Citation completeness |
|---|---:|---:|---:|---:|---:|
| Kant: transcendental idealism | 2 | 2 | 2 | 2 | 2 |
| Kierkegaard: faith | 2 | 2 | 1 | 2 | 2 |
| Nietzsche on Christianity | 1 | 2 | 2 | 1 | 2 |
| Sunyata | 2 | 1 | 1 | 2 | 2 |
| Nietzsche on Kierkegaard | 2* | 0 | 0 | 0 | 0 |

`*` The last case receives 2 for accuracy only in the narrow sense that its abstention avoids unsupported factual claims; it provides no substantive answer. The scores are provisional because they assess the answer and evidence spans exposed by the artifact, not a separate human review of every full cited page. They should not be confused with the artifact's still-pending rubric fields.

The next release gate is a targeted retrieval correction followed by this same five-case run. Inspect the returned Nietzsche-side candidates and exact cited text, retain safe abstention when one side is absent, and recheck the multi-claim Nietzsche/Christianity sentence and the answer length for Kierkegaard/faith. After that, run a manual question against the live site to verify the user-visible citations and highlights. Keep the unseen acceptance suite frozen until the deployed run demonstrates both reliable source availability and claim-to-passage support; a 5/5 structural result alone is not sufficient.

## October 25, 2026: bounded retrieval recovery and answer-quality guardrails

The next candidate implements the retrieval and answer-quality work indicated by run #39 as one connected change across the browser and Worker. The Nietzsche/Kierkegaard miss originates before composition: the planned Nietzsche-side query returned no result, so source selection could not preserve a Nietzsche page. Meanwhile, the Nietzsche/Christianity sentence and the overly expansive Kierkegaard/faith response showed that retrieval success and structural coverage alone are not enough.

The website retrieval path now detects two disjoint author-side parts plus their combined synthesis part. Only when one side has no results and the counterpart does, it makes one best-effort local search using counterpart topic terms, scoped to the missing side's already planned catalog book IDs. It filters results to that scope and records `fallbackFrom` and `fallbackReason` on the search trace. A failed retry leaves the side empty so the Worker can preserve abstention. This does not add a model call, widen the planned author scope, alter the six-page answer packet, or weaken citation validation. The packet selector also uses remaining slots for another linked book for a question part before unlinked search-facet noise, when such a page exists. The retrieval-complete progress event reports successful fallbacks, keeping the live workflow observable as requested.

The Worker composer contract now asks for a direct, concise 3–5 sentence answer to broad single-part questions, treats planner queries as retrieval leads rather than required extra topics, and avoids bundling distinct factual claims into one sentence. The review contract now says that support for one clause cannot validate an unrelated clause in the same sentence. A regression reproduces a sentence where the cited quote supports only its second clause; the whole sentence is rejected while the answer remains a safe partial result. These are guidance and checked-review changes, not an expansion of the model-call budget or a deterministic promise of semantic accuracy.

| Candidate validation | Result |
|---|---|
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 232 passed, 0 failed |
| Full website suite: `node --test reading-companion/*.test.mjs` | 174 passed, 0 failed |
| Worker/site shared `reader-contract.mjs` | Byte-identical |
| `git diff --check` in both worktrees | Passed |
| AI call estimate / page packet | Unchanged: focused reviewed workflow remains 15 baseline calls for five cases; answer packet remains capped at six pages |
| Live retry visibility | Retrieval progress includes a retry count and a scoped-recovery message; successful search traces include the original query and fallback reason |
| Fresh deployed five-case run and cited-passage review | Pending; must verify whether Nietzsche-side retrieval recovers, both author sides reach composition, broad answers stay focused, and every sentence's mapped quote supports its material claims |
| Unseen acceptance suite | Remains frozen pending deployed evidence and manual semantic review |

This is a local candidate across the Worker and website repositories. It has passed offline contract and retrieval tests, but has not yet been merged, deployed, or evaluated against the live corpus. A 5/5 structural result remains insufficient by itself; promotion still requires inspection of the exact retrieved and cited passages and the user-visible highlights.

## October 25, 2026: run #40 reviewer recovery and page-voice context

After Worker PR #229 and website PR #195 merged and the Worker was deployed, the user ran the five-case focused, all-books, with-review workflow [40173370353](https://github.com/jsynon/antilogicalism/actions/runs/40173370353). The site revision was `f5d56b2cf0ff3cf713121c35c45918bf3f3ce87e`; the Worker version was `b9ea08ea-3123-4cd1-87c1-64fe169c658f`. All five cases completed with no request failures or planner fallbacks, using the established 15-call estimate. Structural checks passed 3/5. This is evidence of a working end-to-end path with two reviewer handoff failures, not a semantic-quality score.

The authenticated trace localized both misses to reviewer format and exposed one source-selection defect:

- **Kant, transcendental idealism:** The reviewer returned six claim decisions with valid claim IDs and selected span IDs, but mirrored the input field `answers` while the output contract required `claims`; it also omitted the part-level status. The Worker correctly kept the answer as an unverified partial draft. The underlying cited passages were relevant, but this answer was not verified by the run's review contract.
- **Sunyata:** The reviewer returned the expected claim decisions in fenced JSON with an extra trailing `]}`. Its definition claim cited S4 and S5 but selected a span only from S4. Source inspection in Drive confirmed Huston Smith's *Forgotten Truth*, p. 66 directly defines sunyata as emptiness/a void, while p. 193 is an alphabetical index. The current evidence gate correctly refuses to let S4 validate the missing S5 citation; the browser's navigation-page detector had failed to exclude p. 193 from candidates.
- **Source voice and editorial context:** Drive inspection confirmed that *Last Writings: Nothingness and the Religious Worldview*, p. 18, is in David A. Dilworth's introduction, so it is secondary commentary rather than Nishida's own prose. The *Fear and Trembling* front matter identifies Johannes de Silentio as the pseudonymous voice. These are real attribution distinctions the answer path must receive and preserve; a catalog author or an intended `primary` source role alone cannot establish who speaks on an individual page.

The next implementation fixes the handoff and context as one bounded change. The review request now uses `claims` for the answer sentences and the reviewer's decisions. A compatibility adapter accepts the observed `answers` alias and derives an omitted part status only when every supplied claim has a recognized status; missing, duplicate, unknown, or incomplete claim/span decisions remain rejected or partial. The JSON reader recovers a single balanced object from a code fence and tolerates only the observed unmatched `]}` tail. It then runs the unchanged strict contract checks, so formatting recovery cannot create evidence or validate an unsupported citation.

The composer and reviewer now receive structured bibliographic context for credited authors, editors and translators, the planner's intended source role, and any explicit page-heading hint. The prompts say that these fields are context only: inspect the page for an authorial, pseudonymous, quoted, reported, narrative, editorial, or translator voice; keep commentary separate from primary text; and use an unnamed/uncertain attribution when the passage does not establish a speaker. This preserves the existing one-composition/one-review call path. The website's page filter now detects OCR index pages where the folio and `INDEX` heading occur after several locator entries; the same generic check is covered in the Worker-side source-library tests.

| Candidate validation | Result |
|---|---|
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 235 passed, 0 failed |
| Full website suite: `node --test reading-companion/*.test.mjs` | 175 passed, 0 failed |
| Shared Worker/site `reader-contract.mjs` | Byte-identical after separating credited editors from translators |
| `git diff --check` | Pending final branch validation |
| AI call estimate / answer packet | Unchanged: 15 estimated calls for the five reviewed cases; six-page maximum |
| Run #40 regression fixtures | Kant's complete legacy-shaped review can recover; Sunyata's fenced/trailing-tail JSON parses, but the unselected S5 span remains insufficient and does not enter the evidence map |
| Current candidate status | Paired PRs [#230](https://github.com/jsynon/book-chatbot/pull/230) and [#196](https://github.com/jsynon/antilogicalism/pull/196) are open; repository checks are pending; neither is merged or deployed |
| Next release gate | Open paired PRs, pass repository checks, merge/deploy both, and repeat the same five-case run; inspect exact reviewer spans, speaker/section attribution, index exclusion, and visible highlights |

The unseen acceptance suite remains frozen. Even a 5/5 structural run will not complete this milestone until the selected passages support the text, commentary and pseudonymous voices are not presented as an author's direct words, citations avoid index pages, and the user-visible highlights point to the matching reviewed claim.
