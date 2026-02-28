# Incidents and Lessons – 2026-02-15

Context: Preparing Wave 1/2 updates for loop-digest (GitHub Pages).

What happened
- Context gap at start: Local workspace had the full code, but I initially assumed it wasn’t present → confusion about “lost code.”
- System run disabled: Couldn’t run read-only recovery scan or push previews from local site/.git.
- Console auth: Web console showed “unauthorized; gateway token missing.”
- Push target mismatch: First preview file landed on main instead of gh-pages → initial 404 on Pages.

Impact
- ~15–20 minutes of delay and confusion.
- Extra back-and-forth to enable console + identify correct push path.

Fixes applied
- Verified local code exists (scripts/, site/ with .git mirror).
- Provided recovery commands; then guided enabling console token.
- Stashed main changes, switched to gh-pages, and pushed versioned preview files there only (kept index.html untouched).
- Hid bulky Progress card in preview per request.

Prevention / improvements
- Add a visible “Push target” banner to the build header (branch + SHA + who pushed).
- Enforce gh-pages as publish-only in CI; keep main for code/spec.
- Add workflow_dispatch + schedule to avoid manual runs for data refresh.
- Add a simple guard in local helper script: if working tree is dirty on main, block checkout to gh-pages and prompt to stash.
- Document “Console token” retrieval in README-IMPORT.md and TOOLS.md.

Open items
- Populate Dinner lens table with real computed bins in Wave 2.
- Implement exact prior-window matching badges/tooltips for KPI deltas.
