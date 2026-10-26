# Reading Companion evidence milestone: release report

Last updated: October 25, 2026
Status: The latest focused all-books with-review workflow is run #61, [40245464263](https://github.com/jsynon/antilogicalism/actions/runs/40245464263), against library v48 and website revision `ee94ba1779d07847345fabc96db38fa560d60225` (website PR #209). The request completed without planner fallback or request failure, but its one answer was partial and failed the structural gate. The run had no human-entered rubric scores. It shows the threshold change alone did not recover the needed Nagarjuna page because the live planner facet used different, broader vocabulary. Worker PR #249's speaker-attribution change is merged; report updates are pending in this repository's PR #250. The earlier James 2:14–26 miss from run [40157017806](https://github.com/jsynon/antilogicalism/actions/runs/40157017806) was traced to scripture scope being dropped from part queries; that fix is merged in website PR #188.
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
| Sunyata | Pass; one request…63 tokens truncated…is is partial; one-sided inference remains incomplete |
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

Run #52 also showed a presentation defect: the public Worker returned at most three exact reviewer-approved excerpts even when an answer cited six pages. In the deployed site baseline, other source cards showed a no-highlight message but still used a generic “Read passage” button. The update made the panel label its contents as citations and verified passages, clarified that no reviewer-approved excerpt is available when that applies, and distinguishes “Read highlighted passage” from “Read source.”

The bounded candidate fixes that handoff across the Worker and website:

- The Worker can return up to six reviewed highlights, matching the existing six-page answer packet. It keeps inline citation order, requires `quoteVerified`, and uses the reviewer-resolved exact anchor; it does not generate or infer highlight text.
- The website shows the exact verified excerpt when available; otherwise it says no reviewed excerpt is available and opens the page without a quote highlight.
- Diagnostic reports retain up to six highlight records so the artifact can show what the interface received. No model calls, answer composition, review decisions, retrieval behavior, corpus contract, or page limit change.

Candidate regressions cover six-source public selection, citation-order behavior, rejection of unverified excerpts, source-reader button labels, and six-highlight diagnostic retention. The Worker suite passes 253/253 tests and the full website suite passes 180/180. The initial website run exposed an obsolete assertion expecting the old generic “Read passage” label; the test was updated to reflect distinct “Read highlighted passage” / “Read source” labels. At PR opening, the changes had not been merged or deployed and no live AI workflow had been run. Worker PR #241 and website PR #205 were subsequently merged; the post-merge live validation and the remaining caller bug are recorded in run #53 below.

The planned post-merge validation was run #53, recorded below. It showed that the selector's new default was overridden at its public call site and that quote relevance still needs a claim-level check. Do not run the untouched acceptance set yet; first correct both issues offline, then repeat a focused live case and manually inspect the source reader. The workflow's All Books acceptance baseline is about 21 calls for seven cases, plus bounded recovery. The broader answer-quality milestone remains separate: use the run #52/#53 gap set (speaker attribution, clause-to-span fit, cross-author inference support, and sunyata's definition depth) instead of broad prompt edits.

## October 25, 2026: focused run #53 after highlight PRs

After Worker PR #241 and website PR #205 merged, focused all-books with-review run [#53](https://github.com/jsynon/antilogicalism/actions/runs/40224196752) ran all five focused questions on corpus v48. The site revision was `0c3171deda81649e793c0724c9dbac35584bbad0`; the artifact identifies Worker version `ad8c60ea-3949-465e-a643-ebc21a580925` and source build `public-gateway-evidence-selection-v3`. All five requests completed with no failures, planner fallbacks, or skips. It used the expected 15-call estimate (five planner calls and ten answer-stage calls), totaling 731.79 answer-stage neurons. The structural result remained 5/5 cases and 7/7 supported parts, the same as run #52. The artifact still has **0/5 human-reviewed scores**, so these are not semantic acceptance results.

| Case | Structural result | Citations / highlights | Passage and answer finding |
|---|---|---:|---|
| Kant: transcendental idealism | Pass; 1/1 part | 2 / 3 | Clear, well-supported definition using *Critique of Pure Reason*, p. 199 and *Prolegomena*, p. 22. Both cited pages have highlights; the third highlight is a second passage from p. 199. |
| Kierkegaard on faith | Pass; 1/1 part | 5 / 3 | The answer now names Johannes de Silentio, Anti-Climacus, and Johannes Climacus separately. One sentence still generalizes from de Silentio's first-person statement that he cannot make the movement of faith into a claim about what faith does to the mind. The exact quoted span establishes his stated inability and the absurd, not that general psychological effect. |
| Nietzsche on Christianity | Pass; 1/1 part | 3 / 3 | The answer covers Christian hedonism, resentment, the metaphysical basis of scientific faith, and the morality of pity. Its S3 highlight asks whether the church still has a right to exist, which does not support the nearby claim about Christianity's life-hostile principle and slave revolt. The evidence map contains a more relevant approved S3 span about resentment creating values, but the public selector chose the earlier span. |
| Sunyata | Pass; 1/1 part | 4 / 3 | It supplies a basic gloss and relates sunyata to dependent co-arising and soku-hi, but still leans on Huston Smith's comparative “Infinite” framing instead of explaining emptiness in its Buddhist philosophical sense. Nishida p. 18 is explicitly marked in provenance as an editorial introduction by David A. Dilworth; the answer presents its framing as a general Buddhist claim without attribution. The displayed S2 highlight is noisy front-matter OCR and omits the more relevant soku-hi span present in the evidence map. |
| Nietzsche on Kierkegaard | Pass; 3/3 parts | 6 / 3 | The answer distinguishes the pseudonymous Kierkegaardian voices and gives a standalone qualified hypothetical inference. Its cited Kierkegaard page (S2, *Fear and Trembling*, p. 38) supports the knight-of-faith/paradox premise. The six cited pages are represented in the evidence map, but only S1, S4, and S2 appear among the three highlights. |

All 15 returned highlight quotes were located in their cited source text. However, the 15 highlights cover only 14 of the 20 cited source-page records: a second Kant excerpt uses one of the three slots, while six other cited pages have no displayed excerpt. More importantly, a quote can be exact and still be a poor highlight for the nearby answer claim, as the Nietzsche/Christianity S3 example shows. Exact-text location is a mechanical check, not claim relevance.

Run #53 exposed a missed caller dependency in PR #241. That PR changed the selector's default limit from three to six, but the public answer route still calls `selectPublicEvidenceHighlights(..., 3)` explicitly. The explicit argument overrides the new default, so the live response remains capped at three. The PR's unit test exercised the selector default, while the public route integration test did not assert six returned highlights. This is a code-path mismatch, not a model or retrieval failure. The website PR improves labels for missing reviewed excerpts, but it cannot compensate for a Worker response capped at three.

As a provisional review of answer text and selected spans (not the artifact's official rubric), the 0–2 ratings are:

| Case | Accuracy | Question coverage | Explanation quality | Citation support | Citation completeness |
|---|---:|---:|---:|---:|---:|
| Kant: transcendental idealism | 2 | 2 | 2 | 2 | 2 |
| Kierkegaard on faith | 1 | 2 | 1 | 1 | 2 |
| Nietzsche on Christianity | 2 | 2 | 2 | 1 | 2 |
| Sunyata | 1 | 1 | 1 | 1 | 2 |
| Nietzsche on Kierkegaard | 1 | 2 | 1 | 1 | 2 |
| **Mean** | **1.4** | **1.8** | **1.4** | **1.2** | **2.0** |

The immediate highlight follow-up is to remove the hard-coded `3` at the public route and add an integration regression that verifies six exact spans can reach the response when six cited pages have verified anchors. The next evidence-selection improvement must also choose the most claim-relevant reviewed span for a cited page instead of blindly taking its first map entry; the current S3 and Sunyata S2 highlights show why raising the cap alone is insufficient. Keep the acceptance suite frozen until these offline route-level tests pass, then repeat one focused all-books case and manually verify the source reader. After that, proceed to the planned answer-quality milestone using the speaker, claim-span, and Sunyata findings above; only then spend the one-time seven-case acceptance budget. No code changes were made in response to run #53.

## October 25, 2026: run #53 evidence-quality fix candidate

The run #53 findings are now addressed in an offline Worker candidate. This is one bounded change at two connected boundaries: choose the best already-reviewed highlight for each cited page, and give the existing semantic reviewer specific scope checks for the observed overgeneralizations. It does not change retrieval, the planner, the source packet, answer structure, public response schema, or AI-call budget.

The Worker highlight selector now ranks only exact, `quoteVerified` evidence-map spans against their linked claim point, using deterministic lexical overlap and a readability tie-breaker. It preserves citation order across pages, emits at most one preferred span per cited source before adding further distinct spans, and keeps the existing six-highlight limit. The public `/api/pilot-answer` route now uses that six-item default instead of overriding it with a hard-coded limit of three. A route-level regression submits six fingerprint-verified pages, cites all six, and verifies that all six approved highlights reach the response without an extra model call. Focused regressions reproduce the run #53 Nietzsche S3 and Sunyata S2 span-choice defects.

The reviewer instructions now call out three general scope traps seen in run #53: a narrator's first-person inability does not establish a general psychological effect; an editor's introduction may support a claim about that commentator but not automatically the credited author's doctrine or a whole tradition; and a broad critique of Christianity alone does not establish a hypothetical judgment of a specific thinker. This strengthens the existing reviewer contract without adding a model stage or weakening fail-closed evidence requirements. Prompt-contract tests lock these instructions in place. The Sunyata retrieval facet is unchanged: the candidate page from *The Self-Overcoming of Nihilism* was not submitted to composition in run #53, and its precise page text must be checked before changing retrieval or treating it as a better source.

| Candidate validation | Result |
|---|---|
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 255 passed, 0 failed |
| Six-page public route regression | Six citations produce six exact reviewed highlights; two AI calls, unchanged |
| Claim-relevance regressions | The resentment passage and clean soku-hi passage rank ahead of the unrelated church question and OCR-heavy introduction excerpt |
| Reviewer scope regressions | Contract tests require the first-person, editorial-voice, and hypothetical-bridge checks |
| `git diff --check` | Passed |
| Live model/workflow validation | Not run; requires merge, Worker deployment, then a focused five-case with-review run |

The website source did not need a code change: the prior website PR already renders up to six Worker highlights and avoids promoting generic page previews into reviewed excerpts. Because the selector now changes ordering only among exact reviewed spans, it needs no website contract or provenance-copy update. The release gate remains the same: merge and deploy this Worker candidate, run one focused all-books with-review five-question suite, inspect both live excerpts and answer claims, and then use the unseen seven-question acceptance workflow only if the semantic review is satisfactory. Structural tests alone do not establish an answer-quality pass.

## October 25, 2026: focused run #54 after the claim-linked highlight fix

Focused all-books with-review run [#54](https://github.com/jsynon/antilogicalism/actions/runs/40226437449) completed all five cases against corpus v48. The website revision remained `0c3171deda81649e793c0724c9dbac35584bbad0`; the artifact reports Worker version `14bd0eea-3749-4fcf-b701-9455c132a604` and source build `public-gateway-evidence-selection-v3`. Worker PR #242 had merged immediately before the run. Its updated reviewer instructions appear in all five captured traces, and every case returned six highlights, confirming the route's six-highlight change was active. The workflow saved artifact [12611328699](https://github.com/jsynon/antilogicalism/actions/runs/40226437449/artifacts/12611328699) even though the structural gate failed. There were no request failures, planner fallbacks, or skipped cases. The run estimated 15 total calls (five planners plus ten answer-stage calls); actual answer usage records ten calls, 72,968 input tokens, 2,286 output tokens, and 725.69 neurons. The automated result was 3/5 cases and 5/7 question parts supported. The human semantic rubric remains blank at 0/5.

| Case | Structural result | Citations / highlights | Answer-quality finding |
|---|---|---:|---|
| Kant: transcendental idealism | Pass; 1/1 part | 3 / 6 | Strong, clear answer distinguishing phenomena, empirical reality, and things in themselves, using *Critique of Pure Reason* pp. 199 and 85 and *Prolegomena* p. 22. Three additional highlights reuse p. 199. |
| Kierkegaard on faith | Pass; 1/1 part | 4 / 6 | The answer gives a coherent account of inwardness, the individual and universal, infinite resignation, and faith by virtue of the absurd. It still flattens distinct pseudonymous voices: the cited *Fear and Trembling* and *Sickness Unto Death* material is summarized generically as “faith,” without naming Johannes de Silentio or Anti-Climacus. One short highlight, “faith can break forth,” is under 24 characters, so the evaluator records its location as unknown; the full verified page text in the trace contains the phrase, but the excerpt is too short to be a useful contextual highlight. |
| Nietzsche on Christianity | Miss; partial 1/1 part | 4 / 6 | The answer is safely marked partial because claim P1-C1 cited two sources but the reviewer selected spans only from S5, causing `missing-claim-source-span`; the Worker did not treat that claim as fully verified. The answer also says Nietzsche argued that the New Testament represented regression while citing *The Portable Nietzsche*, p. 578, whose passage is Walter Kaufmann's editorial commentary presenting Nietzsche's view. The answer should make that mediation clear or cite Nietzsche's primary text. Its claim that pity “leads toward nihilism” is stronger than the cited p. 4 question about nihilism. |
| Sunyata | Pass; 1/1 part | 4 / 6 | The answer now includes “emptiness or a void,” binary opposition, and Prajñāpāramitā framing, but still does not establish the core philosophical account through lack of inherent existence or dependent origination. Huston Smith's comparative “Infinite” discussion remains a central source. The current retrieval did not submit the previously noted Nishitani candidate page; do not change retrieval until that page is checked directly. |
| Nietzsche on Kierkegaard | Miss; partial 2/3 parts | 6 / 6 | Both author-side summaries are present and the evidence/citation IDs map consistently. The synthesis part contains a comparison but no cautious answer to what Nietzsche might think of Kierkegaard; the Worker recorded `hypothetical-inference-missing` and correctly left P3 partial. One associated Nietzsche claim—linking communal stability to shared faith—goes beyond the cited passage about shared customary principles. One S6 highlight is only an OCR/header fragment (“54 THE PORTABLE NIETZSCHE … the standards they themselves applied”). |

This is why the action reports 3/5 even though all five requests and their citation maps completed successfully: `structuralPassed` requires complete question coverage, not just valid IDs and a well-formed response. The two misses are partial answers, not broken JSON, unknown citations, missing submitted pages, or service failures. The fail-closed behavior is appropriate. At the same time, the three structural passes are not semantic quality passes: the automated reviewer marked some weakly scoped claims as answered, and no human rubric was completed.

The highlight count fix is verified, but relevance remains imperfect. The evaluator's `quoteLocated: null` for the short Kierkegaard phrase means the excerpt is below its 24-character location-check threshold, not that the full source page lacks the phrase. Conversely, a `true` location result proves only that text occurs in the submitted page; the Nietzsche/Kierkegaard OCR fragment demonstrates that location alone does not make a useful highlight. The deterministic claim-wording ranker improved capacity and some choices, but it is not a semantic relevance judge.

As an independent provisional 0–2 rubric review (not scores entered into GitHub), the drafts rate: Kant 2/2/2/2/2; Kierkegaard faith 1/2/2/2/2; Nietzsche on Christianity 1/1/1/1/2; Sunyata 1/1/1/1/2; Nietzsche on Kierkegaard 1/1/1/1/2. In dimension order—accuracy, question coverage, explanation quality, citation support, citation completeness—the means are 1.2, 1.4, 1.4, 1.4, and 2.0. The low citation-support mean reflects claim-to-passage fit and attribution, while citation completeness reflects that included claims generally have traceable page IDs; neither is an official human score.

Run #54 demonstrates that the project has advanced beyond the earlier route cap and lost-evidence-map defects, but the 7/7 milestone is not reached. Keep the partial-answer safeguards. The next answer-quality work should target the two observed failure mechanisms together: ensure composed synthesis parts actually attempt the explicitly requested hypothetical (or state the limitation directly), and make the reviewer preserve page voice and select a span from every source cited by each claim. Continue the Sunyata source audit and the highlight-context review as separate evidence tasks; do not treat the 3/5 result as a reason for broad pipeline restructuring. Rerun the focused suite only after a candidate addresses these findings; keep the untouched acceptance set frozen until then.

## October 25, 2026: candidate source-complete review and cleaner highlights

The candidate follows run #54's evidence without changing retrieval scope, model count, packet size, or the public response shape. It addresses answer coverage, per-source review, page voice, and display excerpts at the Worker boundary where these findings appeared.

- The composer contract already assigns one answer section to every planned part. Its hypothetical check now recognizes a direct, cited limitation—“the supplied passages do not warrant a reliable inference”—as explicit coverage. The part remains subject to the normal answer review; missing or unsupported content stays partial rather than silently passing.
- The reviewer contract now asks for a separate status and exact span IDs for every source cited by each claim. The Worker resolves each decision against that source's own fingerprint-verified spans and will not retain the claim as supported if any cited source is missing, partial, or has no valid span. Older flat span lists are still normalized by source ID, then pass the same gate. The review output remains one flat claim array, uses the same two answer-stage calls, and preserves the six-span budget.
- A title/page-guarded editorial attribution check downgrades a claim when it cites a known editorial-commentary page, attributes a position directly to the credited author, and does not identify the commentary or commentator. It does not classify an entire anthology or book as editorial based only on its title.
- Highlight selection continues to use only exact reviewer-approved spans, ranked against their linked claims. It now skips excerpts under 32 characters or five words, low-readability OCR, and page-number/all-caps running-header fragments. The six-highlight limit is a maximum, not a target; no preview or unreviewed passage is used to fill a slot.

| Candidate validation | Result |
|---|---|
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 259 passed, 0 failed |
| Added regressions | Per-source reviewer statuses; missing cited-source span remains partial; editorial-commentary attribution; explicit hypothetical limitation; short/header highlights omitted; useful exact highlight retained |
| Model-call budget | Unchanged: planner plus composition and review; no repair or retry call added |
| Public response and website contract | Unchanged; website continues to receive the same citations, evidence map, and highlight fields |
| Website suite: `node --test reading-companion/*.test.mjs` | 180 passed, 0 failed; public highlight/citation field contract remains unchanged |
| Live focused five-case run | Pending merge and Worker deployment; inspect the two run #54 misses, voice attribution, and all displayed excerpts |
| Unseen acceptance set | Frozen until deployed outputs and citations are reviewed |

This candidate is not yet a live quality result. Offline tests show that missing source decisions and known unmediated commentary attribution fail closed, while clean spans remain eligible. They cannot show that Gemma will produce better prose or choose semantically correct passages across the corpus. Keep the release gate focused: review the same five cases and their exact cited pages after deployment, then decide whether the separate Sunyata source audit or broader acceptance run is warranted.

## October 25, 2026: focused run #55 and the next answer-quality candidate

Focused all-books with-review run #55 completed all five cases against corpus v48. The Worker version was `07a3dab9-acdc-4493-9c8b-6e69e0a2e40e`, source build `public-gateway-evidence-selection-v3`, and website revision `0c3171deda81649e793c0724c9dbac35584bbad0`. It estimated 15 calls (one planner plus composition and review per case), completed all five requests, and had no request failures; one planner used its fallback. Structural coverage was 3/5 cases and 5/7 parts. The artifact had no human rubric scores.

| Case | Structural result | Finding |
|---|---|---|
| Transcendental idealism | Pass; 1/1 part | The answer covers the requested distinction with two cited books. |
| Kierkegaard on faith | Pass; 1/1 part | The answer uses three pseudonymous/authored source books and passes the review gate. |
| Nietzsche on Christianity | Pass; 1/1 part | The source-complete reviewer accepts the answer, but a pronoun-led sentence (“He characterized…”) attributes Walter Kaufmann's p. 578 editorial commentary to Nietzsche after an earlier sentence names Nietzsche. The page-specific attribution guard examines only the current sentence, so this unqualified continuation escaped it. |
| Sunyata | Partial; 0/1 part | The answer draft cites both p. 17 of *Last Writings* and p. 48 for its final “no Buddha/Buddha” claim. The reviewer found a relevant span on S5, p. 17, but no supporting span on S6, p. 48. The Worker removed that entire multi-source claim, as required by the all-cited-sources rule. The remaining answer gives a basic gloss and comparison, but does not explain emptiness through a supported Buddhist philosophical account. |
| Nietzsche on Kierkegaard | Partial; 2/3 parts | The synthesis has a standalone cautious inference, but cites all six retrieved pages. The reviewer found relevant Nietzsche evidence on S2 and no premise support in the other five cited pages, so it correctly withheld the inference. The draft should cite the smallest directly relevant pair of premise pages, not every retrieved page. |

The Drive source audit confirms that *Last Writings* p. 17 is page 26 of David A. Dilworth's introduction; the book's contents place the introduction on pp. 1–46 and Nishida's first essay at p. 47. Page 18 is also within that introduction. Page 48 is in Nishida's essay and remains authorial text. The p. 17 discussion presents the “because there is no Buddha, there is Buddha” formulation as Dilworth's account of Nishida's use of the Prajnaparamita tradition. The p. 48 passage makes a related but different statement about absolute nothingness and absolute being in that tradition. This supports adding the missing p. 17 voice metadata, but not treating the two pages as interchangeable evidence or changing retrieval based on this single run.

The next candidate keeps the pipeline and call count unchanged. It carries the cited author's antecedent across up to three preceding supported claims within the same answer part when a later sentence begins with a clear pronoun, so a follow-up sentence cannot bypass a known editorial-page attribution rule. It also tells the composer and reviewer to cite the smallest relevant source set for a hypothetical inference and to treat unrelated extra citations as unsupported. The metadata for *Last Writings*, p. 17, is brought into alignment in the Worker and website reader contracts; p. 48 remains untagged as editorial. The existing source-by-source review gate, span budget, answer schema, and retrieval behavior are unchanged.

| Candidate validation | Result |
|---|---|
| Focused Worker regressions | Added: adjacent named-author/pronoun attribution, mediated wording remains eligible, Dilworth p. 17 vs. Nishida p. 48 voice, and a two-page hypothetical that passes with five unused group pages available |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 261 passed, 0 failed |
| Website contract suite: `node --test reading-companion/*.test.mjs` | 181 passed, 0 failed |
| `git diff --check` | Passed in both repositories |
| Live focused five-case run | Pending merge and Worker deployment; verify Nietzsche attribution, the Sunyata scope and citations, and a minimal two-premise hypothetical citation |
| Seven-question acceptance workflow | Keep frozen until those live outputs are reviewed and semantically satisfactory |

Run #55 is useful evidence that per-source review is now protecting the answer from unsupported pages; it is not a semantic-quality pass. The immediate candidate closes the attribution-context gap and reduces noisy citations on the inference. The Sunyata answer still needs source-level validation after deployment; the current evidence does not justify broad retrieval changes or a promise of a complete definition. No live model result is claimed for this candidate.

At the time of run #55, the paired implementation PRs [Worker #245](https://github.com/jsynon/book-chatbot/pull/245) and [website #206](https://github.com/jsynon/antilogicalism/pull/206) were open. Both later merged; their changes were active during run #56, recorded below. Worker contract workflow [#40232082838](https://github.com/jsynon/book-chatbot/actions/runs/40232082838) and website smoke workflow [#40232081357](https://github.com/jsynon/antilogicalism/actions/runs/40232081357) completed successfully.

## October 25, 2026: deployed run #56 and citation-precision candidate

After Worker PR #245 and website PR #206 merged, the focused five-question all-books with-review workflow [#56](https://github.com/jsynon/antilogicalism/actions/runs/40232733825) ran against corpus v48. The site revision was `52a39d3a18a19800eeb9fc4b21a5bc211ae51a00`, the merge commit for website PR #206; the Worker version was `6d8e01a9-70f6-4c88-8494-7c38195210bf`, source build `public-gateway-evidence-selection-v3`. All five requests completed, with no request failures, planner fallbacks, or skipped cases, at the existing estimate of 15 AI calls. The workflow failed its structural gate at 3/5 cases and 5/7 parts. Human semantic rubric scores were 0/5; the run contains no official answer-quality score.

| Case | Structural result | Trace and answer-quality finding |
|---|---|---|
| Transcendental idealism | Pass; 1/1 part | The answer distinguishes appearances from things in themselves. Its phrase “no self-subsisting existence apart from human thought” risks stating more than the cited pages establish about Kant's view. |
| Kierkegaard on faith | Partial; 0/1 fully supported parts | The draft said faith is the opposite of sin and cited S2 and S5. The reviewer accepted S2 but marked S5 unanswered for that sentence. S5 supports the neighboring definition of faith, but not this claim. This is an unsupported extra citation, not a missing passage: the reviewer accepted the claim overall and its S2 evidence. |
| Nietzsche on Christianity | Pass; 1/1 part | Full structural coverage with cited passages. Structural acceptance still does not replace human semantic scoring. |
| Sunyata | Pass; 1/1 part | Coverage improved from partial in run #55 to full. The definition “emptiness or a void” relies on Huston Smith's comparative framing; the rest is primarily Zen context and does not explain the Buddhist philosophical concept in depth. |
| Nietzsche on Kierkegaard | Partial; 2/3 parts | Both author positions were supported, but the synthesis claim was partial. The reviewer marked the claim partial even though each cited source decision had relevant spans. The conclusion generalized from Nietzsche's criticism of life-denying morality to Kierkegaard's faith and absurd; the evidence packet offers a narrower point of contact, but the answer overstated what follows. |

Aggregate structure did not improve over run #55 (also 3/5 cases and 5/7 parts), but the failures moved: Sunyata became full while Kierkegaard on faith became partial. This indicates the changes in PRs #245/#206 affected specific cases without increasing the total structural pass rate. It is not evidence of an outage or a code-path mismatch: run #56 used the merged website revision and a newer Worker version, and all model requests completed.

The next Worker candidate addresses the two observed issues at the existing review boundary in `hosting-poc/evidence-answer.mjs`. For a non-comparison, single-source-group claim, it may remove a cited page only when the overall reviewer claim is `answered`, the reviewer explicitly marks the extra source partial or unanswered, another cited source has an answered decision and exact verified span, and every citation group retains that supported source. Missing decisions, missing spans, separate unsupported citation groups, multi-author comparisons, and hypothetical inferences remain fail-closed. The final citations, source list, and evidence map are built from the retained source IDs. The trace records the removed extra citations.

The hypothetical composer and reviewer instructions now require the inference to stay on the specific point established by both cited passages. The run's page packet already included relevant Nietzsche and Kierkegaard material, so this candidate does not change retrieval or page budgets. A reviewer decision that the inference is partial remains partial even when both premise pages have valid spans; wording instructions cannot override the evidence judgment. This adds no model stage or AI call.

| Candidate validation | Result |
|---|---|
| Focused answer/review contract tests | 61 passed, 0 failed |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | 264 passed, 0 failed |
| Citation-pruning regressions | Supported sentence retained with only its supported citation; missing legacy spans and two-author premise failures remain partial |
| Hypothetical-inference regressions | Narrow inference can pass with both source groups; broad conclusion remains partial even when premise spans pass; one-sided citation is not pruned |
| AI-call budget and public response schema | Unchanged: composition plus review; no website response contract change |
| Live five-case run and page review | Pending merge/deploy; rerun the same focused set and inspect the faith citation plus Nietzsche/Kierkegaard synthesis |
| Seven-question unseen acceptance run | Keep frozen until the live evidence and answer wording are satisfactory; human scoring remains necessary |

The candidate has offline structural validation only. It does not establish that Gemma will produce the narrower inference or that the five answer drafts are semantically reliable. The acceptance set remains reserved, and no other retrieval, corpus, model, UI, or pipeline-stage changes are included.

## October 25, 2026: deployed run #57 and bounded reviewer handoff candidate

The focused all-books with-review workflow [#57](https://github.com/jsynon/antilogicalism/actions/runs/40235089177) used corpus v48 and completed all five requests without planner fallbacks, skips, or request failures. It estimated the existing 15 AI calls. The structural result fell from run #56's 3/5 cases and 5/7 parts to 2/5 and 2/7. This is a meaningful regression signal, but one stochastic run cannot isolate whether the source change caused it. The artifact contained no human rubric scores.

The per-case traces identify separate behavior to address:

| Case | Result | Finding |
|---|---|---|
| Transcendental idealism | Partial | One answer claim was reviewed as partial because it cited a supporting page and an explicitly unsupported extra page. The current cleanup only runs when the reviewer marks the claim itself answered, so this supported single-author claim was dropped despite an answered part and a usable exact span. |
| Kierkegaard on faith | Full | The answer passed with four cited source pages. This is a positive control from the same run, not a quality score. |
| Nietzsche on Christianity | Partial | The claim about the New Testament was stated as Nietzsche's own position but came from Walter Kaufmann's editorial commentary in *The Portable Nietzsche*, p. 578. Trace diagnostics flagged the attribution; the final answer still included the unqualified wording. |
| Sunyata | Full | The answer passed with four cited pages, but its narrow Zen framing does not establish a general Buddhist definition. Keep this semantic limitation visible when reviewing the actual pages. |
| Nietzsche on Kierkegaard | Unverified draft | The review response hit `finish_reason=length` at exactly the 1,200-token output cap on a roughly 14.5k-token prompt containing 12 claims. No evidence map was accepted. The Worker correctly failed closed rather than returning the draft as verified. |

The artifact also does not establish exact Worker source identity. Its Cloudflare version ID changed from #56, but the source build remained the generic `public-gateway-evidence-selection-v3`, and no Git revision was attached. PR #246 had merged shortly before the run and its post-merge contract check passed; the run nevertheless cannot prove which source commit the deployed version contained. The site revision stayed at `52a39d3a18a19800eeb9fc4b21a5bc211ae51a00`.

The bounded candidate changes three connected handoffs without increasing the call count, changing retrieval, or altering the public answer schema:

- The reviewer now requests one strongest exact span for each answered cited page rather than multiple spans from a page. The Worker enforces that cap, reducing output size and preventing redundant evidence-map entries. The per-claim ceiling remains six, with all cited sources still requiring their own decisions and spans.
- For ordinary single-source-group facts only, citation cleanup can retain a claim marked partial if the whole part is explicitly answered, every cited page has an explicit decision, at least one page is answered with an exact valid span, and each removed page is explicitly partial or unanswered. It cannot repair a missing decision or span, and it remains disabled for comparisons and hypothetical inference. The resulting inline citation, citation list, and evidence map are rebuilt from the retained page IDs.
- The composer gets a direct instruction to attribute editorial-page claims to the named commentator or commentary, never to the credited author as direct speech. Existing deterministic page-voice checks remain in place; the instruction does not infer speaker identity from catalog metadata alone.
- Worker response diagnostics carry `workerSourceRevision` only when Cloudflare version metadata includes a 40-character Git SHA tag. The website evaluator records this field per planner/answer result and collects the distinct revisions in the saved artifact's `workerSourceRevisions` list. Deployments must tag the version with the source SHA for this field to identify the exact code revision.
- Review completion capacity rises from 1,200 to 1,800 tokens while composition stays at 1,800. Truncation still fails closed without a retry, and normal reviewed execution remains one planner plus two answer-stage calls per case.

The source/citation contract, one-span-per-source normalization, editorial prompt instruction, Worker revision metadata, and evaluator propagation are covered by offline regressions. This candidate is not a live quality result. After merging and deploying both repositories with the Worker tagged by its Git SHA, rerun the focused five cases and inspect the exact citations, page voice, accepted quote-to-claim map, and review finish reason. Keep the unseen acceptance set frozen until those traces are clean and the answer wording is judged against the cited pages. The two full answers in #57 should also receive source-level reading; structural passes do not certify their definitions.

## October 25, 2026: deployed run #58 and evidence-to-answer handoff candidate

Run [#58](https://github.com/jsynon/antilogicalism/actions/runs/40237692626) is the latest deployed baseline. It ran the five focused questions in all-books with-review mode against library v48. Every request completed: there were no planner fallbacks, planner skips, or answer request failures. The artifact estimates 15 Worker AI calls (five planner calls and ten answer-stage calls). Structural coverage improved from #57's 2/5 cases and 2/7 supported parts to 4/5 and 6/7. GitHub marks the job failed because the structural suite correctly treats the one incomplete part as a miss; it was not an outage or request failure. The artifact contains 0/5 human-entered rubric reviews.

The one structural miss was the Nietzsche-on-Kierkegaard synthesis. The exact composer wording says that Nietzsche's and Kierkegaard's positions support a comparison “but not a reliable inference about Nietzsche's specific response to Kierkegaard's thought.” That is an explicit, appropriately cautious limitation and answers the hypothetical responsibly. The Worker rejected it because the deterministic wording detector recognized forms such as “do not warrant a reliable inference” but did not recognize this “support a comparison but not a reliable inference” construction. This is a validation-language mismatch, not missing source coverage and not a reason to add another prompt or model call. The positive-inference gate remains strict: a real inference still requires one sentence with citations from both source groups and explicit caution.

The run's evidence and presentation counts show a second localized issue. All 40 selected answer quotes were marked quote-verified, and all inline citation IDs mapped to returned sources. Only 26 of those quote candidates were located as rendered highlights; Kierkegaard-faith pages S2 and S5 and Sunyata page S4 had no located highlight. The exact verified quotes include line-wrapped OCR text. Their letter/readability score was diluted by whitespace, while the Sunyata excerpt began with an OCR running header (“THE LEVELS OF REALITY / 55”). The excerpts were exact; the existing readability filter rejected them before display. The fix should keep the excerpt as an exact substring, measure readability on non-whitespace characters, and remove only a recognizable leading page-header prefix. The six-highlight cap and “no generic-preview fallback” rule remain unchanged.

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
## October 25, 2026: planner-vocabulary and page-voice candidate

The next candidate addresses the run #61 failure at the planner-to-search handoff. The Worker planner prompt now consolidates the overlapping definition, expression, and role/function guidance: keep the reader’s exact technical or traditional term in one query, and use another query slot for a likely gloss plus the source’s own defining relation or operation in vocabulary likely to occur in the text. The query remains a retrieval lead, not another requested answer part or proof. This adds no model call, stage, schema field, question-specific alias, or further threshold reduction.

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
