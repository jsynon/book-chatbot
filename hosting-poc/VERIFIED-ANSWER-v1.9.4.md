# v1.9.4 — Protected SHA-256 verified AI answers

Goal: one working Thucydides answer using the real book passage, verified
against v47 SHA-256 before two evidence-first Workers AI calls.

## Scope and isolation

- The existing public-foundation Worker stays disabled for public visitors: PUBLIC_ENABLED is false.
- New protected POST /internal/verified-answer requires the existing SOURCE_PROBE_TOKEN.
- It accepts browser requests only from localhost/127.0.0.1 on port 8766.
- The original private AI test Worker is unchanged; existing /api/answer is not enabled.
- The source pilot remains one book: Thucydides 152, original PDF page 38.
- No billing or external API keys are needed; free Workers AI neuron quota is consumed by successful AI calls.

## Manual installation (after merging this PR)

1. Pull latest book-chatbot changes with GitHub Desktop.
2. From PowerShell run:

    cd D:\Downloads\book-chatbot
    npx.cmd wrangler deploy --config hosting-poc/wrangler.source-probe.jsonc

   Confirm Wrangler lists env.PUBLIC_ENABLED false and the AI binding.
3. If your local test server is stopped, run:

    python -m http.server 8766 --bind 127.0.0.1 --directory "D:\Downloads\book-chatbot"

4. Open http://127.0.0.1:8766/hosting-poc/verified-answer-test.html
5. Enter the same private SOURCE_PROBE_TOKEN previously configured. Do not share it or commit it.
6. Ask the default question once. Expect a real AI answer with an [S1] citation to original PDF page 38, or a clearly stated insufficient-evidence result.
7. Check the deliberate-text-alteration checkbox. Expect HTTP 422, stage source-verification, with no AI call.

## Data flow

Browser fetches the original v47 book page, then sends exact text to the protected Worker.
The Worker fetches owner-published SHA-256 fingerprints, validates exact UTF-8 page
bytes and canonical title/PDF identifiers, and only then calls Workers AI.
Stage one reviews evidence and coverage; stage two composes an explanation
only from IDs selected by the first stage. Fabricated or missing citation IDs
cause an error instead of an unsourced answer. No AI runs on unverified text.

## Limitations and next milestone

Page provenance and source IDs are checked, but individual AI claims are NOT independently
fact-checked against cited passages. The result is labeled verified-source-draft
and citations_not_claim_verified. The test uses one verified pilot page; whole-library
fingerprint publication, interactive retrieval and the actual Book Lite website page
are still future work. Check Cloudflare CPU Time and daily free neuron usage for the
first actual answer before expanding. Wall time is not CPU time.

Tests: node --test hosting-poc/public-gateway.test.mjs
Tests mock inference and cover proper citation binding, tampering, missing binding,
authentication, private CORS, insufficient evidence, and invalid citations.
