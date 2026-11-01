# Antilogicalism Reading Companion

**Read with the books, not instead of them.**

The Antilogicalism Reading Companion helps readers explore the library and understand ideas in context. Answers can combine cited passages with broader knowledge and synthesis; citations identify claims drawn from the books, while uncited explanation is the model's own context.

## Use the live companion

Open the [Reading Companion](https://jsynon.github.io/antilogicalism/reading-companion/).

1. Choose **All Books** to search the collection, or select a title to focus on one book.
2. Ask a question in your own words. Questions can request an explanation, comparison, or evidence for an interpretation.
3. Check the cited passages. Use **Read passage** to inspect the excerpt and follow its link to the original PDF page.
4. Ask a follow-up question if you want to explore the evidence further.

The public pilot currently searches the published library index, which contains **642 book titles**. Answers may be incomplete or mistaken. Citations help you verify what the books say, but they do not certify the model's broader explanation or interpretation. Treat the response as a guide to reading, and judge source-based claims against the cited text.

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

The local page follows the live page's Book Lite layout, typography, colors, and controls. Local model selection and testing tools remain available in Developer Mode; the public Cloudflare quick check is not part of the local workbench.

### Manually review saved answers

The cross-disciplinary runner records source identity checks, but it does not grade the meaning of an answer. After running cases, review the saved answers and cited passages without making more model requests:

```powershell
python scripts\review_cross_discipline.py
```

Use `--output` to choose a report folder and repeat `--case CASE_ID` to review selected cases. The reviewer records 0–3 human scores for accuracy, completeness, explanatory value, citation support, and readability, plus notes, directly in each report JSON. It marks a report reviewed only after all five scores are present and confirmed.

## How it fits into Antilogicalism

Antilogicalism brings together philosophy, religion, literature, history, science, and other fields through its website, Bookshelf, and searchable Digital Library. The Reading Companion adds a conversational way to move from a question to relevant books and passages, while keeping the original texts accessible and central.

The project is split across three repositories:

- [**antilogicalism**](https://github.com/jsynon/antilogicalism) contains the website, Bookshelf, Library Search, public companion interface, and evaluation workflows.
- [**antilogicalism-library-data**](https://github.com/jsynon/antilogicalism-library-data) publishes the catalog, indexed book text, search data, and source fingerprints used to verify page identity.
- **book-chatbot (this repository)** contains the Cloudflare Worker API for the public pilot and the local Python/Ollama workbench.

The companion uses the shared published library data rather than maintaining another full copy of the books here. This keeps the website, book-data pipeline, and answer service distinct while supporting one connected reading experience.

The local workbench and public Worker do not share most answer-generation code. The local app runs its Python retrieval and evidence-first pipeline with Ollama; the website calls the JavaScript Worker pipeline with Cloudflare AI. They can use the same published catalog and book text, and the evaluation cases can be reused, but a local-model result is not a direct test of Worker behavior.

## Project status and limits

The public Reading Companion is an active pilot. Its core end-to-end path plans searches, retrieves published book text, verifies source pages, selects evidence, composes answers, and reviews links among claims, question parts, and citations. The public Worker and local workbench support development and evaluation, but they use separate answer-generation implementations.

Testing and diagnostics have matured alongside the pipeline. Saved traces make it possible to inspect retrieval, selected evidence, answer claims, and review decisions offline. Evaluation distinguishes structural integrity—whether source identity and evidence links line up—from semantic answer quality—whether a response is accurate, complete, explanatory, and well supported. A structural pass is necessary, but does not guarantee a good answer.

Reliability and answer quality remain active areas of work. Search can miss useful passages because of wording or OCR, and the Worker must choose from a limited set of retrieved pages. A relevant passage may still be only adjacent to the question. Answers can omit nuance, blur differences among authors, or format lists and other Markdown unevenly. A highlight can be located correctly yet be incomplete or only indirectly support its claim.

Broader knowledge can help explain and connect ideas beyond what the library directly states. The response should keep that context distinguishable from claims grounded in the books, and readers should check important claims against the cited passages and original pages.

Current work focuses on reusable pipeline behavior rather than fixed answers for known questions: finding and preserving useful evidence across question parts, checking claims against source text, and producing coherent explanations. Evaluation should continue with varied questions and separate human review of answer quality from automated structural checks.

**Guiding principle:** use AI to help readers find, question, and understand the books, while keeping the books themselves at the center.
