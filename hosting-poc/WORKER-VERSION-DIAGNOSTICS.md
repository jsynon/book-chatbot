# Worker version diagnostics

The public pilot planner and answer endpoints include these diagnostic fields:

- `workerSourceBuild`: identifies the source-level behavior milestone included in the deployment. Update this marker when deploying a diagnostic or repair change so a live report can confirm which behavior is active.
- `workerVersionId`: Cloudflare's immutable Worker version ID.
- `workerVersionTag` and `workerVersionTimestamp`: optional Cloudflare metadata.

For an exact deployed version ID, configure a Worker Version Metadata binding named
`CF_VERSION_METADATA`. With Wrangler, add this to the Worker configuration:

```toml
[version_metadata]
binding = "CF_VERSION_METADATA"
```

Use the equivalent binding in any other deployment workflow. If the binding is
not configured, the response still includes `workerSourceBuild`, while the
Cloudflare ID, tag, and timestamp are `null`. No request data, secrets, or
model output are included in these fields.

After deploying, inspect either `/api/pilot-plan` or `/api/pilot-answer`
response in the Reading Companion diagnostic report or live evaluation artifact.
