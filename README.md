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

The public Reading Companion remains a pilot. In the latest five-case handoff validation, all five answers returned and passed structural checks, covering three All Books questions and two selected-book questions. The reviewer returned complete contracts for all five cases and marked all nine question parts answered. These checks confirm that the pipeline returned answers and kept its evidence links connected; they do not establish that every interpretation is accurate or complete.

A separate provisional review of that run scored the answers **8.2/10** on average and the displayed passage excerpts **7.4/10**. These are independent estimates using the five-part quality rubric, not scores recorded by the workflow. The artifact's official quality review remains pending. One answer made a useful but indirect move from memory and identity to Marcel Proust's account of perception and artistic representation. Some answers also still format lists unevenly, and a located excerpt can be clipped or less relevant than the claim it accompanies.

The same five-case run had previously returned a generic HTTP 502 during the Odyssey answer request; the repeat succeeded on the same Worker version and source revision. That shows the failure did not recur on this attempt, but its cause is still unknown. Because this was a repeat of the same questions, it demonstrates repeatability on this small set rather than performance on fresh questions.

The public path separates question planning, retrieval, evidence selection, answer composition, and claim review. The Worker verifies source-page fingerprints and selects at most six pages from a pool of up to 24 hydrated candidates across four books. When retrieved text appears weak for a question part, it may make an additional search-gap planning call. The five-case evaluation estimates 20 core Worker calls, with up to five additional gap-planning calls. The call count and selected passages can vary by question and run.

Review checks whether claims are linked to the requested question part and whether cited spans can be located with the expected attribution and wording. These checks help catch mismatched sources, but they are not a complete semantic judge. Search can miss useful passages because of wording or OCR, and a relevant passage can still support only part of an answer. The model can also overstate a source, blur distinctions among authors, or produce awkward formatting. Compare important claims with the cited passage and original page.

Evidence selection suppresses near-identical passages across edition or anthology records only when the page text strongly overlaps and the titles identify the same work. Distinct translations and materially different passages remain available; explicit Bible translation comparisons bypass cross-translation suppression.

**Guiding principle:** use AI to help readers find, question, and understand the books, while keeping the books themselves at the center.
