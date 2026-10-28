# Local testing architecture: trace comparison

The local Python/Ollama app and the public Cloudflare Worker **do not execute the same code**. This workflow provides an offline comparison boundary rather than falsely labeling local results production-equivalent.

## 1. Capture representative artifacts

Use the existing local benchmark runner and save its JSON reports under `reports/`. The live website's authenticated evaluation workflow produces separate JSON artifacts with Worker planning, retrieval, answer and reviewer traces. Download or extract those artifacts into a local private folder outside the public website repository. Do not upload secrets, raw session credentials or private evaluation traces into GitHub.

For useful comparisons, record the exact question, book scope, dataset version, model, pipeline mode, source revision, and Worker version. A test with different retrieval or source versions is informative but cannot isolate model-quality differences. Keep the original artifact unchanged.

## 2. Compare offline

```powershell
py -3 scripts/compare_traces.py .\reports\local-case.json .\reports\worker-case.json --output .\reports\comparison.json --html .\reports\comparison.html
```

Open `comparison.html` in a browser. The report shows exact field paths discovered in each JSON, stage-by-stage, and identifies missing or changed metadata. It **does not** re-run search, call Ollama, or contact Cloudflare. It supports differing nested formats without assuming that local and Worker traces have matching schemas.

Common credential-related field names are excluded from the generated report. This is a best-effort filter, **not a complete data sanitizer**: source passage text and some nested metadata may still be sensitive. Keep HTML and JSON outputs local. The report intentionally does not dump the entire answer or full page text.

## 3. Evaluate actual answer quality separately

Use `py -3 scripts/review_cross_discipline.py --output <local-report-directory>` for the existing manual rubric (accuracy, completeness, explanatory value, citation support, readability). Inspect exact quoted spans and original PDF pages. Review status is not inferred from structural pass rates.

The Worker evaluation suite and seven-question development cases remain distinct from the private unseen acceptance set. Do not train or tune against acceptance questions.

## 4. Isolation and remaining integration

This initial adapter is **saved-trace import**, not an alternate local implementation of the Worker. It helps diagnose whether expected stages or evidence handoffs are represented, but does not yet replay identical selected passages to multiple Ollama models, render side-by-side claim-level judgments, or call the Worker implementation directly.

For a later deterministic parity harness, retain the Worker as the canonical implementation of retrieval, evidence ranking, source fingerprints and citation contracts. Use offline Node fixtures from `hosting-poc/*.test.mjs` and `antilogicalism/reading-companion/*.test.mjs`, or export a normalized trace schema with provenance, rather than copying Worker heuristics into Python.

## Validation

```powershell
py -3 -m unittest discover -s tests
node --test hosting-poc/*.test.mjs
```

Verify that the generated HTML can be opened offline, unknown trace fields do not crash the comparison, and public deployment files remain unchanged.
