# Reader release checklist and public-hosting handoff

This is a release checklist, not a claim that an AI answer is semantically correct or a plan to retune models. The stable repository overview remains in the root README.

## Local reader acceptance

Use the local server at `http://127.0.0.1:8765/` and the separate testing view at `/developer`.

- **Reader journey:** select Aristotle's *Nicomachean Ethics*, ask one ordinary question, click a [S#] citation, inspect a highlighted page, move to a neighboring indexed page, return to the conversation, and ask a genuine follow-up.
- **Scope change:** switch to another available book and then to across-library mode. Confirm old conversation turns are cleared when the reading scope changes, but not when closing a source page.
- **Failure recovery:** with Ollama stopped or unreachable, submit a question and verify the original prompt is restored for editing/retry instead of being silently lost. A fallback explanation must not be added as authoritative context for the next question.
- **Desktop and mobile:** inspect the reader at desktop width and an emulated phone width in Chrome Device Toolbar. Check source text overflow, Book Lite navigation, page buttons, prompts and spacing. Mobile simulation is not a test on a physical device.
- **Developer workspace:** confirm `/developer` exposes the model, pipeline, diagnostics, benchmark picker and regression controls. The ordinary reader must not display development options or the technical footer.

## Five-disciplines smoke review

The existing checked-in cross-disciplinary fixture has **eight cases across four disciplines**: science, history, literature and philosophy. Religion is not a separate case in that suite. For a small fifth-discipline manual check, choose a locally installed religious text and ask a question about its own argument or teaching. Record the exact work, physical PDF pages, whether the answer cites that work, and whether the interpretation is supported. Do not imply passing structural contracts independently verifies reasoning.

For a bounded sample, use one case from each existing discipline through the Developer Mode question picker, plus the manually chosen religion question. Check each returned book identity, citation page, whether the cited passage actually addresses the question, and whether any important objection or qualification was lost. Stop and file one reproducible issue for any material failure rather than starting an open-ended answer-quality build campaign.

## Deployment readiness: work for v1.8

The current application is **local-only**: `app.py` binds to `127.0.0.1`, calls Ollama on a local port, reads `data-v47` shards and postings from the local filesystem, and serves HTML and JSON from one Python process. It does not have a hosted inference service, remote corpus layer, or multi-user workload management.

Before offering a public chat service:

1. Choose realistic inference hosting and measure actual cost, throughput, token limits, response time and model availability before claiming a free-tier solution.
2. Make catalog, term index and compressed source-page access work in a remote storage model without loading the entire corpus into each request.
3. Restrict or remove model-selection, benchmark, raw diagnostic and development-only behavior from public APIs. Hiding controls at `/` is **not** access control. Avoid returning internal filesystem details and provider errors.
4. Add request-size bounds, per-user rate limiting, concurrency controls, abuse handling, bounded processing time, and clear resource quotas.
5. Plan privacy practices for reader questions, third-party AI processing, logging/retention, and any hosted data sources.
6. Measure cold starts and load with real indexed texts, verify citation/book IDs across works, and handle provider outages with an understandable retry path.
7. Confirm legal and operational suitability of serving each work and its original PDF/source text from a public endpoint.

Only the **structural checks** run offline in CI. Human review on real books, physical device checks, actual hosted inference capacity and public security verification remain release gates rather than assumed completed work.
