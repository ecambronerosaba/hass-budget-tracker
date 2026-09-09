# Budget Server (Home Assistant add-on)

Serves the Budget Tracker web app and its tiny JSON document API, so the app can run as a
Home Assistant add-on ("App" as of HA 2026.2 — same thing, new name) instead of only in a
browser tab with IndexedDB. Implements `docs/api-contract.md` v1 exactly: `GET api/health`,
`GET api/state`, `PUT api/state`, and static file serving. Node standard library only — no
dependencies.

## Install from the repository (recommended)

This add-on lives in a GitHub repository shaped the way Home Assistant Supervisor expects —
`repository.yaml` at the repo root, this folder (`budget-server/`, with its own `config.yaml`)
directly under it. That means Supervisor can track it like any store add-on: no manual copying,
and version bumps show up as a normal in-UI update.

1. **Settings → Add-ons → Add-on Store** (**Settings → Apps → App Store** in HA 2026.2+) → **⋮**
   → **Repositories** → paste the repo URL (e.g. `https://github.com/<you>/budget-tracker`) →
   **Add**.
2. The store reloads and **Budget Tracker** appears in the list (not under "Local"). Open it,
   hit **Install**, then **Start**.
3. Open it from the Home Assistant sidebar. Ingress means Home Assistant proxies the app behind
   your existing HA login — there is no separate port to open, expose, or forward.

From then on, a new commit that bumps `version:` in `config.yaml` shows up as an **Update**
button on the add-on's page — Supervisor diffs the version it has against what the repo
advertises, same as any store add-on. Turning on **Auto update** in the add-on's **Info** tab
(or its three-dot menu) applies that update automatically instead, with no click at all — see
the root README for the trade-off before enabling it.

## Install as a local add-on (development only)

Useful for testing a change before it's pushed, without waiting on a commit. Copy this folder
onto the Home Assistant OS machine at `/addons/budget_server`, then **Add-on Store → ⋮ → Check
for updates → Local add-ons → Budget Tracker → Install**. A local install and a repository
install can't both track the same slug at once — uninstall one before installing the other.

## Where the data lives

The whole budget is one JSON document at `/data/budget.json` inside the add-on's container.
`/data` is the directory Supervisor mounts, backs up, and preserves across add-on
restarts/updates/reinstalls — nothing durable is written anywhere else. Every accepted write
also rotates the previous document to `/data/budget.prev.json` first, so one bad write is
always recoverable by hand (stop the add-on, copy `budget.prev.json` over `budget.json`,
start it again).

## Configuration

None. There are no add-on options — Ingress supplies the port and the auth, `/data` is
provided automatically, and everything else is fixed by the deployment shape. If a real knob
becomes necessary later, add it to `config.yaml`'s `options`/`schema` rather than growing the
env-var surface in `server.mjs`.

## Rebuilding `www/`

`www/` is a checked-in **copy** of the built web app (the repo root's `dist/`) — Home
Assistant's Supervisor builds this add-on's Docker image using only this folder as build
context, so it can't reach `../../dist` itself. Before shipping a new version, rebuild the app
at the repo root and refresh the copy:

```bash
npm run build            # from the repo root — produces dist/
rm -rf ha-addon/budget-server/www
cp -r dist ha-addon/budget-server/www
```

The copy in this repo may lag behind the latest `src/` changes; that's expected during
development and is exactly why this step exists as a discrete, visible one.

## Development / testing

```bash
DATA_DIR=/tmp/budget-data STATIC_DIR=./www PORT=8099 node server.mjs
node --test test/server.test.mjs
```

`DATA_DIR`, `STATIC_DIR`, `PORT`, and `MAX_BODY_BYTES` are all read from the environment
(defaulting to the real container paths), which is what lets the test suite point a real
running instance at a scratch directory instead of `/data`.
