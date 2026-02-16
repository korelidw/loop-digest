# Importing this bundle into korelidw/loop-digest

Branches
- main: code + /spec
- gh-pages: built site (index.html + versioned builds)

Initial import
1) Switch to main → Add file → Upload files:
   - scripts/ (all .js files)
   - spec/ (docs)
   - .github/workflows/deploy.yml
   - .gitignore
   - CHANGELOG.md, DATA_SAFETY.md, ROADMAP.md
2) Switch to gh-pages → Add file → Upload files:
   - contents of site/ (index.html + versioned index-YYYYMMDD-HHMM.html, .nojekyll)
3) Settings → Pages → select Branch: gh-pages, Folder: /
4) Settings → Actions → enable GitHub Actions

CI behavior (after import)
- On push to main: fetch (optional), build, deploy to gh-pages automatically
- On schedule (daily 06:00 UTC): fetch, build, deploy (automatic refresh)
- On demand: Actions tab → Run workflow (workflow_dispatch)
- On PRs: CI builds and uploads a "site-preview" artifact (no deploy)

Code changes workflow
- Open a pull request to main. CI will attach a site-preview artifact you can download and open locally.
- Merge to main when ready. The deploy job will publish to gh-pages → live site updates within ~1–2 minutes.

Data refresh (no code changes)
- Either wait for the scheduled run, click "Run workflow" in Actions, or push a trivial change to main (e.g., README bump) to trigger a rebuild.

Secrets (for private Nightscout or server-side fetch)
- Settings → Secrets and variables → Actions → New repository secret:
  - NIGHTSCOUT_URL: e.g., https://emmettk.herokuapp.com
  - NIGHTSCOUT_TOKEN: read-only token (omit if fully public)

Notes
- Never commit raw Nightscout data or tokens. Use CI to fetch and derive aggregates during the build.
- Keep index.html as the latest build; store versioned index-YYYYMMDD-HHMM.html alongside for rollback.
