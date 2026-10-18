# v1.8.1 — Remote library retrieval smoke test

This directory contains a **read-only, development-only prototype**. It does not run a hosted LLM, produce AI answers, replicate the local evidence-first pipeline, or publish an Antilogicalism menu item. Its purpose is to verify that a browser can reuse the public v47 compressed corpus from `antilogicalism-library-data` without paid storage.

## Run locally

From the `book-chatbot` repository root:

```powershell
python -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/hosting-poc/` in a modern browser. The sample question is *What caused the Peloponnesian War?*; replace it with other subjects or supply a numeric book ID (e.g. `152`) for a book-specific test. The prototype loads the published `manifest.json.gz`, only the term partitions needed by the query, and at most two compressed book shards. It shows physical PDF page numbers and links instead of claiming to provide verified interpretation.

`node --test hosting-poc/remote-library.test.mjs` runs five offline tests against synthetic gzip fixture data; GitHub Actions runs them automatically. These tests **do not establish that remote GitHub Pages is reachable, that CORS is configured, that retrieval is relevant or that hosted AI works**. Those require the manual browser smoke and subsequent model work.

Note down the result count, timing, quoted preview quality and any console/network error (including CORS). GitHub Pages can already read v47 from the library search page; this isolated prototype must still be tested in the intended browser context.

## Deliberate limits

The retrieval here is intentionally **basic lexical ranking**, not a port of Python's richer source-form filtering, semantic interpretation, citation binding or context reconstruction. It can retrieve index pages, OCR-corrupted text or partial-page excerpts; no model answer should be generated from it directly without a stronger evidence selection/validation stage. A preview ending in an ellipsis is a clipped display excerpt, not a claim that the entire PDF page ends there. Only source metadata and physical pages present in the remote shard/manifest are linked.

**Next gate:** test a model's structured two-call response and quota consumption through a deliberately restricted Cloudflare Workers Free proof of concept, with source validation and no automatic paid overages. This requires the maintainer to create/enable the free Cloudflare services, and may require an account even when the service is free. Never put provider credentials in browser JavaScript or commit them to GitHub.

## v1.8.2 — Protected hosted AI evidence experiment

This is a **manual, private-token smoke test**, not a public chat service. Its Worker API accepts short browser-supplied excerpts; **it does not yet independently verify them against the v47 corpus**, meaning citations are not tamper-proof or claim-verified. The local two-call evidence-first Python system remains the quality reference.

1. In Cloudflare Workers & Pages, open `antilogicalism-companion-test` → **Edit code**. Replace the Worker code with the contents of `hosting-poc/worker-grounded-test.mjs` and **Deploy**. Retain the existing `AI` binding and encrypted `TEST_TOKEN` secret; do not paste either token value into source code.
2. Confirm that visiting the Worker root returns `mode: protected-grounded-test`. A request to `/grounded` with no token must return `401`, and the normal GET root must not run inference.
3. Run `python -m http.server 8766 --bind 127.0.0.1 --directory "D:\\Downloads\\book-chatbot"` on your own computer. Open **http://127.0.0.1:8766/hosting-poc/grounded-test.html**. Enter your private token **only into the password field in this locally served test page**; never share it in a chat, screenshot, commit, or public web page.
4. Click **Find passages and test AI** with the preset Peloponnesian War question. It retrieves two real source-page excerpts from the public v47 GitHub Pages data and POSTs them through the authenticated Worker. Compare every claimed cause to its actual cited excerpt and record `finishReason`, `citationReview`, reported neurons, and any 401/403/503 errors.
5. Do **not** put this demo on the public Antilogicalism site or remove authentication. Rotate `TEST_TOKEN` if exposed. For production, evidence must be validated by trusted retrieval, usage caps/rate limits must be enforced independently of CORS, source binding and claim support must be checked, and the complete two-call evidence-first pipeline must be restored.

The request is capped to four excerpts of at most 1,200 characters each; currently the browser sends two. CORS allows only the **local test origin** on port 8766, and the Worker requires the private token. Neither CORS nor a manually shared token constitutes public deployment security. No paid services are required for this experiment. Run the offline checks with `node --test hosting-poc/worker-grounded-test.test.mjs`.

**Expected limitation:** Gemma may still invent, omit, or misattribute claims. The presence of valid `[S1]` syntax alone is not evidence entailment. This POC is only intended to measure whether a remote library passage can flow into free hosted inference and return a checkable answer.

## v1.8.3 — Two-call evidence-first private test

The previous hosted response had a valid Thucydides page-38 citation, but the retrieved short previews did not adequately explain the deeper cause. This experiment fetches up to three pages of the best-ranked book (rather than two) and asks the Cloudflare model to perform **two separate, bounded inferences**.

- Call 1: assess full/partial/no evidence coverage and select at most four *verbatim quotations* from the retrieved excerpts. The Worker accepts a quotation only if it is a contiguous text match in the supplied excerpt after whitespace normalization. Failed or unparseable evidence review stops the synthesis rather than pretending validation succeeded.
- Call 2: compose the answer from the selected pages and matching quotations, explicitly reporting missing evidence when partial. The local page displays coverage, rejected quotations, finish reasons, and total neuron usage.

This is **not** the full local two-call pipeline, and it does not prove semantic correctness. A quote may match perfectly while still being irrelevant to a claim; browser-provided excerpts and metadata are still unverified against trusted v47 data. Neither a valid citation ID nor a validated quote is sufficient to establish that the answer is correct.

After merging the PR, replace the Cloudflare Worker's editor code using `hosting-poc/worker-grounded-test.mjs`, deploy, then reload the previously working **http://127.0.0.1:8766/hosting-poc/grounded-test.html** (hard-refresh if cached). Keep the `AI` binding and private `TEST_TOKEN` secret unchanged. Never put the secret in GitHub, code, screenshots, or a public page.

**Success criteria:** The hosted run performs at most two calls, cites only source IDs with verified quotations, explains the limits of an incomplete passage set, and exposes combined neurons. For this particular history question, do not claim complete success unless the actual excerpts substantiate both the immediate events and the deeper explanation. Stop and inspect results before expanding to the public site. Run contract tests with `node --test hosting-poc/worker-grounded-test.test.mjs`.

## v1.8.4 — Reliable source-ID selection

The v1.8.3 real-cloud test accepted zero exact model-generated quotations, despite one seemingly relevant source selection. This patch changes only the evidence-selection contract: reviewer returns source IDs and coverage, and the Worker binds each selected ID to the original client-retrieved text. Invented IDs are rejected. We retain the full/partial/none coverage result even when no IDs are selected, rather than silently relabeling it none. The second call is skipped if no valid source is selected. We **do not** claim that source IDs or source excerpts demonstrate claim-level factual support. The browser continues retrieving three candidate pages and the full site remains unchanged.

Once merged, deploy the updated Worker JS from `hosting-poc/worker-grounded-test.mjs`, refresh the local `/hosting-poc/grounded-test.html`, and repeat one question. Review selected sources, coverage, citation IDs and neuron usage. If it still misses the underlying cause, prioritize retrieval improvements rather than changing prompts repeatedly. Do not publish this private-token test endpoint.
