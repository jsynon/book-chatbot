# Evaluating the Reading Companion

**A model returning a cited draft is not the same as an accurate interpretation.** The same is true of the older pipeline's model-generated "verified" verdict. This guide is for reviewing actual answers against their primary-source passages and deciding whether a change helps readers.

## Repeatable evaluation

Run the fixed five-question regression test and the separate synthesis question on the same installed Ollama models. Compare **evidence v1.2** with **direct v1.1** using identical questions, fresh conversation histories, and the same underlying book shard. Record the local build, model, context length, passage IDs and pages, full output and elapsed time. Export the JSON report.

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

## Checks for the Aristotle pilot

These are **human review anchors**, not hardcoded answers or retrieval rules. They help expose errors that the v1.1 provenance validator cannot catch:

- **Practical wisdom:** distinguish practical wisdom from theoretical/scientific knowledge; explain deliberation and particular action. The Book VI passage on PDF p. 72 explicitly assigns the **right aim to moral virtue** and the **right means to practical wisdom**. Reversing these roles is a serious error.
- **Mean relative to us:** not an arithmetic midpoint; it depends on circumstances and what practical wisdom judges appropriate. The exercise/food comparison in Book II (PDF p. 18) is a useful control.
- **God and soul:** answer from the scope of the *Ethics*, distinguishing the rational and non-rational aspects of the soul, the activity of the soul in happiness, and any relevant discussion of contemplation. A one-line poetic reference to divinity is **not** enough to establish Aristotle's own metaphysical doctrine.
- **Three kinds of friendship:** utility, pleasure, and virtue/character. The author **does explicitly introduce three forms** in Book VIII (PDF p. 90). Do not deny a clear definition present in the cited passage.
- **Magnificence:** distinguish it from liberality, explain scale and noble expenditure, and ground the distinctions in Book IV.
- **Synthesis question:** connect moral virtue, practical wisdom, and eudaimonia; recognize the aim/means relation, happiness as activity rather than transient mood, and (when relevant) the Book X complication that contemplation receives special priority.

## Failure analysis

For v1.2.1, a **citation-recovered** draft means its `[S#]` markers were reconciled with real, supplied passage IDs; it does **not** mean the content was checked for truth. Inspect `diagnostics.draft.citation_reconciliation` to see any added source IDs or rejected conflicts. Preserve the same philosophical scoring rubric after a format-only recovery.

For a poor answer, separate **retrieval** (the needed passage never appeared), **selection** (it was retrieved but not supplied), **interpretation** (it was supplied but the model got the meaning wrong), **citation** (the answer points at an irrelevant/unknown passage), and **presentation** (repetition or poor organization). These failures need different solutions. Do not conflate a successful JSON format with philosophical correctness.

Prefer changes that improve more than one test and preserve useful passages. As the project expands to the whole library, add other authors, genres, editions, cross-book comparison questions, and deliberately difficult objections. A strong reading companion should leave the reader equipped to **inspect primary evidence and keep reading**, not merely admire a fluent summary.
