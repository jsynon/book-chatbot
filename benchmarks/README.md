# Local cross-disciplinary benchmark

This folder contains an **offline evaluation workbench for the local Python/Ollama app**. Its eight fixed questions in [cross-disciplinary-v1.json](cross-disciplinary-v1.json) cover science, history, literature, and philosophy. Seven questions target one catalog book; a Nietzsche–Kierkegaard control checks retrieval across two works.

This benchmark is separate from production. It does not exercise the deployed Cloudflare Worker, the website's live retrieval path, or the GitHub live-answer workflows. Use the website repository's `reading-companion-live-answer-evaluation.yml` for live-answer checks and `reading-companion-holdout-answer-evaluation.yml` for the seven-question reviewed holdout. A local benchmark pass cannot establish that the live pipeline works, and live workflow results should not be recorded as results from this local fixture.

The questions are evaluation fixtures, **not answer keys or production retrieval boosts**. Do not put expected interpretations into prompts. Each case starts with an empty chat history and uses the same local baseline unless you are deliberately running a separate experiment.

## Run cases

From the repository root, with Ollama running and the local app started:

```powershell
python scripts\run_cross_discipline.py --list
python scripts\run_cross_discipline.py --case science-darwin-selection
python scripts\run_cross_discipline.py --case history-thucydides-causes
python scripts\run_cross_discipline.py --summary
```

Listing does not call Ollama. A selected case makes up to **two local Ollama calls** and saves a full JSON report under `reports/cross-disciplinary-v1/`. Existing reports are preserved unless `--rerun` is supplied. Cases run sequentially. When ready for all eight, `--all --resume` runs only cases without saved reports. Reports include the question, build, model, elapsed time, cited passages, citation and integrity findings, retrieval trace, and blank human-review scores. The reports directory is gitignored because it contains full transcripts. `--summary` groups results by build and discipline, reports timing and structural source checks, and averages scores only for reviewed answers.

The local page also has a collapsed cross-disciplinary question picker. Choosing a case selects its assigned book and fills the question field; it does not submit until **Ask** is clicked. Troubleshooting mode can download a diagnostic JSON for one chat.

## Review answers

Score each answer manually from 0 (serious problem) to 3 (very good):

| Criterion | Review question |
| --- | --- |
| Accuracy | Does the explanation faithfully reflect the source work? |
| Completeness | Does it cover every requested concept or episode? |
| Explanatory value | Does it connect ideas and causes rather than list facts? |
| Citation support | Does each linked passage support the claim beside it? |
| Readability | Is the answer organized, clear, and concise enough? |

For science, check the mechanism and separate historical claims from modern consensus. For history, separate chronology from an author's causal account, speeches, hearsay, and personal judgment. For literature, distinguish narrator and character from the author and cite scenes rather than generic commentary. For philosophy, check technical distinctions, qualifications, objections, and whether a reconstruction is clearly labeled.

## Interpret automated checks

The script checks assigned book IDs, citation markers, Google Drive URL shape, physical PDF page references, distinct PDF identities, and call count. These are provenance and structure checks. They do not fetch or read the linked PDF page, and they do not establish semantic support. OCR can be imperfect, and a fluent answer with structurally valid citations can still be wrong. Human scores remain blank until a person reviews the answer.

`python scripts/audit_cross_discipline_sources.py` downloads the seven original v47 single-book shards to a temporary directory, checks catalog/PDF identities, and prints sample passages found by the local lexical index. It makes no Ollama calls. This network-dependent audit is separate from offline CI; its output is useful for spotting discovery and ranking problems, not for grading answer quality.

Use results to localize failures to discovery, selection, interpretation, citation, or presentation. Prefer one general change supported by more than one case, keep the local call budget visible, and inspect saved traces before broad evaluation runs. This benchmark informs local-app work; validate production changes with the website's live workflows.
