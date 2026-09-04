# Design Spec — Consuming Agent Economics (CEO Dashboard & ROI)

- **Drives:** aion-docs
  [ADR-004](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-004-agent-economics-layer.md),
  [architecture/agent-economics.md](https://github.com/Ceoloo/aion-docs/blob/main/architecture/agent-economics.md)
- **Priority:** P0 schema alignment now; consumption in Phase 5 (once real
  outcomes exist)
- **Status:** Design — not yet implemented

Agent Economics is a **canonical contract owned by aion-data**. Products —
including the CEO dashboard and any customer-facing ROI view — **read** that
contract; they never fork it or compute a competing definition
([dependency rules](https://github.com/Ceoloo/aion-docs/blob/main/repositories/dependency-rules.md)
#4/#5). This spec describes how a product consumes economics correctly, using
this repo's existing Phase-4 product (Revenue Copilot) as the worked example.

## The rule products must not break

There is exactly one definition of "cost per successful task", "automation
efficiency", "revenue ROI", and "agent utility" — the
[canonical metrics](https://github.com/Ceoloo/aion-docs/blob/main/architecture/agent-economics.md)
in aion-data. A dashboard that computes its own ROI creates a second, divergent
truth. So:

- **Read the canonical economics/ROI views; do not recompute them.** The product
  queries `agent_economics` / `agent_economics_roi` through the data read path,
  the same way it reads any canonical entity.
- **Do not blend cost into value.** The product displays the trust levels
  honestly (cost authoritative, value measured, attributed value estimated with
  method+confidence, ROI derived) — it must not present an estimate as a fact.
- **Do not let the product write economics.** Products emit **outcomes** and
  **events**; economics is computed *about* runs by aion-data. A product never
  reports its own ROI.

## What a product contributes (the input side)

A product's job in the economics loop is to make **value measurable**, by
emitting honest outcomes — not by scoring itself.

Revenue Copilot already optimizes **conversion-stage advancement**, not a
terminal boolean. That maps cleanly onto measured value inputs:

| Copilot signal | Economics input | Trust |
|---|---|---|
| conversion-stage advancement (ladder progression) | `outcomes` (realized business value / stage delta) | measured |
| rep-time saved per call vs. baseline | `human_minutes_saved` | measured |
| closed revenue attributable to a copilot-guided deal | `revenue_created` | measured |
| pipeline influenced by copilot guidance | `revenue_influenced` (+ method + confidence) | **estimated — labeled** |

These flow through the platform's governed write paths and outcome
instrumentation (Phase 5), **not** a product-local metrics table. The product
supplies truth about the world; aion-data composes it with authoritative cost
from [execution receipts](https://github.com/Ceoloo/aion-core/blob/main/docs/design/execution-gateway.md)
into economics.

## The CEO dashboard

```mermaid
flowchart LR
    subgraph aion-data (canonical)
      ECON["agent_economics"] --> ROI["agent_economics_roi (views)"]
    end
    ROI -->|read only| DASH["CEO dashboard (product)"]
    OUT["outcomes"] --> ECON
    RCP["execution receipts + telemetry"] --> ECON
    COPILOT["Revenue Copilot emits outcomes/events"] --> OUT
```

The dashboard is a **read** surface over the canonical ROI views, sliceable by
agent, mission, runtime, and model. It answers the questions the Agent OS exists
to answer: *is this autonomous work cheaper than the humans it replaces? does it
make more than it costs? which agents earn their keep?* It adds presentation, not
definition.

## Honest presentation requirements

- **Show the trust level** next to every number (measured / estimated / derived).
  An estimated `revenue_influenced` shows its attribution method and confidence.
- **Show partial-data state.** Before Phase-5 outcomes are real, economics is
  incomplete; the dashboard says so rather than implying a precise ROI.
- **Trace to source.** Every displayed metric links back (by `run_id` /
  `mission_id`) to the receipts, telemetry, and outcomes it derives from —
  lineage is preserved end-to-end, so a surprising number is auditable.

## What this spec deliberately does NOT do

- Does not define economics metrics — that is aion-data (ADR-004).
- Does not add a product-local economics/ROI store — products read the canonical
  contract.
- Does not let a product self-report value or ROI — products emit measured
  outcomes; the platform computes economics.
- Does not build the dashboard before Phase-5 outcomes make the numbers real.
