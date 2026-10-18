# v1.9.5 — Reading Companion on the existing Antilogicalism website

This build is a **real static page**, not a new or separate website. The reader page is published from `jsynon/antilogicalism` at `/antilogicalism/reading-companion/`, retaining the existing Book Lite theme, footer and primary navigation. The initial pilot is deliberately limited to Thucydides' *History of the Peloponnesian War*, book 152, physical PDF pages 33–64 (the only published SHA-256 fingerprint chunk so far). Search and passage inspection work even when AI is disabled.

The matching Worker change is in `jsynon/book-chatbot` on the v1.9.5 limited-public-demo branch. It exposes **new, separately gated** endpoints `GET /api/pilot-status` and `POST /api/pilot-answer`. The old private `/internal/verified-answer` and the existing separately deployed private AI Worker are not modified. The old general `/api/answer` stays disabled.

## Stage 1: Publish the page safely

Merge the website and Worker PRs, then pull both via GitHub Desktop. The new GitHub Pages page is immediately functional for inspecting indexed passages and opening PDF citations. **Hosted AI remains disabled** until the owner explicitly configures protection. No AI secret or private `SOURCE_PROBE_TOKEN` is included anywhere in site assets.

Deploy the Worker using the separate, deliberately disabled public-pilot configuration:

```powershell
cd D:\Downloads\book-chatbot
npx.cmd wrangler deploy --config hosting-poc/wrangler.public-pilot.jsonc
```

The config initially says `PUBLIC_PILOT_ENABLED: "false"`, `PUBLIC_ENABLED: "false"` and includes Workers AI plus two native rate-limit bindings. It uses two account-unique numeric namespace IDs (review them if you already use these IDs in other Worker services). It does not enable visitor inference when deployed as-is. The `SOURCE_PROBE_TOKEN` stored in the Worker should persist.

## Stage 2: Explicitly opt in to a *limited* public test

1. In the free Cloudflare Turnstile dashboard, create a widget with hostname **jsynon.github.io**, not the temporary workers.dev address. Copy the **public sitekey** and keep the **private secret key** confidential.
2. In your local `hosting-poc/wrangler.public-pilot.jsonc`, set `TURNSTILE_SITE_KEY` to the public key. The sitekey is not a credential. Do not put the secret key in a config file.
3. In the repository directory, securely set the secret on this **public-foundation** Worker only (Wrangler prompts for secret content interactively):

```powershell
npx.cmd wrangler secret put TURNSTILE_SECRET --config hosting-poc/wrangler.public-pilot.jsonc
```

4. After verifying free quota and binding names, change `PUBLIC_PILOT_ENABLED` to `"true"` in the local config and deploy again using the same `wrangler.public-pilot.jsonc`. **Do not change `PUBLIC_ENABLED`; it must stay `"false"`.**
5. Visit `https://jsynon.github.io/antilogicalism/reading-companion/`; the public site should display a Turnstile widget and allow an answer only after a visitor passes its challenge and selects up to two fingerprint-covered pages.

Cloudflare validates Turnstile token server-side for hostname `jsynon.github.io` and action `companion_ask`. Without a valid secret, sitekey, rate-limit bindings, AI binding and explicit enabled flag, the Worker does **not** offer public AI. The Worker enforces per-visitor 2/60 seconds and shared-key 4/60 seconds rate limits before fetching book fingerprints or running AI. Cloudflare native limiters are **not** a guaranteed globally centralized, daily AI-neuron hard cap, and IP-based limits can affect users behind shared networks. Keep the limited pilot under observation and disable it promptly if usage is excessive. Using Workers AI consumes the free allowance and can become temporarily unavailable; no paid service is required.

## Scope and honest caveats

The page searches the actual v47 Thucydides shard in the browser, ranks its 32 eligible pages, displays the best eight, and offers selection of at most two original pages. The Worker verifies the **exact UTF-8 text** against trusted SHA-256 fingerprints before two evidence-first AI calls. It binds citations to canonical PDF identifiers, not to arbitrary client URLs. Invalid, invented or missing citation IDs fail closed. This proves page provenance, **not** whether every sentence in the model's answer is logically supported or whether OCR is perfect. The UI explains this.

Questions about works outside Thucydides can already be explored using the existing `Library Search` link. Before enabling AI for other books, first publish fingerprints for their specific page chunks, expand the Worker allowlist and test free-plan CPU/neuron consumption across disciplines. Never expose or embed any `SOURCE_PROBE_TOKEN`, `TEST_TOKEN`, `TURNSTILE_SECRET` or API key in static site assets.

## Testing

Run `node --test hosting-poc/public-gateway.test.mjs` in `book-chatbot`. Offline mock tests verify that a valid Turnstile and exact page hash are prerequisites to inference; no inference occurs for an unsupported source, corrupted bytes, bad Turnstile, rejected limits, or wrong site Origin. The private single-page test still works via `wrangler.source-probe.jsonc` and remains available for benchmarking.

The Reading Companion page appears in navigation via the existing shared `assets/search.js` loaded on exported pages, avoiding modifications to thousands of static WordPress exports. The homepage also provides a direct link. Do not regenerate every post HTML file for this pilot.
