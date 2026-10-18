# Reading Companion: architecture and roadmap

This document describes the **Version 1** system as a new reader or contributor would encounter it. The goal is not to reproduce the history of earlier experiments; the working question is how to make the full Antilogicalism library useful for trustworthy exploration.

## The project in context

[Antilogicalism](https://jsynon.github.io/antilogicalism/) provides writing and resources for independent reading across philosophy, literature, religion, history, science, and related subjects. Its **Bookshelf** organizes primary sources, while **Library Search** exposes full-text searching over the separately maintained [antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data) corpus. The companion makes those books approachable through questions and follow-up conversations, always linking explanations back to inspectable source text.

Eventually the same core should support questions involving multiple books and authors. The user interface and citation format should therefore not assume every passage belongs to the same book, even while the running pilot loads only Aristotle's *Nicomachean Ethics*.

## Current data flow

1. **Corpus resolution:** app.py resolves a compressed book shard from antilogicalism-library-data (or a bundled pilot fallback), using a configurable book ID, version, title, and PDF identity.
2. **Passage index:** grounded_pipeline.PassageIndex creates source windows from page text and indexes them with a lightweight BM25-style lexical search. A passage retains its book ID, version, page range, immutable content identity, and the source page(s) it spans.
3. **Question retrieval:** the server searches the loaded book. In Version 1's direct mode, up to eight top-ranked passages are included within a bounded context budget; the source content is treated as untrusted data, not as model instructions.
4. **Local synthesis:** direct_pipeline.answer_direct asks the chosen local Ollama model for one coherent explanation using only those passages, with [S#] citation markers.
5. **Provenance validation:** deterministic code rejects missing and unknown citation IDs and substantial uncited paragraphs. It binds accepted markers back to real passage metadata and PDF pages. This establishes source identity, **not** the truth of the model's interpretation.
6. **Presentation and evaluation:** index.html shows the readable answer and page links. The test runner executes the same prompts and models with one or both pipelines and exports source passages and call timings.

The browser calls a local Python HTTP service. The Python application calls a local Ollama installation. The companion does not send book text to a hosted AI API. Opening Drive source links takes the reader to the book PDF.

## Two answering methods

**Direct (default)** uses a single model call after retrieval and minimal provenance validation. It aims to assess whether a capable local model can synthesize a good answer when unnecessary intermediate supervision is removed. Its outcome is labeled **draft**, deliberately not verified.

**Grounded (comparison)** retains the previous multi-call passage selector, claim composer, self-reviewer, and bounded repair. Its **verified** label means only that the model-based review accepted the answer. It is not equivalent to independent textual or philosophical correctness.

The two routes share the same index and source identity. They need not select exactly the same passage subset, and this difference should be considered when interpreting comparative results. The interface supports controlled comparisons by using identical questions and models and fresh conversational history.

## Evaluation standard

Success is judged by **correctness, completeness, thoughtful explanation, genuine passage support, readability, and responsiveness**. Automatic citation validation is useful but cannot replace direct human evaluation.

A repeatable test should record: the exact question, selected model, pipeline, full answer, selected and cited passage text, physical page numbers, response time, provider token counts where available, and any failure reason. An answer with nonexistent sources must fail provenance checks; an answer with real sources can still be wrong. Do not optimize solely for the older checker's approval rate.

The pilot includes five fixed regression prompts and one synthesis prompt. More varied questions and independently reviewed examples will be needed before a public demo is treated as trustworthy.

## Limits and future work

- **One book loaded at a time:** there is no corpus-wide catalog resolver or persisted multi-book search index in Version 1.
- **Corpus quality matters:** repaired extracted text is the source of truth for the application, but it may still contain OCR artifacts. Fix text in the data repository rather than hardcoding corrections into prompts.
- **PDF navigation:** Google Drive may ignore page fragments. Displayed physical page numbers provide a fallback, but a reliable page-specific viewer remains desirable.
- **Context constraints:** stronger models demand more VRAM at larger context sizes. Keep evidence selection bounded and measure actual local performance.
- **No public inference host yet:** GitHub Pages serves a static site but cannot run the Python/Ollama backend.

The next engineering steps are: choose the more useful single-book answering method based on **human-scored** test results; stabilize a local Aristotle demo; add per-book metadata and persistent retrieval across the entire library; design cross-book evidence selection and synthesis; then deploy a sustainable public inference service.

## Working on the project

The code uses the Python standard library and Ollama's local HTTP interface. Run **python -m unittest discover -s tests -v** to check contracts and API behavior. Source texts are stored in the separate repository. Avoid answer-specific patch tables and escalating verification complexity unless comparisons demonstrate that a change actually improves the quality readers experience.
