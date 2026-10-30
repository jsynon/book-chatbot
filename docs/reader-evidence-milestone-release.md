# Reading Companion evidence milestone: release report
Last updated: October 30, 2026
Status: The latest live diagnostic is [workflow run #16](https://github.com/jsynon/antilogicalism/actions/runs/41048575521), artifact `reading-companion-quality-benchmark-calibration-baseline-compare-selection`, using site revision `76f68d816a934ea6438bd9594df1642974d7ebc5`, Worker revision `c064273b-32f9-4680-aea2-204c85d151d2`, and library v49. All three questions completed without request failures or fallback generation. Deterministic selection passed 0/3; the evaluation-only model-selection arm passed 1/3 (Buddha). Human rubric scores were still pending. The traces showed a Bible page lost before the candidate pool for God-is-love, expected philosophers absent from simulation retrieval, and useful Buddha pages present in candidates but omitted by deterministic selection. Those handoffs motivate the October 30 Worker-side selection change below; no live validation of that change exists yet.

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

Historical call-budget notes above predate Worker-side candidate selection. The October 30 architecture update at the end of this report supersedes them: a normal reviewed All Books case now has one planning, one selection, one composition, and one review call, with conditional gap planning still optional.

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
| GitHub Worker contract workflow | Pass; [run #784](https://github.com/jsynon/book-chatbot/actions/runs/40371944343) succeeded |
| Live validation | Pending; after this candidate is merged and deployed, rerun the same five-question with-review workflows in both all-books and selected-books modes. Inspect the Kierkegaard faith trace for the polarity reason; inspect Nietzsche/Kierkegaard span relevance and Sunyata attribution/coverage separately. |
| Quality claims | None yet. The new test proves the deterministic guard catches this explicit polarity pattern; it does not prove that the shortened model instructions improve broader answer quality. |
| Remaining answer-quality work | Sunyata's substantive explanation and weak hypothetical inference still need source-level evaluation. Keep the unseen acceptance suite frozen until both live scopes are reviewed. |

## October 26, 2026: runs #74 and #75 expose scope-dependent hypothetical handoff gaps

The inspected all-books artifact #74 and selected-books artifact #75 both used the Nietzsche/Kierkegaard question. The all-books planner created Nietzsche and Kierkegaard premise parts plus a synthesis part, but its Nietzsche-side query returned no pages. All 12 retrieved candidates and all six submitted pages were Kierkegaard pages, leaving the Nietzsche premise and inference unsupported. The selected-books route did retrieve pages from both works, but skipped planning and represented the question as one generic part. Review rejected the Kierkegaard premise as unsupported, so the output could not make the requested cross-author inference. These traces show separate gaps: a source-native retrieval miss in all-books mode and loss of comparison structure in selected-books mode.

The current bounded candidate addresses both existing handoffs without adding stages or model calls:

| Change | Scope and contract |
|---|---|
| Empty-side retrieval retry | The browser's existing single fallback query now combines the failed facet's source-native terms with the successful counterpart facet and reader question. It remains limited to the already planned missing-side book IDs; it runs only when that source facet is empty and adds no model call or page budget. |
| Selected-books plan reconstruction | If planning was skipped, the Worker reconstructs author premise groups only when the question explicitly names exactly two authors found in verified source titles. It preserves question order and creates the two author-side parts plus the shared inference part. Other selected-books questions retain the current fallback behavior. It uses existing composition, review, and span checks. |
| Paired-scope question suite | A new manually dispatched website workflow runs five new questions in All Books and Selected Books. Both sides reuse the same all-books planner output and queries; the selected half intersects the plan with its explicitly configured book IDs. This creates a more controlled comparison than separate all-books and selected-books workflows. |

The five new paired questions cover Hume/Kant on causal inference, Wollstonecraft on education and reason, Du Bois on double consciousness and the color line, Boethius on Fortune and happiness, and Hamlet on conscience. The workflow runs with review, emits per-scope live progress, and estimates 25 Worker AI calls for all five pairs (five shared planner calls plus two answer calls per scope). A single pair estimates five calls. The Hamlet question is about the play's soliloquy and is not an acceptance-set item.

| Candidate validation | Result |
|---|---|
| Worker selected hypothetical plan reconstruction | Added regression checks both verified author groups, question order, three parts, and no added AI call; pass in the Worker suite. |
| Missing-side retrieval fallback | Updated regression uses the observed abstract Nietzsche/Kierkegaard facet shape and verifies the retry combines both sides while remaining target-scoped; pass in the site suite. |
| Paired workflow | Added an opt-in manual workflow, report fields for planner reuse and scope summaries, and tests for paired plan reuse, selected-book restriction, workflow inputs, and offline recheck; pass in the website suite. |
| Full offline suites | Pass; Worker `node --test hosting-poc/*.test.mjs`: 276 tests; website `node --test reading-companion/*.test.mjs`: 191 tests. Changed modules pass `node --check`, and both candidate diffs pass `git diff --check`. |
| Code review note | The current Worker main-branch snapshot's `evidence-answer.test.mjs` contained literal truncated-output text and had lost most of its tracked test cases. The candidate restores the intact test file from the preceding source commit, then updates prompt-contract assertions to match the already deployed reviewer prompt and adds the new regression. This restores validation coverage; it does not change answer runtime behavior beyond the selected-scope reconstruction. |
| Live validation | Pending PR merge and deployment. First rerun the existing focused all-books and selected-books with-review workflows to compare against #74/#75; then run the new paired workflow to evaluate the additional questions under the shared planner. |
| Quality claims | None yet. Unit tests verify bounded routing and structural contracts; they cannot establish answer accuracy or semantic support. Inspect answer text, per-question-part evidence, reviewed spans, and cited page text in both artifacts. |
| Unseen acceptance suite | Keep frozen until the focused results and new paired outputs are reviewed. |

## October 26, 2026: paired-scope run #1 and bounded alignment/review correction

Paired scope run [#40383267079](https://github.com/jsynon/antilogicalism/actions/runs/40383267079) used Worker source revision `a6fc66a`, website revision `a160d844b`, and library v48. All ten scope rows completed without request failures or planner fallbacks. Structural results were 8/10 overall: All Books 3/5 and Selected Books 5/5. The run used the 25-call baseline. This was the first controlled comparison because each selected-books half reused its paired all-books plan and query set.

The Hume/Kant All Books case was flagged for source alignment even though the expected Hume (book 35) and Kant (book 40) works were present. The Hume answer also cited book 276, which appeared in that part's saved planner `sourceBookIds`. The previous evaluator treated any non-canonical extra book as structurally misaligned, despite the plan making it eligible. That is a structural false negative; eligibility alone does not show that the passage is relevant. The Boethius downgrade was distinct: one citation was partial while another citation from the same planned source group had an accepted exact span supporting the claim. Requiring every cited source to pass individually discarded supported claim evidence.

The paired candidate makes two narrow changes across the Worker and website evaluator:

| Area | Change | Boundary |
|---|---|---|
| All Books source alignment | Use the saved planner part's `sourceBookIds` as the eligible set; continue requiring the configured expected work and report additional eligible cited works separately for human quality review. | Applies only to All Books audit alignment. Selected Books remains strict. Plan eligibility is not semantic support. |
| Same-group citation review | Retain a claim when the reviewer marks it answered and at least one cited source has an accepted exact span, provided accepted evidence still covers every source group represented in the claim. Remove weak citation IDs from the rendered answer/evidence map. | Missing decisions, missing spans, unsupported required source groups, and incomplete comparison premises still fail closed. No broad citation pruning. |
| Offline report recheck | Reuse the saved scope and planner plan during offline evaluation rechecks, and expose the recalculated part alignment. | Prevents artifact rechecks from silently applying a different scope rule from the live run. |

The change reuses the existing planner/composer/reviewer calls and page packet. It adds no stage, model call, retry, or page budget. Worker regression coverage uses a Boethius-like same-group citation set (one partial source, one accepted exact span) and verifies that only the accepted citation survives. Website coverage checks planner-eligible alternates, out-of-plan sources, strict selected scope, and saved-plan offline rechecks.

| Candidate validation | Result |
|---|---|
| Focused Worker regression | Pass: 72 tests, including preservation of earlier missing-span and cross-group failure guards. |
| Focused website evaluator regressions | Pass: 51 tests, including offline recheck using the saved all-books planner eligibility set. |
| Full offline suites | Pass: Worker `node --test hosting-poc/*.test.mjs`, 277 tests; website `node --test reading-companion/*.test.mjs`, 194 tests. Changed modules pass `node --check`; both candidate diffs pass `git diff --check`. |
| PR/deployment | Merged: [Worker #262](https://github.com/jsynon/book-chatbot/pull/262) and [website #217](https://github.com/jsynon/antilogicalism/pull/217). The user reports deploying the Worker; paired run #2 recorded Worker revision `d657b43ff610969692e63cab5e3f33a1219de729`. |
| Live validation | Completed in paired run #2, recorded below. The alignment correction remained effective; the Boethius downgrade was not reproduced, so its exact pruning path still needs a deliberate trace to validate. |
| Quality conclusion | No answer-quality improvement is established by this artifact or these structural regressions. The evaluator now separates planner eligibility from semantic relevance, while the Worker can preserve a claim supported by a valid source from its planned group. |
| Unseen acceptance suite | Keep frozen until the paired artifact is re-run and cited page text is reviewed. |

## October 26, 2026: paired-scope run #2 and candidate-to-part handoff

Paired scope run [#40419672507](https://github.com/jsynon/antilogicalism/actions/runs/40419672507) used website source `8ac297ab1372250451bcd828693b3eaf67d371f5`, Worker source `d657b43ff610969692e63cab5e3f33a1219de729`, and library v48. All ten rows completed with no request failures or planner fallbacks; the 25-call baseline was respected. Structural results were 6/10 overall: All Books 2/5 and Selected Books 4/5. Fifteen of twenty question parts were supported, two were partial, and three were unsupported. Every cited source had a located highlight, which confirms location only.

The source-alignment false negative from run #1 did not recur. The Hume page in All Books was aligned to its planned source group, and the audit correctly reported the additional eligible book. However, the case exposed a more important evidence handoff loss: the Kant-linked searches returned pages 104, 98, 103, and 213 from *Critique of Pure Reason*, but all 12 hydrated `retrievalCandidates` were Hume pages. The bounded packet consequently contained six Hume pages, leaving the Kant part unsupported. The merge step reserved many Hume pages from several linked facets before it reserved a candidate for the Kant part.

The Hamlet All Books failure occurred earlier. The planner did not assign book IDs to the part. A Shakespeare-focused facet resolved catalog books 212 and 564, but its top results were other Shakespeare pages; the exact part wording was searched globally and surfaced commentary. Page 454, which the Selected Books run retrieved and cited, did not appear in All Books search results. A part query scoped to works resolved by a sibling facet should be run inside those already trusted works so source-specific wording has a chance to find the intended page.

This bounded website candidate changes two existing handoffs in `reading-companion/evidence-search.mjs`:

- Candidate merging gives every question part its strongest eligible page before distributing additional distinct-work pages across parts. Ordinary cross-facet ranking fills the rest of the existing 12-candidate limit.
- When an exact part question was searched globally but another linked facet resolved that part to catalog works, retrieval repeats the exact query only inside the unresolved works. The result trace records `partScopeInherited` and the targeted book IDs. It does not widen the part's source allowlist or the reader's selected-book scope.

These are local index searches; they add no Worker AI call, no model stage, and no submitted-page budget. The existing six-page Worker packet, fingerprints, citation validation, review rules, and public response contract remain unchanged. This addresses evidence availability in the Hume/Kant and Hamlet traces; it does not establish answer quality or fix the separate incomplete Hume span in Selected Books or Du Bois reviewer variance.

| Candidate validation | Result |
|---|---|
| Hume/Kant candidate regression | Pass; when one part has many linked books/facets, a Kant candidate survives the bounded merge and reaches the submitted packet. |
| Hamlet named-source regression | Pass; the exact part query inherits only catalog-resolved books 212 and 564, page 454 reaches the packet, and an unscoped commentary candidate cannot satisfy the part. |
| Focused retrieval suite | Pass; 62 tests, 0 failures. |
| Full website suite | Pass; `node --test reading-companion/*.test.mjs`, 196 tests, 0 failures. |
| Worker dependency suite | Pass; Worker suite 277 tests, 0 failures. No Worker runtime or shared contract changed. |
| Zero-AI published-library evaluation | Passes expected-source retrieval in 30/31 cases, with 0 source-identity issues, fingerprint errors, or execution errors. The one miss is the existing 1 John expected-source case; the benchmark is source discovery/identity only, not answer quality. |
| Saved-plan retrieval replay | Pass; replayed the Hume/Kant and Hamlet All Books plans from run #2 against the published v48 index with no AI calls. Kant pages entered candidates and the packet; Hamlet page 454 entered both. This replay does not test composition/review or independently verify fingerprints. |
| Live validation | Pending. After website publication, rerun the same paired scope workflow. Confirm these evidence pages survive in the authenticated artifact and check the other cases for regressions. Inspect cited page text and review traces; a structural score alone is not a quality judgment. |
| Unseen acceptance suite | Keep frozen until the paired rerun has been reviewed. |

## October 26, 2026: paired-scope run #3 and answer-quality handoff

Paired-scope run [#40429747671](https://github.com/jsynon/antilogicalism/actions/runs/40429747671) used website source `e18be04314083fdfe6bdbfce1e8930e0e2b33bc3`, Worker source `bbdef1c373d15931bfce025ac33b156cc813bde3`, and library v48. All ten scope rows completed with no request failures, planner fallbacks, or skipped cases. Structural results improved to 9/10: All Books 4/5 and Selected Books 5/5. The artifact marked all 20 question parts supported. It ran with the existing 25-call paired baseline. The workflow used Worker version `d2efe248-e578-489d-bcfd-0a125d5c4df4`.

This structural score does not establish answer quality. The artifact’s own quality note says its automated checks do not judge factual truth or semantic citation support, and `humanReview.reviewed` is 0/10. A separate provisional rubric review in this conversation rated the drafts 42/50 for All Books and 43/50 for Selected Books; these are not scores stored by the workflow and are based on answer text and artifact excerpts, not a full independent reading of every PDF page. All 33 cited sources had a located highlight; that verifies location, not whether the chosen span is the best or whether it supports the interpretation.

The Hume/Kant All Books miss is a source-work alignment issue, distinct from the answer-stage issue. The evaluation expects Hume’s *Enquiry* (book 35), while the answer cites Hume’s *Treatise* (book 276), a primary Hume source permitted by the author-wide Worker plan. The packet included an *Enquiry* page 69 that was not relevant to the question, and a relevant-looking *Enquiry* candidate page 30 did not reach the six-page packet. This candidate does not change retrieval, the packet selector, or the evaluator’s expected-work rule; the 9/10 result therefore remains an honest unresolved structural miss.

The answer-stage trace gives a narrower target for the current change. In the All Books comparison, one sentence combined Hume’s and Kant’s positions under a shared citation group. The existing reviewer accepted Hume’s *Treatise* span and Kant’s *Fundamental Principles* span for that claim, while marking the Kant *Critique of Pure Reason* span partial. This indicates that author-side premises and the causal concept were not separated clearly enough for a reliable claim-level judgment. In both Hamlet scopes, the reviewer accepted short answers that explained the consequences of uncertainty but did not plainly state what Hamlet means by “conscience” in this passage.

The bounded Worker candidate edits only the existing `COMPOSER_PROMPT` and `REVIEW_PROMPT` in `hosting-poc/evidence-answer.mjs`:

- The composer must answer each part in its opening sentence. For a phrase-meaning question, it interprets the phrase before describing consequences. For a comparison, it gives each author’s position in a separate sentence, then states a synthesis only when both sides support the relationship.
- The existing reviewer must require an explicit interpretation for phrase-meaning questions and check each comparative premise against that author’s evidence. A topical or adjacent passage does not establish the requested concept.
- No Worker call, reviewer stage, source schema, retrieval behavior, citation rule, page cap, or public response contract is added or changed. The same paired with-review workflow still estimates 25 calls. Prompt inputs are slightly longer; there is no additional call.

| Candidate validation | Result |
|---|---|
| Composer/reviewer prompt contract regressions | Pass; assertions cover direct part answers, explicit phrase interpretation, separate author premises, and supported synthesis. |
| Focused answer suite | Pass: `node --test hosting-poc/evidence-answer.test.mjs`, 72 tests, 0 failures. |
| Full Worker suite | Pass; `node --test hosting-poc/*.test.mjs`, 277 tests, 0 failures. |
| Syntax and whitespace | Pass; changed JavaScript files pass `node --check`; `git diff --check` passes. |
| Website suite | No website runtime or evaluator code changed in this candidate. |
| Live quality validation | Pending. After merge and Worker deployment, rerun the same paired with-review workflow and inspect the Hume/Kant P3 claim/source decisions and both Hamlet answers. Re-score all ten answers with the same five dimensions; the eight stronger drafts should not regress. |
| Unresolved structural issue | Hume/Kant All Books still needs the expected *Enquiry* work alignment or an explicit test decision about an author-wide alternate source. This prompt-only candidate does not claim to fix it. |
| Unseen acceptance suite | Keep frozen until paired answers are reviewed. |

## October 27, 2026: paired-scope run #5 and bounded source-resolution correction

Paired-scope run [#40432440170](https://github.com/jsynon/antilogicalism/actions/runs/40432440170) completed all ten rows with no planner fallback, skipped case, or request failure. It used website source `e18be04314083fdfe6bdbfce1e8930e0e2b33bc3`, Worker source `fa871b19c1f4091cc4b8262359a6cf86871dbef4`, library v48, and the existing estimated 25-call baseline. Structural results fell from run #4’s 9/10 to 6/10: All Books 2/5 and Selected Books 4/5. Seventeen parts were supported and three were partial. All 34 citation highlights were located; this does not establish that the cited text supports the attached claim.

The two most actionable failures point to source resolution rather than a need for another general prompt rule:

- **Hume/Kant, All Books:** the test question asked about Hume generally, while its required-source fixture demanded Hume’s *Enquiry* (book 35). The answer used a relevant passage from Hume’s *Treatise* (book 276), which the all-books plan allowed. The trace also showed a relevant-looking *Enquiry* page 30 in retrieval candidates but not in the six-page composition packet; an irrelevant *Enquiry* page 69 was submitted. Make the paired question explicitly name both *An Enquiry Concerning Human Understanding* and Kant’s *Critique of Pure Reason*. That makes the existing deterministic title-to-book source grouping and part-level packet ranking test the work scope the fixture claims to test. Do not weaken the all-books source gate to accept any author text when the benchmark intends a controlled work comparison.
- **Hamlet, All Books:** Shakespeare’s primary passage was in the submitted packet, but the plan left the Hamlet part unscoped (`sourceBookIds: null`) and the final answer cited commentary by Paul Tillich instead of interpreting the line. The catalog has Shakespeare’s collected works but no standalone Hamlet record, so the existing title matcher did not connect “Hamlet” to a primary source. Add a small verified alias from the explicitly named play to book 212 (*The Complete Works of William Shakespeare*). The normal planner normalization then attaches that source ID to the part, and the existing `linkEvidenceToParts` contract prevents commentary from standing in for the named text. The alias does not claim the Shakespeare passage is semantically sufficient; review still decides that.
- **Wollstonecraft Selected and Boethius All Books:** reviewer-rejected claims remained partial. Preserve that fail-closed status. Their current traces do not justify relaxing coverage or citation gates, and they are not being folded into this bounded source-resolution change.

No planner/composer/reviewer call, answer packet size, review decision, citation rule, or public response field is added. Hume’s prompt change repairs the benchmark’s source definition; the Hamlet alias affects only explicitly named Hamlet questions and links to a title-validated primary catalog record. The evidence-milestone site patch that adds scoped part-query recovery was already included in the site revision used by run #5, so this change does not repeat it.

| Candidate validation | Result |
|---|---|
| Planner regression: named Hamlet resolves to book 212 and the normalized part carries that ID | Pass |
| Evidence handoff regression: Hamlet part admits the Shakespeare page and excludes an unrelated commentary page | Pass |
| Site/evaluator regression: paired Hume/Kant case names both required works while retaining selected IDs 35 and 40 | Pass |
| Website/evaluator suite: `node --test reading-companion/*.test.mjs` | Pass; 197 tests, 0 failures |
| Full Worker suite: `node --test hosting-poc/*.test.mjs` | Pass; 280 tests, 0 failures |
| Syntax and whitespace checks | Pass; changed JavaScript modules pass `node --check`; both repository diffs pass `git diff --check` |
| Live paired-scope validation | Pending merge/deployment; rerun the same ten rows and check Hume *Enquiry* page 30 in submitted sources, Hamlet part source IDs and cited Shakespeare passage, plus all other rows for regressions |
| Unseen acceptance suite | Keep frozen until the live source text and answers are reviewed |


## October 27, 2026: paired-scope run #6 and direct-answer coverage handoff

Run [#6](https://github.com/jsynon/antilogicalism/actions/runs/40436293515) completed all ten paired-scope cases on library v48 with-review. It recorded zero request failures, planner fallbacks, or skipped cases, with an estimated 25 Worker AI calls. The deployed website revision was `55ca020e5b06f0056193329b0e597941ba85666c`; the Worker source revision was `b9c4860abdafc867b9e0451b60949c78ea97b8fd`, running as Worker version `7dd0e7b4-f18c-4389-bead-f38c3be82ec8`.

The run passed 7/10 structural cases: All Books 4/5 and Selected Books 3/5. Seventeen of 20 parts were supported and three were partial. All 30 citations resolved to located highlights; this confirms location only, not that a highlight or passage supports its answer claim. No cases had human semantic ratings. Compared with run #5 (6/10), Hume/Kant and Hamlet All Books improved; the net structural change was +1. Hume/Kant passed in both scopes. Hamlet passed structurally in both scopes, but its All Books answer was a one-sentence statement about enterprises losing momentum and did not adequately explain conscience; the Selected Books answer gave a more useful explanation. Wollstonecraft Selected remained partial. Boethius was partial in both scopes, with its Selected result regressing from the previous run. These are answer-quality and completeness signals; do not loosen the evidence gate to improve the score.

The bounded candidate change extends the existing review response with `directAnswerClaimIds` for each question part. The reviewer must name the claim or claims that directly answer the part and cover its explicit facets; a related consequence or example alone does not qualify for a meaning, definition, reason, or relationship question. The Worker then verifies deterministically that each nominated ID belongs to that same part and that the claim survives exact quote review. If a part has accepted claims but no valid accepted direct-answer claim, it remains partial. The IDs and validation decision are retained in the authenticated review trace. This adds no model call, pipeline stage, retrieval pass, page packet, or public response field. It does not regenerate or rewrite prose.

The reviewer still makes the semantic judgment about whether a claim directly answers the question. The Worker check makes that judgment explicit and auditable and prevents a missing, cross-part, or citation-rejected claim from silently satisfying coverage; it is not an independent semantic judge and does not by itself guarantee a stronger answer. Highlight relevance remains a separate follow-up.

| Validation | Result |
|---|---|
| Focused answer-pipeline tests | 77 passed, 0 failed |
| Full Worker tests (`node --test hosting-poc/*.test.mjs`) | 284 passed, 0 failed |
| Syntax and whitespace checks | Passed; all changed JavaScript files pass `node --check`, and `git diff --check` is clean |
| Live paired-scope rerun after merge and Worker deployment | Pending; required before claiming live improvement |
| Highlight relevance evaluation | Separate discussion and milestone |
| Unseen acceptance suite | Keep frozen |

## October 27, 2026: paired-scope run #7 and direct-answer/highlight handoff

Run [#40439355678](https://github.com/jsynon/antilogicalism/actions/runs/40439355678) completed all ten with-review rows on library v48. The website revision remained `55ca020e5b06f0056193329b0e597941ba85666c`; the Worker revision changed from run #6's `b9c4860abdafc867b9e0451b60949c78ea97b8fd` to `0148253f4ecbb943320c4b8d69ee6ce8ff1d03f9` (PR #266), running as Worker version `7a225ce1-be5b-4752-9d66-4572abefa43d`. The run used the existing estimated 25-call baseline and had zero request failures, planner fallbacks, or skipped rows.

Structural results were 6/10: All Books 2/5 and Selected Books 4/5. Thirteen of 20 parts were supported and seven were partial; none were unsupported. Human semantic review remained pending for all ten rows. Compared with run #6 (7/10, All Books 4/5 and Selected Books 3/5), the scope split reversed: Selected Books improved while All Books lost two passing cases. This is a mixed result on a changed Worker revision, not a like-for-like regression test. All 33 cited-source highlights were text-located, which proves only that the excerpt can be found on its page.

The exact review trace explains the new partial results. Every one of the seven partial parts had `directAnswerCovered: false`. In each, the reviewer nominated all claims in the part as direct answers, but one or more nominated claims failed exact source review. The accepted claims were preserved in the trace; the broad direct-answer list caused the part to remain partial even when other accepted claims existed. The Worker must not pass a part based on any single accepted claim: the selected direct-answer claims together need to cover all requested facets. The bounded correction therefore tightens the existing reviewer contract to request the smallest sufficient direct-answer set. The Worker continues to require every nominated direct claim to survive exact-span review. Claims that are not nominated as direct answers and fail review are omitted from final rendering; they do not alone downgrade a part if the reviewer confirms that the retained answer fully covers it. A rejected direct claim or partial reviewer part decision remains fail-closed.

The same artifact gives a concrete highlight case. Hamlet Selected Books used the approved neighboring quote “those ills we have / Than fly to others that we know not of?” as the primary excerpt for an answer about the phrase “conscience makes cowards of us all,” even though the approved excerpt set also included the line itself. The Worker now ranks only exact, reviewer-approved quote candidates using both the linked claim and original reader question, so the phrase asked about can lead over nearby context. The quote is still limited to a cited, fingerprint-verified source; question terms only reorder approved spans. No answer, citation, evidence-map, or workflow-artifact fields change.

This change stays within the existing pipeline: no added AI call, review stage, retrieval query, answer-page budget, fingerprint path, or public schema. The reviewer owns the semantic judgment; the Worker validates the chosen claim IDs, prunes rejected claims before rendering, and preserves partial status when the required direct-answer set is incomplete. The primary highlight ranking remains a UI aid, not semantic validation.

| Candidate validation | Result |
|---|---|
| Focused Worker suites (`evidence-answer.test.mjs`, `public-gateway.test.mjs`) | Pass; 242 tests, 0 failures. Includes pruning an unsupported non-direct claim, fail-closed handling for an unsupported direct claim, and a Hamlet question-aware primary-highlight regression. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 288 tests, 0 failures. |
| Website/evaluator suite (`node --test reading-companion/*.test.mjs`) | Pass; 198 tests, 0 failures. No website runtime code changed; its evaluation guide now records run #7 and the follow-up. |
| Syntax and whitespace | Pass; changed Worker modules pass `node --check`, and both repository diffs pass `git diff --check`. |
| Live paired-scope validation | Pending merge and Worker deployment. Rerun the same ten rows, verify minimal accepted direct-answer IDs and omitted rejected claims, preserve partial status when a nominated direct answer fails, and inspect Hamlet primary excerpts in both scopes. |
| Unseen acceptance suite | Keep frozen until the live answers and cited source text have been reviewed. |

## October 27, 2026: paired-scope run #8 and trace diagnostics

Run [#40442765743](https://github.com/jsynon/antilogicalism/actions/runs/40442765743) completed all ten with-review rows on library v48 using the merged Worker revision `da69074d8410ba5f988335c88138e17bb1b41b0b` (Cloudflare version `0020fa45-3f34-4d34-a18b-658dfe59f673`) and website revision `3841faabe5220e8ca60db2ef77d772412c57957c`. It passed 6/10 structural cases: All Books 4/5 and Selected Books 2/5. Sixteen of twenty parts were supported, three partial, and one unsupported. The run had zero request failures, planner fallbacks, or skipped rows. All 35 cited highlights were located; all ten human-review entries remained pending, so the run supplies no official semantic quality score.

The direct-answer handoff remains a measured issue in the three partial Selected Books parts: Hume/Kant P3 accepted two of three nominated direct claims; Wollstonecraft P2 accepted three of four; Du Bois P2 accepted three of four. The reviewer still nominates every drafted claim in each part, so the exact-source gate rejects a broader set than necessary. Preserve the fail-closed check; the diagnostic change records the reviewer's original part status alongside the final status after Worker checks, letting the next authenticated trace distinguish reviewer-level partiality from deterministic downgrading.

Hamlet All Books is now understood from the saved authenticated trace. The Shakespeare passage is among the six submitted pages, but its `candidatePartIds` is `P1` only on S1 and S2; S3–S6 are unlinked. The composer cited S2 together with S3 or S4 in each of four sentences. Because any cited source outside the part's allowed candidate set invalidates that sentence, all four were rejected as `source-not-linked-to-question-part`, leaving no verifiable answer. This is a part-to-source handoff failure. The exact raw compose output is already available in the authenticated artifact; no prompt change or extra model call should be inferred from this single case. The diagnostic candidate adds a finite list of rejection reason codes beside this generic final failure, while retaining the detailed trace and leaving public failure behavior unchanged.

The next review should check whether the candidate captures reviewer status and the Hamlet reason summary without exposing either in public responses, and whether the existing fail-closed behavior and call budget remain unchanged. After merge and Worker deployment, rerun the same paired set once. Verify the new diagnostics first; then decide whether a distinct bounded source-linking behavior fix is warranted from this root cause. Do not broaden to answer-style tuning or unfreeze acceptance based on structural scores alone.

## October 27, 2026: paired-scope run #9 and bounded reviewer handoff correction

Paired-scope run [#40446494819](https://github.com/jsynon/antilogicalism/actions/runs/40446494819) completed all ten v48 cases with the 25-call baseline and no request failures, planner fallbacks, or skipped rows. It passed 6/10 structural checks: All Books 2/5 and Selected Books 4/5. Sixteen of 22 question parts were supported and six partial; none were unsupported. The Worker source revision was `6c0d973c2ffa3f1a90ebc5b7fb36071cf1481613`, and the site revision was `4d5e3601d939a99a5fdd91a27abdc89cc4568d74`. Human semantic review remained pending for all ten rows. The scope split reversed from run #8, and the planner created a different part count for Hamlet, so the score is not a like-for-like quality comparison.

The authenticated trace showed two separate review-handoff failures. In four partial parts—Hume/Kant All Books P3, Wollstonecraft Selected Books P1, and both Boethius All Books parts—the reviewer marked the part answered but included one or more claims in its direct-answer set that did not survive Worker source checks. The remaining accepted claims may be sufficient, but the system correctly refused to infer that from a reviewer part label alone. Wollstonecraft All Books had a different failure: the reviewer emitted a fenced JSON object with an extra `]` after each source list inside its claims array. The existing parser tolerated a known stray tail but not this repeated, internally unmatched closer, so the answer stayed unverified and returned no evidence map or highlights.

The bounded Worker change keeps the existing three-way trust boundary—model review, exact source validation, deterministic part coverage—and makes those handoffs more coherent:

- Review JSON gets a string-aware delimiter scan. On the review stage only, it can remove an immediately repeated closing delimiter only when that delimiter is unmatched at the current structural position. The normalized text must still parse as JSON and pass the complete existing claim/part/source/span schema. Other malformed or truncated responses remain fail-closed. The authenticated trace records the narrow recovery code and count.
- The reviewer now emits claim/source decisions before part decisions. Its instructions require the direct-answer set to be chosen afterward, from claims it judged answered and whose evidence still covers every required source group. A weak alternate can be omitted only under the existing supported-subset rule. The Worker still independently requires every nominated direct-answer claim to survive its exact-span and source-group checks; it does not promote a part merely because some claims survived.
- The composer, retrieval and candidate selection, six-page packet, highlight ranking, public response shape, and model-call budget are unchanged. The composer already separates factual sentences into reviewable claims, so this correction addresses the observed reviewer ordering/selection and formatting defects without another generation stage or a general prompt expansion.

| Candidate validation | Result |
|---|---|
| Exact run #9 malformed-review fixture | Pass; the duplicated unmatched `]` is removed, the full review schema and exact span are still required, and trace recovery is recorded. |
| Malformed quote and unrelated reviewer-format regressions | Pass; unescaped quotes and the prior malformed-key example still fail closed. |
| Direct-answer fail-closed regressions | Pass; a rejected nominated direct claim still leaves the part partial even when another accepted claim remains. |
| Focused Worker suite (`node --test hosting-poc/evidence-answer.test.mjs`) | Pass; 81 tests, 0 failures. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 290 tests, 0 failures. |
| Syntax and whitespace checks | Pass; changed Worker JavaScript passes `node --check` and `git diff --check`. |
| Website/evaluator suite | No website runtime code changed; the paired workflow shape and 25-call estimate are unchanged. |
| Live paired validation | Completed in run #10 after merge/deployment. Wollstonecraft All Books succeeded with valid review JSON, but the trace had no recovery event, so this run did not exercise the delimiter-repair branch. The four direct-answer handoffs were not all resolved; follow-up run #11 tests the source-subset change. |
| Quality conclusion | The clean Wollstonecraft run confirms the case completed, but no broad quality improvement was established. Human source review remains necessary; keep the unseen acceptance suite frozen. |

## October 27, 2026: paired-scope run #10 and source-subset/interpretive-completeness candidate

Paired-scope run [#40450042539](https://github.com/jsynon/antilogicalism/actions/runs/40450042539) completed all ten v48 cases with the existing estimated 25-call baseline. It recorded no request failures, planner fallbacks, or skipped cases. The deployed Worker revision was `a92bc250c8e6ad121163913b46c09f0a29cd0977` (Cloudflare version `c88c28f2-1b5a-46aa-9bea-38fc4728567a`). Structural results were 7/10: All Books 3/5 and Selected Books 4/5. Fifteen of 20 question parts were supported and five partial. All 36 citations had a located highlight, but semantic relevance was not scored; the artifact's human rubric remained blank for all ten answers. The planner produced a different number of parts than the prior run, so the structural score is not a clean like-for-like quality comparison.

The run confirms a narrow source-subset handoff defect. In Hume/Kant All Books P1 and P3, and Boethius P2 in both scopes, the reviewer marked the claim answered, explicitly marked one citation partial or unanswered with no span IDs, and supplied an accepted exact span from another citation in the same planned author/work group. The Worker still treated the explicitly rejected empty citation as unresolved and blocked the supported subset. Keep the existing conditions that the claim decision is answered, accepted exact evidence remains, and every group cited by the claim remains covered. Only an explicit partial/unanswered source decision can be omitted. A missing or malformed decision, a source marked answered without a selected exact span, a legacy spanless review, or an uncovered comparison group must continue to fail closed. This adds no AI call or retry.

The answer-quality signal is separate from the subset fix. Both Hamlet answers passed structure but explained that thought weakens resolve and action without stating the passage's preceding reason: fear of what may follow death. The adjacent soliloquy page was in the submitted packet, but the answer did not use it. The candidate therefore tightens existing composer and reviewer instructions for phrase interpretation: when the supplied pages give the causal premise behind a phrase's effect, include that premise and cite its own page; do not invent missing context. This aims at fuller interpretation from already supplied evidence, without increasing the packet or adding a stage. It does not claim a broad quality gain from prompt text alone.

| Candidate validation | Result |
|---|---|
| Explicit partial/unanswered citation with no span IDs plus accepted same-group exact evidence | Pass; both explicit statuses are omitted while the accepted citation and same-group requirement remain enforced. |
| Answered citation with no accepted exact span | Pass; claim is not promoted and no evidence is retained. |
| Missing comparison-side group and existing accepted/rejected-direct-claim safeguards | Pass; existing regression tests remain green in the full Worker suite. |
| Interpretive causal-premise guidance | Composer/reviewer prompt contract assertions pass; this checks the instruction contract, not live model compliance. |
| Focused answer suite (`node --test hosting-poc/evidence-answer.test.mjs`) | Pass; 83 tests, 0 failures. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | Pass; 292 tests, 0 failures. |
| Syntax and whitespace | Pass; changed modules pass `node --check`, and `git diff --check` is clean. |
| Live paired-scope validation | Completed in run #11 after merge/deployment; see the follow-up entry below. The expected Hume/Kant All Books and Boethius P2 handoffs recovered. |
| Quality conclusion | Run #11's Hamlet answers included the supplied fear-of-death premise, but the artifact has no human semantic scores. This is a promising observed answer change, not proof of broad quality improvement; keep the unseen acceptance set frozen. |

## October 27, 2026: paired-scope run #11 validates the source-subset change

Paired-scope run [#40455788471](https://github.com/jsynon/antilogicalism/actions/runs/40455788471) completed all ten cases in with-review mode on v48 using the existing 25-call estimate. It had no request failures or planner fallbacks. The site revision was `c5e4eb8221c11a55ca60190eba948a7f8482cccb`; the Worker revision was `0b129183ff2a04eb7cda1b78d52d35059cdef645`, the merge commit for PR [#271](https://github.com/jsynon/book-chatbot/pull/271), running as Cloudflare version `81848ea5-8acb-4ec2-b2bb-a3fea7695be0`. This confirms the workflow tested the merged update.

The run passed 8/10 structural cases, up from run #10's 7/10, with 18/20 parts supported and two partial (run #10 had 15 supported and five partial). The question set, site revision, scope pairing, and planned 20 parts were the same, making this a useful paired comparison, though answer generation remains stochastic. Hume/Kant passed in both scopes; Wollstonecraft passed in both; Du Bois passed in both; Hamlet passed in both. Both Boethius cases remained partial. All 28 cited highlights were located; highlight location does not show semantic relevance. The artifact's human rubric was still unscored for all ten cases.

The source-subset change behaved as intended in the authenticated traces. Hume/Kant All Books P1/P3 omitted the Hume page that the reviewer explicitly marked partial with no spans, while retaining accepted same-group evidence; the case became fully supported. Boethius P2 in both scopes similarly became answered after its weak alternate citation was omitted. The strict boundaries remained: only explicit rejected sources were pruned, and exact accepted spans remained attached to final citations. This is live evidence that the targeted handoff path works, not proof that every use of source subsets is semantically correct.

The two remaining structural failures share one issue: Boethius P1, “How does Lady Philosophy explain the instability of Fortune?” In both scopes, the reviewer itself marked the part partial. Some direct claims survived exact-span validation, including the Fortune-wheel reversal; other generalization/example claims were rejected. The direct-answer IDs that remained did survive, so this is not the old missing-span subset bug. Keep the part partial until its answer and the cited Boethius pages are reviewed together; do not relax the gate based on this score alone.

The Hamlet answers did include the premise absent in run #10: the dread or fear of what follows death causes hesitation, with the selected-books answer connecting it to Hamlet's preference for known hardships over the unknown. Both cite Shakespeare's *Complete Works*, p. 454. This matches the answer-quality prompt change in this sample. The artifact still gives no independent human quality score, and the 28/28 highlight-location count does not judge whether the best lines are highlighted.

The latest dispatched run, [#40459165657](https://github.com/jsynon/antilogicalism/actions/runs/40459165657) (#12), was canceled before any case completed. Its artifact is an initial `running` report with zero completed cases and no Worker source revision, so it is not a result and does not supersede run #11.

| Validation and follow-up | Result |
|---|---|
| PR #271 merged and deployed source verification | Pass; run #11 reports its merge commit as `workerSourceRevision`. |
| Same-group explicit rejection handling | Live trace supports intended recovery in Hume/Kant All Books P1/P3 and both Boethius P2 parts; all remaining source checks stayed active. |
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


## October 27, 2026: paired-scope run #18 after PR #279

Paired-scope run [#40560450505](https://github.com/jsynon/antilogicalism/actions/runs/40560450505) completed all ten with-review cases on library v48. The artifact is `reading-companion-paired-scope-evaluation-all` (artifact ID `12760777662`). The site revision remained `d04d70cb4b2b2f0a6fb04ac519a8d43c94154147`. The Worker source revision was `f976c0800c7fcea25383e5280297993d7c27e90b`, the merge commit for PR #279, with Cloudflare Worker version `43ad174c-7d06-4735-9c5e-b982c369be66`. Thus the run did use the reviewer-hint ranking change.

The official result was **4/10 structural cases**: All Books 2/5 and Selected Books 2/5. Because the paired planner fallback left each Hume/Kant case as one combined question part, the artifact counts 16 parts rather than the planned 20: 12 supported, four partial, and none unsupported. There were no request failures or skipped cases; the planner fell back twice. The workflow job failed only at its final structural gate; setup, evaluator checks, and artifact upload succeeded. It estimated 25 Worker AI calls. The artifact’s five-dimension human rubric remains pending for all ten cases.

| Question | All Books | Selected Books | Trace finding |
|---|---|---|---|
| Hume/Kant | Structural miss; one combined part was fully supported. | Structural miss; the combined part was fully supported. | The All Books planner request returned HTTP 502 `search-planning-failed`; Selected Books reused that fallback plan. The exact question was answered with cited Hume and Kant positions, but the planner did not decompose the requested comparison into parts, so the evaluator did not count either case as a pass. |
| Wollstonecraft | Partial: education/reason P1 partial; social-position P2 supported. | Partial: P1 supported; social-position P2 partial. | All Books P1 included a causal link from appearance/social charm to limited intellectual development that the cited span did not establish. Selected Books P2 included claims about independence preventing cunning and improving social relations that review could not support from the cited pages. These are source-to-claim alignment misses, not missing retrieval pages. |
| Du Bois | Pass; both parts supported. | Pass; both parts supported. | Both scopes gave a grounded definition of double consciousness and linked it to the color line. |
| Boethius | Partial: Fortune-instability P1 partial; happiness P2 supported. | Partial: P1 partial; P2 supported. | All Books P1’s natural-cycle comparison was not supported by S3; another P2 claim using S3 was rejected while the answer remained supported by other S4 evidence. Selected Books P1’s direct claim about chance-based happiness being snatched away triggered the polarity check against the cited passage distinguishing Fortune’s uncertainty from the highest good. |
| Hamlet | Pass; meaning and mechanism supported. | Pass; meaning and mechanism supported. | Both scopes gave clear, cited explanations of thought, fear of death, and hesitation to act. |

The run offers limited live evidence for PR #279’s ranking change. In All Books Boethius P2-C2, the four claim hints included S4-Q15, the page 13 passage about incomplete or temporary welfare and wealth; the reviewer selected S4-Q2 and S4-Q5 instead. The Selected Books draft did not cite S4 for the corresponding prosperity/completeness claim from run #17, so that exact claim path was not reproduced. The new ranking code was active, but this run does not establish that it recovers the omitted detail.

All 31 cited-source highlights were text-located. The artifact explicitly marks semantic highlight relevance as unscored, so this run gives no answer about whether the displayed highlights are the best passages. It also has zero human-scored answers; structural passes and model review are not human quality scores.

Run #17 scored 10/10 structurally, so this run is worse on the official score. It does **not** establish that PR #279 caused a broad regression: two misses came from one transient planner 502, while four other scope results were partial for distinct answer-to-source support issues. The questions and site revision were unchanged, but model composition and planning are stochastic.

Next, keep the acceptance set fixed and avoid widening retrieval or adding another pipeline stage. A single focused Hume/Kant paired retry (five-call estimate) can determine whether the 502 was transient. For answer quality, the actionable pattern is citation scope: Wollstonecraft answers bundle causal/social clauses beyond what the nominated passages establish, while Boethius P1 has a direct-answer polarity/source distinction. Inspect those claim-to-span links before choosing one generalized composition adjustment. Do not treat the Boethius ranking test as a confirmed live answer-quality improvement.

## October 27, 2026: focused Hume/Kant trace and review-handoff fix

The previous turn inspected two consecutive focused paired runs rather than treating a single timeout as a stable regression. Run [#40563347181](https://github.com/jsynon/antilogicalism/actions/runs/40563347181) (artifact `12761293341`) had a network error in Selected Books before the Worker version was assigned; All Books completed with all three parts supported and five citations. The repeat, [#40564438606](https://github.com/jsynon/antilogicalism/actions/runs/40564438606) (artifact `12762701445`), completed both scopes without planner fallback or top-level request failures, but scored 0/2 structurally.

Run #20 isolates two separate failure classes:

- **All Books:** the reviewer request hit the Worker’s own 45-second inference timer. The saved trace named `Inference deadline exceeded` but omitted the stage because the timer error carried no stage metadata. The draft remained unverified and partial with no evidence highlights, as required by the fail-closed contract. The answer contained enough cited prose to compose a draft, so this is review-stage availability/packet-size evidence, not a retrieval failure.
- **Selected Books:** Hume P1 and Kant P2 were supported, while comparison P3 stayed partial. The first comparison sentence was an uncited summary, which the deterministic validator correctly rejected as the required direct answer. A later sentence gave the separately cited author positions, but those could not replace the rejected first sentence. The draft also appended an unrequested “if Kant applied ... he might suggest ...” speculation. The comparison guard covered “argue” and similar verbs but missed “suggest,” so the speculative sentence reached review and was rejected there. The reviewer’s partial verdict must remain partial; do not promote P3 merely because later claims survive.

The active public evidence route imports `composeEvidenceAnswer` from `hosting-poc/evidence-answer.mjs` via `hosting-poc/public-gateway.mjs`. The fix is confined to that Worker module and its direct test file, `hosting-poc/evidence-answer.test.mjs`; it does not change the planner, retrieval, browser, legacy route, or evaluator. It makes four bounded changes:

1. Comparison instructions now explicitly require the opening sentence to state each author’s position in a separate cited clause. This aligns the first-sentence direct-answer contract with the source-specific citation rule. The required-direct-answer check stays strict and trace output now records a `required-direct-answer-rejected` coverage gap even when review already returned partial.
2. The existing cross-author transfer detector recognizes `may/might/would/could suggest`, `propose`, and `infer` along with its existing transfer verbs. The check still only removes an unrequested conditional transfer from a comparison; it does not block an explicitly requested, qualified hypothetical.
3. Reviewer evidence is limited to the top eight ranked exact spans per cited source per question part. The smaller per-claim hint list remains four; it is drawn from those offered spans. The server validates selections against the per-part packet, so an exact span still present elsewhere in the full source cannot be selected if it was not sent in this review request. Full verified source data stays in the authenticated trace. This bounds repeated span text without making ranking a support decision.
4. The existing 45-second timer records the stage, stable error code, and elapsed time when it fires. The review still fails closed, and no retry or repair model call is added.

The regression tests replay the run #20 comparison shape, verify the unrequested “might suggest” bridge is rejected before review, assert the uncited opening remains a coverage gap, enforce the eight-span packet and unsent-span boundary, and exercise stage-specific timeout reporting without waiting 45 seconds. Existing tests continue to protect against upgrading a reviewer-partial answer.

| Validation | Result |
|---|---|
| Focused evidence-answer suite (`node --test hosting-poc/evidence-answer.test.mjs`) | 97 passed, 0 failed. |
| Full Worker suite (`node --test hosting-poc/*.test.mjs`) | 306 passed, 0 failed. |
| Whitespace / patch check (`git diff --check`) | Passed. |
| Calls, retries, and stages | Unchanged: with-review stays at one compose plus one review call; no retry or new stage. |
| Live result | Pending PR merge and Worker deployment. The current trace’s 0/2 result is not retroactively changed; rerun the same focused paired workflow once after deployment and compare reviewer deadline, P3 coverage, and exact selected spans. |

The All Books timeout is the clearest reason for shrinking repeated reviewer input, but an offline timeout simulation cannot prove the live latency improvement. The packet change is limited to the review request and exact per-part validation boundary; it does not increase retrieval or claim that review semantics are solved. If the deployed reviewer still reaches its deadline, inspect the new stage/elapsed trace and packet size before changing budgets or introducing retries. Keep the full acceptance set frozen for this check.

## October 27, 2026: focused Hume/Kant run #21 after PR #281

Paired-scope run [#40567413698](https://github.com/jsynon/antilogicalism/actions/runs/40567413698) completed with the `paired-hume-kant-causal-inference` case in with-review mode on library v48. Artifact `reading-companion-paired-scope-evaluation-paired-hume-kant-causal-inference` (ID `12763382692`) was produced at 19:17 UTC. PR #281 merged at 19:14 UTC; the artifact’s Worker source revision exactly matches its merge commit, `6be7e17737df8c24009b50b5e9e44cce5c9bb52d`, and reports Cloudflare version `abc6c8e4-f03d-4cb2-a4fb-138d25f44090`. The site revision remained `2c3c12e20fbdfbb36406c05f15edb248b7ac756d`.

The official result was **2/2 structural passes**: All Books 1/1 and Selected Books 1/1. Both cases completed all six planned parts (three per scope) as supported, with no partial or unsupported parts, request failures, planner fallbacks, or skipped cases. The workflow estimated five Worker AI calls. The new Worker timer and capped review handoff were active in both cases.

The traces show the intended behavior:

- Both review calls completed without a deadline failure: 28.48 seconds for All Books and 28.12 seconds for Selected Books. Total case times were about 72 seconds and 41 seconds, respectively, including retrieval and composition.
- Each part sent at most eight exact spans per cited page. The review request contained 64 spans and about 23,355 characters for All Books, and 64 spans and about 23,692 characters for Selected Books. The selected-scope run #20 request had 228 spans and 53,215 characters. This is a roughly 55% reduction in serialized review text and 72% fewer span entries on the repeated Selected Books case. One successful pair does not isolate packet size as the sole reason latency improved, but it confirms that the previously failing deadline did not recur with the new bounded request.
- P3’s opening comparison sentence now directly states Hume’s and Kant’s contrast with both author sources cited. The uncited opening gap is gone. The “if Kant applied ... he might suggest ...” sentence is still recorded as `unrequested-cross-author-inference` and is absent from both final answers.
- All Books had four unsupported alternate citations to Hume page 48 recorded as `claim-source-not-supported`; the final answer retained the claims where Hume page 24 provided reviewed support. Selected Books had one rejected alternate citation on P3, while accepted evidence from the same source group remained. These rejections did not create unsupported final claims or block coverage.

My independent read of the answer text and accepted passages is positive: both scopes give direct, relevant explanations of Hume’s custom-based causal inference, Kant’s role for causality in possible experience, and their contrast. The five-dimension workflow rubric is still pending for both cases; this assessment does not populate or replace those artifact fields. This one question pair does not establish a broad answer-quality gain.

The highlight check exposes the next distinct issue. The artifact locates all seven cited-source highlights, but semantic relevance is explicitly unscored. Several exact selected quotes stop before the supported sentence is complete: All Books’ Hume quote about heat and flame ends at “we are”; the Kant page 104 quote ends at “therefore of”; and the Selected Books Hume page 48 quote ends at “which is the only.” The citation pages themselves contain fuller support, so this is not evidence that the answer citations are wrong; it is evidence that a located highlight can still be an awkward or incomplete reading target. The current Hume page 24 highlight also shows the broad custom conclusion rather than the specific heat/flame sentence. Continue to treat highlight relevance as a separate product-quality concern.

| Run #21 check | Result |
|---|---|
| Structural result | 2/2 cases and 6/6 planned parts supported. |
| Worker provenance | PR #281 merge revision `6be7e17737df8c24009b50b5e9e44cce5c9bb52d`; Cloudflare version `abc6c8e4-f03d-4cb2-a4fb-138d25f44090`. |
| Review deadline | Both calls completed in about 28 seconds; neither hit the 45-second timer. |
| Review packet | 64 spans per scope; serialized request about 23–24K characters, down from 228 spans / 53.2K characters in Selected Books run #20. |
| Comparison handoff | Direct cited opening retained; unrequested “might suggest” transfer removed before review; no P3 coverage gap. |
| Citation and highlight location | 7/7 cited sources had located highlights. This does not measure whether the selected quote is complete or the best match. |
| Workflow human rubric | Pending for both cases. |
| Next validation | Run the frozen ten-question paired acceptance set with PR #281 deployed. Do not reopen the Hume/Kant logic unless it regresses there; prioritize a separate bounded inspection of truncated/weak highlights. |

This run validates the bounded review-handoff milestone for the intended Hume/Kant pair. It does not show that semantic reviewer decisions are infallible or that the whole answer pipeline has reached the project goal. Preserve the successful trace and use the full paired acceptance set to check for cross-question regressions before starting the separate highlight work.

## October 27, 2026: complete, readable citation highlights

Run #21 exposed two related presentation defects after exact evidence had already passed review. First, `buildReviewSpans` split source sentences at 220 characters, so approved Hume excerpts ended at “which is the only” and “we are,” while Kant ended at “therefore of.” Second, the exact Hume custom passage was linked to several claims; those duplicates occupied the three excerpt slots for that page and crowded out the distinct heat-and-flame passage. The Worker had verified the quotes and located them on the correct page, but the visible reading targets were incomplete or repetitive. Neither defect called for weakening citation validation or adding another model stage.

The bounded fix raises the maximum exact review span from 220 to 320 characters so the Hume conjunction sentence and the heat/flame sentence can reach review intact. It keeps the old 220-character limit when coalescing multiple short sentences, preserving passage-ranking granularity. For longer source sentences, the gateway may expand an already verified quote to the complete source sentence, up to 480 characters; it still verifies the supplied quote against the source first and adds no wording beyond the source (whitespace may be normalized). In the public excerpt selector, repeated quote text is deduplicated after relevance ranking, then the three available excerpt slots prefer distinct answer claims before adding extra excerpts for a claim already represented. Thus the best claim association survives and a page with repeated support can still expose its other reviewed passages. Review span IDs, reviewer acceptance limits, source/page checks, model-call counts, and fail-closed behavior are unchanged. The same eight-span-per-page ceiling remains in place; measure the actual packet size and latency in the paired workflow before treating the change as live success.

| Highlight check | Current status |
|---|---|
| Hume/Kant examples from run #21 | Offline regression fixture covers the Hume 260-character regular-conjunction sentence, 299-character heat/flame sentence, and 444-character Kant sentence. Replaying the saved run’s evidence map now retains a distinct heat/flame excerpt in Hume’s three-item page group. |
| Exact source validation | Preserved; reviewer quotes must still match source text before a complete-sentence anchor is produced. |
| Workflow and live-site validation | Pending PR checks, merge/deploy, and a paired workflow run. Compare highlight text, review packet size, review latency, and structural outcomes with run #21. |
| Semantic highlight relevance | Still requires inspecting whether each selected complete sentence is the best passage for its linked claim; claim diversity and lexical ranking alone do not prove semantic relevance. |

This change targets cut-off highlights while retaining the established evidence and citation gates. It does not claim to solve weak passage choice; use the next paired artifact to evaluate the changed anchors before considering any broader retrieval or composition work.

## October 27, 2026: offline review of paired Boethius miss in run #22

Paired-scope run [#40568852702](https://github.com/jsynon/antilogicalism/actions/runs/40568852702), artifact `reading-companion-paired-scope-evaluation-all` (ID `12763768490`), failed the structural gate at 8/10. The Boethius All Books case was one of the two misses: its Fortune-instability part was supported, while its true-happiness part was partial. The trace replay used the saved artifact and the review-span implementation from the Worker revision used by the run (`6be7e17737df8c24009b50b5e9e44cce5c9bb52d`), without another model call. The local selector change and its offline validation are recorded below.

The miss was not caused by missing book pages. Both scopes reused the same two planner queries and submitted the same six Boethius pages, including pages 13 and 14. The All Books composer received the full page-14 text, which contains the direct statement that happiness sought “without” lies “within yourselves.” It drafted the direct P2 claim that true happiness must be sought within oneself and cited page 14.

The review handoff then bounded page 14 to eight exact spans for P2. In All Books, the direct “happiness without … lies within yourselves” span was rank 12 and excluded; the packet contained spans Q5, Q10, Q11, Q9, Q19, Q7, Q22, and Q3. Offline execution of the exact deployed span-ranking code reproduced the artifact’s packet IDs and confirmed the direct span at rank 12. Review rejected required claim P2-C1 as `claim-source-not-supported`; the part decision consequently recorded `direct-answer-claim-missing` and remained partial even though later claims about transferred wealth and self-mastery had accepted evidence.

Selected Books demonstrates why the distinction matters. Its page-14 P2 packet included the direct “happiness without … lies within yourselves” span at rank 7. Its answer also used a narrower direct claim—true happiness is not found in external, changing circumstances—and cited pages 13 and 14. Review accepted the direct-answer claim and marked the part supported, although it rejected a separate supporting claim. A rejected non-required claim does not by itself make the whole part partial; losing the required direct answer does.

One separate metadata difference appears in the paired traces: page 14 is labeled `plannerSourceRole: unspecified` in All Books and `primary` in Selected Books. The span-ranking replay does not use that field, so this does not explain why the direct span fell outside All Books' packet; retain it as a provenance inconsistency rather than folding it into the demonstrated handoff cause.

This trace isolates a bounded handoff problem: per-source packet ranking can exclude the exact passage needed for a required direct answer when several claims are attached to the same page. It is not evidence of a retrieval failure, and it does not prove that including the span would guarantee acceptance. The previous Boethius handoff work addressed claim-level ranked hints and reviewer eligibility among spans already sent; this run exposes the earlier boundary where the per-part eight-span packet is formed.

The offline selector change preserves the broad answer's top eight spans unless the required direct-answer claim has a strong candidate missing from that packet. It then replaces only the last broad-ranked span with the best missing direct-answer candidate among that claim's top six. This reserves one slot while retaining seven of the broad answer's spans; the eight-span-per-source cap, exact-span validation, review decisions, and model-call count remain unchanged. Replaying both saved scopes with the new selector includes the previously omitted direct page-14 passage in All Books and retains it in Selected Books; both packets remain at eight spans and retain seven of their original broad-ranked spans. The Selected Books packet also gains its strongest missing claim-ranked passage. The Worker regression fixture reproduces the crowded-packet shape, checks that only one broad span is displaced, and verifies the quote reaches review without adding a call. The full Worker test suite passes 309/309. This is offline validation only; the changed selector has not been deployed or tested in a live workflow.

| Run #22 trace check | Finding |
|---|---|
| Planner and retrieved pages | Same planner query set and same six submitted Boethius pages in both scopes; relevant page 14 was present in the composer input. |
| All Books page-14 review packet | Eight-span cap excluded the direct within-oneself passage; exact deployed ranking replay placed it at rank 12. |
| Selected Books page-14 review packet | The same direct passage was included at rank 7. The required direct claim was accepted; a separate rejected claim did not downgrade the part. |
| Structural consequence | All Books P2 became partial because the required direct-answer claim had no accepted evidence; Selected Books P2 was supported. |
| Offline selector replay | Both scopes retain eight spans per source and seven of their original broad-ranked spans; the direct page-14 passage is present in both packets. |
| Regression and Worker tests | Focused crowded-packet test passes; full Worker test suite passes 309/309. |
| Scope | Local selector and saved-trace replay only. No live validation or claim that broader answer quality improved. |

## October 27, 2026: run #25 Hamlet All Books retrieval-candidate miss

Paired-scope run [#40589127363](https://github.com/jsynon/antilogicalism/actions/runs/40589127363), artifact `12774350799`, completed all ten v48 rows with no request failures, planner fallbacks, or skipped cases. It passed 7/10 structural checks (All Books 3/5; Selected Books 4/5), with 16 supported parts, three partial, and one unsupported. The deployed Worker revision was `339504ccb57bd9f209d912b047866b5c65bf3326`; the workflow estimated 25 AI calls. Human quality scores remain pending.

The merged site audit in PR #240 replayed this exact artifact without AI or network calls. Its corrected counters identify one best passage absent from retrieval candidates (Hamlet All Books p. 454), zero best passages retrieved but omitted from the packet, one context-only highlight (Kant p. 213), and zero review-to-output status mismatches. Boethius p. 14 was submitted in both scopes. This corrects an earlier blended count that could miss a candidate-fusion loss.

The bounded site follow-up, branch `codex/hamlet-quote-evidence-retention-20261027`, changes only the shared browser/evaluator candidate merger. When a question part includes a quoted phrase, it prioritizes a passage containing that phrase within the part's already-resolved source books before ordinary rank order. This covers the trace's wording difference (“conscience makes” in the question; “conscience does make” in Shakespeare) and the rank-two result on p. 454. It leaves search allowlists, corpus data, the 12-candidate pool, six-source answer packet, Worker review, model calls, and the public answer contract unchanged. The regression recreates the crowded All Books candidate cap and requires p. 454 to reach source selection.

The saved ten-row query results were replayed locally through the updated candidate merger with no AI or network calls. Hamlet All Books now retains book 212 p. 454 and passes it through source selection; p. 453 remains available. The only candidate-page set change among the ten rows is this Hamlet row (p. 454 enters and a lower-ranked unrelated page leaves). Hume/Kant's direct Kant pp. 103–104 and Boethius p. 14 remain in the captured candidate pools. These results verify deterministic passage handoff for this artifact, not answer quality; the code has not been live-tested.

| Follow-up check | Result |
|---|---|
| Quoted Hamlet passage regression | Pass; p. 454 survives the 12-candidate cap and reaches the six-source selector. |
| Saved paired-candidate replay | Ten rows replayed; only Hamlet All Books candidate set changes. No AI/network calls. |
| Site unit suite | `node --test reading-companion/*.test.mjs`: 210 passed, 0 failed. |
| Live acceptance | Pending site PR merge and Pages publication. Rerun the same paired workflow once; confirm p. 454 appears in `retrievalCandidates` and `submittedSources`, then review the answer and source text. |
| Worker behavior | Unchanged. No Worker redeploy is required for this site-only retrieval change. |

## October 27, 2026: run #23 trace review and citation-to-highlight linkage

Paired-scope run [#40574778730](https://github.com/jsynon/antilogicalism/actions/runs/40574778730), artifact `reading-companion-paired-scope-evaluation-all` (ID `12766852545`), completed on library v48 with the merged PR #283 Worker revision `d98c7bf1e12aec5846bcd8d175e1cd66eeb7a81a` and Cloudflare version `eb7b4886-ce47-4129-a960-b5845718736f`. It completed all five paired questions without request failures, fallbacks, or skipped cases, but the structural result was **8/10**: All Books 3/5 and Selected Books 5/5. Eighteen of twenty answer parts were supported; two were partial. The workflow estimated 25 Worker AI calls.

Offline trace review isolated the two misses to different claim-to-evidence failures:

- **Hume/Kant, All Books P3:** the composer opened with an uncited comparison sentence. The deterministic citation validator rejected that required direct-answer sentence as `sentence-missing-citation`. Later cited comparison claims survived review, but they could not replace the rejected required answer. The final trace records `required-direct-answer-rejected`; the reviewer’s `directAnswerCovered` describes only the surviving claims at its stage, not the final post-validation coverage gate. This is a composition-format failure, not missing retrieved evidence. Selected Books P3 passed.
- **Boethius, All Books P1:** required claim P1-C1 said Fortune is unstable because of uncertainty **and the fickle changes of the material world**. Review selected the exact page-14 span “that Fortune by its own uncertainty can never come near to reaching happiness” and rejected the broader claim as `claim-source-not-supported`; that span does not establish the added material-world-change explanation. Other Fortune claims passed, but the required direct answer remained partial. Selected Books used a narrower formulation and passed, though its “inconstancy” wording should still be read with the quote’s narrower statement about uncertainty rather than treated as proof of an identical claim.

The Boethius P2 packet replay does not show that PR #283 changed this case’s packet. The broad top-eight packet exactly matched the artifact. Its top-six required-claim candidates were already present, so the conditional replacement did not activate. The “happiness without … lies within yourselves” span was rank 11 on the claim-specific ranking and was absent, yet review supported P2 using other accepted page-14 spans. P2’s pass is therefore not evidence that this selector rescued the direct span; do not widen the packet on this case alone.

The same artifact reveals a distinct highlight-linkage defect. On Selected Books Boethius page 14, the evidence map contains approved exact quotes for multiple claims, including P2-C2’s wealth/possession claim. The public highlight payload retains at most three quotes per source page and omits that P2-C2 quote. The active site client then tries to match the answer sentence against those three quotes and, if none match, falls back to the page group’s primary quote, which belongs to a different claim. The source reader faithfully locates the quote it receives, so a location pass can coexist with a semantically wrong passage being opened for a particular citation. All 33 source entries in this artifact had a located highlight, but `highlightRelevance` is inspection-only and did not score claim-level relevance; the workflow’s location result does not rule out this wrong-claim fallback.

This points to a bounded, zero-AI-call highlight fix: keep the compact three-quote page summary for source cards, but resolve each inline citation using the full verified claim/source evidence map (or an equivalent claim-indexed payload). Remove the fallback to a different page-level primary claim; if the citation cannot be mapped confidently, open the cited page without a highlight. Add a regression for Boethius P2-C2 as a fourth page claim and assert that its inline citation opens the wealth/possession quote, never the happiness quote. A stronger relevance check should follow each answer sentence through its own claim ID and exact approved quote to the located source text; “some highlight exists on this page” is too weak. Lexical ranking can order verified candidates, but it cannot establish semantic entailment.

| Run #23 trace check | Finding |
|---|---|
| Structural outcome | 8/10; All Books 3/5 and Selected Books 5/5; 18/20 parts supported. |
| Hume/Kant All Books P3 | Uncited required opening comparison rejected before review; later cited claims could not substitute. |
| Boethius All Books P1 | Required claim added a material-world-change rationale absent from the selected uncertainty quote. |
| Boethius P2 packet replay | Selector condition inactive; packet unchanged from broad top eight; direct span rank 11 and absent, while P2 passed on other spans. |
| Highlight location vs relevance | 33/33 source entries located; semantic relevance was not scored. A fourth claim’s approved quote was omitted by the three-quote page payload, allowing UI fallback to another claim’s primary quote. |
| Bounded highlight change | Implemented in the site client: inline citations resolve against the existing full verified evidence map, while source cards retain their three-quote page summary. |

The site implementation adds `reading-companion/citation-evidence.mjs` and integrates it in the active `companion-v111.mjs`. The helper requires one exact normalized claim-point match among reviewer-approved evidence for that source and claim; it rejects unverified, missing, or ambiguous matches with an empty highlight list. It does not use the compact page summary or fall back to the page's primary quote. The existing source reader then performs its exact text-location check as before. No Worker payload expansion was needed because the public answer already returns the verified `evidenceMap`; retrieval, review, the three-quote source-card cap, and AI-call count are unchanged.

Regression tests reproduce the run #23 Boethius page-14 overflow: the P2-C2 wealth quote is outside the three-item page summary but remains in the evidence map, and its inline citation selects that quote. Further tests prove that a happiness quote is never used as fallback, and that missing, ambiguous, wrong-source, or unverified evidence produces no highlight. This is a linkage/location guarantee, not an automatic semantic-entailment score. The two structural misses remain separate composition/support issues and are not changed by this highlight patch.

| Implementation validation | Result |
|---|---|
| Site Reading Companion tests (`node --test reading-companion/*.test.mjs`) | 149 passed, 0 failed. |
| Focused citation-evidence tests | 5 passed, including the Boethius overflow fixture and live response wiring. |
| Active client syntax and patch checks | `node --check` for `companion-v111.mjs` and `citation-evidence.mjs`; `git diff --check` passed. |
| Worker contract suite (`node --test hosting-poc/*.test.mjs`) | 309 passed, 0 failed; Worker code and response contract remain unchanged. |
| Live validation | Pending site PR merge and GitHub Pages publication. Run the same Boethius question and inspect an inline P2-C2 citation; confirm it opens the wealth quote and not the happiness quote. Also verify that citations with no exact claim match open the page without a highlight. |

This replay and regression are local/PR validation only. Run #23 remains the live result; the change has not yet been published or checked in a live browser.

## October 27, 2026: run #24 offline passage review

Paired-scope run [#40580563553](https://github.com/jsynon/antilogicalism/actions/runs/40580563553), artifact `reading-companion-paired-scope-evaluation-all` (ID `12769053355`), completed on library v48 with client revision `579cf50594c5770d38e9fe0968d780809e7679b1`, Worker source revision `8e04d7a2f49ff2338bacf2e8905268977d5165a8`, and Worker version `46230924-f00a-4b26-926a-e02c20631be4`. It completed all ten paired cases without request failures, planner fallbacks, or skipped cases, but only **7/10** met the structural gate: All Books 3/5 and Selected Books 4/5. Fifteen of twenty answer parts were supported, four partial, and one unsupported. The run estimated 25 Worker AI calls.

The following passage annotations were checked against the original Drive PDFs, including the page layout for the decisive Boethius, Hume, Kant, and Shakespeare pages. “Best” here means strongest within the candidate set preserved by this run, not a claim that every page in the entire corpus was exhaustively compared.

| Trace / claim | Best evidence in the reviewed candidates | Other candidate or selected evidence | Annotation |
|---|---|---|---|
| Hume/Kant selected, Hume’s causal inference | Hume pp. 24 and 39 | Hume pp. 44–45 and 30 appeared in query results; p. 45 focuses on inference about human actions, while pp. 24/39 directly explain custom, repeated conjunction, the one-instance contrast, and the customary transition. | Pages 24 and 39 are direct and complementary; the answer’s custom/habit explanation is well grounded. |
| Hume/Kant selected, Kant’s role for causality | Kant pp. 103–104 | Kant p. 213 also says that everything which happens must have a cause, but does so in a discussion of cosmological freedom. | Pages 103–104 are the best direct support for causality as a condition of objective experience. Page 213 is contextual support, not the best highlight for that claim. |
| Hume/Kant selected, comparison | Hume pp. 24/39 paired with Kant pp. 103/104 | The answer also maps Kant p. 213 to the comparison claim. | The four direct pages establish the contrast between custom-based inference and causality as a condition of experience. Prefer those for the claim-level highlight; p. 213 may remain supporting context. |
| Boethius all-books, why Fortune is unstable | Boethius pp. 11–12 | Page 11 gives Fortune’s “unchanging sport” and wheel; page 12 places that instability alongside changing natural conditions and the law that nothing born remains constant. | Both are direct. Page 12 also supports the draft’s natural-world analogy. The reviewer marked that analogy claim partial because its citation set included pages 11 and other pages that did not support that specific comparison; the final answer removed it but retained partial coverage. |
| Boethius all-books, what Fortune’s gifts reveal about happiness | Boethius p. 14, with p. 11 as a direct companion | Page 11 says wealth and honors are Fortune’s handmaids and come and go. Page 14 directly connects chance, loss, the highest good, happiness, and the limitations of riches. Page 38 discusses divine goodness and happiness; page 12 warns against trusting brittle fortunes. | Page 14 is the strongest single passage for the requested inference; p. 11 is the best direct passage for the gifts’ impermanence. Page 14 was in the all-books candidate pool but omitted from the submitted six-page packet; Selected Books included it and passed. The all-books reviewer marked the broad gifts-to-happiness claim partial on p. 11 alone. |
| Hamlet all-books, meaning of the soliloquy | Shakespeare, *Hamlet*, p. 454 | Shakespeare p. 1625 discusses conscience in a different scene; Tillich p. 43 is commentary about the soliloquy, not Shakespeare’s primary text. | Page 454 is the direct primary passage: the surrounding lines connect fear of what follows death to hesitation and the loss of resolution. Page 1625 is a keyword match but answers a different question; Tillich is contextual commentary only. Page 454 appeared as the second result for a Shakespeare-specific query, then disappeared before the final packet. |

The Hume trace also exposes a final-status inconsistency. The reviewer response marks all three parts answered and all listed claims answered. The final result marks the Hume part and comparison partial. Its draft had an uncited opening comparison sentence and an unrequested hypothetical about Kant applying his view to Hume; both were rejected. The hypothetical was removed, but the trace still reports `required-direct-answer-rejected`. The finalized Hume paragraph also omits an optional “no idea of necessary connection” claim that appeared in the draft, without a matching rejection entry. Retrieval supplied the needed direct passages, so the regression should target agreement among the draft, accepted claims, final text, and final part status.

This review gives the next offline regression set four bounded assertions:

1. For Hamlet all-books, keep Shakespeare p. 454 through candidate fusion and into the answer packet; do not treat p. 1625 or secondary commentary as interchangeable support for the soliloquy.
2. For Boethius all-books, retain p. 14 for the gifts-and-happiness part when it is in the candidate pool, or leave that part explicitly partial if no direct passage survives selection. A removed optional analogy must not keep the Fortune-instability part partial by itself.
3. For Hume/Kant selected-books, final coverage must agree with the accepted reviewer claims and the final answer after rejected sentences are removed. Preserve a cited direct comparison, and do not carry a stale rejection into the final status.
4. For all three, a located quote is not a “best passage” pass. A highlight should be judged against the claim, primary/secondary voice, context, and stronger alternatives in the recorded candidate set. Multiple equally strong passages may be labeled tied; the test should not force a unique winner where the evidence does not.

| Run #24 offline review | Finding |
|---|---|
| Structural outcome | 7/10; All Books 3/5 and Selected Books 4/5; 15/20 parts supported. |
| Hume/Kant | Direct evidence was available; selected-books partial status follows composition/review/final-status disagreement, not a missing source page. |
| Boethius | The strongest gifts-to-happiness passage, p. 14, was a candidate but missed the all-books packet; partial status also persisted after an extra analogy was removed. |
| Hamlet | The exact primary-text page, p. 454, was returned by one query but dropped before packet submission; the wrong scene on p. 1625 was submitted instead. |
| Highlight evaluation | Quote location and claim/source linkage do not establish best-passage relevance. “Best” is evaluated only within the captured candidate set. |
| Follow-up scope | Use these three annotated traces for an offline replay and focused tests before another full paired run; no additional AI judge or model call is needed. |

## Run #24 offline review implementation

Added a no-AI passage audit in the Reading Companion client checkout. The gold file stores page identifiers and human judgments only; it does not copy book text. Its scope is the candidate lists captured in run #24, and it explicitly distinguishes best/tied evidence from acceptable support, context-only material, and rejects. The existing offline recheck now reports whether the best reviewed candidate reached the submitted packet, whether submitted highlights point to non-best material, and whether the review-stage part status agrees with the returned answer status. These counts diagnose known traces; they do not claim corpus-wide optimality or serve as a semantic pass score.

The paired audit reproduced two packet-selection misses (Hamlet p. 454 and Boethius p. 14), one context-only highlight (Kant p. 213), and one Hume/Kant review-to-output status mismatch. This makes the evidence-selection and highlight regressions inspectable without repeating model calls. It does not yet alter retrieval, ranking, packet construction, or highlight selection, so it should not be described as an answer-quality fix.

The Worker trace now adds `outputStatus` beside its existing review decision fields. `finalStatus` continues to mean the review result after exact-span validation; `outputStatus` records the final state after answer assembly and required-answer checks. This exposes where a status changes without changing the public answer or adding an AI call. Regression tests cover the comparison case where review says answered but final assembly returns partial.

Validation performed locally: the focused passage-review tests passed 4/4; the Worker evidence-answer tests passed 98/98; replaying the run #24 report preserved the structural result at 7/10 and reproduced the four passage/status diagnostics above. The full client suite passed 207/207 and the full Worker suite passed 309/309. Both repository diffs pass `git diff --check`; the gold JSON and changed JavaScript files pass syntax/parse checks. No live workflow has been rerun, and no claim is made that answer quality improved in production.


## October 29, 2026: planner-part and composer-window refinement

After retrieval parity, acceptance runs [#97](https://github.com/jsynon/antilogicalism/actions/runs/40910190533) through [#101](https://github.com/jsynon/antilogicalism/actions/runs/40911313049) used library v49 and the updated 24-candidate/four-book settings. Three simulation attempts produced partial drafts or a citation-validation failure; none supported the computational claim. Two Buddha attempts included relevant Buddhist search results, but one exceeded the compose inference deadline and the other returned partial coverage after the planner split one direct question into three parts, including a requested transition-of-consciousness claim that the reader had not asked.

The active Worker verifies and retains complete submitted page text; the 1,080-character preview helper belongs to the legacy route. The implementation therefore keeps full-page identity, source text, and final review intact, while changing the composer input to bounded, exact sentence windows selected from each linked page. The selection uses the original question and normalized parts, includes one neighboring span on each side where available, and records span IDs in the authenticated stage trace. This is a lexical focus aid only; the reviewer continues to judge claims against the complete verified page.

The shared plan contract also normalizes a single direct question to one coverage part unless the wording explicitly asks distinct components, a comparison, or a multi-part hypothetical. Planner context stays available as search leads and may be explained when supported, but does not create additional required parts. The composer guidance now allows two or three short paragraphs when separate passages contribute useful explanation, without a fixed length requirement. No model calls, retrieval caps, fingerprint rules, or citation-validation rules were added or removed.

The changes are coordinated across the Worker and website repositories. Validation and live answer-quality review remain pending; these edits alone do not establish that answers improved. Recheck the five quality dimensions and the trace path from search candidate to submitted page to composer window to reviewed citation, then use the unseen acceptance set to assess generalization.


## October 29, 2026: epistemic context and named-speaker review

The simulation runs showed a general retrieval weakness: a planner could preserve the central question yet fail to give retrieval useful searches for concepts expressed differently in older texts. The planner prompt was revised to keep a direct search while allowing other query slots to explore underlying concepts, assumptions, or kinds of reasoning where those are useful. Those contextual searches remain distinct from direct evidence for a contemporary claim, and the prompt names no authors or works. This keeps the answer plan unchanged and adds no model call or query slot.

The Buddha runs exposed a separate answer-generation quality issue: a source page can contain a quotation credited in nearby footnote text to a different writer. The existing reviewer contract now asks for per-source attribution status and speaker, and the Worker rejects an explicitly named-speaker claim when review marks the attribution as conflict or unclear. The trace records those decisions for diagnosis. The composer guidance encourages two or three paragraphs (roughly 160–260 words as a non-binding guide) when relevant passages support distinct facets, including passages from one work; it still asks for concise answers when evidence is thin. This does not impose a minimum answer length.

Offline regression cases cover the context-query contract and a footnote-attribution conflict. The established five human scores remain accuracy, question coverage, explanation quality, citation support, and citation completeness. Word count and distinct-work count are supporting diagnostics only. Re-run the simulation and Buddha cases after deployment, inspect retrieval candidates and exact cited passage context, and score the resulting answers with the same rubric. The workflow's structural pass is not a semantic quality verdict.


The composer also now distinguishes an explicit “the supplied passages do not answer this question” response from malformed answer output when no cited answer survives. It returns the existing `insufficient-evidence` outcome and records a coverage gap; answer coverage remains none, so this does not pass the quality gate or trigger a retry.


## October 29, 2026: refusal wording and trace-order follow-up

The first simulation reruns after the retrieval/answer changes exposed two gaps in the insufficient-evidence classification. The model said the available text “does not contain information” rather than “does not answer,” and one response path attempted to add a coverage-gap trace before the trace list was initialized. The follow-up recognizes both phrasings and constructs the trace list once, so an explicit refusal with no retained cited answer returns the structured insufficient-evidence outcome. It still records zero answer coverage. Offline regression coverage now includes both phrasings. The simulation reruns also show that the context query alone does not reliably retrieve the desired epistemic sources; that remains a separate retrieval-ranking issue.


## October 29, 2026: named-speaker retrieval and repeated calibration

The live screenshot with an Epictetus answer to a Buddha question exposed a gap between author matching and subject matching: the catalog records some teachings under a compiler or translator, with the named teacher appearing only in the work title. The Worker now recognizes that wording as a subject source group and keeps the role distinct from a catalog author. The browser can reserve the title as one source-aware discovery facet, while the other query facets remain broad enough to find relevant primary texts that do not name the teacher in their titles. The match is a retrieval lead, not proof of direct authorship. The answer and review prompts now prohibit attributing another writer’s topical passage to a named speaker when no relevant speaker source is in the packet.

The live composer now asks for two or three connected paragraphs (roughly 160–260 words as a guide) when separate relevant evidence points support different facets. It asks for a direct answer first, then the textual reasoning or qualification, and a final paragraph only for a distinct supported perspective or limit. This is not a minimum length or multi-source quota; thin evidence still calls for a concise, explicit limitation. Every factual sentence remains cited, and reviewer-selected passages still determine what can appear in the answer.

The website adds the manually dispatched **Reading Companion repeated calibration** workflow. One confirmed run executes the simulation and Buddha acceptance cases three times each, in All Books mode with review, through the evaluator’s shared 30.5-second call spacing. It saves one artifact with all six traces and per-case summaries for structural outcomes, answer lengths, and cited books. Repetitions interleave the two questions and continue after ordinary per-attempt failures; provider-limit or capacity errors still stop the run. Human semantic scores remain separate from structural pass/fail. This makes the next comparison a single workflow run without increasing any individual live-answer page cap or adding Worker inference calls.


## October 29, 2026: conditional retrieval gaps and source attribution

The latest simulation and Buddha run showed that a strong answer still depends on the initial planner query wording and can spend several source slots on duplicate edition records. The coordinated site change adds a bounded conditional retrieval pass: after the first retrieval, compare each requested part with the retrieved text using lexical overlap as a diagnostic only. If coverage is weak, ask the scholarly librarian for up to three optional alternate queries using at most six short excerpts, retain the original plan and scope, rerun the shared retriever, and repeat fingerprint verification and source selection. No answer part, expected author, or preferred response is inserted by this rule. The browser obtains a fresh single-use Turnstile token for this request. The paired workflow calls the same endpoint and shared retrieval implementation, and artifacts report the trigger, optional queries, failure code, and before/after signal.

Answer source selection now removes only exact normalized page-text copies under the same normalized title; textually different editions remain eligible. Composer and reviewer guidance more clearly distinguishes a later source reporting a historical figure from a primary statement, and asks the answer renderer to use paragraphs rather than inline list markers. These are general pipeline rules, not Buddha-specific behavior.

The conditional planner can add at most one extra inference call per live scope, and the paired workflow exposes that allowance separately from its baseline estimate. Targeted offline tests cover coverage triggering, bounded planner output, source-copy suppression, and trace wiring. These changes need deployed acceptance runs and the existing five human scores before we can claim improved answer quality.


## October 29, 2026: repeated calibration #3 and coverage false negative

Repeated calibration run [#3](https://github.com/jsynon/antilogicalism/actions/runs/40942322015), artifact `12927642441`, used site revision `6b8e13d`, Worker source revision `ffbaa628`, and corpus v49. It completed all six attempts without request failures, but only one answer passed structural checks. The simulation case produced one partial off-topic draft and two careful but unhelpful abstentions; Buddha answers were partial, partial, and structurally supported. The artifact's human rubric entries were still pending, so the structural pass was not a semantic quality score.

All six traces reported no conditional gap-planner attempt. The previous diagnostic took the maximum count of question terms anywhere on a page and required only two matches. In the simulation trace, “living” and “simulation” appeared in separate contexts on a Spengler page about imitation, which made the page look sufficient and suppressed the retry. The site now measures whether distinctive terms occur together in a short text window and uses that signal both for part linking and candidate ranking. When the signal is weak, the existing bounded librarian call receives the matched terms and may produce alternate queries that preserve context or use source-native wording. It cannot add required answer parts or name preferred works.

The Buddha traces cited the 1986 and 2019 editions of *The Teaching of Buddha* for near-identical passages. Source selection now removes a duplicate only when normalized work titles match, both passages are substantial and similarly sized, and their three-word-shingle overlap is at least 94%. Materially different passages and translations remain eligible. The six-page answer budget, source allowlist, page fingerprint verification, and evidence review remain unchanged.

This is a general retrieval-quality correction, not a runtime route for either benchmark question. The case-specific source expectations stay in the evaluator, and the evaluation review focus is not sent to the Worker. Validation and post-change live answer-quality review remain pending; inspect whether the retry now triggers on false lexical matches, whether its candidate set improves, whether duplicate editions disappear, and how the existing five human scores compare before changing acceptance conclusions.


## October 29, 2026: repeated calibration #4 and index false positive

The latest six-attempt artifact completed without request failures but passed structural checks only once. All three simulation attempts remained partial or unanswered; two Buddha answers were partial and one was structurally supported. None attempted conditional gap planning. The simulation trace exposed an index page in *Nicene and Post-Nicene Fathers* III where separate entries placed “simulation” and “Christian living at Jerusalem” close together. The earlier local-window matcher treated that lexical collision as coverage.

The site now matches terms within sentence/clause segments and conservatively identifies index-style lists from repeated page-reference entries. Index-like pages do not satisfy part coverage and are excluded from the answer packet. When such a page is the strongest lexical match, the trace passes its bounded reason, matched terms, and page locator to the existing optional gap planner so it can preserve context in a broader search lead. This does not add an author, title, answer part, or benchmark-specific route.

The same artifact showed the 1986 and 2019 *Teaching of Buddha* editions contributing near-duplicate Amida text despite differently sized excerpts. Same-work deduplication now measures three-word-shingle containment against the shorter substantial passage, without requiring similar page lengths. A materially revised passage remains eligible when it does not substantially contain the other excerpt.

The composer and reviewer already distinguished retrospective reports from primary statements; the instructions now make the reporting source the grammatical subject when only its account is evidenced, and require that framing during review. This avoids converting a later source's report into a verified historical claim while preserving useful source material.

Focused regression fixtures cover the index collision and coherent-prose control, answer-packet exclusion, differing-length duplicate excerpts, materially different passages, bounded diagnostic forwarding, and mediated-source attribution language. These changes need deployment and a comparable live run. Structural pass rates alone do not establish answer quality; continue using the five human scores and inspect the retrieved/cited passages and answer prose.

## October 29, 2026: one-run quality benchmark and expansion ablation

The conditional search-gap planner described above is already implemented in the live website/Worker flow. Recent all-books traces show that it can run without recovering the expected sources, so the project must measure its before/after candidate sets and relevant-page recall before treating the extra query call as a quality improvement. Do not add a duplicate gap-planning call. Keep its search phrases optional, bounded, within the original source scope, and separate from answer evidence.

The Worker now has an authenticated evaluation-only `with-expansion` variant. It runs after the initial composition and before the existing evidence review. It receives the same plan, draft, and fingerprint-verified passage windows, and may elaborate only supported material already in that packet. The standard public answer path remains composition plus review. Paired evaluation compares both variants with the same selected pages; the extra call is enabled only when the authenticated evaluator requests it. Expansion success is judged by the five human dimensions, citation support, and completeness, not by word-count gain alone.

The website evaluator now accepts `baseline` and `expanded` retrieval profiles. The expanded experiment raises the candidate pool from 24 pages across four books to 48 pages across six books; the final answer packet remains capped at six pages. This is an evaluation profile, not the live-site default. The consolidated workflow runs four approved calibration cases or the full acceptance set in one dispatch and may compare the expansion variant. Its report-collection job records structural failures without treating them as an answer-quality verdict; `qualityStatus` stays `pending-human-review` until all five human scores are supplied. Preserve the current source fingerprint, scope, citation, and review protections while judging the experiment on labeled relevance, exact-window evidence, human quality scores, and candidate diversity.

## October 29, 2026: evidence-selection ablation

The next experiment measures the selection handoff separately from retrieval and composition. The website evaluator freezes one hydrated candidate pool after the existing optional gap-search step, saves the deterministic packet, and sends bounded excerpts for those same candidates to an authenticated Worker selector. The selector can choose only temporary IDs from that pool, with a six-page maximum and no author or book targets. The website maps IDs back to canonical full text and applies the normal request-size and v49 fingerprint checks before answer generation.

The selector route is available only to the authenticated evaluator and does not alter the public answer path. `compare-selection` runs the deterministic and model-selected packets through the same composition and review stages, and stores the pool, decision, usage, both page lists, and answer traces in one artifact. A failed or empty selection is explicitly marked and uses the baseline packet only to complete trace collection; it is not counted as a successful selector result. Retrieval absence remains a separate failure category. The comparison adds one selector call and a second compose/review run, for three additional Worker calls per question over the normal path, plus the existing conditional gap-planner allowance.

This test does not include post-composition expansion. Keep the candidate pool, planner output, corpus fingerprints, Worker/site revisions, six-page limit, and review pipeline fixed across the paired answers. Human review should compare relevant evidence selected from the same pool, then answer accuracy, coverage, explanation, citation support, and completeness; source count, structural pass status, and model-reported coverage are not quality scores. The next benchmark artifact and manual scores are required before considering any public-path adoption.


## October 30, 2026: planner query diversity after evidence-selection comparison

The baseline and expanded paired-selection runs showed that a larger candidate pool and a stronger selector cannot recover source text that retrieval never returns. The simulation planner's saved output kept all four queries within the contemporary computational-simulation framing; the expected contextual epistemology sources were absent from both candidate pools. This is a query-planning coverage issue before it is a page-selection issue.

The existing planner and conditional gap-planner prompts now ask for distinct conceptual search angles where useful. When a contemporary or specialized label may not appear in historical texts, they may search the concepts, assumptions, or reasoning those texts use to examine the underlying issue. They must keep those contextual leads separate from direct evidence, preserve the reader's scope, and must not prescribe authors, works, answer claims, or extra answer parts. No inference call or retrieval budget was added. Prompt regression checks ensure this guidance stays general and does not name the simulation-case thinkers.

This is a retrieval-planning experiment, not evidence that recall or answer quality has improved. After merge and deployment, rerun the same paired-selection calibration in baseline and expanded modes. Compare actual planner queries, sources found per facet, candidate book/page recall, selected pages, and human-scored answer quality; keep the selector evaluation-only until broader retrieval gains and answer quality are demonstrated.

## October 30, 2026: move final evidence selection into the verified Worker path

The latest quality benchmark exposed a stage-boundary problem more clearly than another retrieval rule could: useful pages could appear in raw search results, then disappear from the bounded browser-selected packet before answer composition. Buddha traces showed pages already in the candidate set being lost to deterministic selection. The God-is-love run showed a direct Bible page in query results but absent from the hydrated answer candidates. The live meaning-of-life screenshot was a larger symptom: the live packet contained unrelated works while the local workbench had retrieved and compared relevant authors. These examples point to a general failure mode: retrieval, packet selection, composition, and review each made separate decisions, but the final answer stage could not recover evidence discarded upstream.

The pipeline now sends the full bounded retrieval candidate pool to the Worker. The Worker fingerprint-verifies all candidate pages before a semantic selection call sees their bounded excerpts. That selector can return only candidate IDs; the Worker maps them back to verified full pages, applies the existing six-page/35 KB composition budget, and binds selections to planned question parts. Composition and review remain unchanged, and deterministic citation, page identity, source scope, and exact-span checks remain in force. The public selector failure path is explicit in `sourceSelectionStatus` and the authenticated trace; it falls back to the retrieved order within the same packet bounds.

This moves the answer-critical semantic choice to a stage with enough context to make it and removes the separate evaluation-only selector endpoint. Baseline retrieval sends up to 24 pages; the expanded evaluation profile can send up to 48 pages, subject to a 250 KB browser upload cap and a 300 KB Worker text cap. The selector sees at most 1,200 characters per verified page and chooses at most six. A normal reviewed All Books request now uses four model calls (plan, select, compose, review), with one optional conditional gap-planning call. A selected-book request may skip planning. This is an intentional increase of one call to prevent irreversible evidence loss before the Worker; it is not a question-specific author or answer route.

The `compare-selection` evaluation now compares a six-page incoming pool with the full retrieved pool while keeping Worker selection, composition, and review the same. That isolates whether widening the candidate handoff improves outcomes. It does not compare deterministic versus model selection, because the public path now uses the same Worker selector in both arms. The artifact should record each verified candidate, selection decision, selected page set, selector usage/fallback, answer, and review result.

This implementation is a structural candidate, not evidence that answer quality has improved. The next live check should compare the same broad questions under the narrow and full candidate-pool arms, then human-score accuracy, question coverage, explanation quality, citation support, and citation completeness. In particular, confirm that the direct Bible passage survives into the full pool, that simulation-related philosophers are actually retrieved, and that the relevant Buddha passages are selected. If a source is missing from the Worker candidate list, the remaining fault is retrieval. If it is present but not selected, inspect selector judgment. If selected but omitted from a claim, inspect composition/review. Keep acceptance conclusions separate from this diagnostic calibration until these handoffs are reviewed.

## October 30, 2026: prevent false author scoping and preserve selector abstentions

The repeated life-meaning trace showed that an all-books query was narrowed after planning: the planner declared all available works and selected no books, but the website inferred book IDs 283–290 from the generic word “authors.” Those catalog entries carry the collective byline “Various authors.” The website now excludes collective catalog credits from person-name matching while retaining explicit title and named-person scoping. This is a general retrieval correction; it does not encode expected authors or answers for the calibration question.

The Worker now records a valid selector response with no chosen pages as `no-relevant-evidence` instead of substituting retrieval-order pages. The answer path can still compose a general-knowledge response from an empty evidence set; the trace makes clear that no library source was selected. Technical selector failures still use the bounded retrieval-order fallback to preserve availability, but traces distinguish provider failure, invalid response, truncation, and budget exhaustion. Fingerprint verification, selected-book scope, the six-page composition limit, and the ordinary plan/select/compose/review sequence remain in place.

Offline regressions cover generic plural wording against collective bylines, preservation of real author and work matching, empty selector decisions, technical fallback classification, and evaluation artifact handling. These checks protect the handoff contract; only a deployed live run can show whether answer quality improves.

## October 30, 2026: allow broader knowledge and natural synthesis

The active Worker answer path no longer treats the selected library passages as the only knowledge the model may use. Composition and evaluation-only expansion can draw on general knowledge to explain concepts and connect ideas; citations identify claims about what the books or their speakers say. The composer no longer fails validation solely because a sentence has no library citation. The reviewer assesses uncited context for relevance and attribution, while citations on source-derived claims still pass through the exact-span review and deterministic ID/scope checks.

The no-relevant-evidence selector result now flows through composition and review with an empty source set, allowing a useful contextual answer without pretending that retrieval found support. Existing source scope, attribution, and comparison checks remain unchanged. The ordinary plan/select/compose/review call sequence is unchanged; no generation stage was added.

The quality rubric must treat citation completeness as coverage of source-derived claims, not citation density across all sentences. General context can improve answer fullness, but its accuracy and relevance remain separate judgment dimensions because the book packet cannot verify it. The next live run should include a question whose direct answer is absent from the library and several questions with useful passages, so we can check that broader explanation is available without weakening source attribution or citation support.

The first live simulation-question check exposed a quality gap: the response substituted Baudrillard's related idea of hyperreality for a direct answer about literal simulation, then stopped at an unfinished list introduction. An existing empty-selection regression had accepted a generic statement about using general knowledge as a fully answered result, so it did not test directness. The follow-up tightens the existing composer and reviewer contracts to answer the exact question before using analogies, judge uncited answers for directness and completion, and reject drafts that are truncated or end in an unfinished lead-in. A valid source-free answer is now labeled `general-context-answer`, separate from `verified-source-draft`; the user notice no longer assumes that empty selection means retrieval found no relevant passage. These changes add no model call and do not prescribe a simulation answer or named source. Offline tests exercise the question with no selected pages and ensure a substantive general answer can pass review while an adjacent, incomplete answer cannot.
