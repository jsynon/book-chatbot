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

The public companion is a pilot for the full collection. Current work evaluates retrieval and generated answers across different disciplines, then uses those results to guide general improvements. The retrieval benchmark checks source discovery and page identity without making AI calls; the separate live answer evaluation checks end-to-end responses and citations.

Search may miss a useful passage because of wording, OCR quality, or the limits of selecting a small set of pages. Even when the cited page is correct, the model can misread or overstate what it says. Compare important claims with the passage and original page.

For broad All Books questions, the browser sends up to 24 hydrated candidate pages across four books to the Worker. After verifying their published fingerprints, the Worker uses one model call to select at most six relevant pages for composition. This adds one selection call and keeps retrieval, evidence selection, answer composition, and review visible as separate stages; it does not force a fixed source list.

The reviewer identifies which claim or claims directly answer each question part. The Worker checks that every nominated claim belongs to that part; cited claims must survive exact source-span, attribution, and negation review. Uncited nominations remain under the existing part-level context review. The first sentence is a candidate, not a mandatory answer, so a later claim can answer the question when it passes review. This uses the existing review call and does not add a topic-specific route.

If a review response omits a decision for a cited source but otherwise returns normally, the Worker records a recovered, fail-closed partial decision for that citation. The omitted source cannot support a claim; independently reviewed claims and sources remain usable. Review inference has a longer timeout than composition because its packet contains claim-by-source evidence checks. A timeout still leaves the answer unverified rather than treating it as reviewed. The composer also answers from broader knowledge when retrieved passages are adjacent to the question, while keeping those explanations distinct from source-derived claims.

Evidence selection suppresses near-identical passages across edition or anthology records only when the page text strongly overlaps and the titles identify the same work. Distinct translations and materially different passages remain available; explicit Bible translation comparisons bypass cross-translation suppression.

**Guiding principle:** use AI to help readers find, question, and understand the books, while keeping the books themselves at the center.
