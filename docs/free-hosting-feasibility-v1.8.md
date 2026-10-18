# v1.8.0 — Zero-cost public hosting feasibility

Status: **architecture candidate, not yet a working deployment**. The project will remain on localhost until its public-hosting gates pass. The root README is deliberately unchanged.

## Non-negotiable product requirements

- Hosting, storage, and inference must remain **$0**, with no recurring subscription, metered overage, or dependency on the maintainer's computer. If free usage runs out, the chat returns a polite quota message; it must not automatically upgrade or incur charges.
- The reader is **another page on the existing Antilogicalism GitHub Pages site**, for example `/antilogicalism/reading-companion/`, with the existing Book Lite header, navigation, and footer.
- The original book data and verifiable citation/page identity stay central. Developer diagnostics must never be made available to general visitors.

## What is already free and working

1. The static website is already on GitHub Pages. The additional reader HTML/JS/CSS can be deployed to a normal site subdirectory.
2. The separate `jsynon/antilogicalism-library-data` repository says its **v47 data is already published via GitHub Pages**, and the live Library Search page points to `/antilogicalism-library-data/data-v47/`. The existing `digital-library/library-search-v18.js` browser code loads compressed `manifest.json.gz`, `terms-XX.json.gz` partitions, and book shards on demand using `DecompressionStream('gzip')`. **Reuse that distribution path and loaders; do not introduce an R2 bill or duplicate all 644 book texts.**
3. Current local Reading Companion Python logic in `whole_library.py` reads the same v47 manifest, 2-letter term partitions and per-book shards; `inference.py` encapsulates the Ollama structured-completion contract. Its standard evidence-first flow makes two inference calls. Source-reader URLs and physical PDF pages must be preserved.

The GitHub API reports ~577 MiB repository size for `antilogicalism-library-data`, not an exact measurement of published files. GitHub Pages has a 1 GB published-site limit and a soft 100 GB/month bandwidth limit; availability and actual site size must be verified as part of testing.

## Recommended stack for the proof of concept

| Layer | Candidate | Why |
| --- | --- | --- |
| Reader UI | Existing Antilogicalism GitHub Pages site | Exactly one visible site and existing Book Lite theme |
| Retrieval data | Already published `antilogicalism-library-data` GitHub Pages data | $0 and already consumed by current browser search |
| Indexed retrieval | Browser JS reused/adapted from `library-search-v18.js`, or a **measured** lightweight server-side retrieval subset | Avoid rehosting data or blindly porting large Python jobs to a 10 ms CPU Worker |
| Inference gateway | Cloudflare Workers **Free** | API mediation, secrets and limits; 100,000 Worker requests/day but only **10 ms CPU/request** and 128 MB memory |
| Candidate inference | Cloudflare Workers AI **Free**, first try Gemma 4 26B A4B; compare GLM-4.7-Flash | 10,000 free neurons/day, resets daily; free-plan quota exhaustion rejects requests instead of silently billing |
| Alternate inference | Groq Free API, if Cloudflare quality/limits fail | Rate limits vary by model; must check exact free-plan availability when tested |

**Important architecture caveat:** The current Python retrieval and orchestration code cannot simply be deployed unchanged to Workers Free. Ten milliseconds of CPU per request is particularly restrictive for decompressing and ranking large v47 posting lists. Moving retrieval to browser JavaScript may be promising because the current Library Search already works this way, but client-provided evidence must not be blindly trusted for provenance: implement validation/bounds, clearly isolate untrusted questions/text, and audit how source IDs/page references are bound before any public launch.

**Avoid Cloudflare R2 for the zero-charge baseline.** Although R2 has a free allocation (10 GB-month standard storage, 10 million Class B reads/month), the service requires enabling an R2 subscription and can bill overage. That violates the hard 'never incur charges' requirement unless an enforceable no-charge strategy is proven. The already-hosted data removes the need to take that risk.

## Measured limits versus required measurements

Official sources checked October 18, 2026:

- Workers Free: 100,000 requests/day, 10 ms CPU/request, 128 MB memory, 50 subrequests/request — https://developers.cloudflare.com/workers/platform/limits/
- Workers AI: 10,000 free neurons/day; exceeded free allowance fails — https://developers.cloudflare.com/workers-ai/platform/pricing/
- Gemma 4 26B A4B: 256K context; 9,091 neurons per million input tokens and 27,273 per million output tokens — https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/ and pricing page above
- GLM-4.7-Flash: 131K context — https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Groq Free limits depend on model and organizational token budgets — https://console.groq.com/docs/rate-limits
- GitHub Pages limits — https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

**Illustrative, not observed capacity:** If two Gemma 4 calls combined consume 12,000 input and 1,500 output tokens, that is roughly 150 neurons at current published rates, or roughly 66 conversations/day out of a 10,000-neuron allowance. Actual prompts, thinking tokens, model-specific requirements, other usage, request limits and provider availability can change this significantly. Measure real calls and adopt a conservative daily application cap rather than treating 66 as a promise.

## Smallest meaningful proof of concept (v1.8.1)

**Do not link it in the site's public navigation yet.**

1. Verify that the site's existing public v47 manifest, a relevant term partition, one book shard and a physical PDF citation can be fetched on a fresh desktop/mobile browser session. Check actual sizes, CORS/origin and page numbers; no corpus copy.
2. Extract or adapt the existing browser-based manifest/partition/gzip loader into a small read-only retrieval module, and use it to resolve **one real question** into verified book/page passages. Check retrieval time and memory on mobile and desktop.
3. Test one **two-call** structured completion with a free hosted model. Compare result schemas, citation integrity, answer quality and token/neuron consumption against the same locally retrieved evidence. Do not rewrite the entire reader or hardcode answers.
4. Put hosted inference behind a Free Worker endpoint with restrictive CORS, request size and origin handling, input validation, no exposed API key, a conservative daily cap, and safe 429/quota messaging. Treat CORS as a browser restriction, not authentication; public endpoints also need abuse controls and exact evidence-bound checks.
5. Demonstrate one complete question → evidence → answer → original source page flow from a **private/local test page** using remotely hosted data and inference, with the user's computer not acting as an Ollama server.
6. Stop if inference cannot pass a minimal cross-disciplinary quality/citation smoke test, data cannot be accessed reliably within free limits, or processing requires a paid tier. Reassess before promising public use.

## Deployment decision

**Conditional GO for a bounded zero-cost proof of concept. NOT yet a GO for public deployment.** Static site integration and reuse of already-public library data are established. Hosted two-call inference quality, quota capacity, Worker CPU compatibility, source-validation architecture, abuse protection, relevant text rights, and real end-to-end performance are outstanding gates.

Public launch is a separate milestone after the proof succeeds. No README edits, new paid accounts, public menu links or live-site modifications are necessary for the feasibility study.
