# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

The Antilogicalism Reading Companion is a source-grounded AI tool for exploring the Antilogicalism digital library. Ask questions about one book or across the collection, compare ideas among authors, and follow citations back to the passages so you can read the source in context.

## Use the live companion

Open the [Reading Companion](https://jsynon.github.io/antilogicalism/reading-companion/).

1. Choose **All Books** to search the collection, or select a title to focus on one book.
2. Ask a question in your own words. Questions can request an explanation, comparison, or evidence for an interpretation.
3. Check the cited passages. Use **Read passage** to inspect the excerpt and follow its link to the original PDF page.
4. Ask a follow-up question if you want to explore the evidence further.

The public pilot currently searches the published library index, which contains **642 book titles**. Answers may be incomplete or mistaken. A citation helps you verify where the text came from; it does not guarantee that every claim or interpretation in the answer is correct. Treat the response as a guide to reading, and judge it against the cited text.

## Run the local workbench

This repository also includes a Python application for local development and experimentation. It uses [Ollama](https://ollama.com/) and a model running on your computer; it is separate from the public website and does not call the Cloudflare Worker.

Requirements: Python 3.10 or newer, Ollama, and local copies of the website and library-data repositories for full-library search. The expected folder layout is:

```text
Downloads/
├── book-chatbot/
├── antilogicalism/
└── antilogicalism-library-data/
```

Install the default local model:

```powershell
ollama pull gemma3:12b
```

From the `book-chatbot` directory, start the app with `start.bat` on Windows, or run:

```powershell
python app.py
```

Then open **http://127.0.0.1:8765/**. The local Developer Mode is at **http://127.0.0.1:8765/developer** and provides development diagnostics and tools. It is intended for local use, not as an access-control system. More setup and design notes are in [docs/README.md](docs/README.md).

## How it fits into Antilogicalism

Antilogicalism brings together philosophy, religion, literature, history, science, and other fields through its website, Bookshelf, and searchable Digital Library. The Reading Companion adds a conversational way to move from a question to relevant books and passages, while keeping the original texts accessible and central.

The project is split across three repositories:

- [**antilogicalism**](https://github.com/jsynon/antilogicalism) contains the website, Bookshelf, Library Search, public companion interface, and evaluation workflows.
- [**antilogicalism-library-data**](https://github.com/jsynon/antilogicalism-library-data) publishes the catalog, indexed book text, search data, and source fingerprints used to verify page identity.
- **book-chatbot (this repository)** contains the Cloudflare Worker API for the public pilot and the local Python/Ollama workbench.

The companion uses the shared published library data rather than maintaining another full copy of the books here. This keeps the website, book-data pipeline, and answer service distinct while supporting one connected reading experience.

## Project status and limits

The public companion is a pilot for the full collection. Current work evaluates retrieval and generated answers across different disciplines, then uses those results to guide general improvements. The retrieval benchmark checks source discovery and page identity without making AI calls; the separate live answer evaluation checks end-to-end responses and citations.

Search may miss a useful passage because of wording, OCR quality, or the limits of selecting a small set of pages. Even when the cited page is correct, the model can misread or overstate what it says. Compare important claims with the passage and original page.

**Guiding principle:** use AI to help readers find, question, and understand the books, while keeping the books themselves at the center.
