# Mission-001 Gates

Application count is **one** outcome metric, not the primary gate. The primary
KPI is **conversion-stage advancement**. `npm run eval` prints the scorecard.

## What the harness measures (offline, deterministic)

| Gate | Definition | How it's measured here |
|---|---|---|
| **Technical** | A real conversation travels audio/transcript → live interpretation → structured state → Core-governed execution → recommendation → rep interaction → durable record, with traceability. | Every fixture runs the full `LiveCopilot` loop; every AI step produces an `ExecutionTrace` tied to call+turn; the post-call `CallIntelligence` is produced. |
| **Live extraction accuracy** | ≥85% on clearly-stated structured facts before trusting automated CRM writes. | Each fixture labels the clearly-stated facts; the harness scores extracted values against them. |
| **Objection detection** | Evaluated separately from facts. | Expected objection categories vs detected. |
| **Rep-value** | ≥60% of surfaced interventions rated useful or acted-upon. | Scripted rep feedback marks interventions; rate is computed over **rated** interventions. |
| **Conversion** | ≥10 measurable positive conversion events across calls, ≥3 reaching a meaningful downstream conversion (application / appointment / proposal / demo / audit / estimate). | Sum of ladder rungs climbed per call; count of calls reaching a `meaningfulConversion` rung. |
| **Learning** | The lineage context → detected state → recommendation → rep accepted/ignored → prospect response → conversion movement → outcome must exist. | Each surfaced recommendation opens a `LineageRecord` linked to a trace id, its state snapshot, the rep feedback, the next prospect response, and the resulting ladder movement. |

Recommendation *quality* ("was this the right move?") is subjective and is
evaluated via the rep-value loop, not scored as correctness.

## Honesty about the fixture set

The bundled fixtures are a **synthetic evaluation set** used to prove the loop
and the gate instrumentation offline. Because the fixtures are hand-labeled and
the deterministic extractor is cue-based, extraction accuracy on them is high by
construction — this validates the *plumbing and metrics*, not real-world
accuracy.

**Production validation still requires the real gates from the mission:**

- ≥25 **real** sales conversations processed end-to-end.
- Manual evaluation on a meaningful subset for: qualification facts, pain/need,
  urgency, objections, buying signals, conversation stage, next action, outcome.
- ≥85% accuracy on clearly-stated structured facts **on real calls** before
  enabling automated CRM writes (the Core already gates writes on explicit +
  high-confidence; this threshold governs turning that on).
- Rep-marked intervention feedback (useful / ignored / wrong / already-knew /
  acted-on) collected live, ≥60% useful-or-acted.
- Conversion tracked as stage advancement across those real calls.

When real transcripts + labels are available, drop them in as fixtures (same
`CallFixture` shape) and/or run the live loop against a transcription source;
the same harness scores them, and setting `ANTHROPIC_API_KEY` evaluates the
Claude-backed path instead of the deterministic baseline.

## The proprietary payoff

Once enough real lineage accrues, AION can mine it for outcome-backed sales
intelligence — e.g. *"when a pricing concern is raised before urgency is
established, reps who return to impact questions convert more than reps who
defend price."* That hypothesis is exactly the signature move the next-best-action
engine already encodes; the lineage is what will let us confirm or refute it
from real outcomes rather than assert it.
