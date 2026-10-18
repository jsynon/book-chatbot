# v1.9.1 — Private trusted-source CPU feasibility gate

**Goal:** Before making a public chat page, check that the *exact* v1.9.0 trusted v47 retrieval method can fetch, unzip and validate a real PDF source on **Cloudflare Workers Free** without exceeding **10ms CPU time**. This is a read-only diagnostic, not a deployed public chat service. It runs **zero AI calls** and does not require Workers AI or paid billing.

**This build does not change** the website at \`jsynon.github.io/antilogicalism\`, the working private \`antilogicalism-companion-test\` Worker, or the main README.

## New protected route

The v1.9.0 public gateway has a *disabled-by-default* additional endpoint:

- \`POST /internal/source-probe\` requires \`Authorization: Bearer <SOURCE_PROBE_TOKEN>\` with an encrypted Cloudflare \`SOURCE_PROBE_TOKEN\` secret of at least 32 characters; GET, browser-originated and unauthenticated requests fail before any source fetch.
- It calls \`trustedSources()\` **directly** for book ID \`152\`, PDF page \`38\` (the Thucydides page already exercised in the browser) and returns the canonical book title, PDF page, real manifest global-page ID, actual PDF link, preview length and a short preview sample.
- It reports \`wallElapsedMs\`, which is **not CPU time**. Actual CPU must be read in Cloudflare's *Metrics → CPU Time per execution* (or Worker logs); wall clock includes time awaiting remote GitHub Pages.
- \`PUBLIC_ENABLED\` remains \`"false"\`. The public \`POST /api/answer\` remains **503 disabled**, independent of the source probe token. No anonymous public AI is reachable.

## Local/offline preflight

Run from \`D:\Downloads\book-chatbot\`:

\`\`\`powershell
node --test hosting-poc/public-gateway.test.mjs
\`\`\`

GitHub Actions also verifies this automatically.

## Cloudflare setup (one step at a time)

Only continue on Cloudflare **Free**; no credit card, paid service, upgrade, or billing toggle is necessary.

1. Check Node/NPM are installed by opening PowerShell and running \`node --version\` and \`npm --version\`.
2. From \`D:\Downloads\book-chatbot\`, run \`npx wrangler --version\`; accept downloading Wrangler only if prompted. Wrangler v4.36.0+ is required later for public rate limits.
3. Run \`npx wrangler login\`. Approve Cloudflare's browser OAuth prompt on the **correct free account**. Don't paste tokens into chat.
4. Run \`npx wrangler deploy --config hosting-poc/wrangler.source-probe.jsonc\`. This creates a **separate** Worker, \`antilogicalism-companion-public\`, with \`PUBLIC_ENABLED=false\`. The config intentionally has *no* AI binding. Do not replace \`antilogicalism-companion-test\` or deploy the separate \`wrangler.public.example.jsonc\` configuration yet.
5. Generate a fresh, random 32+ character probe-only password privately and store it in your password manager. To generate locally: \`python -c "import secrets; print(secrets.token_urlsafe(32))"\`. Never add it to source code or share screenshots showing it.
6. Run \`npx wrangler secret put SOURCE_PROBE_TOKEN --config hosting-poc/wrangler.source-probe.jsonc\`. Paste the private value at its hidden prompt. This creates an encrypted Worker secret (and may trigger a deployment). **Do not add it as a plain config \`vars\` value.**
7. Open the new Worker's URL shown by Wrangler. The root path should show \`publicEnabled:false\` and \`mode:"public-foundation"\`. The old test Worker should still answer \`protected-grounded-test\`.
8. Test once via PowerShell (do not put token in the command or chat). Replace the placeholder Worker URL with the exact \`workers.dev\` URL printed by Wrangler:

\`\`\`powershell
$secure = Read-Host "Enter private SOURCE_PROBE_TOKEN" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $result = Invoke-RestMethod -Method Post -Uri "https://<YOUR-NEW-WORKER-URL>/internal/source-probe" -Headers @{ Authorization = "Bearer $token" }
  $result | Format-List
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Variable token,secure -ErrorAction SilentlyContinue
}
\`\`\`

9. In Cloudflare Workers & Pages, open \`antilogicalism-companion-public\` → **Metrics**. Find **CPU Time per execution** and **Errors/Exceeded resources** (metrics may take a short while to appear). Check actual CPU, not \`wallElapsedMs\`. A few 200 responses alone are not sufficient; repeated trials and relevant CPU quantiles are needed before approving public deployment.

## Decision

- If source validation is reliable and comfortably **below 10ms CPU** in production, retain trusted source fetching; follow up with Turnstile, unique rate limit namespaces, public Book Lite page and a small multi-discipline trial.
- If Workers Free repeatedly returns **1102 / exceeded resources** or CPU use is near/above 10ms, **do not upgrade**. Prepare smaller precomputed trusted lookup packets as static files in the existing GitHub Pages library-data repository and retest.
- Do not switch \`PUBLIC_ENABLED\` to true yet. That requires real Turnstile, independent per-visitor/global protection, production source verification and appropriate abuse budget handling.

Official references: [Workers Free CPU limits](https://developers.cloudflare.com/workers/platform/limits/) and [Worker metrics (CPU vs wall time)](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).
