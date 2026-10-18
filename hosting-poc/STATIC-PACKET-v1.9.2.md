# v1.9.2 — Static packet CPU comparison (private, AI-free)

**Observed:** the v1.9.1 production Worker successfully returned real Thucydides PDF page 38 from GitHub Pages five times (wall times 259, 51, 47, 56, 39 ms), but Cloudflare dashboard showed **P90 CPU 24.35 ms**, exceeding the 10 ms Free-plan allowance over a very small sample. We should not enable public AI with a CPU-heavy lookup.

**Hypothesis to test, not yet a result:** precomputing short, versioned, uncompressed packets of 32 original PDF pages each could greatly reduce CPU versus decompressing/parsing the 280,699-page manifest and whole-book shard. A packet still preserves the underlying page text and canonical PDF link. The first experiment involves **only Thucydides, book ID 152, physical page 38**.

## Two repositories, two narrowly scoped PRs

1. `antilogicalism-library-data` contains the offline packet generator and a manual **Publish reader pilot packet** GitHub Actions workflow. Merging its PR does not run the publication workflow or modify existing v47 source files. When manually triggered, it creates `reader-packets-v1/books/152/1.json` for physical pages 33–64, with text and metadata taken directly from the existing v47 gzip corpus, and commits only this one packet.
2. `book-chatbot` adds `POST /internal/packet-probe` to the **existing disabled** public-foundation Worker. This new route requires the current private `SOURCE_PROBE_TOKEN`, rejects browser-originated calls, fetches and checks the packet schema and original page locator, and returns source information without invoking any AI. The old `POST /internal/source-probe` remains intact as a baseline.

## Test sequence (keep the entire setup on Free)

After the PRs are merged:

1. Open `jsynon/antilogicalism-library-data` → **Actions** → **Publish reader pilot packet** → **Run workflow**. Wait for the workflow and GitHub Pages deployment to finish.
2. Check the packet URL: `https://jsynon.github.io/antilogicalism-library-data/reader-packets-v1/books/152/1.json`. It must return JSON with `schema: antilogicalism-reader-packet-v1`, `libraryVersion: 47`, `bookId: "152"`, and a page 38 record. Don't republish or delete any `data-v47/` files.
3. Update the existing **separate disabled** `antilogicalism-companion-public` Worker by running `npx.cmd wrangler deploy --config hosting-poc/wrangler.source-probe.jsonc` in `D:\Downloads\book-chatbot`. This leaves `PUBLIC_ENABLED=false`; it does **not** modify the protected `antilogicalism-companion-test` Worker or require an AI binding. The previously created encrypted `SOURCE_PROBE_TOKEN` binding must still be configured on that Worker; verify it is present in Cloudflare Settings after deployment.
4. In the PowerShell session holding the same private `$token`, test the new route:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://antilogicalism-companion-public.jsynon.workers.dev/internal/packet-probe" `
  -Headers @{ Authorization = "Bearer $token" } | Format-List
```

5. If that succeeds, run a few authenticated packet probes and compare the **CPU Time** percentiles and Exceeded Resources errors in Cloudflare Metrics against the original source-probe route. `wallElapsedMs` is useful for responsiveness, **not** the 10 ms CPU budget. Repeat baseline and packet runs in separate short intervals so the dashboard aggregation isn't misleading.

## What constitutes success

A valid result has the same book ID 152, physical PDF page 38, global page index ID **34403**, correct original Google Drive PDF link and readable passage. It uses no AI neurons and does not enable public access. The new packet path must be **comfortably below 10 ms CPU** across representative repeated requests before expanding. We should also assess memory and GitHub Pages publishing footprint when considering all ~280,699 indexed pages, rather than mass-export the library prematurely.

These packets are signed by neither a cryptographic verifier nor the model, but they are generated from the canonical user's v47 data repo and retrieved over HTTPS from the fixed owner-controlled URL. The Worker validates their schema and source IDs; claim-level factual entailment remains separate.

**No root README or live website changes. No new billable resources.**
