# Experiments.md — How the Experiments Work (Lunch Timing, Corrections)

Purpose
- Give a simple, repeatable way to test changes that can improve outcomes (measured by risk chips), without prescribing numeric setting edits.
- Keep analysis deterministic, exclusions explicit, and results easy to read at a glance.

Key outcomes and risk chips (standard across experiments)
- Outcomes (context‑dependent):
  - Lunch timing: 4h TAR after meal; 2h peak; time to 180 min
  - Corrections: 120‑min dose‑normalized BG drop per unit; % still rising at 120 min
  - Overnight fasting (reference for decisions): drift slope 12–4am
- Risk/constraints: Pred ≤ suspend, AB cadence (auto‑bolus usage rate), Max basal hits (de‑emphasize if 0%)
- Stability/context: CV and GRI; sample size n; CGM coverage notes when relevant

Clean‑window rules (eligibility/exclusions)
- Meals (timing):
  - Identify meals as carb entries ≥10 g; find nearest bolus in a window [−60, +30] minutes.
  - Require a CGM value near the meal start (prefer ±5 min; fallback ±10 min).
  - Analyze a 4‑hour window post meal.
- Corrections (120 m lens):
  - Delivered corrections only (manual and/or AB when flagged); exclude <0.3 U to avoid per‑U distortion.
  - Exclude carbs/exercise ±4 h; censor if suspend >5 min or additional bolus occurs in [0, +120] min (kept for sensitivity only).
  - Require CGM coverage ≥85% across [−30, +120] min around the correction start.

Data sources (local files)
- data/meal_timing_analysis.json (from scripts/analyze_meal_timing.js)
  - Groups by pre‑bolus lead bins (e.g., pre10–19, pre≥20) and time windows (overall, lunch, school lunch).
  - Provides: n, %>180 in 4h, median peak, time to 180, start BG, Δpeak, start trend tag.
- data/correction_context.json (from scripts/analyze_correction_context.js)
  - Provides per‑band medians at 120 m (and 180 m), % “ineffective at 2h” (<30 mg/dL drop), sample counts, and gating metadata.
- data/experiments.json
  - Declares active/past experiments (name, window, goal, primary metric, status).
- data/scenario_cards.json (from scripts/scenario_cards.js)
  - Assembles the visible cards, linking a hypothesis, direction, evidence bullets (n, medians, % ineffective), confidence, confounders, safety, and next steps.

Experiments v1 (current patterns)
1) Lunch timing (Weekdays lunch window)
- Hypothesis: Earlier visible dosing (e.g., +10 → +20 min) lowers post‑meal TAR more safely than changing ICR first.
- Arms: +10 min pre‑bolus; +20 min pre‑bolus (use what’s feasible; this is guidance, not a prescription).
- Primary metric: 4h TAR; secondary: 2h peak; risk: Pred ≤ suspend, TBR (via chips).
- Inclusion: carb ≥10 g; nearest bolus in [−60, +30] min; CGM present ±10 min at start.
- Display: per lead‑bin summaries; “Quick take” gives directional read, with sample size n and chips.

2) Corrections calibration (any time; stratified)
- Hypothesis: Midday corrections under‑respond at low/mid IOB, while overnight corrections behave well; daytime ISF may be the lead lever if constraints aren’t binding.
- Arms: directional only (stronger/weaker ISF as a hypothesis); we do not output numeric setting changes.
- Primary metric: 120‑min dose‑normalized drop per unit; secondary: % still rising at 120 min.
- Inclusion: delivered ≥0.3 U; no carbs/exercise ±4 h; no suspend >5 min or extra bolus in [0, +120] (else censored); CGM ≥85%.
- Display: banded by IOB and daypart; “Quick take” includes n and risk chips; medians shown as absolute drops (mg/dL), and “Ineffective at 2h” is computed against that same metric (<30 mg/dL).

Small‑n guardrails and language
- When n ≤ 6 in a cell/arm, display a “Low sample size” tag and use softer “Quick take” phrasing.
- Confidence labels reflect n and internal consistency; “Quick take” tone aligns to the Confidence chip.

Risk‑aware phrasing rules
- If Pred ≤ suspend is red or Max basal hits >0, prefer caution on stacking/timing and avoid overly strong “ISF stronger ~20% stays the lead lever” language.
- ISF/ICR/basal changes are always directional suggestions; the page does not prescribe patient‑specific numeric changes.

How to interpret the cards
- Read the linked hypothesis line first to anchor context.
- Scan the chips for risk/constraints (Pred ≤ suspend, AB cadence, Max basal) and stability (CV, GRI), then look at outcome medians and n.
- Favor actions with a consistent directional signal across days and adequate n, without worsening risk chips.

Validation cadence (lightweight)
- Aim for 3–5 clean events per arm/context before calling direction.
- Stop or pause an arm early if TBR, Pred ≤ suspend, or AB cadence deteriorate materially.
- After adopting a change (e.g., earlier lunch dosing), re‑check a few events to confirm no regression in risk.

References (source files)
- scripts/analyze_meal_timing.js — meal timing metrics
- scripts/analyze_correction_context.js — clean‑window logic and correction medians
- scripts/scenario_cards.js — cards assembly logic
- data/experiments.json — declared experiments

Notes
- All analytics are read‑only and intended for decision support; the user remains responsible for therapy decisions.
- Numeric setting changes are intentionally out of scope; we surface what levers to consider and when, with safety/context.
