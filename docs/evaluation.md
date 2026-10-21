# Evaluating the Reading Companion

**A model returning a cited draft is not the same as an accurate interpretation.** The same is true of the older pipeline's model-generated "verified" verdict. This guide is for reviewing actual answers against their primary-source passages and deciding whether a change helps readers.

## Repeatable evaluation

Use **Gemma3:12b** as the standard local model, not a recurring contest among models. For substantive changes, run the established five Aristotle regression questions and one difficult synthesis question with fresh histories, record the build and elapsed time, and inspect the cited text. Run a different model only to answer a specific diagnostic question. For v1.4, additionally test one named **two-author comparison** and one **broad across-library question**, and inspect the selected books, pages and each linked PDF. Export the JSON report when debugging a problem.

Do not use Google's AI Overview as ground truth. It can provide ideas for readable presentation, but it may draw from external study sites, vary between runs, and itself simplify or misinterpret texts. Whenever possible, judge claims from the cited Antilogicalism primary-source text.

Score each answer from 0 to 3 in each category:

| Category | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Interpretive accuracy | Contradicts decisive passages | Major distortion | Mostly faithful, minor problems | Faithful, correctly qualified |
| Completeness | Misses central question | Major part missing | Core request covered | Full intended scope covered |
| Explanatory value | Unhelpful or incoherent | Lists terms or repeats | Clear connections | Builds an illuminating argument |
| Citation quality | Invented/irrelevant | Mostly weak support | Mostly matching passages | Precise evidence for substantive claims |
| Readability | Difficult to use | Cluttered/repetitive | Clear enough | Well paced, purposeful depth |

Also record wall-clock latency and whether evidence selection brought in a decisive or merely tangential passage. These manual scores are not computed by the application.

## Local claim-reviewed prototype

The local app now exposes **Claim-reviewed prototype** in Advanced settings for
both one-book and Across-library questions. It uses the existing grounded
pipeline: the model drafts separate claims with passage IDs, a second model call
checks each claim against only its cited passages, and one repair can replace
rejected claims. Only claims accepted by that review are displayed. This costs
more local inference than evidence-first mode and the review is fallible; it is
a quality-control experiment, not a truth certificate. The default remains
Evidence-first.

For the Nietzsche regression, select **Across the Antilogicalism Library**,
choose **Claim-reviewed prototype**, and ask: “What did Nietzsche mean by God
is dead?” Inspect whether the returned claims stay within what the cited
passages establish, especially whether suffering or slave-morality passages
are being used to explain the phrase without a direct textual link. Compare the
same question in Evidence-first mode. Save both diagnostics and compare the
selected books/pages, review verdicts, final claims, and latency. No Cloudflare
Worker request is involved in this local check.

## Checks for the Aristotle pilot

These are **human review anchors**, not hardcoded answers or retrieval rules. They help expose errors that the v1.1 provenance validator cannot catch:

- **Practical wisdom:** distinguish practical wisdom from theoretical/scientific knowledge; explain deliberation and particular action. The Book VI passage on PDF p. 72 explicitly assigns the **right aim to moral virtue** and the **right means to practical wisdom**. Reversing these roles is a serious error.
- **Mean relative to us:** not an arithmetic midpoint; it depends on circumstances and what practical wisdom judges appropriate. The exercise/food comparison in Book II (PDF p. 18) is a useful control.
- **God and soul:** answer from the scope of the *Ethics*, distinguishing the rational and non-rational aspects of the soul, the activity of the soul in happiness, and any relevant discussion of contemplation. A one-line poetic reference to divinity is **not** enough to establish Aristotle's own metaphysical doctrine.
- **Three kinds of friendship:** utility, pleasure, and virtue/character. The author **does explicitly introduce three forms** in Book VIII (PDF p. 90). Do not deny a clear definition present in the cited passage.
- **Magnificence:** distinguish it from liberality, explain scale and noble expenditure, and ground the distinctions in Book IV.
- **Synthesis question:** connect moral virtue, practical wisdom, and eudaimonia; recognize the aim/means relation, happiness as activity rather than transient mood, and (when relevant) the Book X complication that contemplation receives special priority.

## Checks for v1.4 across-library reading

The global retrieval mode is deliberately bounded. Evaluate both **which books are selected** and **what the model says about them**; a perfect URL does not mean the right work was found.

- **Named cross-work comparison:** “How do Aristotle and Tolstoy understand happiness and the good life?” Confirm that source passages from both authors appear in retrieval, that the final answer cites both if it makes claims about both, and that no source uses the other author's PDF. Aristotle's Book X treatment of contemplation must not be flattened into an ordinary claim about practical virtue.
- **Broader discovery:** “How do different authors in the library approach the question of life's meaning?” Review which books the system selected, and whether the answer clearly says it is only a sample of texts rather than an exhaustive survey of all 644 books.
- **Cross-work identity:** Source IDs must be unique within one answer, and every title, book ID, original PDF page and Drive document must match the exact extracted passage. The source list should identify each book visibly.
- **Search coverage:** A query that mentions two named authors but has indexed topical evidence for only one must report that limitation rather than silently invent a comparison. A missing global manifest must produce a clear local-data error before inference begins.
- **Memory and timing:** Inspect the diagnostic field library_discovery. It should list at most four opened books and nine pages per book; the global mode must not load all compressed shards just because a single question was asked.

A **real-index compatibility smoke** tests source mappings but not interpretation: it downloads v47 metadata, the happiness/virtue/meaning partitions, and Aristotle's and Tolstoy's shards, then reports selected original pages. A live Gemma answer is still required to judge the explanatory quality and latency of a cross-book conversation.

## v1.4.1 source relevance: two real acceptance questions

These are the actual live v1.4 failures. Evaluate the *retrieval* before
asking Gemma to interpret it; keep Gemma3:12b as the fixed baseline.

**Aristotle and Tolstoy on happiness and the good life.** The v47 retrieval
should include real works from both authors, and allow an author's different
works to satisfy the same author citation requirement. The new index-only
audit includes Aristotle's *Ethics* and *Politics*, Tolstoy's *A Confession*
and *War and Peace*. Distinguish a fictional character's view from Tolstoy's
own philosophical commitments.

**Different authors on life's meaning.** Expected topical search words:
**life, meaning**, not *authors, library, question*. Generic bylines such
as "Various authors" must NOT be treated as people explicitly named by
the reader. The real-v47 audit now selects Frankl's *Man's Search for Meaning*,
Tolstoy's *A Confession*, Ortega's *Man Has No Nature*, and Peirce's
*How to Make Our Ideas Clear*. Inspect all passages for relevance even if the
selected titles sound promising. A new independent question must not carry
over named authors merely because they appeared in earlier chat history.

The system must still open no more than four books and nine pages per
book, preserve each PDF's identity, and distinguish a cited draft from a
factually faithful interpretation. Genuine follow-ups such as "How about
Tolstoy?" should retain conversation history for context resolution.

The optional real-index-only smoke uses the command:
    python scripts/smoke_relevance_v141.py
This downloads only selected public v47 data into a temporary directory
and does not invoke Ollama.

## v1.4.2: hypothetical comparison as a general test case

Ask this EXACT question in **Across library / Evidence-first / Gemma3:12b**:

> What would Nietzsche think about Kierkegaard's thought?

The original v1.4.1 diagnostic search contained just the term **thought**.
The resulting citations were technically authentic yet largely irrelevant,
and the models constructed speculative opinions from off-topic excerpts.

In v1.4.2 the first model call should be **conceptual_retrieval_plan**,
not **evidence_selection**. It must generate distinct search themes for each
*real catalog author*, not invent what Nietzsche historically said about
Kierkegaard. The second call should be **evidence_grounded_synthesis**,
using original excerpts from both authors. There should be exactly
**two** Ollama calls, including when planning returns malformed data.

Read the diagnostic report in this order: original question type; planned
author-specific terms; selected titles and physical PDF pages; original
passage excerpts; final prose and citations. A good answer must distinguish
documented positions from **hypothetical interpretation**.

The real public v47 INDEX-ONLY audit with representative thematic terms
found more suitable passages in *Fear and Trembling*, *The Sickness Unto
Death*, Nietzsche's *On the Genealogy of Morals* and an edited collection.
This establishes improved source discovery, NOT Gemma answer quality.
Collections can mix an editor's words with the writer's, so verify the
speaker of each cited paragraph.

Ordinary questions ("How do Aristotle and Tolstoy understand happiness?")
must retain their original selector+composer flow. A standalone new question
must not inherit unrelated named authors from earlier chat.

Run python scripts/smoke_conceptual_v142.py for an optional read-only,
index-only audit against the public v47 files without calling Ollama.
Synthetic tests validate the strict two-call ceiling and original PDF identity.

## v1.4.3: evaluate science, history, and literature

The benchmark at [cross-disciplinary-v1.json](../benchmarks/cross-disciplinary-v1.json) preserves eight fixed questions from the actual book catalog: two each for science, history, literature, and philosophy. This is an evaluation tool, **not** a list of answers or author-specific retrieval rules. Scores must reflect the original source, not a model's apparent confidence.

To run one local test without launching a long suite:

```powershell
python scripts\run_cross_discipline.py --case science-darwin-selection
python scripts\run_cross_discipline.py --summary
```

The full question set requires explicit `--all`. Reports are saved individually to the gitignored reports/ directory with the original paragraphs, citations, stage traces, timings, and blank manual score fields. The local browser has a collapsed question picker which selects the appropriate original book and populates the composer; it does not automatically ask the model. The picker and source view are intended to remain usable at mobile widths.

**Science:** Is the mechanism clear? Does the answer separate what Darwin or Hawking actually wrote from present-day knowledge? Does it distinguish observations, explanatory models, and speculative predictions?

**History:** Does it keep an author's interpretation of causes distinct from events and chronology? Are speeches, reports, and traditions presented as claims made by sources rather than independently verified facts?

**Literature:** Does it distinguish a character's position from the novelist's own commitments? Does it preserve narrative context when explaining a theme across distant scenes?

**Philosophy controls:** Aristotle's virtues/practical wisdom/happiness synthesis and the Nietzsche–Kierkegaard hypothetical comparison remain available to detect regressions from the preceding builds.

Automatic tests can verify only structural integrity: known source IDs, numeric book IDs, consistent PDF and page links, correct source-book identity, representation of named authors, and at most two model calls. A fully valid cited draft can still be false. Use the same 0–3 human rubric already defined above. See [benchmarks/README.md](../benchmarks/README.md) for details.

For the first evaluation, try **one science, one history, and one literature case** (Darwin, Thucydides, Dostoevsky) before spending time on all eight. Categorize the actual failure as discovery, selection, interpretation, citation, or presentation. Prefer fixes that generalize across genres. Do not turn this into another model comparison.

## v1.4.4: source form, reported speech and narrative sequence

The first v1.4.3 live answers from **Darwin, Thucydides and Dostoevsky** were successfully cited drafts, but exposed three recurring cross-disciplinary weaknesses:

- Darwin: the evidence selector accepted a chapter heading and a contents listing, neither of which establishes the mechanism of natural selection, despite having actual explanatory prose elsewhere in the book.
- Thucydides: the answer quoted the Corinthians reporting the **Corcyraeans' own characterization** of nonalignment, then mistakenly suggested the Corinthians endorsed that characterization.
- Dostoevsky: the answer conflated Porfiry's presentation of Raskolnikov's theory with Raskolnikov's direct words, and called a conversation with Dounia a "final confession" without establishing its place in the full event sequence.

v1.4.4 addresses evidence *before* generation. `passage_quality.py` conservatively identifies navigation/contents text and downranks it within the one-book BM25 index; the evidence selector excludes navigation when at least two real-prose candidates remain, unless the reader asks about the contents themselves. Dialogue/reporting signals in the original source excerpts are exposed to the model, and an opening that appears clipped or unattributed may recover the actual preceding passage under the existing neighbor budget. **No model or heuristic infers the identity of a speaker automatically.** Distant passages are never asserted to be consecutive narrative events simply because their physical pages are ordered.

The optional real-v47 audit (`python scripts/audit_source_quality_v144.py`) checks all three original text shards in a temporary folder. It establishes passage identity, non-navigation candidate quality and the continued availability of the decisive pages; it cannot assess a generated interpretation. The normal GitHub CI remains offline.

**Live acceptance:** Run the same three questions in one-book mode, Gemma3:12b, Evidence-first, troubleshooting enabled. Inspect candidate page lists and the answer separately. For Darwin, verify no chapter headings entered selected evidence and check the mechanism explanation. For Thucydides, identify who actually makes each reported claim. For Dostoevsky, distinguish a characterization of Raskolnikov's theory from his actual speech, and avoid unsupported event-finality claims. Keep two model calls; save the reports and compare with v1.4.3 rather than running every model.

Source labels and valid page links remain necessary but never sufficient for semantic or historical accuracy. Prefer not to merge further quality changes until the actual new-model outputs are inspected.

## v1.4.5: three actual failures define acceptance

**Darwin:** v1.4.4 now ranks explanatory prose rather than obvious chapter headings, but the answer still overemphasized dominant species and copied a quotation incorrectly as “an struggle for existence”. v1.4.5 detects long supposed verbatim quotations absent from the cited passage and displays an explicit source-check caution. A warning is a detected **literal mismatch**, not a proof that every remaining claim is true. Ask again for the *mechanism* and expect the actual PDF page 80 to be explained without invented wording or unnecessary geographical digressions.

**Thucydides:** v1.4.4 cited the central underlying cause on PDF p. 38 but did not adequately explain the immediate disputes, and a *split* table-of-contents fragment on p. 19 was still ranked as evidence. v1.4.5 carries physical-page navigation status through passage splitting. The same first model call can now acknowledge that a separate part needs evidence, propose up to two source-search expressions, and recover matching original passages before synthesis. The real-v47 read-only audit exercises generic index searches for *Epidamnus* and *Potidaea*, which are **evaluation examples rather than hardcoded answer rules**. Check whether the local model actually proposes useful hints, which pages are recovered, and whether its answer explains the events coherently instead of substituting unrelated later-war material.

**Dostoevsky:** v1.4.4 still attributed Porfiry's paraphrase of Raskolnikov's theory to Raskolnikov directly. Two real excerpts on PDF pp. 464–465 are now linked as nearby selected evidence in original order, so the composition model can read the investigator's formulation and the character's reply together. That proximity link does **not** identify the speaker; the final answer still requires human review. The new answer should describe Porfiry's reconstruction first and Raskolnikov's qualifying response second, without claiming that the former quotation is Raskolnikov speaking.

**Acceptance test:** merge the PR, pull in GitHub Desktop, and run these same three benchmark cases under Gemma3:12b / Evidence-first, with troubleshooting enabled. Compare original candidate pages, `evidence_selection.gap_retrieval` audit, nearby selected source links, `evidence_check.quotation_precision`, model response and elapsed time against v1.4.4. At most **two** Ollama calls and six core source anchors. A `draft` proves only the source IDs/citation format are valid; the scientific, historical and literary explanations must be assessed against the originals.

## v1.4.6 final quality gate — proceed to the demo

**Reason for this release:** v1.4.5 still required Gemma to volunteer missing topic searches. None of the three live questions triggered that option, so the system could select six sources supporting the FIRST part while overlooking the SECOND. Several adjacent literary/historical passages were also shown as separate source units, making it harder to read an actual reported argument and response together.

**General change:** `evidence_structure.py` independently checks each already-detected question part against real indexed source prose, can replace up to two low-priority anchors with better-matched original passages, and exposes unresolved parts in diagnostics and a reader-visible caution. `render_argument_context` now groups related adjacent originals into a single chronological reading unit without duplicating text, falsely identifying a speaker, or connecting distant chapters.

**One bounded validation:** Existing regression suites plus six final source-assembly contracts; one read-only audit against original Darwin, Thucydides and Dostoevsky v47 shards. The audit found another real Darwin passage; it did **not** resolve every historical incident or literary-interpretation facet, and the system makes that uncertainty visible. No live Gemma answer-quality guarantee is implied by these source tests. At most two Ollama calls and six primary anchors are still required.

**Stop criterion:** Once code compiles, all existing offline regression tests pass, and the single source audit shows no fabricated or wrongly attributed PDFs, mark the release ready. We will not create further v1.4 quality builds for merely imperfect prose. Only a critical regression warrants a blocker.

**Next step:** v1.5 should deliver a usable, responsive one-book Reading Companion demo with original PDF links, approachable source navigation, and honest evidence limitations. The entire 644-book research scope remains the longer-term goal. The public Antilogicalism GitHub Pages interface will need a separate inference API/service; it cannot run local Ollama directly.

## Failure analysis

For v1.4.1, a **citation-recovered** draft means its `[S#]` markers were reconciled with real, supplied passage IDs; it does **not** mean the content was checked for truth. Inspect `diagnostics.draft.citation_reconciliation` to see grouped citation markers, any added source IDs, and rejected conflicts. This recovery supports at most six unique, existing source IDs per paragraph and does not grade whether the cited passage supports each claim. Preserve the same philosophical scoring rubric after a format-only recovery.

For a poor answer, separate **retrieval** (the needed passage never appeared), **selection** (it was retrieved but not supplied), **interpretation** (it was supplied but the model got the meaning wrong), **citation** (the answer points at an irrelevant/unknown passage), and **presentation** (repetition or poor organization). These failures need different solutions. Do not conflate a successful JSON format with philosophical correctness.

Prefer changes that improve more than one test and preserve useful passages. As the project expands to the whole library, add other authors, genres, editions, cross-book comparison questions, and deliberately difficult objections. A strong reading companion should leave the reader equipped to **inspect primary evidence and keep reading**, not merely admire a fluent summary.
