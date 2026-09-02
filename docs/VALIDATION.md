# MISSION-001 Validation Harness v0.1

The milestone has shifted from *"build Revenue Copilot"* to *"Revenue Copilot has
observed its first real customer conversation."* This harness is how we get
there: a local operator console that runs the governed pipeline on **real
calls**, captures the rep's corrections as ground truth, and scores the mission
gates against reality — not synthetic fixtures.

## Run it

```bash
npm run setup:core       # once — builds @aion/core (pinned)
npm ci                   # or npm install
npm run console          # → http://localhost:4173
```

Set `ANTHROPIC_API_KEY` to run the interpretation through Claude (still governed
by `@aion/core`); without it the deterministic path runs. Session records are
written under `AION_DATA_DIR` (default `./data`, **git-ignored — real records
are PII and are never committed**). Only the default `data/` path is git-ignored;
if you override `AION_DATA_DIR`, point it **outside the repository** (the server
prints a warning if a custom path resolves inside the repo).

The server binds to `127.0.0.1` by default. For handheld/LAN use, set
`AION_HOST=0.0.0.0` **and** `AION_TOKEN=<secret>`, then open
`http://<lan-ip>:4173/?token=<secret>` on the phone — the API rejects requests
without the token. Binding to a non-loopback host without a token prints a
warning; prefer a trusted network or a tunnel.

## The loop

```text
Prospect/context entry → Start Session → LIVE TRANSCRIPT
        │ (transcript adapter: paste / mic → Turn[])
        ▼
   LiveCopilot.ingest()  → live guidance (stage, readiness, objection, next move)
        ▼
   End call → REP VALIDATION (ground-truth correction, 30–60s)
        ▼
   Canonical SessionRecord (persisted) → Validation Dashboard
```

## Ingestion modes (build order)

1. **Paste transcript** — available now. Paste a call transcript (lines prefixed
   `Rep:` / `Prospect:`; aliases like `Agent`/`Customer` work; unprefixed lines
   continue the previous speaker). This gets real data flowing today with zero
   telephony integration.
2. **Live microphone** — available now (Web Speech API, Chrome). Toggle who is
   speaking; finalized utterances are sent as turns into the same
   `LiveCopilot.ingest(turn)`.
3. **Ytel/Centrex integration** — later, *after* validation. Automate call
   events, recordings/transcripts, prospect association, and outcomes. **Mission-001
   does not depend on this.**

Transcription is always an **adapter** (`src/validation/transcript.ts`), never
part of the intelligence architecture.

## Evaluability — don't count unanswered dials

```text
Dial → Call Session → Conversation → Qualified Conversation → Conversion Event
```

A dial can create a session, but it counts toward the 25-real-conversation gate
only once there is enough actual dialogue to evaluate (default heuristic: ≥2
prospect turns and ≥40 prospect words; the rep can override per call). Given call
volume, **collect 50–100 sessions while requiring ≥25 evaluable conversations** —
the non-conversations (gatekeeper, instant rejection, bad timing, existing
provider, rate-first, callback, …) are captured as **failure data**, which is
itself valuable.

## The canonical record

Every finalized session leaves one `SessionRecord` (`src/domain/session.ts`):

- **Identity** — call/prospect/rep ids, industry/schema, timestamps.
- **Classification** — kind (dial/session/conversation/qualified), disposition, evaluable.
- **BEFORE** — conversion stage, assembled context.
- **DURING** — transcript turns, extracted facts, objections, buying signals,
  gaps, recommendations, **canonical `@aion/core` traces** (correlation ids), trace summary.
- **REP BEHAVIOR** — which recommendations were shown and accepted/ignored/wrong/acted-on.
- **AFTER** — AI outcome, **rep-corrected ground truth**, stage before/after,
  outcome, next action, conversion advanced?, downstream conversion, revenue when known.

This dataset is the beginning of AION's proprietary conversion intelligence.

## Ground truth = the rep's corrections

After each call the rep validates (✓ / ✕ / edit) the AI's read of: pain, urgency,
authority, objection, conversation stage, buying signals; rates the guidance
(useful / acted-on / ignored / wrong); and records the outcome, whether the deal
advanced, any downstream conversion, disposition, and notes. Those corrections —
not the AI's self-report — are what the dashboard scores.

## Dashboard & production gates

`npm run console` → Dashboard tab (or `GET /api/dashboard`):

```text
REAL CALLS:             n / 25     (evaluable conversations)
Fact accuracy:          %          (≥85% — rep-verified, before trusting auto CRM writes)
Objection accuracy:     %          (≥85%)
Useful interventions:   %          (≥60% useful/acted-on of rated)
Conversion advances:    n / 10
Downstream conversions: n / 3
Lineage completeness:   %          (context→state→rec→feedback→response→movement, =100%)
```

Lineage completeness requires the **whole** documented chain to exist for a
finalized call — every surfaced recommendation linked to a canonical trace id
and detected-state snapshot, at least one intervention with rep feedback, at
least one prospect response attributed, and the conversion movement recorded —
not merely a trace id. A call with no feedback or no attributable response does
not count as complete.

These are the **real** Mission-001 gates. The synthetic `npm run eval` scorecard
validates the plumbing; **this** dashboard validates the product. Mission-001
passes only when these clear on real calls. Merge of the harness ≠ mission
passed — it means we can now start collecting.
