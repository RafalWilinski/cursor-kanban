# Agent rules

## Lockfiles

- **Do not create or commit `package-lock.json`** (prohibited in this repo).
- **Prefer Bun** (`bun.lock`) for dependency changes.
- If `npm` must be used, it **must** be invoked without generating a lockfile (repo-enforced via `.npmrc`).

