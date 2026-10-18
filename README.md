# Antilogicalism Reading Companion

**A conversational way into the books, not a replacement for reading them.**

The Reading Companion is part of [Antilogicalism](https://jsynon.github.io/antilogicalism/), a personal project devoted to making philosophical, literary, religious, historical, and scientific texts easier to discover and explore. Antilogicalism brings together writing, reading resources, a curated **Bookshelf**, and a searchable **Digital Library** of primary sources. The companion adds a different way to engage with that material: ask a question in ordinary language, follow an explanation, and return to the actual pages that informed it.

The long-term aim is to make **the entire Antilogicalism library available for source-grounded conversation**. Readers should eventually be able to investigate an argument, compare authors and traditions, follow a question across books, and inspect the evidence rather than trusting an unsupported AI summary.

## Where the project stands

**Version 1** is a local, single-book prototype using Aristotle's *Nicomachean Ethics*. It is designed to establish a useful reading experience before expanding retrieval to the full library.

- **Default: direct synthesis.** A local model receives relevant book passages and writes one coherent answer citing passage IDs. The application validates the citation IDs against the supplied passages; it does **not** claim to have independently proved every interpretation.
- **Comparison mode: historical claim/review pipeline.** The same question and model can also run through the earlier multi-stage composer, model reviewer, and bounded repair system. That path is retained for evaluation, not treated as an authoritative judge.
- **Models:** Ollama detects installed local models automatically. The comparison UI prioritizes Qwen3:14b, Gemma3:12b, and Qwen3:8b when available; other installed models can be selected.
- **Repeatable tests:** Six questions can be run across either or both pipelines. A downloadable JSON report keeps full answers, selected passages, model timings, and available diagnostics. The server's console shows progress through each stage.

This is an **experimental reading assistant**, not a production service or a guarantee of scholarly accuracy. A cited response can still misinterpret a passage. The source text and page links are part of the answer precisely so that readers can check it.

## Try it locally

You need Python 3.10+ and [Ollama](https://ollama.com/) running on your own computer.

1. Clone **both** this repository and **antilogicalism-library-data** into the same parent directory (or configure the book text path described below).
2. Install a model, for example with the command **ollama pull qwen3:14b**. Smaller models are supported; performance and available context depend on your hardware.
3. On Windows, double-click **start.bat** in the project folder. Alternatively, run **python app.py**.
4. Open **http://127.0.0.1:8765** if the browser does not open automatically.
5. Select a model and ask a question. The default answering method is **Direct synthesis (Version 1)**.

For a reproducible comparison, choose a question set in **Compare installed Ollama models**, select the models you want, optionally check **Compare both answering methods**, click **Run test set**, and download the combined report. Requests run sequentially so local models do not compete for GPU memory. The CMD window shows each question's retrieval, model calls, timings, and outcome.

No extra Python packages or hosted AI API keys are needed. The application sends prompts only to your configured **local Ollama endpoint**. Opening an external source PDF uses Google Drive.

### Source texts and configuration

The authoritative extracted and repaired corpus is kept in [jsynon/antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data), separate from the chatbot's code. With the repositories side by side, this project automatically looks for the configured book shard in that data repository. **This GitHub repository does not include book-text shards.** The alternate local data/book-7.json.gz path is a fallback only if you supply that file yourself. Without either a matching shared shard or a configured explicit file, the application cannot load the pilot book.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| BOOK_CHATBOT_LIBRARY_DATA | Sibling antilogicalism-library-data directory | Shared corpus location |
| BOOK_CHATBOT_DATA_VERSION | v47 | Selects the data-v47 corpus snapshot |
| BOOK_CHATBOT_BOOK_ID | 7 | Current pilot book shard, book-7.json.gz |
| BOOK_CHATBOT_BOOK_FILE | Not set | Override with an explicit shard path |
| BOOK_CHATBOT_BOOK_TITLE | Nicomachean Ethics — Aristotle | Book label for passage provenance |
| BOOK_CHATBOT_PDF_FILE_ID | Pilot PDF's Google Drive file ID | Source-page links |
| OLLAMA_URL | http://127.0.0.1:11434 | Local inference service |
| OLLAMA_MODEL | qwen3:14b | Initial model selection |
| BOOK_CHATBOT_PORT | 8765 | Local web server |
| BOOK_CHATBOT_PIPELINE | direct | Initial answering method (direct or grounded) |
| BOOK_CHATBOT_CONTEXT_TOKENS | 8192 | Ollama context length; may affect VRAM |
| BOOK_CHATBOT_PROGRESS | 1 | Set to 0 to silence additional CMD progress logs |

The pilot's title and PDF identity **do not automatically update** when changing its book ID. Multi-book metadata resolution is part of the next development phase.

## How it works

The user asks a question; the application searches the loaded book, finds contiguous source passages, and assigns IDs linked to their book and physical PDF pages. Direct synthesis gives a bounded set of those passages to a local model and requests a readable, cited explanation. Python checks that citations belong to passages actually supplied. The companion then shows the response and links back to the source pages.

The default route is intentionally **one model call after retrieval**. It avoids using a model to certify its own writing, a process that can mistakenly approve false claims or reject valid ones. The historical multi-stage pipeline is still selectable for controlled comparisons.

The application can currently index only **one configured book at startup**. It does not yet provide a whole-library book catalog, persistent multi-book search, cross-book synthesis, user accounts, or a hosted public inference service. Some Google Drive PDF previews ignore page anchors; the displayed physical page number remains the reference in that case.

## Development and direction

This repository separates the book corpus, retrieval, local inference, answering logic, and browser experience. The important modules are:

- **app.py** — local HTTP server, corpus configuration, API routing, and older compatibility functions.
- **grounded_pipeline.py** — shared passage index/provenance and the optional multi-stage comparison pipeline.
- **direct_pipeline.py** — Version 1's simple, citation-bound synthesis.
- **inference.py** — Ollama structured-completion boundary and call timings.
- **index.html** — reading/chat interface and repeatable model/pipeline comparison.
- **tests/** — automated contract and HTTP tests, separate from human assessments of answer quality.

Read [docs/README.md](docs/README.md) for architecture and the path to the full library. Run unit tests with:

    python -m unittest discover -s tests -v

**Next milestones:** evaluate the two answering approaches against actual passage interpretations; refine the simplest working one-book demo; add a catalog and efficient indexing across the full Antilogicalism corpus; and finally provide a publicly accessible backend. GitHub Pages can host the website and frontend, but cannot itself execute Ollama or a Python inference server.

The project is meant to encourage reading, questioning, and intellectual exploration. Its success will depend less on whether an internal checker says “verified” and more on whether a reader can learn something useful, see where it came from, and continue investigating independently.
