# aion-products — Design Specs

Forward-looking designs for how products **consume** platform capabilities
through canonical contracts. Products reach the platform through contracts, never
around it, and never fork a canonical definition
([dependency rules](https://github.com/Ceoloo/aion-docs/blob/main/repositories/dependency-rules.md)
#4/#5).

| Spec | Drives | Priority | Status |
|---|---|---|---|
| [agent-economics-consumption.md](agent-economics-consumption.md) | [ADR-004](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-004-agent-economics-layer.md) | P0 align / Phase-5 build | Design |

## Ground rules

- **Read canonical contracts; never fork or recompute them.** One definition of
  a metric lives in aion-data; products present it, they do not redefine it.
- **Products supply measured truth (outcomes/events); they never self-report
  value or ROI.** Economics is computed *about* runs by the platform.
- **Present trust levels honestly** — measured vs. estimated vs. derived — and
  preserve lineage back to source.
