# DATA_SCHEMA.md

Computed aggregates relied on by the dashboard:
- metrics_digest.json: { meta:{durationDays, coverage, count}, tir:{veryLow, low, inRange, high, veryHigh}, cv, risk:{LBGI, HBGI, GRI} }
- metrics_digest_prev.json: same shape for prior window
- overlay_daily.json, review_summary.json, correction_context.json, meal_timing_analysis.json, constraints_summary.json
