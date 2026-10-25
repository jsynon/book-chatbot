# Reading Companion evidence milestone: release report

Last updated: October 25, 2026
Status: Worker PR [#240](https://github.com/jsynon/book-chatbot/pull/240) merged at 18:33 UTC before focused all-books with-review run #52, [40221892508](https://github.com/jsynon/antilogicalism/actions/runs/40221892508). The deployed trace shows the source-balanced six-span selection working: the reviewer returned nine spans for a three-source inference and the Worker retained two exact spans from each source. The run passed all 5/5 structural cases and all 7/7 question parts, with no request failures, planner fallbacks, or skipped cases. This is a real mechanical milestone, but the artifact's human-review rubric is blank and exact-span inspection found evidence-selection and answer-quality gaps in otherwise passing cases. The source-balanced logic, strict over-budget gate, two-answer-call budget, and the 53 focused / 253 full offline regression results are recorded below. No new code change is made from run #52. The earlier James 2:14–26 miss from run [40157017806](https://github.com/jsynon/antilogicalism/actions/runs/40157017806) was traced to scripture scope being dropped from part queries; that fix is merged in website PR #188.
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

## October 25, 2026: run #41 and provenance-to-highlight candidate

After Worker PR #230 and website PR #196 were merged and deployed, the user ran focused all-books with-review workflow [40176637186](https://github.com/jsynon/antilogicalism/actions/runs/40176637186). It completed all five cases on Worker version `0aa5a623-f687-406b-bb97-f4f467dbfc83`, source build `public-gateway-evidence-selection-v3`, site revision `d1f0e5607639a5e4d8eb42ccd14823cac1ef8ea5`, and corpus v47. It used the expected 15 AI calls, with no request failures, planner fallbacks, or skipped cases. Structural checks passed 4/5. Kant on transcendental idealism and sunyata moved from partial in run #40 to full. Kierkegaard on faith remained partial, which is still the correct machine outcome unless the retrieved passages establish the missing facet. Structural status does not replace semantic review.

Run #41 identified a presentation defect distinct from retrieval and answer validation. The sunyata answer cited its definition as S4, while the visible highlight list used S1–S3 because the Worker selected the first citations in retrieval order. The model had useful speaker/section context, but the final citation records and saved live-evaluation artifact did not preserve it. The follow-up candidate addresses both issues across the response contract:

- Shared `reader-contract.mjs` now owns a bounded provenance helper so browser, Worker, and evaluator share the same data shape. It retains credited authors/editors/translators and planner/section hints. Curated publication/page-voice labels are guarded by exact v47 book ID plus exact title; *Fear and Trembling*, *Philosophical Fragments*, and *The Sickness Unto Death* identify their pseudonymous work voices, while *Last Writings* page 18 identifies David A. Dilworth's introduction. Work-level pseudonym metadata is explicitly separate from the speaker on an individual page.
- Final citation rows include provenance. The site displays only the curated distinctions it can state safely, and otherwise labels an introduction as having an unconfirmed page speaker.
- The Worker selects up to three highlights in the answer's inline citation order, then fills remaining slots with additional distinct verified spans. A citation with no verified reviewer span receives no fabricated preview highlight. The site and source reader expose that absence clearly rather than presenting an arbitrary excerpt as a key passage.
- The live evaluation artifact serializes bounded provenance fields so future runs can be audited without relying on prompt-only traces.

The candidate preserved source fingerprint checks, reviewer strictness, retrieval/page limits, and the 15-call estimate. Paired PRs [#231](https://github.com/jsynon/book-chatbot/pull/231) and [#197](https://github.com/jsynon/antilogicalism/pull/197) were merged and deployed before run #42. That run and the follow-up are recorded below. The unseen acceptance suite remains frozen until the deployed five-case results and cited passages are reviewed.

## October 25, 2026: run #42 and review/retrieval follow-up

After Worker PR #231 and website PR #197 were merged, the user ran focused, all-books, with-review workflow [40179065982](https://github.com/jsynon/antilogicalism/actions/runs/40179065982). The artifact records site revision `0d614bdb82bcfaf3ad17ea1d116fd6ca160da57b`, Worker version `7d036e8c-e02a-449a-9e22-7e0d786c9449` (`public-gateway-evidence-selection-v3`), and corpus v47. All five cases completed; there were no request failures, planner fallbacks, or skipped cases. The expected baseline remained 15 AI calls. Structural checks passed 3/5; all human rubric fields remain pending, so this is not a semantic answer-quality score.

The two failures were distinct:

- **Nietzsche on Christianity:** Composition produced a cited draft, but the reviewer returned invalid JSON. The outer Markdown fence was not the cause—the current parser already removes a complete fence. Inside it, the reviewer put unescaped quotation marks around the phrase `denial of the self` in a JSON `reason` string. The Worker correctly marked the review as `model-output-invalid-format` and withheld verified status and evidence highlights.
- **Nietzsche and Kierkegaard:** The Nietzsche-specific query returned no indexed pages. The broad question search did return an incidental Nietzsche-book hit, but it did not become a candidate linked to Nietzsche's answer part. That unrelated hit tripped an existing `alreadyFound` guard, suppressing the bounded retry with Kierkegaard's topic terms restricted to Nietzsche's planned books. The six-page submitted packet therefore contained only Kierkegaard pages. The reviewer also emitted a duplicate top-level `parts` property; ordinary JSON parsing retained the later list, dropping Nietzsche's decision, and the Worker correctly rejected the incomplete review contract.

The paired follow-up changes only the two existing handoff points:

- The reviewer prompt now requires one unfenced JSON object and tells the model not to use quotation marks in free-text reasons; span IDs already carry the exact evidence reference. The current Gemma model is not listed among Cloudflare Workers AI's documented JSON Mode models, so the Worker does not send an unsupported `response_format` option. There is no repair-model call or new dependency. Existing parsing and contract checks remain authoritative: malformed JSON stays unverified, and a duplicate `parts` key that loses a planned decision remains contract-incomplete.
- The website now performs its existing one-time, source-scoped comparison retry whenever a named side's own facet is empty and the counterpart facet has results, even if the broad question facet contains an incidental hit from that side. This lets a relevant Nietzsche candidate reach the already part-aware, author-balanced six-page selector. The retry stays restricted to the planned Nietzsche books; if no qualifying page is found, the answer remains safely partial. It adds one local index search only in that case, with no AI call, page-cap increase, or citation-validation relaxation.

| Validation | Result |
|---|---|
| Worker focused evidence-answer tests | 40 passed, including malformed-quote fail-closed and duplicate-`parts` contract regressions |
| Website focused evidence-search tests | 58 passed, including an incidental broad-hit retry regression that verifies both authors reach the bounded answer packet |
| Full Worker suite: `node --test --test-reporter=dot hosting-poc/*.test.mjs` | 240 passed, 0 failed |
| Full website suite: `node --test --test-reporter=dot reading-companion/*.test.mjs` | 177 passed, 0 failed |
| Shared Worker/site `reader-contract.mjs` | Byte-identical |
| `git diff --check` | Passed in both repositories |
| Model-call budget / packet limit | Unchanged: 15 baseline calls across five reviewed cases; six submitted pages maximum |
| Semantic answer review | Pending; structural tests do not prove that a recovered Nietzsche passage supports the comparison |

The paired follow-up was delivered in Worker [PR #233](https://github.com/jsynon/book-chatbot/pull/233) and website [PR #199](https://github.com/jsynon/antilogicalism/pull/199); both were merged before the next run. Their checks passed ([Worker run 40181348428](https://github.com/jsynon/book-chatbot/actions/runs/40181348428), [website evaluation 40181346756](https://github.com/jsynon/antilogicalism/actions/runs/40181346756), [website smoke 40181346801](https://github.com/jsynon/antilogicalism/actions/runs/40181346801)). The v48 live-evaluator correction followed in website [PR #201](https://github.com/jsynon/antilogicalism/pull/201), also merged before run #45. The five-case v48 results and remaining source-level checks are recorded below. Keep the unseen acceptance suite frozen until those checks are satisfactory.


## October 25, 2026: v48 focused run #45

After website PR #201 corrected the v48 preflight, focused workflow [40183728454](https://github.com/jsynon/antilogicalism/actions/runs/40183728454) completed all five configured cases with `all-books` and `with-review`. The artifact records site revision `d7e459b21d88c41bad0d964b0c58b5892c64db25`, corpus v48 at `data-v48/`, fingerprint schema v2, and Worker version `fbbfccdd-4226-4479-b53f-86bacdcbabbb` (`public-gateway-evidence-selection-v3`). This is the five-question focused regression set, not the separate seven-question holdout.

| Run measure | Result |
|---|---|
| Cases | 5 completed; 0 skipped |
| Structural result | 4 passed, 1 failed |
| Request failures / planner fallbacks | 0 / 0 |
| Estimated baseline calls | 15; no conditional repair calls recorded |
| Corpus / fingerprint pairing | v48 / v2; preflight succeeded |
| Question-part decisions | 6 supported, 1 partial, 0 unsupported across 7 parts |
| Highlights | 12 exact-text-located highlights on the four verified answers; none on the safely unverified draft |
| Artifact human rubric | Pending for all five cases; no semantic scores were written by the workflow |

The main failure changed from run #42's malformed reviewer response to a completion-length failure. For Nietzsche on Christianity, composition produced a five-claim cited draft, but the reviewer ended with `finish_reason: length` at exactly 1,800 completion tokens. Its response echoed much of the submitted review payload and was cut off inside a source-span object, so it was not valid JSON. The Worker correctly kept the answer `unverified-source-draft`, marked the part partial, and emitted no evidence highlights. This is evidence of reviewer-output truncation, not proof that each draft claim is false. The prompt addition in PR #233 did not prevent this distinct failure mode. The current review path allows 1,800 completion tokens and makes no extra repair call.

There are concrete gains in the other cases. The Nietzsche/Kierkegaard retrieval packet now contains three Nietzsche pages and three Kierkegaard pages, and all three planned answer parts have structural evidence links; the missing-author retrieval defect from run #42 did not recur. The sunyata answer's highlight list begins with the cited definition on *Forgotten Truth*, p. 66, followed by its Suzuki citations; all three excerpts are text-located. The Kant answer cites the relevant passages in *Critique of Pure Reason*, p. 199, and *Prolegomena*, p. 22.

My manual scores below are an independent read of the draft and available source text on a 0–2 scale. They are not scores from the artifact. The Nietzsche/Christianity draft remains unverified, and its *Portable Nietzsche*, p. 578 citation has editorial/source-voice ambiguity that needs page-context review. The two Kierkegaard answers summarize works whose curated metadata identifies pseudonymous voices (Johannes de Silentio, Johannes Climacus, and Anti-Climacus), but the prose attributes the views directly to Kierkegaard without naming that mediation. The Nietzsche/Kierkegaard hypothetical is clearly labeled as inference, yet its final inference sentence cites Nietzsche's framework without also citing the Kierkegaard passage it says Nietzsche would critique. Sunyata draws on Suzuki and Huston Smith commentary rather than a primary Buddhist text and compresses emptiness to “emptiness or a void”; it is usable as an introduction, with that scope and qualification made clear.

| Case | Accuracy | Question coverage | Explanation quality | Citation support | Citation completeness |
|---|---:|---:|---:|---:|---:|
| Kant: transcendental idealism | 2 | 2 | 1 | 2 | 2 |
| Kierkegaard: faith | 1 | 2 | 1 | 1 | 2 |
| Nietzsche: Christianity (unverified draft) | 1 | 2 | 1 | 1 | 2 |
| Sunyata | 1 | 2 | 1 | 2 | 2 |
| Nietzsche and Kierkegaard | 1 | 2 | 1 | 1 | 1 |

The next fix should target reviewer completion reliability without adding a model call: reduce redundant review-payload fields and require a compact decision-only JSON response while retaining per-claim/per-cited-source span checks and provenance context. Add a regression for `finish_reason: length` to preserve the fail-closed behavior and make the incomplete-review reason visible in diagnostics. Do not treat a higher token ceiling alone as proof of reliability. After that change, rerun these same five v48 cases and inspect the exact speaker/page context for Kierkegaard and the Nietzsche p. 578 passage, along with the final inference citation.

## October 25, 2026: run #45 reviewer handoff and page attribution follow-up

Focused all-books with-review workflow [40183728454](https://github.com/jsynon/antilogicalism/actions/runs/40183728454) ran the five focused questions on corpus v48. Four of five cases passed structural checks; the Nietzsche-on-Christianity review failed during formatting. The reviewer reached its 1,800-token output cap (`finish_reason: length`) after echoing the large submitted payload and was cut off inside a span decision. The answer correctly remained an unverified source draft, with no evidence map or highlights. The run used the established 15-call estimate; this failure did not justify a repair call or a higher call budget.

The paired candidate tightens that existing handoff. The reviewer now receives only each claim's ID, text, and cited source IDs, plus exact ranked review spans for those cited pages. It no longer receives repeated candidate-source lists, page book IDs, fingerprints, or unbounded context text. Its output is a compact per-claim decision with span IDs grouped by cited source; free-text rationales are removed because they do not establish evidence. A normalizer accepts the compact shape and the observed legacy evidence-array shape, then performs the same exact-ID and per-cited-source checks against server-held fingerprint-verified spans. The reviewer output cap is 1,200 tokens, while composition stays at 1,800. If the review ends with a length limit, the Worker records `review-output-truncated` at stage `review` and remains fail-closed without an additional model call. Existing public status compatibility is retained as `review-format-failed`; authenticated traces and evaluation artifacts carry the specific failure code.

Source inspection also resolved the page-voice question for the run's Nietzsche material. In *The Portable Nietzsche* (book ID 239), p. 578 is Walter Kaufmann's editorial commentary, while inspected pages 547 and 582 contain direct Nietzsche text. The shared Worker/site reader contract therefore tags only page 578, guarded by the exact v48 book ID and title. The composer and reviewer are told to preserve known pseudonymous work voices, and the site citation label distinguishes Kaufmann's commentary from the work's credited author. This is page-specific metadata, not a claim that all editorial material in the volume has been cataloged.

| Candidate validation | Result |
|---|---|
| Focused Worker evidence-answer tests | 43 passed, 0 failed |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 243 passed, 0 failed |
| Focused site attribution and live-audit tests | 44 passed, 0 failed |
| Full site suite: `node --test reading-companion/*.test.mjs` | 180 passed, 0 failed |
| Shared Worker/site `reader-contract.mjs` | Byte-identical |
| `git diff --check` | Pending final branch validation |
| AI-call budget / page packet | Unchanged: 15 baseline calls for five reviewed focused cases; six-page answer packet maximum |
| Deployed run and semantic review | Pending; offline structure does not establish that cited pages support every answer claim |

This is a paired local candidate and has not been merged or deployed. After both repository checks pass and the changes are deployed, repeat the same five-case focused all-books with-review run. Inspect the exact reviewer output and `finish_reason`, confirm the former truncation is gone without weakening exact-span checks, and review the Nietzsche-on-Christianity source attribution and visible excerpts against the cited page text. Keep the unseen acceptance suite frozen until that source-level review is complete.

## October 25, 2026: run #46 compact-review validation

After Worker PR [#235](https://github.com/jsynon/book-chatbot/pull/235) and website PR [#202](https://github.com/jsynon/antilogicalism/pull/202) merged, the user ran [focused workflow #46](https://github.com/jsynon/antilogicalism/actions/runs/40211508465) with All Books and review enabled. The artifact records site revision `16e770e3d59425342f7af840d90390a87ed6a8c6`, Worker version `4b4e359d-408f-4169-83ab-100c27d39a3f`, and corpus v48 with fingerprint schema v2. All five cases completed; there were no request failures, planner fallbacks, or skipped cases. The run used the expected 15-call baseline. Four cases passed structural checks and one failed, so the workflow is red despite completing the full set.

The key run #45 failure improved: Nietzsche on Christianity now passes review. In the failing Nietzsche/Kierkegaard case, the compact reviewer returned normally with `finish_reason: stop` and 586 completion tokens, rather than truncating at the token limit. However, its JSON was invalid: the unanswered claim ended with the malformed property `"spansBySource:{}` (missing the closing quote after the key), and the response put part statuses in a non-contract top-level `parts_status` map. The model had supplied all claim IDs and span decisions, and marked the final hypothetical inference claim unanswered. Because JSON parsing failed, the Worker correctly rejected the entire review, kept all three answer parts partial and unverified, and returned no evidence map or highlights. This is a format failure, not evidence that the whole draft is unsupported; the reviewer's unanswered inference is still a useful signal.

| Case | Structural result | Accuracy | Question coverage | Explanation | Citation support | Citation completeness |
|---|---|---:|---:|---:|---:|---:|
| Kant: transcendental idealism | Pass | 2 | 2 | 1 | 2 | 2 |
| Kierkegaard: faith | Pass | 1 | 2 | 1 | 2 | 2 |
| Nietzsche on Christianity | Pass | 2 | 2 | 2 | 2 | 2 |
| Sunyata | Pass | 1 | 2 | 1 | 2 | 1 |
| Nietzsche on Kierkegaard | Fail; unverified | 1 | 1 | 1 | 1 | 1 |

These 0–2 scores are my provisional manual reading of the drafts and the artifact's exact selected spans, not workflow scores. The artifact leaves all five human scorecards pending. The averages are accuracy 1.4, coverage 1.8, explanation 1.2, citation support 1.8, and citation completeness 1.6; the failed draft is scored as a draft, not as a verified answer.

The passing answers contain meaningful progress, with remaining quality limits:

- **Kant:** One direct *Critique of Pure Reason* passage (p. 199) supports the definition and all five claims. The explanation repeats the appearance/representation point and does not fully distinguish empirical reality from things-in-themselves.
- **Kierkegaard:** Exact excerpts support all seven claims, and the response now names Johannes de Silentio. But it also draws on *Philosophical Fragments* (Johannes Climacus) and *The Sickness Unto Death* (Anti-Climacus) without naming those voices, so it still generalizes distinct pseudonymous authors as Kierkegaard's single position.
- **Nietzsche on Christianity:** This previously failing case is now structurally verified. The answer draws on direct Nietzsche passages in *The Portable Nietzsche*, pp. 462, 463, 502, and 605, with exact claim-linked spans. Page 578, the Walter Kaufmann commentary page tagged by PR #202, was retrieved but not cited; this run therefore does not validate the new visible commentary label.
- **Sunyata:** The definition is directly supported by Huston Smith, and Suzuki supports the cited discussion of Zen. Other claims rely on David A. Dilworth's introduction to Nishida's *Last Writings* (pp. 17–18). The answer treats that commentary as a broad account of sunyata and expands into `soku hi`; a primary Buddhist source and a more qualified explanation would improve it.
- **Nietzsche and Kierkegaard:** Retrieval supplies three Nietzsche pages and three Kierkegaard pages in the six-page packet. The draft names Johannes de Silentio and presents its conclusion as a cautious inference. That concluding inference cites Nietzsche pages only, not the Kierkegaard passage defining the target concept; the reviewer marked that claim unanswered. The formatting error prevented the system from accepting this useful distinction.

| Run measure | Result |
|---|---|
| Completed / skipped | 5 / 0 |
| Structural cases | 4 passed, 1 failed |
| Question-part outcomes | 4 supported, 3 partial, 0 unsupported; all three partial parts are in the unverified final case |
| Verified answer highlights | 12 across the four passing cases; none on the unverified draft |
| Answer-stage calls | 10 total (two per case); expected total including planning: 15 |
| Reviewer output in failed case | 586 tokens; `finish_reason: stop`; not truncated |
| Artifact human rubric | 0 reviewed, 5 pending |

The next bounded step is a deterministic format-recovery regression using this exact malformed response. Any recovery must preserve claim IDs, part completeness, and the current exact-span checks; it must not invent evidence or make an extra model call. Then rerun the same focused five-case set once. Track the remaining pseudonymous-voice and secondary-source issues separately rather than broadening this formatting fix. Keep the unseen acceptance suite frozen until the new run and source-level review are satisfactory.

## October 25, 2026: standalone run #47 and cross-author inference handoff

The user reran Nietzsche on Kierkegaard by itself in focused, all-books, with-review mode ([workflow #47](https://github.com/jsynon/antilogicalism/actions/runs/40212305825)). It completed one case with no request failure or planner fallback, using Worker version `35f82015-9600-4d32-b212-b7570273faf9` (`public-gateway-evidence-selection-v3`) and `reader-evidence-v2`. The artifact estimates three calls total (one planner plus the existing two Worker answer calls); the answer pipeline used two calls. The reviewer returned valid compact JSON and stopped normally, so the malformed JSON from run #46 did not recur.

The system still failed its structural acceptance check: one of three question parts was supported, two were partial, and none were unsupported. The draft correctly named Johannes de Silentio in one sentence, but other Kierkegaard statements still collapsed pseudonymous voices into Kierkegaard's own position. More directly tied to this case, the final sentence asked what Nietzsche would think about Kierkegaard's emphasis on inwardness and cited Nietzsche sources only (`[S1, S6]`); it did not cite a Kierkegaard source for the premise. The reviewer marked that inference claim partial. The pipeline then omitted that claim from the returned answer. This is a valid-review, incomplete-evidence handoff, not a planner, request, or JSON-format failure. It pinpoints the next problem as composition's source linkage for a hypothetical cross-author conclusion.

The Worker candidate in this PR addresses that specific gap without changing retrieval, the shared Worker/site contract, the public response format, or the model-call budget:

- The composer prompt requires the two authors' positions to be established separately, labels the hypothetical conclusion as a cautious reader inference, and requires citations from both author source groups. It must leave the hypothetical conclusion unsupported if either premise lacks evidence.
- The reviewer prompt says not to demand a historical passage documenting an imagined response. It instead assesses each premise against its own author's cited spans, accepts only a modest inference, and keeps one-sided or overreaching claims partial or unanswered.
- A deterministic pre-review check recognizes hypothetical author-response questions and gates each attempted inference sentence. The sentence must be explicitly labeled and qualified and cite at least one source from every planned primary/subject author group. A failed sentence is rejected into the existing incomplete-coverage path; it cannot become a verified citation or highlight. The existing reviewer span checks remain authoritative for sentences that pass this source-link gate.
- Regression tests cover a qualified two-source inference, a one-sided citation, an unqualified hypothetical claim, and the existing answer/citation behaviors. No additional AI call is introduced.

This is a bounded attempt to fix the exact transition shown by run #47, not evidence that the answer is now reliable. Local validation passed: 46 focused `evidence-answer` tests and all 246 Worker tests, with no failures. `git diff --check` is clean. After merge and Worker deployment, first repeat the standalone Nietzsche/Kierkegaard focused all-books with-review case. Inspect the final inference sentence, its two author-source citations, and the selected exact spans; confirm structural completion and no fabricated historical attribution. If it passes, rerun the established five-question focused suite once to check for collateral effects, especially pseudonymous voice attribution. Do not call the milestone complete from offline tests or this one-case regression; keep live semantic verification and the frozen acceptance suite pending until the deployed results support that conclusion.

## October 25, 2026: run #48 reviewer format and citation-binding failures

The focused all-books with-review workflow [#48](https://github.com/jsynon/antilogicalism/actions/runs/40214265811) tested one Nietzsche/Kierkegaard case with `reader-evidence-v2`. The artifact records Worker version `4a1d8a43-b273-43dd-ab0c-677409e9ed27`. The request and planner completed without fallback; composition and review used the expected two Worker answer calls (three calls total including planning). The structural result was 0/1. The reviewer stopped normally, rather than reaching its output limit, but returned malformed JSON at `"spansBySource:{}`. The Worker failed closed: it accepted no review map or highlights and kept all three parts partial. This isolates a format-contract failure in the reviewer handoff.

The trace also exposed two independent sentence-to-evidence defects in the composed hypothetical conclusion. The conclusion combined a Nietzsche-based inference and a Kierkegaard contrast in one sentence with separate citation groups (`[S4]` and `[S2,S3]`). The deterministic guard pooled citations across the sentence, so it treated the inference as two-sided even though its own group cited only Nietzsche. Then the quotation audit's greedy search attached “fictitious morality” to the later `[S2,S3]` group instead of the first `[S4]` group, which contains the quoted words. The audit therefore removed the inference sentence. These are code-boundary failures; the relevant Nietzsche and Kierkegaard pages were present. The revised composer prompt from PR #236 was active, and its direction alone did not prevent either defect. Pseudonymous voice naming improved in the draft, but the failed review prevented an accepted answer. No artifact rubric scores were supplied.

## October 25, 2026: run #48 handoff repair candidate

The current Worker candidate addresses the two deterministic linkage failures and makes the review response smaller and less nested:

- A hypothetical conclusion must be a standalone sentence. Its one citation group must contain source IDs from every planned author group. Separate citation groups elsewhere in the same sentence can no longer satisfy that gate.
- The exact-quote audit binds a quoted phrase to the first following citation group in its sentence, including a citation placed after sentence-ending punctuation. It cannot borrow a later comparison citation. Regression coverage reproduces the run #48 order (`[S4]`, then `[S2,S3]`) and checks quotes followed by additional sentence text.
- Reviewer output now has separate root-level `parts` and `claims` arrays. Each claim returns source-encoded span IDs such as `S1-Q2`; the Worker derives the source ID and checks the selected ID against that claim's cited pages and its exact server-held span map. Part coverage stays explicit. Missing, duplicate, unknown, or malformed decisions remain fail-closed; invalid extra span IDs cannot enter the evidence map.
- The evaluator and integration-test fixtures use the same compact response contract, so the Worker-level path and public pilot test exercise the actual schema together.

The change stays inside the Worker answer path. It does not alter retrieval, corpus/fingerprint verification, the public response fields, site integration, model choice, or the two-call compose/review budget. No new repair call or JSON-mode dependency is introduced. Repository tests establish contract and evidence-map behavior; they cannot establish that a deployed model will always return valid JSON or that a semantic inference is sound.

| Candidate validation | Result |
|---|---|
| Focused evidence-answer tests | 49 passed, 0 failed |
| Full Worker tests: `node --test hosting-poc/*.test.mjs` | 249 passed, 0 failed |
| `git diff --check` | Passed |
| Live workflow / semantic review | Pending merge and Worker deployment |

After this candidate is merged and deployed, rerun the standalone Nietzsche/Kierkegaard focused all-books with-review case first. Confirm that the reviewer returns the flat shape and valid span IDs, the final inference is a standalone sentence with both author groups in one citation group, and the exact selected spans support each premise. Then rerun the established five-case focused set once for collateral effects. Structural completion is necessary but not sufficient; manually inspect the answer's authorship and source passages. Keep the broader unseen acceptance set frozen until those checks pass.

Worker PR [#237](https://github.com/jsynon/book-chatbot/pull/237) merged on October 25 at 17:23 UTC and was deployed before run #49. The run's flat reviewer contract and two-call answer path confirm that this repair was active. The result and the next review-handoff finding are recorded in the run #49 entry below.


## October 25, 2026: run #49 and claim-specific reviewer handoff

After Worker PR #237 was merged and deployed, the focused five-question all-books with-review workflow [40216345480](https://github.com/jsynon/antilogicalism/actions/runs/40216345480) ran on corpus v48, site revision `cce7533bcba0988c301452d9f999233f8586e053`, Worker version `bdc599a9-ab6d-49c6-a5bc-3559a510bb77`, and source build `public-gateway-evidence-selection-v3`. All five cases completed with no request failures, planner fallbacks, or skips. Structural checks passed 4/5. The run used the expected 15 estimated calls (10 Worker answer calls) and all 15/15 highlights were located in source text. These are useful structural and trace results, not a semantic accuracy score.

The remaining miss was Nietzsche on Christianity. The draft sentence `P1-C3` joined two material claims: moral degradation of imagination and rejection of both the lowest and highest desires. It cited S4 (*The Portable Nietzsche*, p. 502) and S5 (p. 607). Both pages were present in the evidence packet, so this was not retrieval loss. The reviewer selected only S5-Q7, which supports the imagination clause, and omitted S4-Q2, which supports the desires clause. The existing Worker correctly downgraded the claim and kept the question partial. This is a reviewer claim-to-source handoff problem; the current prompt's generic one-main-claim instruction had not prevented the compound sentence.

The next Worker candidate addresses this at the smallest shared boundary:

- The composer now explicitly separates claims when different passages support them and keeps each citation beside its sentence.
- The review request adds a `sourceEvidence` index to each claim: for every cited page, it lists up to three span IDs ranked against that exact claim. Exact source text still appears once in the page evidence list; the index adds pointers, not duplicate quotations.
- The reviewer is told to use the pointers to locate claim-specific evidence and to return a relevant span from every cited page before marking a claim answered. If a cited page does not support a material clause, it must mark the claim partial or unanswered.
- The Worker response schema and `normalizeReview` fail-closed gate are unchanged. The Worker still resolves returned IDs only against exact spans built from fingerprint-verified pages and requires a selected span from every source cited by the sentence. Retrieval, the public response contract, model choice, and the two-call compose/review budget are unchanged.

| Candidate validation | Result |
|---|---|
| Focused evidence-answer tests | 50 passed, 0 failed |
| Full Worker tests: `node --test hosting-poc/*.test.mjs` | 250 passed, 0 failed |
| Claim-specific regression | Missing S4 span remains partial; selecting one exact span from S4 and S5 yields full coverage |
| Answer calls in regression | 2 (composition and review), unchanged |
| `git diff --check` | Passed |
| Worker PR | [#238](https://github.com/jsynon/book-chatbot/pull/238) open; GitHub contract workflow [#714](https://github.com/jsynon/book-chatbot/actions/runs/40218084523) passed |
| Deployed live run / semantic review | Pending |

After merge and Worker deployment, repeat the same five-question focused all-books with-review workflow once. Inspect the Nietzsche/Christianity answer to confirm separate claims are cited locally and each reviewed claim maps to the relevant page span. Also inspect the exact span text and visible highlights; a structural pass alone does not establish semantic correctness. Keep other observed quality questions and the unseen acceptance suite as separate validation work.

## October 25, 2026: run #50 and multi-part reviewer contract

After Worker PR #238 was merged, the focused five-question all-books with-review workflow [40218461270](https://github.com/jsynon/antilogicalism/actions/runs/40218461270) ran on corpus v48, site revision `cce7533bcba0988c301452d9f999233f8586e053`, Worker version `17721275-cc7a-471a-98fd-302cf81308a0`, and source build `public-gateway-evidence-selection-v3`. All five requests completed without failures, planner fallbacks, or skipped cases. Structural checks passed 4/5; 4/7 question parts were supported, with three partial and no unsupported parts. The trace estimated 15 AI calls (one planner and two answer calls per case). All 15/15 highlights were located in source text. The evaluator's human-review rubric was blank, so these structural results do not establish semantic accuracy.

The four structural passes covered transcendental idealism (Copleston, p. 126; Kant's *Prolegomena*, p. 22), Kierkegaard on faith (*Fear and Trembling*, pp. 13 and 32; *Philosophical Fragments*, p. 55; *The Sickness Unto Death*, p. 93), Nietzsche on Christianity (*On the Genealogy of Morality*, p. 46; *The Portable Nietzsche*, pp. 547 and 594), and sunyata (D. T. Suzuki, pp. 48 and 53; Dilworth's introduction to Nishida's *Last Writings*, p. 18; *The Forgotten Truth*, p. 66). The Nietzsche/Christianity case that failed structurally in run #49 passed after PR #238 added claim-specific span pointers; its S4 and S5 evidence reached the relevant claims. The sunyata answer still used broad claims and did not consistently identify Dilworth's commentary as commentary.

The remaining structural miss was Nietzsche on Kierkegaard. The reviewer returned a root `parts` array followed by repeated root `claims` arrays for P1, P2, and P3. `JSON.parse` retained only the final claims array. The Worker's existing `normalizeReview` detected the missing P1/P2 claim decisions and correctly returned an unverified partial answer; the review request itself completed normally and was not truncated. This is a serialization/input-shape failure, not a reason to relax validation. Separately, the draft compared Nietzsche's criticism of Christian morality with Johannes de Silentio's emphasis on religious inwardness but did not answer what Nietzsche might think of Kierkegaard. Both author-side parts had evidence, but the requested synthesis inference was absent.

The current Worker candidate addresses both failures at their shared answer/review boundary:

- Review input retains per-part question and page evidence but moves every claim into one root `claims` array. Each claim carries `partId`, `claimId`, text, source IDs, and claim-specific span pointers. The reviewer output contract remains flat and unchanged; the prompt now shows a multi-part example and explicitly allows only one `claims` property.
- The strict normalizer still detects missing, duplicate, unknown, or malformed decisions and resolves spans only against fingerprint-verified source text. The regression reproduces duplicate `claims` keys in raw JSON and verifies that parsing cannot leak evidence for the claim lists that were dropped.
- The composer is told that comparison alone does not answer an author-to-author hypothetical. If a two-source synthesis part has no standalone attempted inference, that part is marked partial with a `hypothetical-inference-missing` trace gap, even if the reviewer labels its comparison answered. It preserves the useful comparison and adds no model call. Existing wording and both-source citation checks still reject overconfident or one-sided inferred claims.
- The public schema, retrieval, model choice, source verification, and compose-plus-review call budget are unchanged.

| Candidate validation | Result |
|---|---|
| Focused evidence-answer tests | 52 passed, 0 failed |
| Full Worker tests: `node --test hosting-poc/*.test.mjs` | 252 passed, 0 failed |
| Duplicate-claims regression | Reproduces JSON key collapse; missing P1/P2 decisions stay fail-closed, with no corresponding evidence exposed |
| Hypothetical inference regressions | Both-source cautious inference is supported; comparison-only synthesis is partial; one-sided inference remains incomplete |
| AI calls in regressions | 2 (composition and review), unchanged |
| `git diff --check` | Passed |
| Worker PR | [#239](https://github.com/jsynon/book-chatbot/pull/239) merged at 18:12 UTC before run #51 |
| Deployment / follow-up run | Worker version in run #51 confirms the flat reviewer and hypothetical-inference changes were active; see run #51 below |

The run #51 follow-up is recorded below. Its results confirmed that the two run #50 issues were addressed, while revealing a separate span-budget failure in multi-source reviewer evidence.

## October 25, 2026: run #51 and source-balanced reviewer evidence

After Worker PR #239 merged at 18:12 UTC, the focused five-question all-books with-review workflow [40220208494](https://github.com/jsynon/antilogicalism/actions/runs/40220208494) ran at 18:13 UTC on the same website revision as run #50. It used Worker version `214f4d99-86e4-42c5-bbf8-0fde162dded5` and source build `public-gateway-evidence-selection-v3`. The trace contains the new comparison-alone instruction and shows the reviewer request with one root `claims` array, 12 claims, explicit `partId` values, and no nested claim arrays. The workflow completed all five cases, with 0 request failures, 0 planner fallbacks, and 0 skipped cases. It estimated 15 AI calls. All 15/15 highlights were located in source text, which confirms quote location but does not establish semantic support. The automated result was 2/5 structural cases and 4/7 supported parts; 3 parts were partial and none unsupported. All five human-review rubrics remained blank, so no human semantic scores are recorded.

| Case | Result | Trace finding |
|---|---|---|
| Kant: transcendental idealism | Partial | The reviewer marked one claim partial even though its selected span on *Critique of Pure Reason*, p. 199 directly states that extended bodies or series of changes have no self-subsistent existence apart from human thought. The review contract itself was valid. This looks like a reviewer false negative or an overly broad paraphrase, not missing retrieval. |
| Kierkegaard on faith | Pass | Full structural coverage; citations map to five selected passages. |
| Nietzsche on Christianity | Pass | Full structural coverage; the claim-specific handoff fix from PR #238 remains effective. |
| Sunyata | Partial | The reviewer correctly downgraded a claim that conflated two relations: the page describes Zen as practically belonging to the Madhyamika school and separately says Zen's ultimate significance upholds the Sunyata system. That does not establish the answer's phrasing that Madhyamika is the practical application of Sunyata. The unsupported extra claim was removed, leaving the requested definition and other supported points. |
| Nietzsche on Kierkegaard | Partial | The answer now includes the requested cautious, standalone inference, and reviewer output contains spans from Nietzsche and both cited Kierkegaard pages. However, `normalizeReview` considers only `decision.spanIds.slice(0,6)`. The reviewer returned three ranked spans for each of the claim's three cited source IDs (nine total); the first six covered the first two sources, so the third source was discarded before validation. `reviewContract.issues` remained empty, but support issue `missing-claim-source-span` kept the inference partial. |

This run demonstrates that PR #239 fixed the duplicate-key input-shape failure and elicited the missing synthesis sentence. It did not reach the milestone because the next boundary still lost valid cited-source evidence during normalization. The follow-up candidate and its validation are recorded immediately below.

### Run #51 follow-up candidate: source-balanced reviewer spans

The Worker now groups reviewer span IDs by the cited, fingerprint-verified source, removes duplicate IDs, and round-robins selection by rank under the existing six-span-per-claim limit. A claim with three cited pages and nine returned spans retains two spans per page; if there are more than six cited pages, the existing missing-source gate keeps the claim incomplete. The reviewer prompt requests one relevant span from every cited source before a second from any source. Claim-to-source exact text resolution, the strict gate, public response contract, page packet, and compose-plus-review call budget are unchanged.

| Candidate validation | Result |
|---|---|
| Focused evidence-answer tests | 53 passed, 0 failed |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 253 passed, 0 failed |
| Three-source regression | Nine ranked spans become six mapped spans, two per source; all three cited sources remain represented and the answer stays supported |
| Over-budget regression | A claim citing seven sources remains incomplete with no evidence map; no source is silently accepted as fully covered |
| Model-call budget | Two answer-stage calls (composition and review), unchanged |
| `git diff --check` | Passed |
| PR / CI / deployment | Worker PR #240 merged; the deployed run #52 below confirms all three sources survive normalization. Semantic inspection remains required. |

This fixes the normalization loss demonstrated by run #51, not every quality issue in that run. It does not claim that all retained spans semantically support a claim; the reviewer decision and exact-span gate remain fallible, so the next live artifact still needs passage-level inspection. Keep the unseen acceptance suite frozen until the deployed five-case run and semantic review are complete.

For the next quality run, the target remains 5/5 structural cases and 7/7 supported parts, but the first validation should confirm that all citations on a multi-source claim survive the six-span selection limit. Separately inspect the Kant reviewer downgrade and the sunyata relation error; the latter is a composition scope/precision issue, not evidence that the reviewer contract failed. Do not treat quote-location counts or a structurally passing case as semantic accuracy scores.

## October 25, 2026: deployed run #52 and source-balanced span result

Worker PR #240 merged at 18:33 UTC. The user then ran the focused five-question, all-books, with-review workflow [40221892508](https://github.com/jsynon/antilogicalism/actions/runs/40221892508), which completed at 18:39 UTC on corpus v48 and site revision `cce7533bcba0988c301452d9f999233f8586e053`. The Worker version was `d491394b-42e7-4023-9ee6-067b8ae9c8a9`, source build `public-gateway-evidence-selection-v3`. The job log records planner, retrieval, and answer progress for every case, including an `ANSWER WAITING` heartbeat on sunyata. All five requests completed with no request failures, planner fallbacks, skips, or unscored cases. The run used the expected 15 total estimated AI calls (one planner and two answer-stage calls per case); the artifact records 10 answer-stage calls and 680.14 neurons. Each answer cited at least two sources, and the 15/15 displayed evidence highlights were located in source text. Quote location and structural consistency do not establish claim entailment.

The aggregate structural result improved from run #51's 2/5 cases and 4/7 supported parts to 5/5 cases and 7/7 parts. The artifact's own human rubric remains **0/5 reviewed**; there is no official semantic score. The source-balanced fix is confirmed active by the trace for the Nietzsche/Kierkegaard synthesis: P3-C4 returned nine span IDs, three each from S1, S2, and S6; normalization preserved six exact spans, two per source. The final inference therefore no longer loses a cited source at the six-span boundary. That does not show that every retained span supports every clause.

| Case | Structural result | Evidence-based finding |
|---|---|---|
| Kant: transcendental idealism | Pass; 1/1 part | Strongest answer in the set. It defines appearances as representations, preserves their empirical reality, distinguishes things-in-themselves, and explains Kant's use of “transcendental.” *Critique of Pure Reason*, p. 199 and *Prolegomena*, p. 22 directly support the main claims. |
| Kierkegaard on faith | Pass; 1/1 part | The six claims have exact spans, but the answer combines material from *Fear and Trembling* and *The Sickness Unto Death* as if it were one undifferentiated Kierkegaard position. The cited works use pseudonymous voices (Johannes de Silentio and Anti-Climacus); the answer does not preserve that distinction. It also reads as a list of doctrines more than a connected explanation. |
| Nietzsche on Christianity | Pass; 1/1 part | The two-sentence answer is concise and its broad account of Christianity, weakness, resentment, and the will to power is consistent with the cited pages. The second sentence adds that the will-to-power prescription combats depression among the weak. The original *Genealogy of Morals*, p. 74 discusses the emotional stimulant that can overcome depression and the love-of-neighbor prescription, but the selected review spans include the will-to-power and herd/weakness passages—not the depression passage. The source page is available, but that material clause was not linked in the evidence map. This is a claim-to-span selection gap hidden by the structural pass. |
| Sunyata | Pass; 1/1 part | The answer identifies emptiness and cites Suzuki's Zen discussion and Huston Smith's comparative *Forgotten Truth*, p. 66. It still does not explain the central philosophical sense of emptiness; it mainly supplies associations, a cross-religious comparison, and a Zen qualification. Smith's p. 66 places sunyata alongside nirvana under a discussion of “the Infinite,” which should remain clearly marked as that author's comparative framing, not a universal Buddhist equivalence. Suzuki's p. 53 says the foothold of Sunyata must be left behind in Zen; “so profound” is an interpretive gloss rather than the page's stated reason. |
| Nietzsche on Kierkegaard | Pass; 3/3 parts | Both author-side positions and a standalone cautious inference are present. The targeted inference now retains spans from all cited source IDs: Nietzsche pages 594 and 547 (S1/S6), and Kierkegaard's *Philosophical Fragments*, p. 56 (S2). However, the selected S2 spans discuss second nature and the historical event, not the “absurd”; the directly relevant “by virtue of the absurd” passage appears in the cited answer's *Fear and Trembling* source S4 but is not cited by the final inference. The contrast is plausible but its final evidence handoff remains incomplete for that clause. |

The Drive PDFs were checked for the passages above. The *Philosophical Fragments* citation URL resolves to the Drive file; an initial metadata lookup used a mistyped file ID and was corrected by searching the exact title. This was not a broken citation in the artifact.

As a separate provisional review of the artifact—not a score entered in the workflow's human rubric—the answers score as follows on the project's 0–2 dimensions:

| Case | Accuracy | Question coverage | Explanation quality | Citation support | Citation completeness |
|---|---:|---:|---:|---:|---:|
| Kant: transcendental idealism | 2 | 2 | 2 | 2 | 2 |
| Kierkegaard on faith | 1 | 2 | 1 | 2 | 2 |
| Nietzsche on Christianity | 2 | 1 | 1 | 1 | 1 |
| Sunyata | 1 | 1 | 1 | 1 | 2 |
| Nietzsche on Kierkegaard | 1 | 2 | 1 | 1 | 1 |
| **Mean** | **1.4** | **1.6** | **1.2** | **1.4** | **1.6** |

The result demonstrates progress in deterministic evidence retention and question-part coverage, not general semantic reliability. The run also exposes two recurring review weaknesses: the answer can bundle a subclaim whose precise span was not selected (Nietzsche on Christianity), and a multi-source inference can pass while one premise's selected spans only loosely support its wording (Nietzsche on Kierkegaard). The sunyata case remains more about source choice and conceptual depth than reviewer formatting. The broad faith answer still needs speaker-aware treatment of pseudonymous works. All five answers have only three visible highlights even when they cite five or six pages; in the Nietzsche/Kierkegaard answer, those previews show S1, S6, and S5, so the inference's S2 evidence is not among the highlighted excerpts. All inline citation IDs do resolve, but preview highlights do not cover every claim/source.

The next development step should use these exact run #52 traces as a claim-to-evidence audit set: evaluate whether ranked reviewer candidates expose the spans for every material clause, require claim wording and citations to remain aligned, and ensure the inference's Kierkegaard premise has a selected passage for the “absurd.” Separately, improve sunyata retrieval toward sources that explain the underlying philosophical concept, and preserve pseudonymous voice distinctions in broad Kierkegaard summaries. Use a focused offline regression of the observed spans before spending another five-case live run; keep the unseen acceptance set frozen until a deployed candidate is reviewed semantically. Do not infer a quality pass from the 5/5 structural result.

## October 25, 2026: highlight coverage and source-reader handoff candidate

Run #52 also showed a presentation defect: the public Worker returned at most three exact reviewer-approved excerpts even when an answer cited six pages. The website then filled the other source cards with generic page previews under the heading “Key passages” and passed those previews to the source reader as excerpts. That made unreviewed text look like selected evidence and could create an odd highlight unrelated to the sentence that cited the page.

The bounded candidate fixes that handoff across the Worker and website:

- The Worker can return up to six reviewed highlights, matching the existing six-page answer packet. It keeps inline citation order, requires `quoteVerified`, and uses the reviewer-resolved exact anchor; it does not generate or infer highlight text.
- The website no longer substitutes a generic preview when a source has no reviewer-approved excerpt. It shows the exact verified excerpt when available; otherwise it says no reviewed excerpt is available and opens the page without asking the reader to highlight preview text.
- Diagnostic reports retain up to six highlight records so the artifact can show what the interface received. No model calls, answer composition, review decisions, retrieval behavior, corpus contract, or page limit change.

Candidate regressions cover six-source public selection, citation-order behavior, rejection of unverified excerpts, no generic-preview fallback, source-reader button labels, and six-highlight diagnostic retention. The Worker suite passes 253/253 tests and the full website suite passes 180/180. The initial website run exposed an obsolete assertion expecting the old generic “Read passage” label; the test was updated to reflect distinct “Read highlighted passage” / “Read source” labels. This is still a candidate; it has not been merged or deployed, and no live AI workflow has been run for it.

The next validation should be a single all-books, with-review Nietzsche/Kierkegaard case after both repository changes are merged and deployed. It costs about three calls (one planner plus compose and review). Check that the artifact returns exact spans for all cited pages up to six and that the live page shows only those spans as highlighted passages. If that passes, run the untouched `acceptance` suite in the live answer evaluation workflow with `case_id=all`, `scope=all-books`, and `answer_variant=with-review` once. The workflow describes All Books acceptance as requiring a planner call per question; the baseline is about 21 calls for seven cases, plus bounded recovery. Keep acceptance frozen until the targeted deployed check and a manual source-reader check pass. Broad answer-quality work remains separate: use the run #52 gap set (speaker attribution, clause-to-span fit, the “absurd” premise, and sunyata's definition depth) for the next measured answer-quality milestone rather than broad prompt edits.
