# Real-call intake (MISSION-001 production validation)

This directory is where **real, consented sales conversations** are dropped so
the production-validation harness can score them against the Mission-001 gates.

```
npm run validate            # strict: exits non-zero until validation is complete
npm run validate -- --status  # report-only (used by the informational CI job)
```

## The exit gate

MISSION-001 is engineering-complete and green on synthetic fixtures. Real-world
validation requires (see [`../../docs/GATES.md`](../../docs/GATES.md)):

1. **≥25 real conversations** processed end-to-end.
2. **Consent** on every real call (`provenance.consent: true`).
3. The **same 7 mission gates** passing on this real data — chiefly
   ≥85% extraction accuracy on clearly-stated facts, ≥60% rep-value, and a
   complete learning lineage.

A green **synthetic** run (`npm run eval`) is *not* validation. Synthetic-
provenance calls are excluded from the real count entirely.

## Adding a real call

1. Copy `_template.call.ts` to `<yyyy-mm-dd>-<short-slug>.call.ts`.
2. Fill in the transcript (`turns`), `context`, and `groundTruth` labels.
3. Set `provenance.source: 'real'` and `provenance.consent: true`.
4. Run `npm run validate` to score it.

The loader picks up every `*.call.ts` here **except** files starting with `_`
(so this template is ignored), and each module must `export const call` of type
`ValidationCall`.

## PII / do-not-commit

**Real call files are gitignored and must never be committed.** `.gitignore`
tracks only this README and `_template.call.ts`; every other `*.call.ts` here
stays local. Redact PII before saving (`provenance.redacted: true`), keep real
transcripts in an access-controlled store, and record consent. No customer data,
credentials, or PII belongs in the repository.

> Durable storage of real calls, outcomes, and learning lineage is
> **aion-data**'s responsibility (Phase 2). This directory is a lightweight
> local intake to prove the validation loop end-to-end, not the system of record.
