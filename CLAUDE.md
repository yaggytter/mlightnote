# MLightNote — instructions for Claude

MLightNote is a score viewer, light editor and MIDI player that runs
entirely in the browser. It is a static site. There is no API server:
parsing, MIDI transcription, rendering data, editing and storage
(IndexedDB) all run in a Web Worker (`web/src/engine/`). The spec and the
progress record are in APP_DESIGN.md. Write docs and user-facing text in
Japanese, as the existing ones are.

## Verify a change

Personal workflow rules (for example, redeploying the local site after
every change) live in `CLAUDE.local.md`, which is not committed.

- `make verify`: Vitest (including the golden tests), tsc, and the
  production build.
- `node_modules/.bin/playwright test`: the E2E suite against the Vite dev
  server.
  - Call the local binary. `npx` can stall for minutes on a registry
    round-trip.
  - After killing a run, free port 5173.
- `make deploy`: the production build behind nginx and its CSP in Docker
  (http://127.0.0.1:8080), then a browser smoke test against it
  (`e2e-docker/`).
- `make vuln`: npm audit of the production dependencies, before a
  release.
- CI (`.github/workflows/ci.yml`) runs all of the above on every pull
  request.

## Where things are

- `web/src/engine/`: the processing engine. The UI never touches it or
  IndexedDB directly. It goes through `web/src/services/api/`, which posts
  messages to the Worker (APP_DESIGN.md §8.2, §12).
- `web/src/features/`: the React screens. `web/src/services/audio/` holds
  the Web Audio engine.
- `testdata/`: small test scores, written for this project. Every new
  fixture must be original or in the public domain.
- `samplefiles/` (or `MLIGHTNOTE_SAMPLES_DIR`): real songs some E2E tests
  use when present. They are copyrighted and git-ignored: never commit
  them, quote them in docs, or derive fixtures or golden data from them.
  Tests skip when they are missing.
- `web/thirdPartyLicenses.ts`: writes `third-party-licenses.txt` into the
  build. Keep it working when adding a runtime dependency.
- `deploy/nginx.conf` and `web/public/_headers` carry the same security
  headers (CSP and others) for the local and the public site. Change both
  together. `web/src/test/deployHeaders.test.ts` checks that they match.

## Rules the code depends on

- **The golden data is frozen.** `web/src/engine/__golden__/` holds the
  outputs of the former Go implementation, removed in the frontend-only
  migration (see docs/history/FRONTEND_MIGRATION_PLAN.md). The engine must keep
  matching it. If a behavior change is intended, change the golden file
  in the same commit and say why in APP_DESIGN.md §0. Never regenerate it
  from the TypeScript output just to make a test pass.
- **Keep `.mlight` and the model JSON compatible.** The canonical model
  keeps the Go JSON shape: PascalCase keys, `null` for nil. Packages
  saved by the Go version must keep opening. A golden test covers this.
- **No runtime requests to other hosts, and no inline scripts or
  styles.** The CSP is `default-src 'self'`, and an E2E test counts
  external requests. Load workers as same-origin module files, never from
  a blob URL.
- **One operation, one IndexedDB transaction.** Inside a transaction,
  await only IndexedDB requests (APP_DESIGN.md §11.1).
- **Per-frame values stay out of React state.** The playback cursor and
  the mixer meters update the DOM directly from `requestAnimationFrame`.

## Keep the docs current

- APP_DESIGN.md §0 (実装状況) is the single progress record. Update it
  with every change: what was done, what was fixed and why, and what is
  still missing (§0.3).
- When a change makes another part of APP_DESIGN.md untrue (a
  requirement, the storage layout, an engine operation, a limit), fix
  that section in the same change. Keep the section numbers: code
  comments cite them.
- Update the in-app manual (`web/src/features/help/Manual.tsx`) when user-
  visible behavior or shortcuts change. Update docs/DEPLOY.md when the
  build or the headers change.
