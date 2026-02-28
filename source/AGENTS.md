# Diabetes Review Workflow (Nightscout + Loop)
## Goal
Produce a short set of **actionable, evidence-backed hypotheses** about
which settings/levers are most likely responsible for observed patterns:
- Basal schedule issues (time-blocked drift)
- Carb ratio issues (meal-window response)
- ISF/correction issues (correction effectiveness/overshoot)
- Insulin action / absorption mismatch signals
- Loop constraint / safety-limit gating signals
The LLM is a **narrator + critic**. The deterministic engine is the source
of truth for metrics.
## Required workflow (always)
1) **Run deterministic analysis first**
- Use the `nightscout-review` skill (or equivalent) to fetch and
analyze.
- Do not produce conclusions before the analysis artifacts exist.
2) **Validate data quality**
- Confirm date range, sensor coverage, and event counts.
- If coverage is poor or sample sizes are small, lower confidence and
say so.
3) **Generate “Hypothesis Cards”**
- For each repeated pattern, propose the most plausible levers (basal
vs ICR vs ISF vs timing/model).
- Prefer hypotheses that are consistent across multiple days and
similar contexts.
4) **Prioritize likely actions**
- Rank by: (a) strength of evidence, (b) consistency/repeatability, (c)
safety risk.
5) **Output format**
Return 3–10 cards max, using this schema:
### Hypothesis Card Template
- **Title:** short phrase (e.g., “Overnight downward drift suggests basal
too strong”)
- **Time window / context:** (e.g., 12am–4am, fasting windows, post-
breakfast)
- **Candidate lever(s):** basal / ICR / ISF / insulin model / constraints
- **Direction:** “too strong / too weak / too fast / too slow /
constrained”
- **Evidence:** bullet points with computed facts (counts, percentiles,
slopes, repeated days)
- **Confidence:** High / Medium / Low (explain why)
- **Confounders:** sensor artifacts, missing entries, exercise/illness,
site changes (if detected)
- **Safety note:** what could go wrong if misinterpreted
- **Next validation step:** concrete steps for the user to confirm/deny
(what to look for next)
## Rules for “candidate actions”
- Provide **directional** actions only by default (what lever + when +
why).
- Avoid numeric deltas.
- If multiple levers could explain the pattern, state the competing
hypotheses and what would distinguish them.
## Tool-use rules
- Do not browse the web in this workspace unless explicitly asked.
- Never install third-party skills without code review.
- Keep Nightscout access read-only.