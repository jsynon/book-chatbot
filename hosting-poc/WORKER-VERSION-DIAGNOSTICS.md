# Worker version diagnostics

The public pilot planner and answer endpoints include these diagnostic fields:

- `workerSourceBuild`: identifies the source instrumentation build.
- `workerVersionId`: Cloudflare's immutable Worker version ID.
- `workerVersionTag` and `workerVersionTimestamp`: optional Cloudflare metadata.

Your deploy command uses `hosting-poc/wrangler.public-pilot.jsonc`. That file
is intentionally ignored by Git because it contains account-specific settings,
so it is not in the repository and cannot be updated by this PR. Add this
top-level entry to that local config, beside `compatibility_date`:

```jsonc
"version_metadata": { "binding": "CF_VERSION_METADATA" },
```

The tracked `wrangler.public.example.jsonc` now contains the same binding.
This uses Wrangler's version metadata binding to expose the deployed version
ID, tag, and creation timestamp to the Worker runtime.

If the binding is absent, responses still include `workerSourceBuild`, while
the Cloudflare version ID, tag, and timestamp are `null`. No request data,
secrets, or model output are included in these fields.

After adding the binding and deploying with your existing command, inspect
either `/api/pilot-plan` or `/api/pilot-answer` in the Reading Companion
diagnostic report or live evaluation artifact.
