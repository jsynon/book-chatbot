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
