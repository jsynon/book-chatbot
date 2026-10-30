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

This adapter is **saved-trace import**, not an alternate local implementation of the Worker. It diagnoses stage and evidence handoffs; it does not establish production parity or semantic quality. Keep the Worker as the canonical implementation of live retrieval, evidence ranking, source fingerprints and citation contracts. Do not copy its ranking heuristics into Python.

## 5. Source-reviewed pipeline comparison

The active paths were compared against the repositories' main revisions on 2026-10-30: website `9c81d04` and Worker `6a5c816`. The comparison below records where their behavior differs; it is not a claim that one model or answer is better.

| Stage | Public live path | Local workbench `evidence` path |
|---|---|---|
| Planning | A planner call supplies the public path's structured question and source plan. A separate gap-planning call is conditional on weak retrieval coverage. | Ordinary questions go directly to retrieval. On questions classified as genuinely hypothetical, the conceptual plan uses the first call in place of evidence selection. |
| Candidate retrieval | Browser retrieval produces a bounded pool (24 candidates across four books in baseline; up to 48 across six books in the evaluation-only expanded profile). | `PassageIndex` searches up to 24 candidates and curates navigation matter before selection. |
| Evidence packet | The public deterministic selector ranks pages and sends at most six to the Worker, subject to request/source byte limits and fingerprint checks. Authenticated `compare-selection` can compare a model-selected packet from that *same* candidate pool; it remains evaluation-only. | A model selects up to six anchor passages. The workbench can add up to three nearby context passages, within a 17,200-character evidence budget, before writing. |
| Answer and checks | The Worker composes an answer and makes a separate claim/evidence review call; deterministic citation and source-integrity checks also run. | One composition call follows selection. Citation and exact-quote checks are deterministic; there is no separate semantic reviewer. |
| Typical inference calls | Three calls: planning, composition, review; weak retrieval may add one gap-planning call. The paired `compare-selection` experiment adds one selector and a second compose/review pair (three extra calls per question). | Two calls on an ordinary evidence-first question (selection and writing). A conceptual-planning question still uses at most two, with planning replacing selection. |

The local workbench defaults to corpus v48, while the live evaluation is on v49. Before comparing answers, configure the workbench for v49 and verify the source packet itself: matching a book/page identifier is not enough if the underlying page text differs.

## 6. Next controlled experiment: replay a fixed live evidence packet locally

The existing authenticated `compare-selection` workflow already tests whether model selection improves the six-page packet while holding the retrieved candidates constant. Its results do not justify changing the public default by themselves. The next unresolved comparison is answer composition: the workbench and Worker currently receive different evidence packets, and their answer/review stages differ.

Add a **local-only fixed-packet replay** that takes the exact `submittedSources` from a saved live artifact and invokes only the workbench's existing composer. It must bypass local retrieval and selection, preserve page order and citation identities, and fail closed if the corpus version or source text does not match. Record hashes for the ordered question, source IDs/pages, and source text so a replay can be shown to use the same inputs. Keep private trace files and full passages outside the public website repository.

Compare the local draft with the Worker composition draft first, since those are the two unreviewed composition outputs. Show the final reviewed Worker answer as a separate production outcome; the workbench has no semantically equivalent review stage. Record model, prompt/build, corpus, byte and character counts, and latency for both. Score both manually on the existing five dimensions (accuracy, question coverage, explanation quality, citation support, citation completeness). Do not infer quality from structural status, citation counts, or a review model's label.

This replay is an offline diagnostic, not a new public path. It makes one local model call and no Cloudflare call, does not change prompts or evidence limits, and does not add question-specific routing. First use a small mixed set of already-run cases; keep the acceptance set frozen. Only after the replay shows whether the difference comes from packet content or composition should a runtime change be considered.

## Validation

```powershell
py -3 -m unittest discover -s tests
node --test hosting-poc/*.test.mjs
```

Verify that the generated HTML can be opened offline, unknown trace fields do not crash the comparison, and public deployment files remain unchanged.
