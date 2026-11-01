# Offline trace comparison

The Python/Ollama workbench and the public Cloudflare Worker do not execute the same code. The tools here compare saved artifacts and replay a fixed evidence packet locally; they do not make the workbench production-equivalent.

## Keep evaluation artifacts private

The live website's authenticated evaluation workflow can save Worker planning, retrieval, answer, and review traces. Store downloaded artifacts and generated reports outside the public repositories. Do not commit private traces, credentials, full source packets, or unreviewed answers. Preserve each original artifact unchanged.

For a useful comparison, record the question, book scope, corpus version, Worker source revision, model, pipeline mode, and workflow run. If those inputs differ, the comparison cannot isolate a single cause.

## Compare saved traces

From the repository root:

```powershell
py -3 scripts/compare_traces.py .\private\local-case.json .\private\worker-case.json --output .\private\comparison.json --html .\private\comparison.html
```

Open the HTML report locally. It lists discovered JSON fields and stage-by-stage differences without assuming that the Worker and local schemas match. It does not rerun retrieval, call Ollama, or contact Cloudflare.

Credential-related field names are excluded, but this is not a complete sanitizer. Source text and nested metadata may remain sensitive, so keep both outputs private. The report intentionally avoids dumping complete answers and page text.

## Replay a fixed Worker packet locally

`scripts/replay_fixed_packet.py` takes an extracted live evaluation artifact, verifies that it uses library v49, joins the saved Worker evidence to the local v49 corpus, and checks page fingerprints and composition windows before making one Ollama call. It bypasses local search and selection. It makes no Cloudflare request and refuses to write its report inside this repository.

```powershell
py -3 scripts/replay_fixed_packet.py .\private\worker-report.json --case-id <case-id> --output ..\private\replay.json --model gemma3:12b
```

Use a case ID from the artifact. The input must include the authenticated evidence trace and submitted source metadata. Older artifacts without canonical page hashes are not replayable. Keep the input and output private.

Compare the local draft first with the raw Worker composition response. Show the final reviewed Worker answer separately because the local workbench has no equivalent semantic review stage. The packet is fixed, but the models, prompts, plan context, and output checks still differ. Treat this as a diagnostic comparison, not exact parity.

## Review answer quality

The local cross-disciplinary review tool supports human scoring of accuracy, completeness, explanatory value, citation support, and readability:

```powershell
py -3 scripts/review_cross_discipline.py --output <private-report-directory>
```

This local rubric uses 0–3 scores. Live workflow labels and score scales may differ; preserve each report's own rubric and do not compare the numeric totals as if they were on one scale. Inspect cited spans and original pages. Structural pass rates and model reviewer decisions are not substitutes for answer-quality review.

## Pipeline comparison snapshot

The table below records a source-reviewed comparison of particular repository revisions from October 30, 2026. It is a historical snapshot, not a guarantee of current limits or behavior. Check the live repositories and run metadata before using the values to interpret a new artifact.

| Stage | Public Worker snapshot | Local workbench snapshot |
|---|---|---|
| Planning | A planner call structures the question; a gap-planning call may run when retrieval coverage is weak. | Ordinary questions go directly to retrieval. Some hypothetical questions use a planning call in place of evidence selection. |
| Candidate retrieval | Browser retrieval returns a bounded set of pages and books. | `PassageIndex` searches candidates and curates navigation matter before selection. |
| Evidence packet | The Worker verifies pages against published fingerprints, then selects a bounded answer packet. | A model selects anchor passages and the workbench may add nearby context passages. |
| Answer and checks | The Worker composes an answer, reviews claims and evidence, and runs deterministic integrity checks. | A composition call follows selection; citation and quote checks are deterministic, without a separate semantic reviewer. |

The public corpus was v49 and the local workbench default was v48 at the time of that snapshot. Matching book and page IDs alone do not prove that the page text matches; compare corpus versions and fingerprints.

## What the comparison can establish

Saved-trace comparison can locate a difference in planning, candidate handoff, selection, composition, or review. Fixed-packet replay can help isolate answer composition after evidence is held constant. Neither tool establishes semantic truth or production parity. Review source relevance and answer quality separately, and keep unseen acceptance questions frozen.

