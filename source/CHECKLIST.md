# Project Best Practices Checklist

## Build and Data
- Deterministic-first, LLM-second (no speculative outputs without computed stats)
- Idempotent builds (same inputs → same HTML)
- Prior-window comparison artifacts
  - Generate data/metrics_digest_prev.json automatically (done)
  - Show deltas on KPI chips (TIR/TBR/TAR/CV/GRI)
- Caching
  - Normalize and cache parsed inputs for faster rebuilds (TODO)
  - Keep heavy SVGs versioned in dist/, inline only small SVGs
- Observability
  - Header includes inputs hash (done)
  - Log build elapsed time and sizes (TODO)
- UX
  - Compact KPI strip with deltas (done)
  - Dynamic "How to read" + 3–5 takeaways on major visuals (Corrections done; AGP/Meals done)
  - A11y: role="img" + aria-label on SVGs (done)
  - Print/PDF-friendly: chips retained; details as endnotes (TODO)

## Prompting (Anthropic/Opus)
- Tight role/system constraints reflecting guardrails (decision support, no numeric dosing)
- Provide minimal, relevant context (counts/percents/percentiles), avoid raw dumps
- Output schema: Hypothesis Card fields; small, validated JSON when possible
- Few-shot over many-shot; include 1–2 high-quality exemplars
- Instruct model not to restate inputs; bullet-first, concise style
- Optional critique pass for consistency (facts ↔ conclusions)
- Token discipline: cap max_tokens to expected schema size; avoid long reasoning

## Safety and Scope
- Read-only posture; no writes to Nightscout or therapy systems
- Directional recommendations only; confidence and coverage always stated
- Hypoglycemia risk prioritized in ordering and callouts

## Tooling and Ops
- Keep skills audited; no third-party installs without review
- Prefer local docs first; avoid unnecessary web calls
- Brave Search: enable with BRAVE_API_KEY when broader web research needed

## Next Improvements
- Build stats card (elapsed per step, asset sizes)
- Prior-window computation by exact date math (not just prior file)
- Extend insights to dinner lens and constraints gating summary
- Add print stylesheet for PDF exports
