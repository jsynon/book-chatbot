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

## Failure analysis

For v1.4.1, a **citation-recovered** draft means its `[S#]` markers were reconciled with real, supplied passage IDs; it does **not** mean the content was checked for truth. Inspect `diagnostics.draft.citation_reconciliation` to see grouped citation markers, any added source IDs, and rejected conflicts. This recovery supports at most six unique, existing source IDs per paragraph and does not grade whether the cited passage supports each claim. Preserve the same philosophical scoring rubric after a format-only recovery.

For a poor answer, separate **retrieval** (the needed passage never appeared), **selection** (it was retrieved but not supplied), **interpretation** (it was supplied but the model got the meaning wrong), **citation** (the answer points at an irrelevant/unknown passage), and **presentation** (repetition or poor organization). These failures need different solutions. Do not conflate a successful JSON format with philosophical correctness.

Prefer changes that improve more than one test and preserve useful passages. As the project expands to the whole library, add other authors, genres, editions, cross-book comparison questions, and deliberately difficult objections. A strong reading companion should leave the reader equipped to **inspect primary evidence and keep reading**, not merely admire a fluent summary.
