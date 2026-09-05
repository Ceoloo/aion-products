# Vercel testing preview

This preview builds from the Validation Console in PR #2 (`cea2258`). It runs
the actual deterministic Revenue Copilot engine and canonical `@aion/core` in
the browser, with secure Web Crypto IDs. The normal server remains unchanged.

The preview supports setup, pasted transcripts, live text turns, rep feedback,
validation, and a tab-local dashboard. The existing browser speech input is
browser-dependent and has not been verified by this deployment.

No Claude credentials, model calls, CRM writes, or shared database are included.
Use synthetic calls. Active sessions are held in memory and reset on refresh;
finalized sample records use sessionStorage and are lost when the tab closes.
Preview dashboard results do not count as production Mission-001 evidence.

## Reproduce

```
npm run setup:core
npm ci
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web run build -- --mode preview
```

Root vercel.json contains Git-import build settings. A file-based deployment
can publish only the generated contents of web/dist with a static configuration.
No source code, environment files, vendor checkout, or call records need to be uploaded.

## Validation

- Web TypeScript check and preview build pass.
- 48 existing product tests pass.
- Five synthetic fixtures pass the existing evaluation gates.

## Full hosted service

For real shared call operations, supply authenticated server-side access,
durable session and report storage, and a supported model configuration.
The existing Node server's in-memory sessions and local JSON files must not be
treated as durable state on Vercel serverless instances.
