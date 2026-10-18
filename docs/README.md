# Reading Companion: architecture and roadmap

[Antilogicalism](https://jsynon.github.io/antilogicalism/) combines writing, a curated **Bookshelf**, and a searchable **Digital Library** of primary-source texts. The Reading Companion adds an interactive layer: ask a question, understand the reasoning, follow source passages, and keep exploring. The long-term project is conversation **across the entire library**, not an Aristotle-only question-answer engine.

The pilot uses Aristotle's *Nicomachean Ethics* and local Ollama inference. The design remains book-agnostic and preserves text/page provenance so multi-book retrieval can replace the pilot index without rewriting the answer system.

## Version 1.2.2: data flow

1. **Resolve the corpus.** The HTTP app finds a compressed book shard in the sibling [antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data) checkout (or from an explicit file path). Metadata includes catalog ID, title, corpus version, PDF identity, and physical page numbers.
2. **Retrieve broadly.** The PassageIndex in grounded_pipeline.py indexes complete sentence windows using lightweight BM25-style lexical search. The server retrieves **up to 24 candidates** with all source identities intact. Multi-part queries use existing facet handling.
3. **Select decisive evidence.** The new evidence_pipeline.py presents bounded, question-aware previews to Ollama and requests **up to six important passages**. It favors explicit definitions, relevant contrasts, and evidence connecting parts of the question. This is the **first inference call**. If the selector produces invalid IDs, its failure is recorded and the original ranked passages are used instead; sources are never invented.
4. **Restore context.** Short or connective-leading selected passages can pull up to three physically adjacent passages from the **same book and corpus version**. Every neighbor retains or receives a **separate, unique source ID**; no two passages are silently fused into a single citation.
5. **Compose a thoughtful explanation.** The **second inference call** receives the complete selected passages and nearby context within a prompt budget. The model is directed to answer the central question immediately, develop the argument with actual evidence, separate an author's position from objections, and avoid padded repetition. Complexity, not a fixed word count, determines response length.
6. **Bind and recover citations.** Each output paragraph includes prose and an array of source IDs. Python validates every structured ID and any embedded `[S#]` markers against the **exact passages supplied**. Individual `[S1]` and grouped `[S1, S2]` markers that overlap the structured list are reconciled and deduplicated, including previously omitted but valid inline IDs. The structured list remains limited to four IDs; at most six existing distinct source IDs may be retained after recovery. Disjoint, unknown, malformed, or excessive references still fail closed. The app inserts final visible citation markers and links; opt-in JSON retains the raw output and per-paragraph recovery or rejection details. The model receives no extra call for this repair.
7. **Show evidence and next questions.** Deterministic extractive highlights show **verbatim complete source sentences**, when short enough, from cited passages with PDF links. The model may also suggest up to two optional follow-up questions; these do not affect whether an otherwise valid answer is accepted.

The browser calls Python on localhost, and Python calls local Ollama. It does not send the text to a hosted AI API. Opening a source link takes the reader to a Google Drive PDF; some Drive previews ignore the page number. The browser never renders model- or book-generated HTML as markup.

## Comparison methods

| Method | Steps | Role |
| --- | --- | --- |
| evidence (default) | Wider retrieval, model selection, nearby source context, synthesis, deterministic citations | Version 1.2 |
| direct | First eight ranked passages, synthesis, deterministic citations | Version 1.1 single-call baseline |
| grounded | Model evidence selector, claim composer, model reviewer, possible repair | Historical comparison; its verified flag does **not** certify truth |

The browser preserves the five historical regression questions and one synthesis question. Checking **Compare v1.2 vs. v1.1** sends identical questions and models through the two modern pipelines, sequentially, and exports their passages, results, stage times and diagnostics. The historical pipeline can still be selected separately.

**Important:** evidence selection can be wrong, and even a real citation can accompany a false or reversed interpretation. Nothing in the default pipeline semantically certifies the claims. Successful answers are deliberately labeled **draft**. See [evaluation.md](evaluation.md) for human quality assessment.

## Source integrity principles

- Treat book prose as untrusted **data**, not as a source of instructions.
- Generate source identities and URLs from the actual indexed book, not from model text.
- Adjacent context must belong to the same book and corpus version, and remain independently citable.
- An evidence spotlight must be a **verbatim complete sentence** from the cited primary text, or be omitted; never silently truncate it.
- A source marker establishes **provenance**, not philosophical accuracy. A reader can inspect the original context from the full passage and PDF links.
- If evidence selection fails, use a transparent ranked fallback. If generated citations are invalid, report that failure rather than passing off unsourced prose as an accepted answer.

## Limitations and roadmap

**Now:** one configured book in memory, a lexical retrieval index, bounded prompts, two default inference calls, imperfect OCR, and occasional page-anchor issues in Google Drive. Larger local models cost time and VRAM; measure quality against latency rather than assuming larger is always better.

**Next:** stabilize a genuinely useful Aristotle pilot, add accurate book/author/edition/PDF metadata, introduce a persistent retrieval layer over the entire existing full-text corpus, support questions and source selection spanning multiple books, and deploy a sustainable public inference service. GitHub Pages can host the static frontend but not Python or Ollama.

Do not introduce author-specific answer patches to the shared pipeline. Prefer improvements demonstrated across questions and measured by **accuracy, completeness, explanation, grounding, readability, and responsiveness**.

## Working on the project

This repository uses the Python standard library and local Ollama. Run **python -m unittest discover -s tests -v** for HTTP and source-integrity contracts. GitHub Actions creates a small synthetic book for automated tests, but those tests do **not** connect to Ollama, measure philosophical correctness or prove public deployment readiness.

Keep the documentation oriented toward the current useful system and the larger Antilogicalism mission, not a chronology of earlier experimental builds.
