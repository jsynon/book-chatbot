# v1.9.3 — Exact-source SHA-256 verification pilot

**Results that motivated this build:** full-book trusted retrieval exceeded Workers Free's CPU headroom (24.35 ms P90 in a small set); plaintext 32-page packets improved to 9.23 ms P90 but remain close to the 10 ms Free-plan budget and duplicate the indexed book text. This experiment publishes only small source fingerprints and asks the Worker to verify browser-supplied text by native SHA-256. **Neither its CPU performance nor full-library viability has been demonstrated yet.**

This is *not* a public AI release. `PUBLIC_ENABLED` remains `"false"`, original protected `antilogicalism-companion-test` is untouched, and `/api/answer` still uses its previous disabled-by-default implementation. The additional `POST /internal/fingerprint-probe` requires `SOURCE_PROBE_TOKEN` and accepts requests only from the local test origin or CLI.

## Two pull requests, staged in this order

1. In `jsynon/antilogicalism-library-data`, merge the v1.9.3 fingerprint-generator PR. Then manually run **Actions → Publish reader fingerprint pilot → Run workflow** to publish one small fingerprint file for Thucydides PDF page 38. Verify the JSON at `https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/books/152/1.json`. A `GITHUB_TOKEN` workflow commit may not automatically trigger a GitHub Pages rebuild; if its file exists on main but the Pages URL is 404, one direct GitHub-web commit to an innocuous README can trigger Pages (as with the earlier reader-packet pilot).
2. In `jsynon/book-chatbot`, merge the v1.9.3 protected-verification PR and pull the changes in GitHub Desktop. From `D:\Downloads\book-chatbot`, deploy the **same disabled public-foundation Worker**, not the original AI testing Worker:

```powershell
npx.cmd wrangler deploy --config hosting-poc/wrangler.source-probe.jsonc
```

The existing encrypted `SOURCE_PROBE_TOKEN` secret should remain on that Worker. Check it in Cloudflare Settings if authentication fails. Don't commit token values.

## One-click local verification

With the existing Python server serving `D:\Downloads\book-chatbot` on port 8766, open:

`http://127.0.0.1:8766/hosting-poc/fingerprint-test.html`

Enter the *current* private `SOURCE_PROBE_TOKEN` into the password field. The page downloads the exact page text from the public v47 original compressed book shard, sends that raw source text (plus numeric book/page locators) to the private Worker, and displays the validated canonical PDF URL returned from the trusted fingerprint record. The page never saves your token to disk.

Run the normal page once: expect HTTP 200 with `status:"verified"`, book 152, PDF page 38, global page 34403. Then check **Deliberately alter one character** and try once more: expect HTTP 422/rejection, not a verified source. The Worker never invokes AI for either test.

A browser gets the original v47 book text as part of normal retrieval, so there is no second copy of that text hosted for Cloudflare. Before publication, the browser's selected page text remains untrusted until the Worker checks its digest. PDF links/titles/page IDs are reconstructed only from trusted fingerprint metadata. A hash match does NOT verify whether an AI-generated explanation is true.

After successful correctness checks, use a small number of authenticated test calls and inspect **Cloudflare CPU Time** in Metrics; wall time includes network waiting and is not a CPU benchmark. Compare carefully against the 10 ms Workers Free CPU budget. No paid tier, credit card, R2 or Ollama host is required.

## Security and scaling notes

- No browser-provided PDF URL/title/citation/global page ID is accepted as authoritative, and SHA-256 is over the *entire original page text*, not the 1,080-character display excerpt.
- A single submitted page is limited to 14,000 UTF-8 bytes; at most three pages totaling 35,000 UTF-8 bytes and a 39 KB JSON body may be submitted. Exceeding these limits fails closed. This pilot page uses one book/page. Oversized real pages will need a separately tested strategy.
- Fingerprint packets are a pinned path under an owner-controlled GitHub Pages domain; they are not digitally signed and do not protect against compromise of the data repo. A mismatch is rejected before AI; source truth still derives from the canonical v47 data exporter.
- The private diagnostic supports CORS only from `127.0.0.1:8766` and `localhost:8766` and still requires a token. CORS alone is not an authentication boundary.
- This version does **not** replace the public `/api/answer` route. Doing so will require real Turnstile validation, both global and visitor rate limit bindings, input and CPU budgets, citation/claim review, and multi-discipline tests before enabling the visitor page.
- Generating ~280,699 pages' fingerprints should occupy far less storage than duplicating all text, but introduces thousands of small files. Estimate output size, GitHub Pages file count/build performance and CPU across several books before bulk exporting the whole library.

Automated offline tests: `node --test hosting-poc/public-gateway.test.mjs`. The tests check valid SHA-256, 1-character tampering, canonical citations, authentication, local CORS and zero AI calls. Root README and live website are unchanged.
