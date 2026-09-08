# Isolated Revenue Copilot preview

Use a dedicated preview project with the repository root as its Vercel root
and the root `vercel.json` settings. The preview uses the current sales cockpit
and the real deterministic product engines through pinned canonical `@aion/core`.
It requires no model credentials, Runtime URL, CRM token, or database.
Do not promote this sample application as the production revenue console.

## Reproduce from a clean checkout

```bash
npm run setup:core
npm ci
npm --prefix web ci
npm run typecheck
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run build -- --mode preview
npm --prefix web run test:preview
npm --prefix web run preview -- --host 127.0.0.1
```

The web CI job bootstraps the pinned Core and installs root dependencies before
web typecheck. It checks both the normal server-backed SPA and explicit preview
build, then exercises the bundled browser adapter. Vercel runs typecheck before
its preview build. A green normal build alone does not certify preview mode.

## Import boundary

- Server entry `src/aion.ts` retains provider detection. The server
  `AiExecutionService` resolves environment defaults and creates the Runtime
  HTTP client when configured; existing production behavior is preserved.
- `src/compose-copilot.ts` uses shared execution with explicit provider injection.
  The preview passes `llm: null` and cannot select a Runtime transport.
- The shared execution service owns the existing canonical Core path and accepts
  an injected Runtime transport for server composition. Provider and transport
  contracts have no environment reads or vendor imports.
- Vite rejects Node built-ins, vendor SDKs, and known server modules in the
  browser graph. The only compatibility mapping is the pinned Core identifier
  module's `node:crypto` import to native `crypto.randomUUID()` (secure context).
  No general Node polyfills, SDK stubs, or `process.env` replacement are used.

## Preview behavior

Setup, pasted/text turns, guidance, feedback, debrief, saved-sample inspection,
editing, deletion, and live-session abandonment work within the tab. Per-session
queues prevent finalization from overtaking ingestion. Storage failures leave
the active call available for retry. Outcome and disposition require explicit
selection. Saved samples are marked synthetic and excluded from all production
metrics, including older records in the preview storage namespace.

Active calls reset on refresh. Saved samples survive refresh in sessionStorage
until the tab is closed/cleared. There is no shared or durable backend. Use only
sample conversations. Browser speech recognition remains browser-dependent and
may use a browser vendor's transcription service; the deterministic engine
itself makes no network calls.

## Release checks

1. Require product typecheck/tests/evaluation and the web job on the updated PR.
2. Verify the Vercel deployment source commit matches the fixed PR head and its
   build is Ready; the old manually uploaded URL is not proof of a source build.
3. In a fresh browser tab, create a sample, paste turns, give feedback, end the
   call, explicitly select outcome/disposition, and save. Inspect/edit/delete
   the sample in Control Room. Confirm Samples increases while Real stays zero.
4. Check refresh/reset behavior, browser console errors, and no `/api`, Runtime,
   model-provider, or CRM requests. Inspect the bundle/import boundary gate.
5. Production sessions still require authenticated server access and durable
   Runtime/storage configuration; preview results do not validate those systems.
