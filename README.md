# Drill Tracker

An offline-first Progressive Web App for fast shooting-drill score entry. It uses React, TypeScript, IndexedDB (via Dexie), and a small service worker—no account, server, or network is needed for normal use.

## Run locally

Install dependencies, then use the project scripts:

```bash
pnpm install
pnpm dev
pnpm build
node --test tests/scoring.test.mjs
```

## Architecture

- `app/page.tsx`: responsive Range, Quick HF, History, Manage, and Data screens.
- `lib/scoring.ts`: pure scoring and standard-evaluation functions.
- `lib/db.ts`: the IndexedDB repository boundary and demo seed data.
- `lib/types.ts`: data model for drills, courses, entries, standards, and immutable run snapshots.
- `public/sw.js`: cached app shell for offline reopening after first load.

The UI only calls the database module, leaving room for a future syncing repository without rewriting scoring or screens.

## Offline and iPhone installation

Load the site once while online, then use Safari's **Share → Add to Home Screen**. The service worker caches the app shell; drills, courses, history, and new runs live in browser IndexedDB. Test offline by opening the installed app after enabling Airplane Mode.

Browser storage can be cleared by Safari or device cleanup. Use **More → Data & Settings** to export CSV runs and a full JSON backup. Restore the JSON file there using merge, or the explicit confirmed replacement path. JSON imports are validated before database writes.
