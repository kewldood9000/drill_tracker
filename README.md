# Drill Tracker

An offline-first Progressive Web App for fast shooting-drill score entry. It uses React, TypeScript, IndexedDB (via Dexie), and a small service worker—no account, server, or network is needed for normal use.

## Run locally

Install dependencies, then use the project scripts:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
```

## Architecture

- `app/page.tsx`: responsive Range, Quick HF, History, Manage, and Data screens.
- `lib/scoring.ts`: pure scoring and standard-evaluation functions.
- `lib/db.ts`: the IndexedDB repository boundary and demo seed data.
- `lib/types.ts`: data model for drills, courses, entries, standards, and immutable run snapshots.
- `public/sw.js`: cached app shell for offline reopening after first load.

The UI only calls the database module, leaving room for a future syncing repository without rewriting scoring or screens.

## GitHub Pages deployment

The repository includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`. On every push to `main`, it installs dependencies, runs the scoring tests, creates a static Vite build, and deploys `dist` to GitHub Pages.

In the GitHub repository, open **Settings → Pages → Build and deployment**, then select **GitHub Actions** as the source. The normal production URL is `https://USERNAME.github.io/REPOSITORY-NAME/`.

The Vite base path is automatically inferred from the repository name in Actions. For another static host or a custom project path, set `VITE_BASE_PATH` when building, for example `VITE_BASE_PATH=/shooting-tracker/ pnpm build`. This base is applied to bundles, icons, manifest, and service-worker registration.

## Offline and iPhone installation

Open the GitHub Pages URL in Safari on your iPhone, wait for the app to finish loading, then use **Share → Add to Home Screen**. Launch it from the Home Screen icon once while connected and check **More → Data & Settings** for the Offline Ready status before relying on it at the range.

The service worker caches the app shell; drills, courses, history, and new runs live in browser IndexedDB. To test offline behavior, add a sample run, close the app, enable Airplane Mode, reopen it from the Home Screen, record another run, close it, and reopen it again. Both runs should remain available without a network request.

Browser storage can be cleared by Safari or device cleanup. Use **More → Data & Settings** to export CSV runs and a full JSON backup. Restore the JSON file there using merge, or the explicit confirmed replacement path. JSON imports are validated before database writes.
