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

The authenticated `evidenceTrace.evidence` contains the full Worker-verified page text and canonical SHA-256. `submittedSources` supplies the corresponding book/page/global-page IDs plus a short excerpt, which lets the replay join the trace identity to the local v49 shard. The trace also preserves the exact Worker composition request and its selected passage windows, so no extra live run or website artifact change is needed.

Implement `scripts/replay_fixed_packet.py` as a **local-only** command. For each source page, it loads the local v49 shard by book ID, global page ID, and printed page, then hashes the raw page text against the Worker's canonical fingerprint. It extracts the passage-window text from the saved composition request and sends those windows to the existing workbench composer under the same source IDs and order. It bypasses local retrieval and selection, and fails closed if the trace, page, version, hash, or window text is missing or mismatched. The report records question/source/window hashes, sizes, model, call count, and latency without copying source pages into a second artifact. Keep the input trace and output report private.

Compare the local draft with the raw Worker composition response first. Show the final reviewed Worker answer separately because the workbench has no equivalent review stage. The page identities and window text are held fixed, but model, prompts, structured plan context, and output checks still differ; this is a controlled pipeline comparison, not exact token-level parity. Score both manually on the existing five dimensions (accuracy, question coverage, explanation quality, citation support, citation completeness). Do not infer quality from structural status, citation counts, or a review model's label.

This replay is an offline diagnostic, not a new public path. It makes one local Ollama call and no Cloudflare call, does not change prompts or evidence limits in the ordinary path, and does not add question-specific routing. First use a small mixed set of already-run cases; keep the acceptance set frozen. Only after the replay shows whether the difference comes from evidence handling or composition should a runtime change be considered.

Run it against an extracted JSON report with the local v49 corpus and Ollama available:

```powershell
py -3 scripts/replay_fixed_packet.py .\\private\\live-report.json --case-id acceptance-god-is-love --output ..\\private\\god-is-love-replay.json --model gemma3:12b
```

The command refuses to write its answer report inside the public repository. Old artifacts that lack the authenticated evidence trace or its canonical page hashes are not replayable.

## Validation

```powershell
py -3 -m unittest discover -s tests
node --test hosting-poc/*.test.mjs
```

Verify that the generated HTML can be opened offline, unknown trace fields do not crash the comparison, and public deployment files remain unchanged.
