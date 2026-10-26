Warning: truncated output (original token count: 33082)
Total output lines: 680

# Reading Companion evidence milestone: release report
Last updated: October 26, 2026
Status: The latest focused all-books with-review workflow is run #64, [40254509391](https://github.com/jsynon/antilogicalism/actions/runs/40254509391), against library v48. It completed all five cases with no request failures, planner fallbacks, or skips, but passed only 3/5 structural cases and 5/7 question parts. Its artifact records Worker source revision `e0d05d4d1b25e5fd4e7feed1a6254cfa287ecec3`, matching the deployed SHA tag and merged PR #253. The artifact has no independent human ratings; structural coverage is not an answer-quality score. Run #64 shows the Sunyata query now includes dependent-origination language and reaches book 178, but the answer attributes commentary passages to Nāgārjuna. It also exposes a same-source citation handoff limit for a compound Nietzsche claim, a pseudonymous-speaker omission on Kierkegaard, and a missing Nietzsche-on-Kierkegaard inference. The unseen acceptance suite remains frozen.
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

The live pipeline keeps source identity and scope checks strict. Retrieval part tags are eligibility links, not semantic proof. The reviewer selects source-scoped span IDs, which the Worker resolves only against fingerprint-verified text; a claim marked answered is accepted only when its cited sources have supported decisions and exact spans, subject to the narrow unsupported-extra-citation cleanup documented after run #56. Known page-level editorial voices and title-guarded pseudonymous work voices are now checked at claim acceptance; an accepted, reviewed attribution may carry into a later answer part. A one-word term in quotation marks is treated as terminology, while multiword quotations remain source-checked. None of these checks alone proves entailment, accuracy, or completeness.

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
| Sunyata | Pass; one request…63 tokens truncated…i…13082 tokens truncated…were located as rendered highlights; Kierkegaard-faith pages S2 and S5 and Sunyata page S4 had no located highlight. The exact verified quotes include line-wrapped OCR text. Their letter/readability score was diluted by whitespace, while the Sunyata excerpt began with an OCR running header (“THE LEVELS OF REALITY / 55”). The excerpts were exact; the existing readability filter rejected them before display. The fix should keep the excerpt as an exact substring, measure readability on non-whitespace characters, and remove only a recognizable leading page-header prefix. The six-highlight cap and “no generic-preview fallback” rule remain unchanged.

One human-read limitation also remains independent of structural pass/fail: Sunyata's answer scored only 1/2 on accuracy, coverage, explanation, and support in a provisional assistant review, despite its structural pass. The result raises a source-scope question: broad claims about śūnyatā need primary passages that establish the requested Buddhist concept, not merely a coherent comparative or Zen framing. The highlighted passage is only one part of the citation issue; a located quotation is not proof of semantic support. The corresponding provisional 0–2 reviews for run #58 were Kant 2/1/1/2/2, Kierkegaard faith 2/2/1/2/2, Nietzsche on Christianity 2/2/2/2/2, Sunyata 1/1/1/1/1, and Nietzsche-on-Kierkegaard 1/1/1/1/2 (accuracy / question coverage / explanation / citation support / citation completeness). These are assistant assessments made from the saved drafts and cited passages, not human scores stored in the workflow artifact.

Source voice was also checked against the original books. *The Portable Nietzsche*, PDF page 528 (printed p. 516), contains Nietzsche's own *Antichrist* text; it must not be blanket-labeled as Kaufmann commentary merely because the volume is edited. *Last Writings*, p. 18, is David A. Dilworth's editorial introduction, not Nishida's own prose. This confirms why voice classification must stay title- and page-specific. The new candidate supplies known voice guidance to composition and review and adds a fail-closed claim check: a known pseudonymous speaker must be named, while an editorial page must be attributed to the commentator/introduction. A prior accepted, reviewed attribution may carry across later parts, so every follow-on claim does not need to repeat the full name. Directly authored pages remain unaffected.

The implementation candidate is intentionally small and cross-repository:

- Worker (`book-chatbot`): recognize the run's explicit comparison-versus-inference limitation; keep two-source citation enforcement for positive hypothetical claims; pass known voice requirements into both existing model stages; and validate the source voice when the review marks a claim supported. This does not add a model call, retrieval stage, or answer schema field.
- Worker (`book-chatbot`): improve highlight readability by ignoring whitespace in its ratio and by taking an exact source substring after a recognized leading OCR header. Short fragments remain filtered and the existing six-page/highlight limit stays in place.
- Website/evaluator (`antilogicalism`): report how many inline-cited sources have a highlight that is actually located in the submitted page, and list cited source IDs without one. This is diagnostic only and does not change structural pass/fail.

The candidate regression suite covers the exact #58 limitation wording, one-sided and unqualified inference rejection, editorial and pseudonymous attribution, the distinction between direct author text and editorial pages, the three line-wrapped/header highlight cases, and non-gating highlight audit behavior. Offline validation passes: all 267 Worker tests and all 182 website/evaluator tests pass, and both diffs pass whitespace checks. This validates the bounded code contracts, not live model quality. After merging and deploying the two repository changes together, rerun the same five focused cases with review. Check that the hypothetical limitation is supported; positive hypothetical claims still cite both authors; editorial and pseudonymous voices are represented correctly; and the three highlights are rendered from exact page text. Then assess the retrieved Sunyata passages against the original works before changing retrieval or the frozen acceptance set. Worker source revision remains null unless Cloudflare's deployed version tag is set to a 40-character Git SHA; run #58's version UUID alone cannot identify its source commit.

## October 25, 2026: run #59 diagnosis and source-voice carry-forward fix

Focused all-books with-review run [#59](https://github.com/jsynon/antilogicalism/actions/runs/40240399902) completed all five cases against the artifact's explicitly recorded library v48 and website revision `7d40c030eaadc2aab8a82cf8b04b8e05cc3ff130`. There were no request failures or planner fallbacks. The run passed 3/5 cases and 5/7 question parts; it contains no human rubric scores. The Worker build is `public-gateway-evidence-selection-v3`, but its source revision is still absent, so the artifact cannot identify the exact Worker commit.

The Sunyata trace isolates retrieval loss before composition. The planner searched `definition and essential nature of sunyata in Buddhist texts` and `how sunyata operates through dependent origination and emptiness`. The first query ranked several lexical matches from *Sacred Books of the East* and Hume above useful Buddhist evidence. The second supplied five searchable terms; the generic all-books relevance gate required at least three terms on a page. In v48 book 178, *Mūlamadhyamakakārikā — Nāgārjuna*, relevant text uses “dependent arising” and “emptiness,” while it does not contain the query's exact `sunyata`, `origination`, or `operates` terms on the same page. The inspected book shard has 420 pages, including the introduction's discussion of dependent arising and later discussion of emptiness and dependent arising, but no page met that three-term gate for the planner query. It therefore never entered the candidate packet. The direct question's ASCII-tokenized `sunyata` query also does not match this shard's OCR form of śūnyatā. The run consequently composed from Suzuki, Huston Smith, and an editorial introduction by David A. Dilworth; that evidence can support a narrow gloss or Zen context, not the requested general Buddhist definition. This is a query-vocabulary and relevance-threshold failure, not a missing v48 book or a composer/reviewer failure. The source volume mixes translation, introduction, and commentary, so any retrieval correction must retain page-level voice checks.

The other incomplete case was Nietzsche-on-Kierkegaard's synthesis. The answer correctly identified Johannes de Silentio in an earlier accepted claim, but later claims citing the same source voice were marked `pseudonymous-voice-unidentified` after more than three intervening accepted claims. `sourceVoiceAttributionIssue` searched only the last three accepted claims, although `normalizeReview` already retains the accepted claims for the answer. This is an unnecessary lookback limit at the existing review boundary.

The bounded Worker change removes that three-claim cap for prior attribution checks. Carry-forward remains limited to accepted, reviewed claims: editorial mediation is still tied to the exact same source ID, and pseudonymous attribution is still tied to a source whose curated work voice has the exact same name. It adds no stage, call, prompt expansion, retrieval rule, citation fallback, or public response change. A regression uses a named Silentio claim followed by three accepted claims and verifies that the later same-voice attribution carries forward; it also verifies that attribution cannot cross from Johannes de Silentio to Johannes Climacus.

| Candidate validation | Result |
|---|---|
| Focused source-voice regression | Pass; attribution survives more than three accepted intervening claims, while a distinct pseudonymous voice remains unidentified |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 268 passed, 0 failed |
| Answer-stage calls | Unchanged: composition plus review |
| Retrieval or corpus code | Unchanged; the Sunyata failure is diagnosed but not repaired by this attribution-only change |
| Remaining Sunyata work | Add a v48 regression proving relevant Nagarjuna pages enter the candidate packet, then address query vocabulary and/or the generic relevance gate without a one-question exception; review page voice before promoting those pages as primary evidence |
| Live validation | Pending; rerun the focused five-case with-review workflow after deploying this Worker change and verify that the Nietzsche/Kierkegaard synthesis remains supported. Sunyata needs a separate retrieval change and trace |

This closes the bounded speaker-attribution defect reproduced in #59, but does not establish improved answer quality or resolve Sunyata retrieval. Keep the unseen acceptance suite frozen until the separate Sunyata retrieval correction is tested and the cited pages are checked for source voice and semantic support.

## October 25, 2026: bounded Sunyata retrieval-threshold correction

The website retrieval candidate lowers the generic all-books evidence threshold for four- and five-term search facets from three local matching terms to two. The threshold now requires roughly half the facet's searchable terms in one passage, with a minimum of two and maximum of three. Comparison and named-author searches retain their existing two-term threshold; one-term queries retain their existing behavior; six-or-more-term unscoped facets still require three local terms. The local evidence window, phrase matching, ranking, book/page limits, source packet budget, and model-call count are unchanged. No Sunyata-only alias or question-specific branch was added.

The regression reproduces the run #59 planner wording and uses an OCR excerpt from v48 book 178, *Mūlamadhyamakakārikā — Nāgārjuna*, page 88. It verifies that the page's local “dependent arising” plus “emptiness” evidence passes retrieval, remains linked to the Sunyata question part, and survives the existing answer-source selector. The excerpt is in Kalupahana's introduction discussing Nagarjuna, not a Nagarjuna verse, so it tests passage reachability without treating it as direct author testimony. Negative controls verify that a page matching only one topic term stays out and two matching terms separated by more than the existing local evidence window do not qualify.

| Candidate validation | Result |
|---|---|
| Regression before threshold change | Fails as expected: book 178 page 88 is absent from retrieved candidates |
| Sunyata retrieval regression after change | Pass; page reaches the shared candidate pool and bounded answer packet with its question-part link |
| Negative controls | Pass; one-term overlap and terms outside the local window do not qualify |
| Full website/evaluator suite: `node --test reading-companion/*.test.mjs` | 183 passed, 0 failed |
| Whitespace validation | `git diff --check` passes |
| Live answer quality | Pending; this verifies passage reachability and handoff, not whether the retrieved page semantically answers the question or whether the final answer attributes its editorial voice correctly |

Run #61 below tested the merged website change against v48. It did not retrieve page 88 because the live planner facet no longer included the page's dependent-arising vocabulary; the initial five-term regression therefore did not represent the current live facet. The retrieval milestone remains open, and the report below records the revised next step.

## October 25, 2026: post-merge Sunyata run #61

After website PR #209 merged, the user ran the focused Sunyata case in all-books with-review mode. Run [#61](https://github.com/jsynon/antilogicalism/actions/runs/40245464263) completed one case against library v48 and website revision `ee94ba1779d07847345fabc96db38fa560d60225`. It had zero request failures, planner fallbacks, or skipped cases; it used the expected three Worker calls (one planner, composition, and review). The artifact reports two answer-stage calls and 135.99 neurons, one failed structural case, and no human rubric score. Worker source revision remains unavailable because the deployment has no Git-SHA version tag.

This run did not retrieve *Mūlamadhyamakakārikā*, book 178, page 88. Its two planner facets were `definition and essential nature of sunyata in Buddhist texts` and `how sunyata functions as emptiness or lack of inherent existence`; neither contains `dependent` or `arising`. `queryTerms` yields six terms for the second facet, so the shared threshold correctly remains three for that facet. The v48 page's relevant OCR contains “dependent arising” and “emptiness,” only one of which appears in the live facet. The direct question `What is sunyata?` supplies only the unmatched ASCII spelling. Book 178 page 88 was absent from every search result, the retrieval candidate pool, and the six-page composition packet. The passing regression had used #59's earlier five-term facet, so it exercised the lowered two-term threshold but did not match the planner wording generated in #61. This is the decisive limit exposed by the run: a threshold adjustment cannot recover a passage when the planner does not supply enough of that passage's searchable vocabulary.

The resulting answer cited three books/pages and displayed four exact, located highlights. Its surviving claims were that sunyata means “emptiness or a void,” that it is prominent in Mahayana/Prajnaparamita texts, and that it is discussed in Madhyamika and Zen contexts. The core gloss came from Huston Smith's comparative *Forgotten Truth*, while the Suzuki pages supplied Mahayana and Zen context. No retrieved passage established the concept through dependent arising or a primary Nagarjuna discussion, so the response remained shallow and the part was correctly marked partial. Highlight and citation identity checks passed; they do not establish that the passages fully answer the question.

The composer also offered an extra *soku-hi* explanation and verse using *Last Writings*, p. 17. The page is David A. Dilworth's editorial introduction, not Nishida's prose. Although the model reviewer returned “answered,” the deterministic voice gate rejected that claim because “a commentator” did not identify the editorial speaker (`editorial-source-attribution-unqualified`). The unsupported claim was removed. This is the intended source-voice safeguard working; it also contributed to the partial draft. Keep that safeguard. The next answer should either name Dilworth's introduction accurately or omit the commentary claim.

The next bounded retrieval work should address planner vocabulary, not lower this shared threshold again. Build a regression from #61's exact six-term planner query and real v48 page-88 OCR; ensure a source-native facet includes the indexed relation “dependent arising” alongside “emptiness” (and Nagarjuna where appropriate), then verify the page is linked to P1 and survives the same six-page packet without promoting unrelated one-term results. Rerun the focused case with review after that change. Keep the seven-question acceptance workflow frozen until the targeted run retrieves this page and the final answer attributes editorial evidence correctly.
## October 26, 2026: planner-vocabulary and page-voice candidate

The next candidate addresses the run #61 failure at the planner-to-search handoff. The Worker planner prompt now consolidates the overlapping definition, expression, and role/function guidance: keep the reader’s exact technical or traditional term in one query, and use another query slot for a likely gloss plus the source’s own defining relation or operation in vocabulary likely to occur in the text. The query remains a retrieval lead, not another requested answer part or proof. This adds no model call, stage, schema field, question-specific alias, or further threshold reduction.

Implementation review is in Worker PR [#251](https://github.com/jsynon/book-chatbot/pull/251) and website PR [#210](https://github.com/jsynon/antilogicalism/pull/210); this report update remains in PR [#250](https://github.com/jsynon/book-chatbot/pull/250).

The Worker regression captures the prompt contract for “What is sunyata?” and keeps the normalized plan to one requested part. The website v48 fixture reproduces run #61's exact second facet, `how sunyata functions as emptiness or lack of inherent existence`, and confirms page 88 is still absent under that wording. With the controlled source-native facet `Nagarjuna dependent arising emptiness`, the existing retrieval and packet-selection path finds book 178, page 88, links it to P1, and keeps it inside the six-page source packet. Existing one-term and distant-term negative controls remain. This verifies that suitable planner vocabulary can traverse the current retrieval handoff; the controlled query does not prove that a live planner will choose it.

I checked the original v48 PDF in Drive. Its title page credits David J. Kalupahana with the introduction, and the contents place the introduction through page 98; the indexed page 88 passage is therefore introductory commentary discussing Nagarjuna, not Nagarjuna’s translated verse. The page-voice contract now marks only book 178 with the exact catalog title and page 88 as an editorial introduction by Kalupahana, credited to Nāgārjuna. This existing metadata path gives the composer and reviewer the speaker context needed to avoid presenting Kalupahana’s interpretation as direct author testimony. The corresponding Worker and browser contract files had drifted in their quote-to-citation matching expression despite the shared-file comment requiring byte identity; the copies are synchronized in this candidate.

| Candidate validation | Result |
|---|---|
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 269 passed, 0 failed |
| Full website/evaluator suite: `node --test reading-companion/*.test.mjs` | 184 passed, 0 failed |
| Contract-copy synchronization | Pass; Worker and browser `reader-contract.mjs` files are byte-identical |
| Whitespace validation | `git diff --check` passes in both repositories |
| Live planner and answer quality | Pending; the fixture tests use controlled queries and do not establish model behavior or semantic sufficiency of the final answer |

After merging and deploying the Worker and website PRs, rerun only the focused Sunyata question in all-books with-review mode against v48. Confirm the live planner supplies indexed source vocabulary, page 88 reaches the submitted packet and stays linked to the definition part, and any use of it is attributed to Kalupahana’s introduction. Inspect the actual reviewed claims and citations for semantic support; a retrieval pass alone is insufficient. Keep the seven-question acceptance suite frozen until this targeted trace is satisfactory.


## October 26, 2026: focused five-question run #62

The all-books with-review workflow [#62](https://github.com/jsynon/antilogicalism/actions/runs/40247761530) completed all five cases against library v48. Its artifact is [12619846350](https://github.com/jsynon/antilogicalism/actions/runs/40247761530). There were no request failures, planner fallbacks, or skipped cases. Each case used one planner call and two answer-stage calls (composition and review), for 15 estimated Worker AI calls total. The run failed its structural evaluation gate, not because GitHub Actions or the Worker request path was unavailable. It passed 3/5 cases and 4/7 question parts; the prior focused five-case run #59 passed 3/5 and 5/7 parts, so this is no case-level gain and one fewer supported part. The artifact has no human rubric ratings.

The website used revision `ce1a6741a2fd25a6363dd227c06f226be3804e86`, the merge of website PR #210, and its Pages deployment succeeded. The user merged, pulled, and deployed the Worker before the run as usual.

| Question | Structural result | What the artifact establishes |
|---|---|---|
| What is transcendental idealism? | Pass; full | Kant’s *Critique of Pure Reason* and *Prolegomena* were cited, with located highlights. The answer explains appearances and things-in-themselves, but its final clause garbles the relation between appearances and things-in-themselves and becomes contradictory. The reviewer’s structural pass did not catch this semantic defect. |
| What did Kierkegaard say about faith? | Pass; full | Six source pages across four works support a broad account of faith, inwardness, paradox, and Kierkegaard’s critique of Christendom. The answer is evidence-rich but reads as a list of claims more than a synthesized explanation. |
| What did Nietzsche think about Christianity? | Pass; full | The answer uses Nietzsche’s critique of Christian morality and slave morality. However, the review trace flags an unsupported source relation, and the final wording that calls pity and self-denial “poison” goes beyond the mapped passage. This is another example of a structural pass that needs semantic checking. |
| What is sunyata? | Fail; partial | The answer cites Huston Smith and D. T. Suzuki for a narrow gloss and Mahayana/Zen context, with all cited highlights located. It does not reach v48 book 178, page 88, and does not explain the concept through dependent arising or a primary Nagarjuna discussion. The live second planner facet said “dependent origination” rather than the indexed “dependent arising”; the prior controlled-query regression therefore did not reproduce the live planner. A reviewer support issue also rejected an extra claim drawn from Dilworth’s editorial introduction, showing the voice safeguard worked. |
| What would Nietzsche think about Kierkegaard’s thought? | Fail; partial | Evidence from both authors reached the packet and the answer compares their positions, but it never gives the requested cautious inference about what Nietzsche would think. The missing item is synthesis/answer coverage, not retrieval of both sides. |

The highlights and cited-source identity checks passed for the selected passages, and all final cited source IDs mapped correctly. These are useful provenance checks, but they did not prevent the Kant contradiction or the Nietzsche unsupported relation, and they do not measure whether the answer fully addresses the reader’s question. Three structural passes should therefore not be treated as three verified high-quality answers.

The following provisional 0–2 scores are my review of the saved drafts and their cited evidence, not workflow-entered human scores. Dimensions are accuracy, question coverage, explanation, citation support, and citation completeness.

| Question | Accuracy | Coverage | Explanation | Citation support | Citation completeness |
|---|---:|---:|---:|---:|---:|
| Transcendental idealism | 1 | 2 | 1 | 1 | 2 |
| Kierkegaard on faith | 2 | 2 | 1 | 2 | 2 |
| Nietzsche on Christianity | 1 | 2 | 1 | 1 | 2 |
| Sunyata | 1 | 1 | 1 | 1 | 1 |
| Nietzsche on Kierkegaard | 1 | 1 | 1 | 1 | 1 |

This run validates workflow liveness and passage/citation plumbing, but not answer quality. It also shows that structural checks can accept semantically flawed wording. The immediate retrieval question is whether the live planner’s alternate terminology can reach source-native passages without lowering relevance or creating false part links. The separate Nietzsche-on-Kierkegaard synthesis gap and the questionable Kant and Nietzsche-on-Christianity passes remain answer-quality work; they should not be claimed as fixed by a retrieval change. Keep the unseen acceptance suite frozen until the focused traces and source-level review support broader validation.

## October 26, 2026: run #62 source-phrase retrieval candidate

The run #62 Sunyata facet used the valid phrase “dependent origination,” while the relevant v48 book 178 page-88 passage uses “dependent arising.” The retrieval candidate adds a small, explicit phrase-equivalence registry in the shared browser/evaluator index search. It applies to search text across books rather than branching on the Sunyata question. Both phrases expand to the same relevance concept; its words do not count as separate evidence matches. The existing minimum relevance threshold, result limits, page limits, answer packet size, and Worker call count are unchanged. No new model call, stage, or broad synonym generation was added. The registry currently contains this single source-attested translation pair; this run does not justify claiming a general semantic synonym engine.

The end-to-end regression uses the exact run #62 facet and a v48 OCR fixture. It confirms book 178 page 88 reaches the same bounded answer packet and remains linked to the definition part. The candidate also retains a negative control where a page contains only “dependent arising” without an independent matching concept; that page remains below the existing local evidence floor. The prior run #61 facet still misses page 88, and the four non-Sunyata planner facets from run #62 do not gain the new variant. To preserve the link through composition, one-part plans may associate a planner facet with their sole part when it shares one distinctive subject term after generic search framing is removed. Multi-part plans retain the two-term association rule, and named-source scoping is unchanged. These links indicate eligibility only; the Worker still validates sources and semantic support.

Page 88 remains Kalupahana’s editorial introduction discussing Nāgārjuna, not Nāgārjuna’s translated text. Existing page-specific provenance continues to require that attribution. Retrieving this page improves relevant contextual evidence but does not, by itself, establish a primary-source definition of śūnyatā or prove that the final answer is semantically complete.

| Candidate validation | Result |
|---|---|
| Exact run #62 facet through v48 retrieval fixture | Pass; page 88 enters retrieval and the bounded answer packet |
| Question-part handoff | Pass; page 88 stays linked to the single definition part through the actual part query |
| Phrase-only negative control | Pass; “dependent arising” alone is one concept and does not meet the existing evidence floor |
| Existing run #61 facet | Still misses page 88, as expected; it lacks the indexed relation rather than using an alternate translation |
| Other four run #62 planner facets | No “dependent arising” expansion is added |
| Website/evaluator suite: `node --test reading-companion/*.test.mjs` | 184 passed, 0 failed |
| Whitespace validation | `git diff --check` passes |
| Live answer quality | Pending; the fixture verifies retrieval and part linkage, not a live planner choice, source sufficiency, or final-answer accuracy |

The site implementation is under review in website PR [#211](https://github.com/jsynon/antilogicalism/pull/211). After the PR is merged and Pages publishes it, rerun the full focused five-question all-books with-review workflow once. Confirm page 88 reaches the submitted packet, its editorial voice is attributed correctly, and no false positives or part-link regressions appear across the other four questions. Score and inspect the final drafts separately: the run #62 retrieval fix does not resolve the missing hypothetical synthesis or the questionable wording in the Kant and Nietzsche-on-Christianity answers. Keep the unseen acceptance suite frozen until those answer-quality checks are satisfactory.

## October 26, 2026: focused five-question run #63

The all-books with-review workflow [#63](https://github.com/jsynon/antilogicalism/actions/runs/40250819999) completed five cases against library v48. It passed 5/5 structural cases and 7/7 question parts, with no request failures or fallbacks. This is a structural recovery from run #62, not proof of answer quality; the artifact has no independent human ratings.

The artifact has no `workerSourceRevision` or `workerSourceRevisions`, so it identifies the deployment-generated Worker version but not the source commit. The Worker already reads Cloudflare's version tag, validates a 40-character Git SHA, and returns it as `workerSourceRevision`; the website evaluator already preserves that field. Future diagnostic deployments should set the version tag to the checked-out Worker SHA.

The Sunyata planner queries were “definition and meaning of sunyata in Buddhist philosophy” and “how sunyata operates as a principle of emptiness and interdependence.” Neither included dependent arising/origination. The six selected passages did not include v48 book 178 page 88. This shows that the controlled retrieval regression did not reproduce the live planner's vocabulary; it does not explain why the planner omitted the concept. The Kierkegaard faith and Nietzsche-on-Christianity outputs also have questionable claim-to-page handoffs despite empty deterministic `supportIssues`. The artifact recorded claim-level review status but not enough of the evidence handoff to identify whether the reviewer chose a weak span or whether interpretation later overreached it.

The bounded Worker change records, in the authenticated evaluation trace for each answer claim and cited source, the candidate span IDs offered to review, the reviewer-returned IDs, the deterministic accepted span ID and exact bounded text, status, and validation outcome. It does not change planner, retrieval, composition, or public answer behavior and adds no AI call. Tests verify that a missing span is diagnosed and that an accepted span is the exact source substring.

Next, after merging and deploying the Worker with the 40-character SHA tag, rerun the same five-question all-books with-review diagnostic. Inspect the Sunyata planner queries and submitted pages, then compare reviewer candidate/returned/accepted spans against the corresponding Kierkegaard and Nietzsche claims. Review the page text before changing retrieval or reviewer behavior. Keep this as a cross-case diagnostic; do not expand into another Sunyata-only fix or run the unseen acceptance suite yet.


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
