# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

The **Antilogicalism Reading Companion** is an open-source, source-grounded AI reading and research tool for the [Antilogicalism](https://jsynon.github.io/antilogicalism/) digital library. Readers can ask questions about individual books, compare ideas across works and authors, and follow citations back to the original texts. Its purpose is to make the collection easier to explore while keeping the books and primary sources central.

## Current status

The project now has two ways to use the companion:

- **Public pilot:** the [Reading Companion page](https://jsynon.github.io/antilogicalism/reading-companion/) is part of the Antilogicalism website. It searches the published v47 library data and sends bounded requests to a Cloudflare Worker for answer generation. The public selector exposes **642 books**.
- **Local workbench:** this repository also contains the original Python application, which uses a local Ollama model for development and offline experimentation.

The public version is a **pilot**, and answer quality is still being evaluated. Retrieval can find the relevant book and page without finding the best passage for a question. OCR quality, terminology, and multi-part questions can also affect results. A correct page citation confirms source identity and provenance; it does **not** prove that every claim in an AI answer is supported or interpreted correctly. Treat answers as reading aids and check the cited passages.

The current project milestone is to improve retrieval and answer reliability **across the full 642-book collection**, measured with a reusable benchmark rather than a series of book-specific patches.

## How it fits into Antilogicalism

Antilogicalism brings together philosophy, religion, literature, history, science, and other fields through a website, Bookshelf, and searchable Digital Library. The Reading Companion adds a conversational way to approach that collection: a reader can discover a work, ask a question, inspect the relevant page, and continue reading in context.

The related repositories have different jobs:

- **[antilogicalism](https://github.com/jsynon/antilogicalism)** — the website and Bookshelf, book metadata, Library Search, the public companion interface, and its evaluation workflows.
- **[antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data)** — the separately published catalog and indexed book text, search data, and reader fingerprints.
- **book-chatbot (this repository)** — the Cloudflare Worker API for the public pilot and the local Python/Ollama workbench, including retrieval, evidence handling, citation/source reading, and local chat.

The companion reuses the collection's published data instead of keeping a second complete book corpus here. This separation lets the website, data pipeline, and answer service evolve independently while supporting one library experience.

## What readers can do

- **Read one book:** choose a title and ask about its ideas and arguments.
- **Explore across books:** compare authors, works, or disciplines. Searches narrow the large catalog to a bounded set of likely relevant pages.
- **Inspect evidence:** follow citations to the indexed excerpt and original PDF page, with book title and physical page number.
- **Read in context:** view indexed page text or its original OCR layout, navigate nearby pages, and inspect matched text when it can be located.
- **Continue the discussion:** ask follow-up questions while retaining the conversation context and reading scope.

## Public pilot architecture

The public interface is hosted by the Antilogicalism website. The Worker in this repository handles the protected planning and answer requests; indexed books and fingerprints are served from the library-data publication.

At a high level, a question is turned into a small search plan, searched against the shared index, and narrowed to a bounded set of source pages. The Worker checks submitted pages against the published source fingerprints before generating a response. The interface presents citations and links back to those pages. Requests are bounded and subject to pilot access controls and rate limits.

The answer pipeline is designed to be evidence-first, but its safeguards have limits: page identity verification checks that a passage came from the expected indexed page, not that a model's interpretation follows from it. The evaluation reports therefore track retrieval, citation consistency, answer outcomes, and expected-work coverage as review signals; they are not truth scores.

## Evaluation and the next milestone

There are two distinct evaluation workflows in the **antilogicalism** repository:

1. **30-case library retrieval evaluation** — the routine benchmark for broad retrieval work. It uses the production search code and published v47 corpus to check whether expected source groups are retrieved, whether selected pages match their SHA-256 fingerprints, and whether citation locators resolve to the correct book and page. It makes **zero Cloudflare AI calls**. GitHub Actions runs it for relevant pull requests and weekly, and it can also be started manually. See [the benchmark guide](https://github.com/jsynon/antilogicalism/blob/main/benchmarks/reading-companion-public-v1.md) and the [library evaluation workflow](https://github.com/jsynon/antilogicalism/blob/main/.github/workflows/reading-companion-library-evaluation.yml).
2. **Live answer evaluation** — a manually started end-to-end run against the deployed Worker. The default smoke set has three questions; the full set has 30. It uses Cloudflare AI and requires explicit confirmations in GitHub Actions. The runner estimates about 3 Worker inference calls per question: about 9 for smoke or up to 90 for all 30, with requests spaced to respect pilot limits. It records questions, search results, submitted sources, answers, citations, and outcome checks, but does not use an AI judge. Review the answers and passages yourself. See [live evaluation instructions](https://github.com/jsynon/antilogicalism/blob/main/reading-companion/LIVE-EVALUATION.md).

The best order is to establish the zero-AI retrieval baseline first, address broad retrieval weaknesses, and then run a confirmed live smoke or full evaluation to inspect end-to-end answer behavior. The full live run is deliberately separate from routine CI so it does not spend AI calls on every code change.

## Local development

The Python/Ollama application remains available as a developer workbench. It is separate from the deployed public pilot and does not make requests to the Cloudflare Worker.

### Requirements

- Python 3.10 or newer.
- [Ollama](https://ollama.com/) installed and running, with a compatible local model. The current default is `gemma3:12b`.
- Local checkouts of this repository and, for the complete book catalog and across-library retrieval, the companion website and library-data repositories.

The expected folder arrangement is:

```text
Downloads/
├── book-chatbot/
├── antilogicalism/
└── antilogicalism-library-data/
```

The local application normally reads the website's `digital-library/library-catalog.json` and the library-data repository's compressed search index and `book-N.json.gz` text shards. A bundled pilot book may be available as a fallback; the full local experience requires the shared data.

### Start the local application

1. Install Ollama, then download the default model:

   ```powershell
   ollama pull gemma3:12b
   ```

2. On Windows, open `start.bat` in the `book-chatbot` folder. Alternatively, run:

   ```powershell
   python app.py
   ```

3. Open **http://127.0.0.1:8765/** in your browser.

For local development, **Reader Mode** is at `http://127.0.0.1:8765/` and **Developer Mode** is at `http://127.0.0.1:8765/developer`. Developer Mode exposes local model and pipeline options, diagnostics, and regression tools. It is a local convenience, **not** an authentication or access-control system.

The repository includes automated tests in `tests/`, repeatable evaluation questions in `benchmarks/`, and additional technical documentation in [docs/README.md](docs/README.md). Common local environment settings include:

| Setting | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_MODEL` | `gemma3:12b` | Local model |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `BOOK_CHATBOT_PORT` | `8765` | Local website port |
| `BOOK_CHATBOT_LIBRARY_DATA` | Sibling `antilogicalism-library-data` | Location of indexed texts |
| `BOOK_CHATBOT_CATALOG` | Sibling website's library catalog | Book titles, authors, and PDF metadata |
| `BOOK_CHATBOT_DATA_VERSION` | `v47` | Installed index snapshot |

## Local application design

The local application uses a retrieval-augmented generation approach:

1. **Find relevant texts.** For one selected book, search that book's indexed passages. For a library-wide question, search the shared full-text index and load pages from a bounded set of matching works.
2. **Select and organize evidence.** Rank relevant passages, preserve their original book and physical page identities, and add nearby context when appropriate.
3. **Generate an explanation.** Ollama produces an answer using the retrieved source material through bounded model calls rather than an open-ended agent loop.
4. **Connect citations.** Check source references against passages actually retrieved so readers can inspect the evidence and navigate the indexed pages.

Key local modules include `app.py` (local HTTP interface), `whole_library.py` (cross-book discovery), `library_catalog.py` (book selection), `evidence_pipeline.py` (evidence-first answers), `grounded_pipeline.py` (passage indexing and provenance), `inference.py` (Ollama provider), and `source_reader.py` (indexed PDF-page reading).

## Limits and guiding principles

**A genuine citation is not proof of a correct interpretation.** The assistant can misunderstand an argument even when it links to the right page. Across-library discovery is selective, not exhaustive; OCR damage, vocabulary differences, or a poorly matched search plan can hide relevant evidence. PDF links point to the original Google Drive documents, but Google Drive may ignore a requested page number, so the reader displays the physical PDF page explicitly.

The guiding principle remains simple: **use AI to help people find, question, and understand the books, while keeping the original texts accessible and central.** This README records the enduring purpose, current system, and evaluation approach; individual release history belongs in GitHub commits and pull requests.
