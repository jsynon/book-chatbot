Warning: truncated output (original token count: 36247)
Total output lines: 779

# Reading Companion evidence milestone: release report
Last updated: October 27, 2026
Status: The latest paired-scope run is [#16](https://github.com/jsynon/antilogicalism/actions/runs/40507788437), using Worker merge revision `a5585c6964b1bcbb1b36c5ac9ded64d7aa696b6e` (Cloudflare version `dfc0d3e4-21c9-4fc4-b3c8-0dd1d918bfe9`): 5/10 structural cases passed (15/20 parts supported, five partial, none unsupported), with no request failures, planner fallbacks, or skipped cases. All Books passed 3/5; Selected Books passed 2/5. Trace review found that both Du Bois partials are false negatives caused by `Intl.Segmenter` splitting the initials in “W.E.B.” into a citationless fragment; the final cited definition and accepted review evidence remain present. A local sentence-boundary correction now passes the focused and full Worker suites; live paired validation is pending merge/deployment. Correcting the evaluator bug would make the trace-supported run result 7/10, but that is an audit interpretation, not the workflow score. Three genuine partials remain: Selected Books Hume/Kant comparison, Selected Books Wollstonecraft P1, and All Books Hamlet. All 34 cited highlights were text-located; semantic highlight relevance remains unscored. The workflow's human rubric is blank for all ten cases; this report adds a separate, explicitly independent answer-quality assessment. Keep the unseen acceptance set frozen.

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

The live pipeline keeps source identity and scope checks strict. Retrieval part tags are eligibility links, not semantic proof. The reviewer selects source-scoped span IDs, which the Worker resolves only against fingerprint-verified text. A claim may omit a weak alternate citation only when the reviewer marked the claim answered, another cited page from the same planned source group has an accepted exact span, and no required comparison source group is lost. Missing source decisions, missing spans, and an unsupported required premise still keep the claim incomplete. The final prose and evidence map retain only the accepted citation set. This narrow rule addresses the Boethius pair in run #1, where the answer had one supported page and one rejected alternate mapping; it does not reinstate the broader citation-pruning behavior documented after run #56, which the Sunyata trace showed could preserve an unsupported clause. Known page-level editorial voices and title-guarded pseudonymous work voices are checked at claim acceptance; an accepted, reviewed attribution may carry into a later answer part. A one-word term in quotation marks is treated as terminology, while multiword quotations remain source-checked. None of these checks alone proves entailment, accuracy, or completeness.

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
| Public pilot answer pipeline | PR #208/#209 and follow-up PRs #183/#210 are merged; Pages deployment succeeded and the user reports the Worker was pulled …25397 tokens truncated…retations directly to Nāgārjuna. The existing title/page voice map only identified page 88, so the accepted excerpts had no known editorial voice. The planner/retrieval change is useful but does not yet produce reliable attribution.
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

The bounded Worker candidate keeps the existing planner, retriev…16247 tokens truncated…e-group explicit rejection handling | Live trace supports intended recovery in Hume/Kant All Books P1/P3 and both Boethius P2 parts; all remaining source checks stayed active. |
| Structure | 8/10 cases; 18/20 parts supported, 2 partial, 0 unsupported. |
| Highlight location | 28/28 citations located; semantic relevance still needs manual review. |
| Answer-quality result | Hamlet answers now include fear of the unknown after death; human rubric remains 0/10. |
| Remaining validation | Inspect Boethius P1 source text and answer claims in both scopes, then rate the ten answers on the existing five-dimension rubric before any broader fix or acceptance run. |



## October 27, 2026: source review of Boethius P1 and Hume/Kant inference

The two Boethius P1 partials are not caused by absent source material. In the original *Consolation of Philosophy* text, the Fortune passage says that constancy “belongs not to my ways,” then defines her “unchanging sport” as turning the wheel so the lowest rises and the highest falls (Book II, p. 11; [source](https://drive.google.com/file/d/11dDUE9lTIkjpIQsZadfhK_BK4wQntXke/view?usp=sharing#page=11)). The adjacent passage supplies the broader reason: natural conditions change, and “naught which is brought to birth shall constant here abide” (p. 12; [source](https://drive.google.com/file/d/11dDUE9lTIkjpIQsZadfhK_BK4wQntXke/view?usp=sharing#page=12)). The run's answer cited the wheel reversal and the law of change, so its core explanation has textual support. The reviewer nevertheless marked P1 partial and rejected/limited the broader paraphrases. This points to answer framing or reviewer completeness calibration, not a retrieval gap: state Fortune's own reason directly, connect the wheel's reversals to her refusal of constancy, and avoid adding a generic natural-world claim unless it is needed to answer the question. Keep the structural status partial until a new trace shows the reviewer accepts the complete explanation.

The Hume/Kant All Books answer's final sentence says Kant might reinterpret Hume's custom as the manifestation of a necessary transcendental principle. Hume's cited passage says inferences from experience arise from custom rather than reasoning and calls custom the guide of human life (Hume, *An Enquiry Concerning Human Understanding*, p. 24; [source](https://drive.google.com/file/d/1mZJ85hOjyvcxA73iUty51ePE53SvBsGV/view?usp=sharing#page=24)). Kant's cited passage says causality is a condition of objective cognition of phenomena in temporal succession (Kant, *Critique of Pure Reason*, pp. 103–104; [source](https://drive.google.com/file/d/1-ZpE0oiPF2dsDnXyutoNoteTS7AssUMF/view?usp=sharing#page=103)). These premises support a contrast between Hume's account of custom and Kant's account of causality; they do not establish that Kant would identify Hume's custom with a transcendental principle. The sentence is a plausible but unrequested interpretive conjecture, and citations attached to it risk presenting that conjecture as source-backed. The bounded quality target is to answer the requested comparison from retrieved claims and reserve cross-author “what Kant might say” extensions for questions that ask for them.

| Follow-up source audit | Finding |
|---|---|
| Boethius P1 retrieval | Direct statements are present on the cited pages; lack of retrieved evidence is ruled out for the demonstrated answer. |
| Boethius P1 output/review | Core support exists, but the answer/reviewer remains partial. Improve the explicit causal explanation and inspect claim-level reviewer feedback before changing gates. |
| Hume/Kant inference | The final sentence is not entailed by either cited passage and was not requested. Treat as an answer-quality overreach, not a retrieval or citation-resolution defect. |
| Next bounded fix | Implemented as an offline Worker candidate: reject explicit cross-author counterfactual transfer in a non-hypothetical comparison, and ask why-answers to state the source’s reason in its terms before examples. Exact-span review, direct-answer coverage, and explicit hypothetical behavior remain intact. |
| Evaluation | Re-run the paired ten-case workflow once after a bounded change; separately human-score all ten drafts on the existing five dimensions. Do not interpret structural pass rate or citation location as answer-quality proof. |

## October 27, 2026: bounded comparison scope and Boethius review handoff

The run #11 trace confirms two different answer-stage defects. In the Hume/Kant All Books P3, the composer added “if Kant applied his view ... to Hume’s account, he might argue ...” to a question asking how their accounts differ. The current prompt already distinguished comparisons from explicit hypothetical questions, but the deterministic check applied only when the question matched the hypothetical-response detector. The new Worker guard runs before review only for a comparison plan with at least two primary/subject source groups. It rejects a narrowly patterned conditional transfer (“if [view] is applied to [other account], [author] might/would ...”), records `unrequested-cross-author-inference` in the authenticated trace, and keeps neighboring independently supported comparison sentences. It does not reject ordinary synthesis or the explicit hypothetical path. No model stage, retry, or AI call was added.

The initial Boethius P1 diagnosis treated the four claim-ranked IDs as the only spans available to review. Run #14 later exposed a gap in that diagnosis: the full same-source span list was present in the part evidence, but P1-C1’s `sourceEvidence` shortlist omitted the direct p. 11 statement that constancy “belongs not to my ways.” The reviewer prompt prohibited selecting spans outside that shortlist, even when they were already present in the part’s source evidence. The earlier fixture covered the case where the composer repeated source wording; it did not reproduce the run’s abstract paraphrase or assert that the span was eligible for that claim. The fix below corrects that gap without adding pages or changing exact-span validation.

| Candidate validation | Result |
|---|---|
| Unrequested counterfactual in ordinary Hume/Kant comparison | Pass; the speculative sentence is removed, supported comparison claims remain, and explicit hypothetical tests still pass. |
| Boethius why-answer reviewer handoff | Superseded by run #14 trace: the direct and wheel spans reached part-level review, but the abstract P1-C1 claim's ranked shortlist excluded them. The previous fixture did not assert claim-level eligibility. |
| Focused answer suite (`node --test hosting-poc/evidence-answer.test.mjs`) | Pass; 86 tests, 0 failures. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 295 tests, 0 failures. |
| Syntax and whitespace | Pass; changed Worker module passes `node --check`, and `git diff --check` is clean. |
| AI calls and evidence budget | Unchanged; existing composition and review calls, source packet, four review candidates, and accepted span limits remain. |
| Live paired-scope validation | Pending merge and Worker deployment. Rerun the same ten cases once; inspect Hume/Kant P3 and both Boethius P1 traces. |
| Answer-quality conclusion | No live quality gain claimed yet. The new fixture proves the evidence span reaches review when the composer uses the source’s wording; only a live paired run can show whether the model and reviewer use it reliably. Keep the unseen acceptance set frozen. |

## October 27, 2026: paired-scope run #13 and linked composer evidence candidate

Paired-scope run [#40463165261](https://github.com/jsynon/antilogicalism/actions/runs/40463165261) completed all ten cases on library v48 using with-review mode. It recorded no request failures, planner fallbacks, or skipped cases. The deployed Worker revision was `2f0e60bfe934c2ecb631c127a0238d4e4a496478` (Cloudflare version `51ed66be-0712-45cc-81d3-1717ee4e82d9`), the merged revision containing the cross-author inference guard. Structural results were 8/10: All Books 4/5 and Selected Books 4/5. Seventeen of 20 parts were supported, two partial, and one unsupported. The workflow conclusion reflects those two structural misses; requests and artifact creation completed. All 32 citation highlights were located, but this is location evidence only. The artifact's semantic human-review rubric remained unscored.

The most actionable failure was All Books Hamlet. Retrieval included the Shakespeare passage as well as pages from unrelated books that were not linked to the Hamlet part. The composer cited those unrelated IDs alongside the Shakespeare page; part-level validation correctly rejected every sentence, leaving the case unsupported. Selected Books Hamlet passed. This distinguishes a prompt-packet problem from a retrieval or source-validation defect: the unrelated pages existed in the authenticated candidate record, but they were not eligible evidence for the planned answer part. Hume/Kant Selected Books was partial because the reviewer did not receive/accept exact spans for some cited sources; the run does not establish that global source filtering fixes that case.

The bounded candidate now computes the union of source IDs linked by `linkEvidenceToParts` and sends only those pages to composition. `trace.evidence` still records every retrieved page, and per-part citation validation, reviewer exact-span requirements, final evidence assembly, page limits, and model-call budget are unchanged. The composer instruction also explicitly asks for the smallest set of pages that directly supports each factual sentence, without adding a source merely because it was retrieved or by the same author. These changes target the observed Hamlet failure and the citation-bloat risk in Hume/Kant; they do not add retrieval calls, retries, ranking logic, or weaken review.

| Candidate validation | Result |
|---|---|
| Composer evidence allowlist and full trace retention | Focused regression passes: unlinked Tillich and Huck Finn pages are omitted from Hamlet composition input but remain in the authenticated evidence trace. |
| Minimal per-sentence citation behavior | Focused prompt and comparison fixtures pass; each answer sentence retains only its directly supporting source IDs. This verifies the contract fixture, not live model compliance. |
| Focused answer suite (`node --test hosting-poc/evidence-answer.test.mjs`) | Pass; 88 tests, 0 failures. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 297 tests, 0 failures. |
| Syntax and whitespace | Pass; `node --check hosting-poc/evidence-answer.mjs` and `git diff --check` clean. |
| Live paired-scope validation | Completed after merge/deployment in run #14. Its artifact reports the PR #275 merge revision; All Books Hamlet passed, and its composer packet contains only the three Shakespeare pages linked to its part. See the run #14 entry below for the full paired result. |
| Answer-quality conclusion | Run #14 confirms the composer evidence filter was active and the Hamlet case passed in both scopes. Overall structural score was 6/10, so this is a targeted handoff success, not a broad quality improvement. Highlight location does not establish semantic relevance, and human scoring remains pending. Keep the unseen acceptance set frozen. |

## October 27, 2026: paired-scope run #14 validates linked composer evidence

Paired-scope run [#40466618327](https://github.com/jsynon/antilogicalism/actions/runs/40466618327) completed all ten cases on library v48 in with-review mode. It recorded no request failures, planner fallbacks, or skipped cases. The Worker reported source revision `0e9305d04a4638eb2c3c7c83e64598e64fb42895`, the merge commit for PR #275, and Cloudflare version `7049a47b-c2ee-49f6-b9db-c29d35232d32`. The website evaluator revision was `b68a2accc0c2388d0fe40e397b73a8d1eebf4ec2`. The run reused each of five shared plans for its selected-books pair and stayed within the existing 25-call estimate: five planner calls and twenty answer-stage calls.

The run passed 6/10 cases: All Books 2/5 and Selected Books 4/5. Sixteen of 20 parts were supported and four were partial; none were unsupported. Compared with run #13 (8/10; All Books 4/5 and Selected Books 4/5), the paired case set and 25-call estimate were the same, but the website source revision changed and model output is stochastic. Treat the totals as a mixed paired result, not proof that PR #275 caused the lower score. The artifact's human-review table is pending for all ten cases, so it supplies no five-dimension semantic scores.

The targeted behavior is directly visible in the Hamlet All Books trace. Retrieval submitted six pages, including Tillich and Huckleberry Finn pages, while the planned part linked only to Hamlet. The composer received the three Shakespeare pages and omitted the unrelated books. Its final answer cited a Shakespeare passage and passed; Selected Books Hamlet also passed. This verifies that the allowlist reduced irrelevant prompt evidence without removing the complete retrieval set from the authenticated trace. Hume/Kant Selected Books also moved from partial in run #13 to full here, though the run does not establish that the prompt's minimal-citation instruction caused that change.

The four structural misses were different: All Books Wollstonecraft P1 and All Books Du Bois P2 were partial; Boethius Fortune-instability P1 was partial in both scopes. The reviewer rejected a compound Wollstonecraft claim that joined education, understanding, and preparation/appearance claims even though relevant supporting statements were present across p. 122 and p. 35. In All Books Du Bois, the claim that the color line is the century's central problem was cited to the forethought page; that fact alone does not establish its specific connection to double consciousness. In both Boethius scopes, P1-C1 was marked partial. Its four claim-ranked span IDs omitted the direct p. 11 statement that constancy “belongs not to my ways” (ranked seventh in All Books and sixteenth in Selected Books), even though that exact span appeared in the part-level evidence supplied to review. The prompt treated the shortlist as an allowlist, so the reviewer could not select the span. This is a claim-to-review eligibility problem, not a missing retrieval page. Selected Du Bois remained structurally supported after an extra unsupported claim was removed; Selected Wollstonecraft passed both parts.

All 33 citation highlights were text-located (33/33). That confirms page-text location only; the saved `highlightRelevance` section explicitly leaves semantic relevance unscored. The human review rubric is blank for accuracy, question coverage, explanation quality, citation support, and citation completeness in every case.

| Run #14 check | Result |
|---|---|
| Structural result | 6/10 cases; 16 supported, 4 partial, 0 unsupported parts. |
| Request and planner health | 10/10 cases completed; 0 request failures, planner fallbacks, or skips. |
| Estimated/actual answer calls | 25 estimated total calls; 20 answer calls recorded, plus five shared planner calls. |
| Worker version provenance | Worker revision matches PR #275 merge commit; Cloudflare version `7049a47b-c2ee-49f6-b9db-c29d35232d32`. |
| Linked composer evidence | Confirmed live in Hamlet All Books: only linked Shakespeare pages entered composition; retrieved unrelated pages did not. |
| Citation/highlight location | 33/33 located; semantic relevance not evaluated. |
| Human semantic scores | 0/10 reviewed; all five-dimension rubrics remain pending. |
| Next bounded target | Treat claim-ranked reviewer span IDs as hints; permit selecting another exact span already supplied for the same cited source and question part. Keep source, part, fingerprint, and exact-span checks strict; do not widen the evidence packet or add a model stage. |


## October 27, 2026: run #14 reviewer-span trace correction and bounded fix

A raw review-trace inspection corrected the initial run #14 diagnosis. For both Boethius scopes, the reviewer received the complete bounded span list for source S1 in P1's part evidence. The direct statement “a constancy which belongs not to my ways” was present there as S1-Q11. However, claim P1-C1's ranked `sourceEvidence.spanIds` contained only four IDs and omitted S1-Q11 (its rank was seventh in All Books and sixteenth in Selected Books). The reviewer prompt explicitly required selecting only IDs from that claim-level list, so the reviewer returned P1-C1 as partial with no span IDs. The worker's source-scoped exact validator could accept any supplied span from the cited page; the restrictive boundary was the reviewer instruction, not retrieval or text validation.

The bounded fix makes the claim-specific IDs ranked hints rather than an allowlist. The reviewer may select another exact span only from the same cited source's existing evidence for that same question part. The Worker continues to reject unknown IDs, IDs belonging to another source, spans outside the fingerprint-verified source map, and selections over the current per-source/per-claim limits. No page, stage, model call, or search budget is added; the complete span text was already in the review request. The slightly longer instruction adds a small prompt-token cost, which should be confirmed in the next trace.

The run #14 reviewer marked P1 partial even though it listed other claims as direct answers and excluded the partial P1-C1. The Worker preserves an explicit reviewer-part partial status; this change does not auto-promote a part based on citation checks alone. The regression test covers both outcomes: a reviewer can select S1-Q11 outside the ranked shortlist and have it pass exact source validation, while an explicit partial part decision remains partial.

| Validation | Result |
|---|---|
| Run #14 Boethius claim-level trace replay | Pass; the direct span is present in part evidence but absent from the four ranked P1-C1 hints in both scopes. |
| Same-source out-of-shortlist review selection | Pass; the run-shaped fixture selects S1-Q4 outside the four ranked hints, and the Worker retains the exact source text. |
| Reviewer-part status contract | Pass; an explicit partial part decision remains partial even when the nominated claim's span validates. |
| Focused answer suite (`node --test hosting-poc/evidence-answer.test.mjs`) | Pass; 89 tests, 0 failures. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 298 tests, 0 failures. |
| Syntax and whitespace | Pass; `node --check hosting-poc/evidence-answer.mjs` and `git diff --check`. |
| Model calls and evidence packet | No additional call or page; exact span text is already supplied once in the part evidence. The prompt instruction grows slightly. |
| Live paired-scope validation | Pending merge and Worker deployment; inspect whether S1-Q11 is selected for P1-C1 and whether the reviewer marks the answer complete. |
| Answer-quality conclusion | No broad quality gain claimed. This targets one demonstrated reviewer handoff failure; the other run #14 misses and semantic answer quality remain separate work. |

## October 27, 2026: paired-scope run #15 and citation/coverage handoff fix

Paired-scope run [#40471529785](https://github.com/jsynon/antilogicalism/actions/runs/40471529785) completed all ten cases on library v48 in with-review mode. The artifact is `reading-companion-paired-scope-evaluation-all` (artifact ID `12718906841`). The website source revision was `d04d70cb4b2b2f0a6fb04ac519a8d43c94154147`; the Worker revision was `1a360225b27012f467206c8aa59992e58c371c2f` (Cloudflare version `b185b039-bd3f-40b0-8158-27fb32b6e47b`). No request failures, planner fallbacks, or skipped cases were recorded. The run used the existing 25-call estimate: five shared planner calls and twenty answer-stage calls.

The structural result was 9/10: All Books passed 5/5, Selected Books passed 4/5, and 19/20 parts were supported with one partial and none unsupported. Run #14 scored 6/10 and 16/20 parts, so the pair improved on this run. Planner output, retrieved pages, and model composition differed; this is not enough to attribute the gain to a code change. All 37 citations had text-located highlights. The artifact does not score semantic highlight relevance or answer quality, and its five-dimension human rubric remains blank for all ten cases.

The two actionable traces expose different handoff failures:

- **Selected Books Boethius P1:** The relevant causal passage is present as S5 on page 12. The composer cited `[S5, S12]` for the answer's first, causal sentence. S12 is not a supplied source ID; confusing page 12 with citation ID S12 is a plausible explanation, but the trace cannot prove the model's intent. Deterministic validation rejected that sentence for `unknown-source-id`. A later sentence about injustice, citing S1, survived; the reviewer accepted and nominated it as the direct answer, so P1 appeared supported while its causal answer had been removed. This is a citation-ID integrity issue followed by a gap in required-answer lineage, not a retrieval or reviewer-span-selection failure.
- **Selected Books Wollstonecraft P2:** Relevant text appears in the part evidence on both S1 (p. 2, denied rights/immurement) and S4 (p. 116, “enlightened citizens”). The composer cited S1 alone for a sentence linking denied rights to becoming enlightened citizens. The reviewer only received the cited S1 page and marked the claim partial. It should not attach S4 on its own: the composer must cite the passage that supports that part of the sentence, or split the claims. This is a composition/source-linking issue, not missing retrieval.

The bounded Worker change keeps the existing compose and review calls, source packet, and strict boundaries:

1. The composer prompt now says to use only supplied source IDs, never turn a printed page number into a source ID, and cite both pages when a sentence links a reason on one page to an outcome established on another. It also reminds the composer to split claims when that makes support clearer.
2. Citation validation may remove a syntactically valid but unknown ID only when the same citation group also contains a known source ID. The remaining known ID must still pass the existing part allowlist, named-book scope, and exact quote/citation audit. Unknown-only citations remain rejected, as do malformed, out-of-part, and out-of-scope IDs. The authenticated trace records which IDs were removed and retained; no source is added by the reviewer or Worker.
3. The Worker carries the composer-required first answer sentence through validation into the review input. If citation validation drops that sentence, or review does not retain it as an accepted answer, the part cannot be marked supported. Any later supported examples may remain visible, but the part is capped at partial. This closes the observed path where an example alone concealed loss of the requested causal answer.
4. The regression fixtures reproduce the Boethius page-12/S12 collision and the unknown-only case with a later surviving example. Prompt checks cover cross-page causal citations. These tests establish the Worker contract, not model compliance or semantic answer quality.

| Validation | Result |
|---|---|
| Mixed known/unknown citation | Run-shaped fixture removes S12, retains S5, sends only S5 to review, records the repair, and adds no model call. |
| Unknown-only required answer | Remains rejected; a later supported example leaves the part partial and records `required-direct-answer-rejected`. |
| Source/part and exact citation checks | Still fail closed for unknown-only, malformed, out-of-part, out-of-scope, and text-mismatched citations. |
| Focused Worker suite (`node --test hosting-poc/evidence-answer.test.mjs`) | 91 passed, 0 failed. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | 300 passed, 0 failed. |
| Syntax and whitespace | `node --check hosting-poc/evidence-answer.mjs` and `git diff --check` passed. |
| Live paired-scope validation | Completed in run #16 after PR #277 merged and deployed. Selected Boethius now has a complete supported answer and passes; no citation-ID repair was recorded, so this run does not exercise the mixed-known/unknown-ID sanitizer. Selected Wollstonecraft P2 is supported, while its P1 remains partial for a separate unsupported opening claim. |
| Answer-quality conclusion | Mixed. The corrected trace supports seven full answers and three genuine partials; no broad quality change can be attributed to one stochastic run. Semantic highlight relevance remains unmeasured. Keep the acceptance set frozen. |

This change does not widen retrieval, add an AI call, add a repair stage, or relax source identity, part-scope, quote, reviewer-span, or final-render checks. Run #16 confirms Selected Wollstonecraft P2 is supported, while a different P1 claim remains partial; it also exposes two Du Bois sentence-boundary false negatives. The artifact's rubric is still blank, so its structural score does not provide semantic answer-quality scoring.

## October 27, 2026: paired-scope run #16 and first-answer lineage validation

Paired-scope run [#40507788437](https://github.com/jsynon/antilogicalism/actions/runs/40507788437) completed all ten cases in with-review mode using library v48. The artifact is `reading-companion-paired-scope-evaluation-all` (artifact ID `12735728454`). The website revision was `d04d70cb4b2b2f0a6fb04ac519a8d43c94154147`; the Worker revision was `a5585c6964b1bcbb1b36c5ac9ded64d7aa696b6e`, the verified merge commit for PR #277, and Cloudflare reports version `dfc0d3e4-21c9-4fc4-b3c8-0dd1d918bfe9`. The run used the existing 25-call estimate: five shared planner calls and twenty answer-stage calls. All cases completed; there were no request failures, planner fallbacks, or skipped cases.

The official structural result was 5/10: All Books passed 3/5 and Selected Books passed 2/5. The artifact reports 15/20 parts supported and five partial, with none unsupported. This is four fewer passing cases and four fewer supported parts than run #15. It should not be read as a clean four-case answer-quality regression: the new first-answer guard exposed two evaluator false negatives, and run #15 had incorrectly counted a Boethius answer as supported after its causal answer sentence was rejected.

| Case | Official structural result | Independent answer-quality score | Trace finding |
|---|---:|---:|---|
| Hume/Kant, All Books | Pass | 9/10 | Clear causal contrast with page-linked citations. One unrequested cross-author inference was removed; the requested comparison remained. |
| Hume/Kant, Selected Books | Partial | 7/10 | The prose states the habit-versus-necessary-condition contrast, but review found no accepted direct-answer claims for P3. The comparison's source-to-claim linkage still needs work. |
| Wollstonecraft, All Books | Pass | 9/10 | Gives a substantive explanation of education, reason, and social position; all requested parts passed. |
| Wollstonecraft, Selected Books | Partial | 8/10 | P2 is supported. The first P1 sentence claimed equality of reason and injustice of subjugation without support from the cited span and was removed; the remaining explanation is useful but the reviewer kept P1 partial. |
| Du Bois, All Books | Partial | 9/10 | The final definition and color-line discussion are well supported. The trace nevertheless marks the required direct answer rejected. |
| Du Bois, Selected Books | Partial | 9/10 | Same validator issue as All Books; the final definition and color-line answer are cited and accepted by review. |
| Boethius, All Books | Pass | 9/10 | Explains instability and why Fortune's gifts cannot constitute lasting happiness. |
| Boethius, Selected Books | Pass | 9/10 | Gives a complete supported causal explanation. The run #15 causal-answer loss did not recur, but no citation repair was recorded. |
| Hamlet, All Books | Partial | 5/10 | The composer’s direct interpretation was rejected as `quotation-citation-mismatch`; the final answer starts with “This occurs because” and explains the cause and consequence without a clean plain-language answer to what the phrase means. |
| Hamlet, Selected Books | Pass | 9/10 | Directly interprets the phrase and explains the fear-of-death mechanism using the cited Shakespeare page. |

The independent scores above use the artifact's five 0–2 dimensions (accuracy, question coverage, explanation quality, citation support, and citation completeness), scored against final prose and accepted source spans. They are my assessment, not values in the workflow artifact. The artifact itself records 0/10 human-scored entries. My totals are 83/100 (8.3/10 average); the score is a useful read of this run, not a claim that semantic quality is fully automated or that run-to-run model variation has been controlled.

Two trace findings change how the structural score should be interpreted:

- **Du Bois All Books and Selected Books, P1:** Both composer responses begin `W.E.B. Du Bois defines... [S3]`. Node's `Intl.Segmenter` splits that text into a first segment `W.E.B.` and a following segment beginning `Du Bois defines...`. The citation-preserving sentence splitter therefore treats the initials as a standalone, citationless first sentence, records `sentence-missing-citation`, and marks the required direct answer rejected. The final answer drops the initials but retains the cited definition; reviewer decisions accept P1-C1 against S3-Q15, and the remaining P1 claims are supported. PR #277's coverage guard correctly enforces its contract given that split, but the sentence boundary is wrong. These two cases should be treated as evaluator false negatives, not evidence that the model failed to provide or cite the definition. A targeted regression test should preserve abbreviations/initials while retaining the required-answer guard.
- **Hamlet All Books, P1:** Unlike Du Bois, this is a real answer-contract failure. The exact first sentence is rejected as `quotation-citation-mismatch`; it is absent from the final answer, and the coverage guard marks the part partial even though the reviewer accepts later causal and consequence claims. The artifact does not identify which quote check failed. Selected Books answers the same question cleanly, so inspect the All Books source packet and quote-audit input before changing the prompt or relaxing exact-text checks.

Other paired observations:

- **Selected Hume/Kant P3** remains incomplete at evidence handoff. The prose makes the requested contrast, but the reviewer returns no direct-answer claim IDs and lists claim/source support issues. Compare the exact P3 composer claims, planned source groups, and accepted spans; do not infer that the passage search itself failed.
- **Selected Wollstonecraft** improved on the earlier P2 problem: P2 now passes with the companions-of-men/social-progress relation. P1 has a different unsupported opening sentence, which is removed while the part remains partial.
- **Boethius Selected** gives a supported answer in this run, unlike run #15's trace where the causal first answer was rejected. The `citationRepairs` array is empty, so the run does not demonstrate that PR #277's S5/S12 cleanup branch was exercised.
- All 34 cited sources had text-located highlights (34/34). This proves that highlights locate on the cited pages, not that they are the most relevant sentences. The artifact does not evaluate semantic highlight relevance. Its five-dimension rubric is still blank for all ten rows.

| Run #16 check | Result |
|---|---|
| Structural result | 5/10 official passes; 15 supported, 5 partial, 0 unsupported parts. Trace audit identifies two Du Bois false negatives; three genuine partial answers remain. |
| Scope comparison | All Books 3/5 official (4/5 after accounting for the Du Bois segmentation defect); Selected Books 2/5 official (3/5 after that correction). Neither scope wins consistently across questions. |
| Request and planner health | 10/10 completed; 0 request failures, planner fallbacks, or skips. |
| Estimated/actual answer calls | 25 estimated total calls; 20 answer calls recorded, plus five shared planner calls. |
| Worker provenance | PR #277 merge revision `a5585c6964b1bcbb1b36c5ac9ded64d7aa696b6e`; Cloudflare version `dfc0d3e4-21c9-4fc4-b3c8-0dd1d918bfe9`. |
| Citation/highlight location | 34/34 located; semantic highlight relevance not evaluated. |
| Citation sanitizer live evidence | No `citationRepairs` entries; the mixed-known/unknown-ID cleanup remains untested live. |
| Independent answer-quality review | 8.3/10 average across the five requested dimensions; automated artifact rubric remains 0/10 reviewed. |
| Next bounded target | The Worker sentence-boundary fix and regression tests are implemented locally and pass 93 focused / 302 full Worker tests. Merge and deploy this bounded change, then rerun the same paired set once. Afterward, address the three genuine trace misses together as an answer-quality review if they persist; do not add retrieval stages or widen source packets. |

This run gives mixed evidence for PR #277: it closes the false-support path by keeping dropped required answers partial, and the Boethius answer is complete in this run. However, a punctuation boundary in the validator misidentified an initialism as a separate sentence, creating two false failures. The follow-up local fix addresses that boundary while preserving the strict coverage rule. No broad quality regression or improvement should be claimed from this single stochastic run.

## October 27, 2026: protect author initials during sentence splitting

The run #16 trace showed that `Intl.Segmenter` split the composer sentence `W.E.B. Du Bois defines... [S3]` after the initials. The required-answer validator then treated `W.E.B.` as a separate uncited sentence, while the final answer retained the cited definition without the initials. This is a sentence-boundary defect in the citation validator, not a missing citation in the composed sentence.

The bounded Worker correction protects periods inside a compact uppercase initialism when it precedes a capitalized name, only for the duration of sentence segmentation. It restores the periods and citation markers unchanged before validating/rendering each sentence. The original sentence therefore remains the first required answer, while later cited sentences remain separate claims. No prompt, retrieval, evidence selection, reviewer contract, model-call count, or direct-answer rule changed.

Two integration tests cover the boundary and its safety condition:

- A valid `W.E.B. Du Bois ... [S3]` first sentence reaches review as required claim P1-C1; a following cited sentence remains P1-C2 and is not merged into it.
- An unknown citation on the initialism-bearing first sentence is still rejected. A later cited sentence may remain visible, but the part stays partial and records `required-direct-answer-rejected`.

| Validation | Result |
|---|---|
| Focused Worker suite (`node --test hosting-poc/evidence-answer.test.mjs`) | 93 passed, 0 failed. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | 302 passed, 0 failed. |
| Syntax and whitespace | `node --check hosting-poc/evidence-answer.mjs` and `git diff --check` passed. |
| Pipeline/cost impact | Sentence parsing only; no retrieval changes, source packet changes, stages, prompts, or AI calls added. |
| Live paired validation | Pending merge and Worker deployment. Rerun the same ten-case paired set; confirm both Du Bois P1 cases pass without changing the other cases. |

This fixes the evaluator false negative without weakening fail-closed answer coverage. The three genuine run #16 partials remain separate answer-quality evidence and should be revisited after the paired validation.

## October 27, 2026: paired-scope run #17 and Boethius reviewer-hint ranking

Paired-scope run [#40512297605](https://github.com/jsynon/antilogicalism/actions/runs/40512297605) completed all ten cases in with-review mode on library v48. The artifact is `reading-companion-paired-scope-evaluation-all` (artifact ID `12737459736`). The site revision was `d04d70cb4b2b2f0a6fb04ac519a8d43c94154147`; the Worker source revision was `554f32fc792a4a7e47048aee6b034a9b839a98ed` (PR #278, the Du Bois-initialism sentence-boundary correction). The run used the existing 25-call estimate, with no request failures, planner fallbacks, or skipped cases.

The structural result was 10/10: All Books passed 5/5 and Selected Books passed 5/5, with all 20 question parts supported. This is a strong structural result for the paired set. It does not establish a broad answer-quality gain: the five-dimension human rubric is pending for all ten cases, and the artifact does not measure semantic highlight relevance. All 36 cited highlights were text-located, which verifies location only.

The Selected Books Boethius answer is structurally supported and gives a correct central account of happiness as inward and secure from Fortune. Its trace also exposes a narrower answer-quality omission. The composer included P2-C3, “Her assessment of Fortune's gifts suggests that external prosperity is unreliable because it is often incomplete or temporary,” citing S4 (page 13). Review marked that source partial with `claim-source-not-supported` and selected no span, so the final answer omitted this useful explanatory detail while retaining the other supported happiness claims. The matching S4-Q15 passage about welfare's completeness not appearing or remaining and abundant wealth was in the evidence packet, but its claim-level ranked hint position was 19; the four hints instead led with general Fortune/gift passages. The full span list was still available to the reviewer, so this is a prioritization issue, not missing retrieval or an allowlist failure.

The bounded local change adjusts only `rankReviewSpans` in the existing reviewer handoff. It adds a few lightweight families for the observed paraphrases and related forms (completeness/incompleteness, prosperity/wealth, and temporary/remains). Exact normalized word overlap scores higher than a family match. These scores only order exact spans for reviewer attention; they never establish support. The full span list, stable span IDs, source fingerprint checks, same-source selection boundary, and accepted-span limits remain unchanged. No new stage, model call, retrieval page, prompt payload, or evidence budget is added.

| Validation | Result |
|---|---|
| Run #17 full S4 trace replay with revised ranking | Pass; S4-Q15 moves from rank 19 to rank 4 and enters the existing four claim-level hints. |
| Saved-case regression | Added; the trace-shaped fixture requires S4-Q15 in the top four while preserving all five exact spans, and confirms an exact match outranks a related-family match. |
| Focused answer suite (`node --test hosting-poc/evidence-answer.test.mjs`) | Pass; 94 tests, 0 failures. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 303 tests, 0 failures. |
| Syntax and whitespace | Pass; `node --check` on the changed JavaScript files and `git diff --check`. |
| Live paired-scope validation | Pending PR merge and Worker deployment. Rerun the same paired set once and inspect whether the reviewer accepts the wealth/completeness passage for Boethius P2-C3. |
| Answer-quality conclusion | No general improvement claimed. This targets one observed hint-ordering miss; semantic acceptance remains the reviewer's job and human scoring is still needed. |

Keep the acceptance set frozen for this validation. If the reviewer still rejects S4-Q15 despite it moving into the four hints, inspect the exact reviewer decision and claim wording before changing ranking again; do not add another retrieval or review stage based on one stochastic miss.
