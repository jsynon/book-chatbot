# Reading Companion architecture and development guide

The Antilogicalism Reading Companion helps readers explore the library, understand ideas in context, and inspect the books behind an answer. The public site is a pilot: answers can be useful and still be incomplete or mistaken.

Use the [live Reading Companion](https://jsynon.github.io/antilogicalism/reading-companion/) to ask a question, inspect cited passages, open the original PDF page, and continue with a follow-up.

## Repository boundaries

| Repository | Responsibility |
| --- | --- |
| [antilogicalism](https://github.com/jsynon/antilogicalism) | Website, Bookshelf, Library Search, Reading Companion interface, and live evaluation workflows. |
| [antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data) | Published catalog, indexed book text, search data, source fingerprints, and PDF metadata. |
| [book-chatbot](https://github.com/jsynon/book-chatbot) | Cloudflare Worker API for the public pilot and a separate Python/Ollama workbench for local development. |

The Worker uses shared published library data rather than hosting another full copy of the books. The public Worker and local workbench are separate answer-generation implementations; a local answer is not a direct test of live behavior.

## Public answer path

The public interface searches the published indexes and sends a bounded pool of candidate pages to the Worker. The Worker verifies candidate text against published page fingerprints, selects evidence for the question, composes an answer, reviews the answer, and returns citations the reader can inspect.

The main stages are:

1. **Plan the search.** A model interprets the question and prepares useful search queries and, when needed, answer parts. The question remains the anchor; the plan does not prescribe authors or conclusions.
2. **Find and select evidence.** Browser retrieval gathers candidate pages. The Worker verifies their fingerprints, then a model selects a bounded packet and relates pages to the planned parts. Search matches and part links are retrieval aids, not proof of relevance.
3. **Compose an explanation.** The model writes from the selected passages and may use general knowledge to explain or connect ideas. Claims about a supplied book or author need citations; broader context can be uncited and should remain distinguishable from source-derived claims.
4. **Review and check integrity.** A model reviews coverage, attribution, cited claims, and evidence. Deterministic checks validate source identity, scope, citation IDs, and quote locations. Both model review and text fingerprints have limits: neither establishes that an interpretation is true.
5. **Return inspectable sources.** Cited claims link to passages and original PDF pages. Authenticated evaluation traces preserve stage inputs and decisions for offline diagnosis; ordinary public responses do not expose full prompts, source pages, or raw model responses.

A reviewed public answer normally uses four model calls: planning, evidence selection, composition, and review. Weak retrieval may trigger an optional search-gap planning call. A targeted review repair may add a call when a cited claim or source decision is missing. Post-composition expansion is evaluation-only. These conditional and evaluation paths do not change the reader’s question or source scope.

The public site and Worker live in separate repositories. Keep their shared plan and citation contracts aligned when either copy changes. The deployed Worker source revision should be recorded in live evaluation artifacts so a result can be tied to the code that produced it.

## Trust, quality, and evaluation

Structural integrity and answer quality are separate measures. Structural checks can show that a citation points to the intended verified page; they cannot determine whether an answer is accurate, complete, coherent, relevant, or fair to the source. Human review should assess those qualities and check important source-based claims against the passages.

Retrieval can miss useful pages because wording differs or OCR is damaged. A selected passage can still be only adjacent to the question, and a good passage can be summarized poorly. Fingerprints establish correspondence with published text, not OCR accuracy or semantic support. Model review is useful but fallible.

The website repository owns live acceptance and calibration workflows. Use those artifacts to evaluate the public Worker. Keep saved traces private, preserve the original artifact, and record the question, scope, corpus version, Worker revision, and mode when comparing runs. Offline trace comparison and fixed-packet replay help locate differences between stages; they do not establish production parity or answer truth.

Do not tune runtime behavior to a small set of known questions. Use varied development questions to diagnose reusable pipeline behavior and keep unseen acceptance questions frozen for evaluation.

## Code map

| Path | Purpose |
| --- | --- |
| `hosting-poc/public-gateway.mjs` | Worker routes, public request gates, fingerprint verification, and response handling. |
| `hosting-poc/evidence-selector.mjs` | Bounded selection of verified candidate pages and safe fallback behavior. |
| `hosting-poc/evidence-answer.mjs` | Evidence assembly, answer composition and review, citation checks, and evaluation-only expansion. |
| `hosting-poc/reader-contract.mjs` | Worker planning, citation, and source contract. Keep shared behavior aligned with the website copy in `antilogicalism/reading-companion/reader-contract.mjs`. |
| `hosting-poc/*.test.mjs` | Offline Worker and pipeline regression tests. |
| `scripts/compare_traces.py` | Offline comparison of saved local and Worker traces. |
| `scripts/replay_fixed_packet.py` | Local-only replay of a saved, verified Worker evidence packet through the local composer. |
| `scripts/run_cross_discipline.py`, `scripts/review_cross_discipline.py` | Local retrieval benchmark runner and human answer review tools. |
| `app.py`, `grounded_pipeline.py`, `evidence_pipeline.py`, `direct_pipeline.py` | Local workbench and its distinct pipeline experiments. |

Run the Worker checks from this repository:

```sh
node --test hosting-poc/*.test.mjs
```

Run browser, interface, and evaluator checks from the `antilogicalism` repository:

```sh
node --test reading-companion/*.test.mjs
```

Both suites use offline fixtures. They do not replace live model evaluation or human review of source-based answers.

## Local workbench

The Python application uses Ollama and does not call the Cloudflare Worker. On Windows, run `start.bat`; otherwise run `python app.py`, then open `http://127.0.0.1:8765/`. Developer tools are at `http://127.0.0.1:8765/developer`.

For full-library retrieval, keep local checkouts of `antilogicalism` and `antilogicalism-library-data` beside this repository. The workbench currently defaults to corpus v48; configure the version explicitly when comparing against a different published corpus. Run `python local_preflight.py` to check local dependencies and data paths. See [Local workbench setup](local-workbench-refresh.md) and [Offline trace comparison](local-trace-testing.md).

## Documentation guide

- [Local workbench setup and limits](local-workbench-refresh.md)
- [Offline trace comparison and fixed-packet replay](local-trace-testing.md)

**Guiding principle:** use AI to help readers find, question, and understand the books, while keeping the books themselves accessible and central.
