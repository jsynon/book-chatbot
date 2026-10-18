# Cross-disciplinary evaluation of the Reading Companion

The Reading Companion must be a **reading aid for the entire Antilogicalism library**, not only a philosophy chatbot. The benchmark in [cross-disciplinary-v1.json](cross-disciplinary-v1.json) contains **eight fixed questions**: two each from science, history, literature, and philosophy. The seven one-book questions bind to existing catalog book IDs. The Nietzsche–Kierkegaard control deliberately tests bounded retrieval across multiple works.

The questions are evaluation fixtures, **never answer keys or production retrieval boost rules**. Do not copy expected interpretations into model prompts. Each question starts with an empty chat history and uses the same baseline model/pipeline unless you deliberately run a separate experiment.

## Run one question at a time

From your **D:\Downloads\book-chatbot** directory in PowerShell, with Ollama running and start.bat already started:

\`\`\`powershell
python scripts\run_cross_discipline.py --list
python scripts\run_cross_discipline.py --case science-darwin-selection
python scripts\run_cross_discipline.py --case history-thucydides-causes
python scripts\run_cross_discipline.py --summary
\`\`\`

The script **lists questions without running Ollama** by default. Running a selected case invokes up to **two local Ollama calls** and saves one full JSON report under reports/cross-disciplinary-v1/. If the report already exists, it is preserved; use **--rerun** to replace it. Tests run sequentially, never concurrently. When ready to run the entire suite, **--all --resume** runs only unanswered cases. Reports contain question, build, model, elapsed seconds, actual cited original passages, citation/integrity findings, retrieval trace, and **blank human-review scores**. The entire reports/ folder is gitignored to keep full transcripts out of the public code repository.

The reader's local web page also has a **collapsed cross-disciplinary question picker**. Select a question to switch to its assigned book and populate the question field; the page **never sends the question until Ask is clicked**. Enable troubleshooting to download a diagnostic JSON from an individual chat.

## What to review (not computed automatically)

Score each question manually from 0 (serious problem) to 3 (very good) in these five areas:

| Criterion | Key question |
| --- | --- |
| Accuracy | Does the explanation faithfully reflect the actual work? |
| Completeness | Does it cover all requested concepts or episodes? |
| Explanatory value | Does it connect ideas and causes rather than listing facts? |
| Citation support | Do the linked passages support the specific assertions, not merely share vocabulary? |
| Readability | Is it organized, clear, and sufficiently concise? |

Specific considerations differ across the disciplines.

**Science:** check the mechanism, definitions, and distinction between observations, models, theoretical predictions, and speculation. Avoid attributing modern knowledge to the historical author, and do not confuse a citation to Hawking or Darwin with proof of scientific consensus.

**History:** distinguish event chronology from an author's causal interpretation; identify reported speeches, hearsay, contested traditions, and the historian's personal judgment. A primary-source narrative is evidence of what the author *said*, not automatically what happened.

**Literature:** distinguish speakers and narrators from the novelist, trace how a character or theme develops, and cite original scenes rather than generic introductions or criticism. Literary interpretation may be arguable; it should nevertheless have concrete textual support.

**Philosophy:** connect technical concepts faithfully, recognize objections and qualifications, and identify hypothetical reconstruction as such rather than historical fact. Preserve differences between two authors' own source passages.

## What automated checks can and cannot establish

The benchmark records source book IDs, citation markers, verified-looking Google Drive URL formats, physical PDF page references, distinct PDF identities within each response, and the model call count. For one-book tests, citations must belong to the assigned book. For cross-author tests, citations must represent both author groups. Those are **structural** checks. They do not independently fetch a PDF page or prove that a claim is semantically supported. Some PDF previews ignore page anchors, and OCR errors remain possible.

A fluent, fully cited answer could earn zero for accuracy. A provenance pass is **never** an automatic human-review pass; the report's human scores remain null until someone reviews it.

## How to use results to guide development

Collect one or two representative runs first, starting with **Darwin, Thucydides, and Dostoevsky**, then inspect those reports before running all eight. They exercise different failure types: scientific mechanisms, historical causation, and character/author distinction.

Separate failures into:

1. **Discovery:** the correct work or relevant passage never appeared.
2. **Selection:** relevant passages were retrieved but omitted from the answer context.
3. **Interpretation:** the model received the right passage and misunderstood it.
4. **Citation:** an answer uses a real but irrelevant or wrongly attributed source.
5. **Presentation:** it is overly verbose, confusing, or incomplete.

Prefer one general improvement that helps multiple subjects. Avoid rules tailored to Darwin, Thucydides, or Raskolnikov. Keep the one-book live demo stable, preserve the two-call budget, and account for mobile browsing and eventual deployment on an Antilogicalism website page.

The baseline is **Gemma3:12b**, Evidence-first, using the existing v47 source repository. The benchmark is not a contest between installed models.
