# v1.10.0 — Four-book verified Reading Companion

## Scope

The live Reading Companion expands from Thucydides to a **small, verified interdisciplinary collection**:

| Book ID | Work | Discipline |
|---|---|---|
| 7 | *Nicomachean Ethics* — Aristotle | Philosophy |
| 114 | *Crime and Punishment* — Dostoevsky | Literature |
| 152 | *History of the Peloponnesian War* — Thucydides | History |
| 529 | *On the Origin of Species* — Darwin | Science |

The indexed library remains at approximately 644 books; **only these four works are eligible for public AI in this release**. This is not a whole-library launch.

### Changes across three repositories

1. **Library data:** \`tools/build_reader_collection.py\` streams each of these four v47 book shards once, producing 32-page SHA-256 fingerprint chunks with exact UTF-8 hashes and canonical PDF page/identity metadata. A tiny \`coverage-v1.json\` index declares which books have been fully exported. This does not add new full OCR text.
2. **book-chatbot:** The same evidence-first AI Worker accepts only book IDs 7, 114, 152 and 529. For every request, the original raw page text is rehashed against independently published source fingerprints. Turnstile, the two native rate limits, source limits, citation checks, and the existing private tests are preserved. Responses now return source-derived key highlights and two safe follow-up question buttons (no extra inference).
3. **Antilogicalism website:** Uses the tested whole-v47 \`RemoteLibrary.search\` engine, restricted to fingerprint-ready book IDs. Visitors can search all four, select a single book, choose source pages, and open PDF page references. The answer sections follow the Reader Mode layout **Answer → Explore further → Key passages from the source books → Sources**, followed by a separate passage browser. Responsive white, black-bordered prompt buttons match the original user preference.

### Safely merge and publish in this order

**First — library-data pull request.** Merge, then open its GitHub Actions workflow **Publish v1.10.0 interdisciplinary reader fingerprints** and run it manually on main. It writes full-book fingerprint chunks and \`reader-fingerprints-v1/coverage-v1.json\` to the data repository. Verify:
\`https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/coverage-v1.json\`

The URL must show **all four books** before enabling the broader site. If the workflow push is on main but the public URL is still 404 or stale, manually trigger a Pages deployment (or perform a direct repository commit) because GitHub Actions bot pushes do not necessarily trigger the branch-backed GitHub Pages workflow. Do **not** hand-edit the hashes.

**Second — book-chatbot pull request.** Merge and pull via GitHub Desktop. Deploy to the existing foundation Worker (never the older private test Worker):
\`\`\`powershell
cd D:\Downloads\book-chatbot
npx.cmd wrangler deploy --config hosting-poc/wrangler.public-pilot.jsonc
\`\`\`

**IMPORTANT:** This repository's tracked example \`wrangler.public-pilot.jsonc\` deliberately contains empty \`TURNSTILE_SITE_KEY\` and \`PUBLIC_PILOT_ENABLED:"false"\` to avoid a surprise public AI deployment. **Keep your locally configured Site Key and your intentional \`PUBLIC_PILOT_ENABLED:"true"\` setting** when pulling/merging! Verify these local vars BEFORE redeploying. The encrypted \`TURNSTILE_SECRET\` remains on Cloudflare. Never commit the secret or change \`PUBLIC_ENABLED:"false"\`.

**Third — Antilogicalism website pull request.** Merge and wait for GitHub Pages. Use:
\`https://jsynon.github.io/antilogicalism/reading-companion/\`

Until the coverage JSON is published, the new page deliberately falls back to its known-working Thucydides pages 33–64; it never presents books as fingerprint-ready without a full published coverage manifest.

### Real acceptance questions

- **Philosophy:** "How do virtue and practical wisdom contribute to happiness in Aristotle's Nicomachean Ethics?"
- **Science:** "According to Darwin, how does natural selection operate?"
- **Literature:** "How does Raskolnikov justify murder in Crime and Punishment?"
- **History:** "What caused the Peloponnesian War?"
- **Cross-book:** "How do Aristotle and Darwin differ in their explanations of human nature?" (evaluate source availability critically; evidence may be incomplete).

Verify the actual quoted passages and PDF page metadata, ensure follow-up buttons populate but do not automatically send, and note CPU time and Workers AI neurons for a representative successful response. Check with at least one tampered page negative test via the original private test harness. **A correct SHA-256 is not proof the AI answer is logically entailed by the source.**

### Known constraints

- Two pages maximum sent for inference, 14 KB raw UTF-8 per page and 32 KB total public request body. Oversized or nonprose source pages may be skipped by the browser; exporter reports how many pages exceed the limit. These should be handled deliberately in a future version, not silently claimed supported.
- Browser currently downloads large v47 search index partitions/book shards as needed. On slower devices, measure performance and memory before enabling all 644 works.
- Follow-up buttons start a fresh retrieval/verified response; conversational context is not yet held across turns.
- GitHub Pages and free Workers AI quota limits apply. Rate limits protect the pilot but do not guarantee fixed daily neuron consumption. No paid service or home PC hosting is introduced.
