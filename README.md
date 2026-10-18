# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

The **Antilogicalism Reading Companion** is an open-source, source-grounded AI reading and research tool for the [Antilogicalism](https://jsynon.github.io/antilogicalism/) digital library. Readers can ask questions about individual books, compare ideas across works and authors, and follow citations back to the original texts. The goal is not to replace reading with AI-generated conclusions, but to make the library easier to explore and to encourage independent engagement with primary sources.

The project currently runs **locally** with Python and [Ollama](https://ollama.com/). Its interface adopts Antilogicalism's Book Lite website design. Public hosting and integration into the live website are longer-term goals, not features of this local application.

## How it fits into Antilogicalism

Antilogicalism brings together philosophy, religion, literature, history, science, and other fields through a website, Bookshelf, and searchable Digital Library. The Reading Companion adds a conversational way to approach that collection.

The related repositories have different jobs:

- **[antilogicalism](https://github.com/jsynon/antilogicalism)** — the website, Bookshelf, book metadata, and Library Search experience.
- **[antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data)** — the separate indexed book text and search data.
- **book-chatbot (this repository)** — retrieval, local AI inference, citation handling, source reading, and the chat interface.

The Reading Companion uses the existing library data rather than storing a second complete book collection in this repository. It is designed to help visitors move from discovering a text, to discussing it, to reading the relevant pages for themselves.

## What you can do

- **Read one book:** select a work from the catalog and ask questions about its ideas and arguments.
- **Explore across books:** ask comparative questions spanning authors, works, or disciplines. Search selects a bounded set of potentially relevant books and passages rather than examining every indexed book for each question.
- **Inspect the evidence:** follow citations to excerpts and full indexed PDF pages, with the book title and physical page number.
- **Read in context:** move to earlier and later indexed pages, view readable paragraphs or the original OCR layout, and see matched cited passages highlighted when they can be located reliably.
- **Continue the discussion:** ask follow-up questions while retaining conversation context within the selected reading scope.

The interface has two local views:

- **Reader Mode:** `http://127.0.0.1:8765/` — a clean reading and conversation experience.
- **Developer Mode:** `http://127.0.0.1:8765/developer` — model and pipeline options, diagnostics, regression tests, and other tools for development.

Developer Mode is a local convenience, **not an authentication or access-control system**.

## Run it locally

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

The application normally reads the website's `digital-library/library-catalog.json` and the library-data repository's compressed search index and `book-N.json.gz` text shards. A bundled pilot book may be available as a fallback, but the full experience requires the shared data.

### Start the application

1. Install Ollama, then download the default model:

   ```powershell
   ollama pull gemma3:12b
   ```

2. On Windows, open `start.bat` in the `book-chatbot` folder. Alternatively, run:

   ```powershell
   python app.py
   ```

3. Open **http://127.0.0.1:8765/** in your browser.

Choose **One selected book** to begin with Aristotle's *Nicomachean Ethics* or another available work. For comparisons, choose **Across the Antilogicalism Library** and ask a question such as: *How do Aristotle and Tolstoy understand happiness and the good life?*

The first library-wide search may take longer while local index data is loaded. No hosted AI API is required for this version.

### Development and configuration

Open **http://127.0.0.1:8765/developer** for local model selection, troubleshooting traces, and benchmark tools. The repository includes automated tests in `tests/`, repeatable evaluation questions in `benchmarks/`, and additional technical documentation in [docs/README.md](docs/README.md).

Common environment settings include:

| Setting | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_MODEL` | `gemma3:12b` | Local model |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `BOOK_CHATBOT_PORT` | `8765` | Local website port |
| `BOOK_CHATBOT_LIBRARY_DATA` | Sibling `antilogicalism-library-data` | Location of indexed texts |
| `BOOK_CHATBOT_CATALOG` | Sibling website's library catalog | Book titles, authors, and PDF metadata |
| `BOOK_CHATBOT_DATA_VERSION` | `v47` | Installed index snapshot |

Additional configuration and evaluation details are documented in the source files and [technical documentation](docs/README.md).

## How it works

The application uses a retrieval-augmented generation approach:

1. **Find relevant texts.** For a selected book, it searches that book's indexed passages. Across the library, it searches the existing compressed full-text index and loads passages from a limited set of matching works.
2. **Select and organize evidence.** It ranks relevant passages, preserves their original book and physical page identities, and adds nearby context when needed.
3. **Generate an explanation.** Ollama produces an answer using the retrieved source material. The normal evidence-first workflow uses bounded model calls rather than an open-ended agent loop.
4. **Connect citations.** Source references are checked against passages actually retrieved. Readers can inspect the cited text and navigate the underlying indexed pages.

The inference interface is separated from the retrieval and evidence-handling components, allowing future hosting options to be investigated without rebuilding the library's search data from scratch.

Key modules include `app.py` (local HTTP interface), `whole_library.py` (cross-book discovery), `library_catalog.py` (book selection), `evidence_pipeline.py` (evidence-first answers), `grounded_pipeline.py` (passage indexing and provenance), `inference.py` (Ollama provider), and `source_reader.py` (indexed PDF-page reading).

## Limits and guiding principles

**A genuine citation is not proof of a correct interpretation.** The assistant can misunderstand an argument even when it links to the right page. Across-library discovery is selective, not exhaustive; OCR damage and vocabulary differences can also hide relevant evidence. PDF links point to the original Google Drive documents, but Google Drive may ignore a requested page number, so the reader displays the physical PDF page explicitly.

This is presently a **localhost application**, not a public website chatbot. Before public deployment, inference hosting, capacity, security, and developer-only API access will need separate work.

The guiding principle remains simple: **use AI to help people find, question, and understand the books, while keeping the original texts accessible and central.**

---

This README documents the project's enduring purpose, setup, and design. Individual changes, experiments, and release history belong in GitHub commits and pull requests; routine updates do not require a README revision.
