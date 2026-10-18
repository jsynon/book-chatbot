# v1.9.0 — Public Hosting Foundation (NOT YET PUBLIC)

This folder adds a **separate, fail-closed Cloudflare Workers Free gateway** in `public-gateway.mjs`, with offline security contract tests and a commented, **non-deployed** Wrangler example. It does **not** change the live Antilogicalism GitHub Pages website or the existing private `antilogicalism-companion-test` Worker. Do not remove the current private test token or binding.

## What has changed

- The new public endpoint is `POST /api/answer`. No one can invoke AI through it unless `PUBLIC_ENABLED` is explicitly `"true"` and ALL required bindings exist. Its default is disabled.
- A browser submits `{question, turnstileToken, sources:[{bookId,page}]}` and **does not supply citation URLs, titles, or passage text**. The Worker fetches v47's trusted manifest and compressed book shards from the existing GitHub Pages data repository; it reconstructs the original PDF links and excerpts from the source itself and rejects unrecognized locators.
- Each enabled request must pass a per-visitor and global Workers Rate Limiting binding, a **server-validated**, single-use Cloudflare Turnstile token, a strict hostname and Turnstile action check, and bounded request validation **before** any model inference.
- The existing hosted **two-call** evidence selection and grounded composition concept remains. Citation IDs refer only to server-retrieved pages. It still **does not prove factual/claim-level entailment**.
- Missing services or free AI capacity produce graceful errors without enabling paid inference. CORS and Turnstile are not absolute abuse prevention; rate limiting is eventually consistent, not a hard budget ledger.

## Free-tier architecture and constraints

Published website: `https://jsynon.github.io/antilogicalism/` (existing Book Lite header/menu/footer, **no separate website**). Published corpus: `https://jsynon.github.io/antilogicalism-library-data/data-v47/`. Planned public gateway is a **separate Worker**, not the current private experiment.

Relevant current Cloudflare documentation:

- [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/): 100,000 requests/day, **10ms CPU per request**, 50 subrequests per request. The 10ms CPU budget is an **unverified feasibility risk** for fetching, decompressing and parsing v47 books. **Measure it before turning on public requests.**
- [Workers AI Free limits](https://developers.cloudflare.com/workers-ai/platform/pricing/): 10,000 neurons/day; Free plan stops inference when the daily allocation is exhausted. **Keep the account/Worker on the Free plan; do not upgrade or activate paid billing.**
- [Turnstile](https://developers.cloudflare.com/turnstile/get-started/) and [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): tokens expire in five minutes and are single-use; only server-side validation counts. The production Turnstile widget must be configured for hostname `jsynon.github.io`, action `companion_ask`.
- [Workers rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): requires **Wrangler >=4.36** to configure; these bindings are not currently visible in the Dashboard. Limits are eventually consistent and don't guarantee strict global daily accounting.

## Safe, non-deploying tests

From the local `D:\Downloads\book-chatbot` repository:

```powershell
node --test hosting-poc/public-gateway.test.mjs
```

GitHub Actions also runs these tests on the PR. They use a tiny synthetic, gzip-compressed v47 manifest and pages plus mocked Turnstile/AI; **they do not establish that the Worker fits 10ms CPU, actually reaches live v47 data, or is safe for public use**.

## Future Cloudflare setup — only after the next check

1. Keep `antilogicalism-companion-test` and its `TEST_TOKEN` untouched. The separate proposed service name is `antilogicalism-companion-public`.
2. In Cloudflare Turnstile, create a **free managed widget** for `jsynon.github.io`; the *sitekey* can appear in the future public browser page. **The Turnstile secret must be kept as a Cloudflare encrypted Worker secret named `TURNSTILE_SECRET`**, never placed in GitHub code or chat.
3. To configure the two Rate Limiting API bindings, use modern Wrangler (`npx wrangler`). Copy `hosting-poc/wrangler.public.example.jsonc` to a personal `wrangler.jsonc` in the repository root and review its values. Its namespace IDs are **illustrative**, not allocated by us. `PUBLIC_ENABLED` must stay `"false"` until a real protected source fetch can complete within free CPU limits.
4. Deploy the **separate disabled Worker** only after verifying it is using Free; its health endpoint should show `publicEnabled:false`. Without the Turnstile secret the public endpoint correctly fails closed. Never change the existing protected Worker as part of this setup.
5. Once independently tested against live v47 data with a private trusted-source probe and CPU telemetry, add a Book Lite-styled `/antilogicalism/reading-companion/` GitHub Pages page using Turnstile with action `companion_ask`, and explicitly enable the gateway as the last step.

**No public enabling, Turnstile key creation, Wrangler deployment, or website changes were carried out by this PR.** This is an intentionally bounded infrastructure and contract milestone.

## Work remaining before public launch

- Confirm trusted v47 retrieval and gzip decompression can run inside Workers Free's 10ms CPU limit. If not, publish a small *static, precomputed trusted source lookup* in the already-free library-data repository and have the Worker fetch exactly the bound evidence packets rather than large book shards.
- Enforce accurate provenance against the real remote corpus and inspect actual returned PDF page links; test source failure and 429/503 cases with real services.
- Create the Book Lite-styled reader page in the **existing** Antilogicalism site and ensure Turnstile tokens are reset after each submit.
- Test several disciplines (philosophy, history, science, literature) with realistic questions, and check evidence sufficiency and quotation/citation accuracy; do not repeat a 160-build quality-tuning campaign.
