# LoopDigest source snapshot (automation scripts)

This branch contains the source code used by the 7am/7pm automation jobs on Dan’s Mac (OpenClaw workspace):

- source/scripts → data fetch + analysis + dashboard build
- source/assets  → static JS assets used by the dashboard build
- source/docs    → notes about experiments and usage
- source/spec    → incident notes / misc

How this is produced
- Files are copied from ~/.openclaw/workspace-diabetes into this branch under source/ (excluding data/dist/site outputs).
- The publishing pipeline deploys dashboard HTML to gh-pages (index.html). The source here is for review/version control.

Typical flow
1) Edit scripts in source/scripts, open a PR to main.
2) After merge, pull changes onto the automation host (or set the workspace to sync) and re-run.

Notes
- No patient-identifiable data is stored here; analysis outputs live in the local workspace and the published HTML.
- BUILD_VER env var can be used to stamp dashboards to a target time (YYYYMMDD-HHMM).
