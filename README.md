# Antilogicalism Reading Companion

**A conversational way into the books, not a replacement for reading them.**

The Reading Companion is one part of [Antilogicalism](https://jsynon.github.io/antilogicalism/), a project dedicated to independent reading and inquiry across philosophy, literature, religion, history, science, and related fields. The site brings together writing, a curated **Bookshelf**, and a full-text searchable **Digital Library** of primary sources. The Reading Companion adds conversation to that experience: ask a question, encounter a useful explanation, and follow the citations back to the author's own words.

**Our long-term goal is to make the entire Antilogicalism digital library available for source-grounded conversation.** Readers should eventually be able to trace arguments across works and authors, compare interpretations, discover books worth reading, and check the underlying text—not merely accept a fluent AI summary.

## Current state: Version 1.2.2

The running prototype uses **Aristotle's *Nicomachean Ethics*** as its first book. It is local, free of hosted inference API dependencies, and meant to become a useful one-book demo before expanding to the full collection.

Version 1.2's default is **evidence-first answering**:

1. Search a wider pool of passages from the book, retaining book IDs and physical PDF pages.
2. Ask the local model to choose the most decisive passages for the question—especially definitions, relationships, contrasts, and evidence covering multiple parts.
3. Include neighboring source passages when a selected quotation is too isolated to understand reliably. Keep each neighbor's citation identity separate.
4. Ask the model for a **direct, coherent explanation** with paragraph-level source IDs. The application—not the model—places inline citation links.
5. Display verbatim, short **key passages** with PDF page links and, when useful, one or two natural follow-up questions that the reader can pursue.

**Version 1.2.2 citation recovery:** some models place `[S#]` markers directly in the prose—or group them as `[S1, S2]`—even when source IDs are returned separately. The application now reconciles known, overlapping references, preserves any valid additional sources, removes duplicate inline markers, and renders its own citation links. Unknown, disjoint/conflicting, malformed, or excessive references are still rejected. Structured source lists remain limited to four IDs; citation recovery can preserve up to six *distinct IDs from passages actually supplied* rather than silently discarding valid inline evidence. Opt-in diagnostics record any recovery or rejection; no extra model call is made. This fixes a formatting failure, **not** an interpretive error.

The default uses **two local Ollama calls**: evidence selection and answer synthesis. There is **no model-generated grade, claim-by-claim reviewer, or automatic rewriting loop**. Responses are labeled **drafts**, because valid citation IDs do not establish that a philosophical interpretation is correct.

The previous **direct v1.1** (one call, first eight ranked passages) and the older **claim/review** route remain available for controlled comparisons. Neither is the default. The interface can compare v1.2 and v1.1 on the same questions, or run any of the three methods individually.

## Run it on your computer

You'll need Python 3.10+ and a local [Ollama](https://ollama.com/) installation, plus the source texts in [jsynon/antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data).

1. Clone **book-chatbot** and **antilogicalism-library-data** as sibling folders, or configure an explicit path to the book shard.
2. Install an Ollama model, for example: **ollama pull qwen3:14b**. Other installed models are detected automatically.
3. On Windows, double-click **start.bat**. Alternatively run **python app.py**.
4. Open **http://127.0.0.1:8765** and ask about *Nicomachean Ethics*. The default method is **Evidence-first answers (v1.2)**.
5. To evaluate it, use **Compare installed Ollama models**, select the original five regression questions, the synthesis question, or both. The optional checkbox runs **v1.2 versus v1.1** on the same models and questions. Download the resulting JSON for full answers, chosen passages, timings, and diagnostics.

All requests run sequentially so large local models do not compete for GPU memory. The CMD window prints stage-by-stage progress, including which evidence was selected. Qwen3:14b, Gemma3:12b, and Qwen3:8b are convenient comparison models; actual speed and quality depend on hardware and Ollama configuration.

**Inference stays local:** the application calls Ollama over localhost and does not send prompts to a hosted AI service. Opening source PDFs uses Google Drive. No additional Python packages or API keys are needed.

## Books and configuration

The original and repaired full-text data live in the separate **antilogicalism-library-data** repository, not in this code repository. Source files are not bundled with this GitHub checkout. The application looks for the shared compressed book shard and will fail to start if neither it nor an explicitly supplied shard is available.

| Setting | Default | Meaning |
| --- | --- | --- |
| BOOK_CHATBOT_LIBRARY_DATA | Sibling antilogicalism-library-data directory | Where to find the shared corpus |
| BOOK_CHATBOT_DATA_VERSION | v47 | Corpus snapshot (data-v47) |
| BOOK_CHATBOT_BOOK_ID | 7 | Pilot book shard (book-7.json.gz) |
| BOOK_CHATBOT_BOOK_FILE | Not set | Optional explicit compressed book file |
| BOOK_CHATBOT_BOOK_TITLE | Nicomachean Ethics — Aristotle | Display and citation title |
| BOOK_CHATBOT_PDF_FILE_ID | Configured Aristotle PDF ID | Link to source pages |
| OLLAMA_URL | http://127.0.0.1:11434 | Local inference endpoint |
| OLLAMA_MODEL | qwen3:14b | Initial selected model |
| BOOK_CHATBOT_PORT | 8765 | Local website port |
| BOOK_CHATBOT_PIPELINE | evidence | Default method: evidence, direct, or grounded |
| BOOK_CHATBOT_CONTEXT_TOKENS | 8192 | Ollama context window; larger windows may increase VRAM use |
| BOOK_CHATBOT_PROGRESS | 1 | Set to 0 to silence progress in CMD |

Changing book IDs does **not** automatically update the title or Google Drive PDF identity. Correct multi-book metadata resolution is part of the planned full-library architecture.

## Reading with evidence

Source excerpts and citations originate in the indexed primary texts. Passage IDs include their book, corpus version, and original page provenance; they are never inferred from an AI-generated answer. When the model returns cited paragraphs, Python checks **both the structured source-ID arrays and any inline markers** against passages actually supplied. It reconciles valid overlap and renders the citation links itself. Disagreements and recoveries are visible in the diagnostic JSON.

**A real citation may still accompany a false interpretation.** The system does not currently certify whether the explanation follows from the cited passages. The **Key passages** section provides short, exact excerpts, with the full context and PDF pages available for readers to inspect. The original five regression questions and synthesis question are preserved to support reproducible evaluation, but a successful automated request is not the same as a correct answer.

The prototype currently loads **one configured book at startup**. There is no whole-library question routing, multi-book index, persistent semantic search, account system, or public Ollama host yet. Some Google Drive previews ignore PDF page fragments; use the displayed physical page number if necessary.

## Repository structure and direction

- **app.py** — local HTTP server, corpus configuration, API routing, and historical compatibility code.
- **grounded_pipeline.py** — passage index, book/page provenance, and optional older claim/review pipeline.
- **evidence_pipeline.py** — Version 1.2 evidence selection, adjacent context, coherent answers, and extractive source spotlights.
- **direct_pipeline.py** — retained Version 1.1 single-call baseline and deterministic paragraph citation binding shared with v1.2.
- **inference.py** — Ollama request boundary, structured output, token counts, and elapsed times.
- **index.html** — reading interface, linked source excerpts, follow-ups, and repeatable test runner.
- **tests/** — synthetic-data and HTTP contract tests. These do not replace human review of interpretation.
- **docs/README.md** — architecture, design limits, and the path to the complete library.
- **docs/evaluation.md** — repeatable human quality checks for comparing answer methods.

Run the automated tests with **python -m unittest discover -s tests -v**. GitHub Actions also tests the v1.2 contract using synthetic book text.

**Next milestones:** evaluate v1.2 against v1.1 for accuracy, evidence use, clarity, completeness, and latency; establish a usable Aristotle demo; add reliable catalog metadata and indexed retrieval across the whole Antilogicalism corpus; then design and host a public inference backend. The GitHub Pages website can host a frontend, but it cannot run Python or Ollama itself.

Antilogicalism's aim is to encourage thinking and reading. A worthwhile companion should bring readers **closer to the texts** and open further questions, not obscure the texts behind confident-sounding automation.
