# First Real Call — MISSION-001 Operator Runbook

This is the step-by-step for ingesting the **first real sales conversation** into
the Revenue Copilot and capturing it as a canonical, scored record. It assumes
the Validation Console (Harness v0.1) is already built in this repo.

> **Merge ≠ mission passed.** Getting the harness green means it is *ready to be
> tested*. Mission-001 passes only after **≥25 real evaluable conversations**
> clear the gates in [`docs/GATES.md`](GATES.md). This runbook produces call #1.

## 0. Before the call — preflight (2 min)

```bash
npm run setup:core      # once, if you haven't (builds @aion/core into .vendor/)
npm ci
export ANTHROPIC_API_KEY=sk-ant-…     # governed Claude interpretation path
export AION_DATA_DIR="$HOME/aion-call-data"   # PII lives OUTSIDE the repo
npm run preflight
```

`preflight` prints a readiness scorecard and exits non-zero if anything would
make a real call unsafe (can't run, or would leak/lose PII). Resolve every ⛔
**blocker** before proceeding; ⚠️ **warnings** are advisory. What it checks:

| Check | Blocker when… |
|---|---|
| Node runtime | Node < 22.18 (TS type-stripping) |
| Canonical `@aion/core` | control plane can't be resolved (`npm run setup:core`) |
| Sales schemas | none registered |
| Interpretation path | *(warn only)* no `ANTHROPIC_API_KEY` → deterministic path |
| Data directory | not writable, or inside the repo but not the git-ignored `data/` |
| Network exposure | bound off-loopback (`AION_HOST`) without `AION_TOKEN` |
| Operator console | *(warn only)* `web/dist` not built → fallback console |

## 1. Consent & compliance (do not skip)

Real conversations are PII.

- **Get consent to record/transcribe** per your jurisdiction (many require
  all-party consent). Announce it at the top of the call if required.
- Records persist as JSON under `AION_DATA_DIR` — keep that path **outside the
  repo** (the default `data/` is git-ignored; any override must be too). Never
  commit real records.
- For phone/handheld use across the LAN, set `AION_HOST=0.0.0.0` **and**
  `AION_TOKEN=<secret>`, then open the console with `#…token` in the URL
  **fragment** (never the query string) — see step 2.

## 2. Go live

```bash
npm run golive
```

`golive` re-runs preflight, builds the operator console if needed, and starts
the server. Open the URL it prints:

- **Same machine:** `http://localhost:4173/`
- **Phone on the LAN:** `http://<lan-ip>:4173/#token=<AION_TOKEN>` — the token
  is read from the fragment, forwarded only in the `x-aion-token` header, and
  scrubbed from the address bar on load.

## 3. Run the call

1. **Setup tab** — pick the industry schema, enter prospect/company/offer and
   the current + desired conversion stage. **Start session.**
2. **Live tab** — capture the conversation as it happens:
   - **Dictate** with the mic (Chrome/Edge Web Speech), or **paste** a
     transcript, or type turns. Rep vs lead is auto-attributed (greeting/script/
     questions → rep; answers/prices/objections → lead); pin Auto/Rep/Lead if
     needed.
   - Watch the next-move guidance, readiness signals, objections, and gaps.
     Tap **Useful / Acted on / Ignored / Wrong** on recommendations as you go —
     that is the rep-value signal.
3. **End call → Validate.**

## 4. Capture ground truth (30–60s — the point of the exercise)

In the **Validate** tab, correct the AI. These corrections *are* the ground
truth the gates score against, so be honest:

- Mark each fact (pain / urgency / authority / objection / stage / signals)
  **Correct / Incorrect / Edit / N-A**.
- Rate whether the guidance was useful.
- Record the **call outcome**, **disposition**, whether the deal **advanced**,
  and any **downstream conversion**.
- Confirm **Evaluable** (a real two-way conversation with enough substance to
  judge) — only evaluable calls count toward the 25-gate.
- **Save canonical record.**

## 5. Confirm it landed

- **Dashboard tab** shows the new record and the live gate metrics, or:
- `curl -s localhost:4173/api/dashboard | jq '.metrics'` (add
  `-H "x-aion-token: $AION_TOKEN"` if a token is set).
- The JSON record is under `AION_DATA_DIR/sessions/`.

That's call #1. Repeat until **≥25 evaluable conversations**; then read the
dashboard against [`docs/GATES.md`](GATES.md). Green synthetic CI is an
engineering gate — **only real evaluable calls decide Mission-001.**
