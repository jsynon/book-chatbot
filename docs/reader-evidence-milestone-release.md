Warning: truncated output (original token count: 40365)
Total output lines: 814

# Reading Companion evidence milestone: release report
Last updated: October 26, 2026
Status: The latest correctly scoped focused all-books and selected-books with-review runs are #69 ([40354991903](https://github.com/jsynon/antilogicalism/actions/runs/40354991903)) and #71 ([40361030717](https://github.com/jsynon/antilogicalism/actions/runs/40361030717)), both against library v48 and Worker revision `ee42f76c61180db78426ab0cee941b67aecb447a`. Both completed all five cases with no request failures or planner fallbacks, passed 5/5 structural cases, and marked all 5/5 parts supported. The artifact reports 19/19 cited highlights located, but has no human rubric ratings; these are structural and quote-location results, not semantic quality scores. Both answers remain shallow on Sunyata, and the selected-books Nietzsche-on-Kierkegaard case collapses the requested hypothetical into one generic part. The selected-books route skips planning while the all-books route uses a live planner, so this pair is not a controlled test of corpus scope alone. Run #70 was labelled selected-books but actually ran with `searchScope=all-books`; exclude it from the selected-books comparison. The Sunyata review trace also confirms a last-mile defect: pruning a rejected citation can retain and mark the whole sentence answered. This report records a bounded fail-closed correction and the validation still required. Keep the unseen acceptance suite frozen.
The earlier James 2:14–26 miss from run [40157017806](https://github.com/jsynon/antilogicalism/actions/runs/40157017806) was traced to scripture scope being dropped from part queries; that fix is merged in website PR #188.
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

The live pipeline keeps source identity and scope checks strict. Retrieval part tags are eligibility links, not semantic proof. The reviewer selects source-scoped span IDs, which the Worker resolves only against fingerprint-verified text. A claim is accepted only when each cited source has a supported decision and exact span; if a source fails, the sentence is incomplete and cannot become supported by deleting its citation. Separately reviewed sentences can remain, with partial part coverage. This replaces the earlier claim-local citation-pruning recovery documented after run #56, which the Sunyata trace showed could preserve an unsupported clause. Known page-level editorial voices and title-guarded pseudonymous work voices are checked at claim acceptance; an accepted, reviewed attribution may carry into a later answer part. A one-word term in quotation marks is treated as terminology, while multiword quotations remain source-checked. None of these checks alone proves entailment, accuracy, or completeness.

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
3. Recheck the liv…22026 tokens truncated…ged: two answer calls with review; six-page maximum |
| Fresh five-case reviewed holdout after merge and deployment | Pending; both PR checks pass, but the fixes are not yet merged/deployed. The rerun must determine whether the reviewer selects S5-Q9, highlights match the evidence map, and source-scoped questions improve |
| Unseen acceptance suite and final semantic milestone | Reserved until the same focused holdout and cited-passage review support promotion |

At the time this candidate was prepared, PR #227 in `book-chatbot` and paired website PR #193 in `antilogicalism` had passed checks but had not yet been merged or deployed. The following section records the user's merge, deployment, and live validation.

## October 25, 2026: post-merge five-case run and claim-level evidence handoff

After PR #227 and website PR #193 merged, the user ran the five-question all-books with-review workflow [40168960976](https://github.com/jsynon/antilogicalism/actions/runs/40168960976). The website source revision was `a67b9b5eb2d3f9d102169ece41693c3b75f679da`; the Worker build was `public-gateway-evidence-selection-v3`. All five requests completed with no request failures, planner fallbacks, or skipped cases. The run used the existing 15-call…24365 tokens truncated…-books with-review diagnostic. Inspect the Sunyata planner queries and submitted pages, then compare reviewer candidate/returned/accepted spans against the corresponding Kierkegaard and Nietzsche claims. Review the page text before changing retrieval or reviewer behavior. Keep this as a cross-case diagnostic; do not expand into another Sunyata-only fix or run the unseen acceptance suite yet.


## October 26, 2026: focused five-question run #64 and evidence handoff fix

The all-books with-review workflow [#64](https://github.com/jsynon/antilogicalism/actions/runs/40254509391) completed all five cases against library v48; its artifact is [12622340794](https://github.com/jsynon/antilogicalism/actions/runs/40254509391/artifacts/12622340794). It made the existing estimated 15 Worker AI calls (one planner plus composition and review per case), with no request failures, planner fallbacks, or skipped cases. The workflow failed its structural gate at 3/5 cases and 5/7 parts. This is not an infrastructure failure. The artifact has no independent human ratings. Its `workerSourceRevisions` value, `e0d05d4d1b25e5fd4e7feed1a6254cfa287ecec3`, confirms that the Worker was deployed with the SHA tag for merged PR #253.

The trace adds useful detail to the cross-case findings:

- **Kierkegaard on faith:** the reviewer returned spans for claims from *Fear and Trembling* and *The Sickness Unto Death*, but the deterministic voice guard rejected claims that did not identify the relevant pseudonymous speaker. The safeguard worked; the answer lost coverage because composition did not preserve attribution.
- **Nietzsche on Christianity:** the reviewer returned three exact spans from one cited source for a sentence combining several related claims. The Worker normalized that decision to one span per source, so the final evidence map retained only part of the support. This is a handoff cap, not missing retrieval.
- **Sunyata:** the planner now asks about dependent origination, and *Mūlamadhyamakakārikā* pages 104 and 164 reached the packet. Those selections are Kalupahana commentary, while the answer attributes interpretations directly to Nāgārjuna. The existing title/page voice map only identified page 88, so the accepted excerpts had no known editorial voice. The planner/retrieval change is useful but does not yet produce reliable attribution.
- **Nietzsche on Kierkegaard:** both sides were answered, but the requested hypothetical conclusion was absent. The evidence trace identified the missing synthesis part; it remained partial.
- **Kant:** the structure passed, but the answer appears to confuse transcendental idealism with subjective idealism. The reviewer did not catch this conceptual distortion, confirming that structurally valid claims can still be wrong.

The candidate fix stays within the existing Worker review and provenance stages. It lets review retain up to three exact spans per cited source, still capped at six spans per claim, and carries every accepted span into the claim evidence map and authenticated trace. This directly addresses the Nietzsche handoff loss without another AI call, planner, retry, or wider page packet. It extends the existing title-guarded provenance for book 178 to the known commentary pages 104 and 164, so the existing attribution prompt and deterministic voice guard identify Kalupahana as commentator. The page map remains title-guarded, and other pages in the work do not inherit the commentary label. The pseudonymous-voice guidance now requires the first claim using a work to name its speaker in that sentence; the deterministic guard continues to reject unattributed claims. A missing hypothetical inference remains partial rather than being invented.

This candidate improves citation completeness for claims that need multiple excerpts from the same page and prevents the demonstrated commentary passages from being misattributed. It does not guarantee philosophical accuracy: the Kant miss shows that model review can still accept a plausible but distorted paraphrase. It also does not make the absent hypothetical answer appear; the correct behavior remains a cautious, evidence-based inference or an explicit limitation, with the part partial if neither is produced. Run #64 is the baseline for the next full five-question diagnostic, not acceptance evidence.

| Candidate validation | Result |
|---|---|
| Same-source multi-span reviewer handoff | Pass; regression suite confirms three exact spans from one source reach the evidence map while the answer path remains at two calls |
| Mūlamadhyamakakārikā page voice | Added title-guarded tests for commentary pages 104 and 164 and a negative control for an unmarked page |
| Pseudonymous voice, editorial attribution, unsupported/cross-source spans, missing hypothetical inference | Existing regressions retained |
| Full Worker test suite: `node --test hosting-poc/*.test.mjs` | 271 passed, 0 failed |
| GitHub PR contract workflow | Pass; [run #764](https://github.com/jsynon/book-chatbot/actions/runs/40256305731) succeeded |
| Syntax and whitespace checks | `node --check` for both changed modules and `git diff --check` pass |
| Live five-question answer quality | Pending; must rerun after merge/deployment and review the actual claims and source passages |
| Unseen acceptance suite | Keep frozen until the full diagnostic shows improved evidence handoff and attribution, and the Kant-style conceptual distortion is assessed |

## October 26, 2026: focused five-question run #65 and claim-linked highlights

The all-books focused with-review workflow [#65](https://github.com/jsynon/antilogicalism/actions/runs/40256572608) tested library v48 and saved artifact [12622449865](https://github.com/jsynon/antilogicalism/actions/runs/40256572608/artifacts/12622449865). It completed all five questions with no request failures, planner fallbacks, or skipped cases. It recorded 4/5 structural passes and 6/7 supported question parts, with 15 estimated Worker AI calls and no human ratings. The trace identifies the deployed Worker revision. This run was useful evidence, not a release-quality answer score: structural checks cannot establish whether a highlight is the best passage for a claim.

The highlight symptom has two concrete causes in this trace and the existing browser code. For the Kierkegaard faith answer, claim P1-C6 said that true belief requires passion in opposition to receiving honor from men. The source page contained the direct “Only that is to believe…” passage as span S6-Q6, but the claim's review index supplied only S6-Q9, S6-Q5, and S6-Q8; the useful span ranked fourth and could not be selected. Separately, the public response flattened approved spans to one highlight per cited page, and the site reader opened only that first quote. So the issue was both a narrow candidate handoff and a lossy display contract. The source text was present in retrieval; a UI-only selector change could not have recovered the span review never saw.

This bounded implementation changes the connected stages together:

- The reviewer receives up to four ranked candidate spans per cited page, while deterministic validation and the review prompt still cap acceptance at three per page and six per claim. This widens choice without a new model call or a larger retrieved-page packet.
- The public Worker response groups up to three accepted excerpts per cited page and carries each excerpt's claim, question-part, and point links. The existing six-item ceiling continues to mean six distinct cited pages; the legacy primary `quote` field remains available.
- The live page entry point loads `companion-v111.mjs` for v48. That active client matches the sentence before an inline citation to the group’s claim points, then opens the excerpts for that matching claim. The page reader locates each excerpt independently and highlights only exact, unambiguous matches. The source card can show all accepted excerpts on that page; regression checks target the v48 entry point rather than relying on the older v110 client.
- Authenticated diagnostic and workflow audit summaries preserve the bounded nested claim/excerpt links and per-excerpt location status, so the next artifact can show which text was offered and which text the reader can actually highlight.

No planner, search, source selection, answer composition, review count, citation identity, or source text behavior changes. There are no added AI calls. This fix improves highlight relevance and testability; it does not make weak model-approved spans semantically correct. The separate run #65 answer-quality findings still stand: Kant has a conceptually distorted explanation, the Sunyata answer needs the Buddhist account beyond a generic gloss, and cross-work/hypothetical claims still require semantic inspection. Keep the unseen acceptance set frozen until this candidate has been checked live and the answer-quality issues are assessed.

| Validation | Result |
|---|---|
| Worker candidate/acceptance regression | Pass; reviewer sees four candidates, only three exact spans can be retained, and the answer uses the existing two calls |
| Worker public highlight contract | Pass; claim-linked excerpts group by page while the six-distinct-page cap and legacy primary quote remain |
| Website/evaluator suite: `node --test reading-companion/*.test.mjs` | 185 passed, 0 failed |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 272 passed, 0 failed |
| Syntax and whitespace checks | Website changed modules pass `node --check`; both repository diffs pass `git diff --check` |
| Live check after Worker and site deployment | Pending; rerun the focused five-question all-books with-review workflow and inspect whether the previously omitted source span reaches review and whether exact claim-linked excerpts are reported and highlighted |
| Live answer quality and unseen acceptance suite | Still pending; review actual text and cited passages separately before unfreezing acceptance |

## October 26, 2026: run #66 evidence review and bounded claim handoff correction

The focused all-books with-review workflow [#66](https://github.com/jsynon/antilogicalism/actions/runs/40260668277) completed against library v48 and Worker revision `bfd2901da9b0a81b026e58cd3481df79694c57e9`. It passed 3/5 structural cases and 5/7 question parts. The trace showed that the two clearest misses were handoff/review failures after relevant evidence had reached composition:

- **Sunyata:** the composer drafted the dependent-arising/emptiness relationship and cited S4 and S6. S6's selected span supported the relationship, while S4 was marked partial; normalization dropped the sentence because one extra citation failed. The existing cleanup guard disabled pruning when an all-books plan contained multiple source groups, even though this was a direct, non-comparison claim with one independently supporting cited page.
- **Nietzsche on Kierkegaard:** the composer included an explicitly cautious inference. The reviewer marked the author-side pages partial without selecting spans, so the deterministic source gate correctly withheld the inference. The review input identified page provenance, but its claim-specific source index did not explicitly map each cited page to the planner's author group. The trace does not prove that metadata alone will correct model judgment; the change makes the premise-to-author relationship explicit while keeping both source decisions mandatory.

The user's live screenshot adds a general answer-relevance defect: in response to “are we in a simulation?”, the answer included a list of unrelated retrieved topics (Kuhn on scientific theory, Anscombe on reasoning, Hull on behavior, and an Ante-Nicene Fathers passage) as a sentence about why those passages did not answer the question. The citations therefore cluttered the answer without helping answer it. This is separate live evidence from the #66 artifact; it does not identify a Worker revision or prove which stage produced the wording. The composer and reviewer now explicitly omit retrieval inventories and unrelated passages. This remains a model-behavior change that must be checked live.

The bounded Worker candidate keeps the existing planner, retrieval, composition/review stages, source-span checks, response contract, and call count:

- Direct, non-comparison claims may now remove an explicitly partial or unanswered extra citation when another cited page has a valid reviewed span for the claim and every cited source received an explicit decision. The repair remains citation-group-local; comparisons and hypothetical inferences are still excluded. If the reviewer marks the question part partial, retaining a supported claim does not upgrade the part's coverage status.
- The existing review payload now labels each cited page with its planner author/source-group label and role. Reviewer instructions clarify that for a hypothetical inference, each author page supports its own premise; the inference still requires relevant evidence from both groups and must stay within their shared point of contact. No reviewer decision or source span is relaxed.
- Composer and reviewer instructions tell the system to omit unrelated retrieved-topic lists and retrieval-process narration. No deterministic semantic classifier or third model call was added.

| Candidate validation | Result |
|---|---|
| Sunyata-like direct claim with an unsupported extra citation in a multi-group plan | Pass; supported claim and citation retained, unsupported citation removed, and partial part status remains partial |
| Hypothetical source-group handoff | Pass; review input maps Nietzsche and Kierkegaard pages to their respective author groups; positive inference still needs both reviewed sources |
| Failed hypothetical premise | Pass; a missing source group remains unsupported and cannot be pruned |
| Worker suite: `node --test hosting-poc/*.test.mjs` | 273 passed, 0 failed |
| Live five-question validation | Pending; merge/deploy this candidate, rerun the focused five-case all-books with-review workflow to inspect Sunyata and the Nietzsche/Kierkegaard reviewer spans, then separately repeat the live simulation question to check whether the irrelevant source inventory disappears |
| Answer quality | Not established by unit tests; check actual cited page text and attribution in the next artifact |

The screenshot still shows the previous “Read highlighted passages” wording. Website PR [#214](https://github.com/jsynon/antilogicalism/pull/214) has since merged the copy change to “Read passages” for both excerpt and fallback states; verify the published page after its site deployment. This interface change does not alter evidence selection or answer quality, and this Worker candidate does not resolve whether the displayed highlights are the best semantic matches. Keep the unseen acceptance suite frozen until the next focused run confirms the changed citation handoff and relevance behavior.

## October 26, 2026: focused run #68 and bounded hypothetical-inference correction

Focused all-books with-review run [#68](https://github.com/jsynon/antilogicalism/actions/runs/40264347850) completed all five questions against library v48. The artifact reports Worker source revision 35ff77ed42be8a3678f404a6bfc7f1fdf77ec18b, confirming that the deployed Worker included PR #257. It used the existing estimate of 15 Worker AI calls, with no request failures, planner fallbacks, or skipped cases. Four of five cases passed the structural gate; six of seven question parts were supported. The artifact contains no submitted human rubric scores.

The Kant case now passes with two citations from six submitted pages, where run #67 had failed after retaining unrelated citations on a direct claim. This is direct live evidence that the claim-local citation pruning from PR #257 reached the deployed Worker and helped this case. The remaining structural miss is Nietzsche-on-Kierkegaard: the answer covers both authors and links the comparison evidence, but its final part declines a reliable inference and is marked partial. The passages do overlap on faith—Nietzsche critiques Christian faith as masking instincts and hostility to reality, while Johannes de Silentio describes faith as a paradoxical relation to God—so the answer can make a limited conditional reader inference without claiming Nietzsche recorded a judgment about Kierkegaard. That distinction should not be implemented by lowering the review gate: the inference still needs each author's own relevant premise, the same specific concept, and a modest conclusion.

The run also confirms that highlight location is not semantic validation. All 18 cited highlights were found in their cited pages, but the Fear and Trembling excerpt used to support a general statement that faith requires a movement into the absurd is Johannes de Silentio saying that he cannot make that movement. The Nietzsche-on-Christianity “poison/herd” highlight is a passage about the herd's triumph; it supports the herd phrase more directly than “poison.” Sunyata remains a thin secondary-source gloss and omits dependent origination and lack of inherent nature. These remain separate answer-quality findings; this change does not address them.

The bounded candidate resolves an instruction conflict in the existing composer/reviewer contract. It permits a conditional reader inference when both authors' passages support the same narrowly identified concept, while distinguishing that reasoning from a historical claim or verdict on an entire doctrine. The deterministic coverage guard now keeps the hypothetical part partial when the pages do not establish that shared point or the answer only says no inference can be drawn, even if the reviewer labels the limitation complete. A supported answer still needs a standalone inference sentence with the smallest directly relevant citation set from both authors. Source-by-source review and exact-span validation remain unchanged. This alters no planner, retrieval, page budget, call count, public response fields, or highlight behavior.

| Candidate validation | Result |
|---|---|
| Positive conditional inference with both author premises | Covered by the existing two-call regression, updated to use a narrow, conditional faith example |
| Broad claim about the other author's whole philosophy | Remains partial even when both author sources are cited |
| Limitation without the requested inference | Remains visible but partial; no longer treated by the regression contract as full coverage |
| Missing or unsupported author premise | Existing fail-closed source-group regression retained |
| Focused hypothetical Worker tests | Pass; 68 passed, 0 failed |
| Full Worker suite: node --test hosting-poc/*.test.mjs | Pass; 273 passed, 0 failed |
| Syntax and whitespace checks | Pass; node --check hosting-poc/evidence-answer.mjs and git diff --check |
| GitHub contract workflow | Pending PR run |
| Live focused five-question validation | Pending; merge and deploy the candidate, then rerun the same focused all-books with-review workflow and confirm Nietzsche–Kierkegaard produces a qualified, source-linked inference while the other four cases remain stable |
| Semantic highlight quality, Kant accuracy, and Sunyata explanation | Still open; not claimed fixed by this candidate |
| Unseen seven-question acceptance set | Keep frozen until the focused outputs are reviewed |

The change is deliberately limited to the inference rule and its regressions because run #68's failure was an omitted hypothetical conclusion after both author sides reached composition. The highlight mismatches require a separate claim-to-highlight support review; combining them here would obscure whether this fix addresses the 4/5 result. A green structural rerun would validate coverage behavior, not establish semantic quality.

## October 26, 2026: focused all-books run #69 and selected-books run #71

The user ran the five-question focused with-review workflow in both scopes. All-books run [#69](https://github.com/jsynon/antilogicalism/actions/runs/40354991903) and correctly scoped selected-books run [#71](https://github.com/jsynon/antilogicalism/actions/runs/40361030717) used library v48 and the same Worker revision, ee42f76c61180db78426ab0cee941b67aecb447a. Each completed all five cases without request failures or planner fallbacks, passed 5/5 structural checks, and marked all 5/5 parts supported. Run #69 used 15 calls (planner, compose, review for each question); #71 used 10 because its selected-books route skips the planner. Both artifacts report all 19 cited highlights located, but neither contains human rubric scores. These results establish stable structure and highlight location, not semantic correctness.

Run #70 is not a valid selected-books comparison: although the artifact label says selected-books, its recorded searchScope is all-books and its selected IDs are empty. Its 2/5 result should not be combined with the valid scope comparison.

| Case | All-books #69 | Selected-books #71 | Assessment |
|---|---|---|---|
| Kant: transcendental idealism | 98 words | 122 words | Both answer the core distinction and pass structure. |
| Kierkegaard on faith | 190 words; cites three selected works, including The Sickness Unto Death | 134 words; cites Fear and Trembling and Philosophical Fragments | Both are relevant; selected scope gives a shorter, narrower answer. |
| Nietzsche on Christianity | 121 words; includes The Portable Nietzsche, Genealogy, and Thus Spoke Zarathustra | 98 words; cites The Portable Nietzsche and Genealogy | Both address the topic; omission of Zarathustra in selected scope is not itself a failure. |
| What is sunyata? | 49 words; a broad emptiness/void gloss with secondary-source framing | 52 words; names dependent arising but does not explain the relation | Neither gives the stronger conceptual explanation needed; both lean on commentary. |
| Nietzsche on Kierkegaard | 296 words; planner split the question into three parts | 191 words; selected route represented it as one generic part | Not directly comparable: planning and part structure differed, not only corpus scope. The selected answer omitted a clear, bounded hypothetical inference. |

The workflow pair shows selected-books answers are often more concise, while the all-books planner can create broader or more fragmented answer structure. It does not show that all-books retrieval is the cause of the length difference. The evaluator uses different planning routes by scope: selected-books uses curated fixed queries and no live planner; all-books uses the planner. Future comparison should preserve this caveat and should not require every selected title to appear in an answer. The quality target is adequate, accurate explanation with source voice and claim-specific evidence, not maximum length or source count.

The authenticated Sunyata trace exposes a deterministic last-mile defect after composition and review. One compound sentence joined the supported account of rejecting substance metaphysics with a further claim about avoiding dogmatism/obsession and cited S2 and S5. Review marked S5 partial, but the finalizer removed S5, kept the entire sentence, and marked the part full. Citation deletion cannot establish that the remaining page supports every clause in the sentence. The active composer already asks for one main claim per sentence, and the reviewer already returns a source decision for each cited source; adding another broad prompt instruction or AI call would repeat the existing contract rather than enforce it.

The bounded Worker correction removes the citation-pruning recovery. If any source cited by a sentence is partial, unanswered, or missing an accepted span, the sentence stays incomplete and is omitted from the reviewed answer. Other separately reviewed sentences can remain, and the part stays partial when only some claims survive. The trace continues to record the failed source decision; the public response shape, planner, retrieval budgets, page packet, source identity checks, highlight selection, and two-call compose/review budget are unchanged. This deliberately favors support accuracy over retaining a compound draft sentence. A future sentence-splitting repair would require a separate evidence-linked claim contract; this change does not attempt to infer which clause to keep from a rejected citation.

| Candidate validation | Result |
|---|---|
| Sunyata-like compound sentence with one supported and one rejected cited page | Added regression: the entire compound sentence is omitted; separately reviewed supported sentence remains; part is partial |
| Direct claim previously recovered from a partial/unanswered source decision | Updated regression: the claim is not promoted, and no unsupported citation/evidence map remains |
| Hypothetical and comparison protections | Existing strict source-group checks retained |
| Worker test suite | Pass; 274 tests, 0 failures |
| Focused answer tests | Pass; 69 tests, 0 failures |
| Syntax and whitespace | Pass; both changed Worker modules pass node --check; git diff --check passes |
| GitHub contract workflow | Pass; [run #780](https://github.com/jsynon/book-chatbot/actions/runs/40366853683) succeeded |
| Website/evaluator test suite | No website files changed; not required for this Worker-only correction |
| Live validation | Pending; after merge and Worker deployment, rerun the focused five-question with-review workflow. Confirm Sunyata no longer reports a full sentence after S5 fails, while independently supported neighboring claims and all other cases remain stable. |
| Human quality review | Pending; verify cited page text and source voice for all five answers. Structural pass and located highlights remain insufficient as quality scores. |
| Unseen acceptance suite | Keep frozen until the focused outputs have been semantically reviewed. |

## October 26, 2026: runs #72 and #73 expose a reviewed polarity reversal

The focused with-review all-books run [#72](https://github.com/jsynon/antilogicalism/actions/runs/40367410409) and selected-books run [#73](https://github.com/jsynon/antilogicalism/actions/runs/40368284857) both used library v48 and Worker source revision `b392769060014e70e178aeb908f1e4f99395f7fd`, the merge commit for Worker PR [#258](https://github.com/jsynon/book-chatbot/pull/258). All five cases in each run completed with no request failures or planner fallbacks. The all-books run estimated 15 Worker calls and passed 2/5 cases (4/7 parts supported, 3 partial); selected-books estimated 10 calls and passed 3/5 (3/5 parts supported, 2 partial). Selected-books skipped the planner for all cases, while all-books planned its questions and expanded the Nietzsche/Kierkegaard item into three parts. These totals are therefore not a direct mode-to-mode quality comparison. All ten human-review rubrics remained pending. Every cited source had a located highlight, which verifies location only.

| Case | All-books #72 | Selected-books #73 | Evidence-level finding |
|---|---|---|---|
| Kant: transcendental idealism | Partial | Partial | The core definition remains. An added contrast among kinds of idealism was not fully supported in either scope. |
| Kierkegaard on faith | Partial | Full | All-books correctly withheld claims whose reviewed evidence did not make the pseudonymous voice clear. Separately, its accepted claim that Johannes de Silentio can plunge confidently into the absurd contradicts the selected passage, where he says he cannot. The quote was located and the reviewer still accepted the claim. |
| Nietzsche on Christianity | Partial | Full | The all-books reviewer rejected a claim backed by editorial commentary presented as Nietzsche's view. The selected-books answer used direct Nietzsche passages. |
| Sunyata | Full | Partial | The all-books structural pass is weak evidence of quality: its short definition redirects through Smith's account of the Infinite and omits dependent origination. The selected answer mentions dependent arising but has the awkwardly formed “Kalupahana, sunyata…” sentence; a compound middle-path claim citing commentary remains partial. |
| Nietzsche on Kierkegaard | Full, three planner-created parts | Full, one selected-scope part | Both outputs make a cautious inference, but the selected answer's inference cites a Kierkegaard span about having courage to think a thought whole, which is weak support for its claim about consolation and religious truth. Structural approval does not establish the inference. |

The trace shows PR #258 is working as intended: unsupported or ambiguous sources leave claims/parts partial instead of being pruned and silently promoted. The deeper polarity failure also shows why that fix alone is not a semantic review. The Worker already had several reviewer instructions about contradiction, voice, and inference, including a first-person inability example. Adding another general warning would repeat the existing contract. Before this candidate, `REVIEW_PROMPT` was about 1,253 words and repeated several rules. The candidate reorganizes it around exact claim entailment, polarity, speaker attribution, and source-group reasoning; it is about 706 words, with the same review response schema and span limits.

A narrow deterministic guard supplements the existing reviewer decision. When the reviewer marks a source answered, the Worker checks the selected exact spans for an explicit negative ability statement and compares it with an explicitly positive ability claim. If the same action phrase is strongly shared and the passage does not also affirm that action, the source is downgraded with `source-contradicts-claim-polarity`; the existing all-cited-sources gate then omits the sentence and leaves coverage partial. This catches the observed “cannot do X” versus “can do X” reversal without another AI call, a retrieval change, a new review stage, or a public response change. It is deliberately limited to explicit capability polarity; it is not a general natural-language inference engine and cannot prove other claims semantically.

Known editorial and pseudonymous speaker checks, source-by-source citation gates, and hypothetical source-group checks remain in place. The review prompt is more concise and direct about a shared point of contact, each author's own premise, and irrelevant quotations. This is a bounded refinement of the existing review contract, not a new answer-generation loop.

| Candidate validation | Result |
|---|---|
| Exact contradictory example: source says speaker cannot plunge confidently into the absurd; draft says Johannes can | Pass; even when the simulated reviewer says answered, the Worker downgrades that source, omits the sentence, and records `source-contradicts-claim-polarity` |
| Faithful paraphrase of the same passage preserving inability | Pass; source remains accepted and the answer is retained |
| Existing editorial, pseudonymous, inference, citation, and scope regressions | Pass in the full Worker suite |
| Worker suite: `node --test hosting-poc/*.test.mjs` | Pass; 275 tests, 0 failures |
| Live validation | Pending; after this candidate is merged and deployed, rerun the same five-question with-review workflows in both all-books and selected-books modes. Inspect the Kierkegaard faith trace for the polarity reason; inspect Nietzsche/Kierkegaard span relevance and Sunyata attribution/coverage separately. |
| Quality claims | None yet. The new test proves the deterministic guard catches this explicit polarity pattern; it does not prove that the shortened model instructions improve broader answer quality. |
| Remaining answer-quality work | Sunyata's substantive explanation and weak hypothetical inference still need source-level evaluation. Keep the unseen acceptance suite frozen until both live scopes are reviewed. |
