# Agent rules

## Lockfiles

- **Do not create or commit `package-lock.json`** (prohibited in this repo).
- **Prefer Bun** (`bun.lock`) for dependency changes.
- If `npm` must be used, it **must** be invoked without generating a lockfile (repo-enforced via `.npmrc`).

## CI / Deploy

- **Cloudflare Pages deploy** runs on merges/pushes to `main` via GitHub Actions (`.github/workflows/cloudflare-pages.yml`).

