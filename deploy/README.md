# Update Wiki production from the local checkout

```sh
npm run prod:update
```

Run from clean `main`. The command fetches origin and fast-forwards main, sends
only a Git archive of that committed revision to the configured CT, and builds
and tests the image there before stopping the running Wiki. It never deploys an
ELMA configuration. Node 22+, Git and Python with Paramiko are local prerequisites
(`python -m pip install paramiko`).

Connection settings come from private `.env`: `PROD_IP`, `PROD_USER`, `PROD_PASS`
and `PROD_URL` (HTTPS origin or hostname). Optional `PROD_PYTHON` selects the Python
executable. The existing verified CT key in `.local/prod-known-hosts` is required;
unknown or changed keys are rejected. No credentials enter Git, command arguments
or the release archive. No new production host is inferred.

```sh
npm run prod:update -- --check
```

The check connects and verifies the existing service without building or stopping
it. It creates only a private staging directory and acquires the rollout lock.

This updater targets the established CT layout: `/opt/elma-wiki`, container
`elma-wiki`, volume `wiki-data` at `/app/.local`, loopback port 43171, and Caddy's
local CA. It refuses incompatible layouts instead of silently converting them.
SSH credentials must permit `sudo` with the same password. Remote Python 3.11+,
Docker, curl and tar are required.

Every rollout preserves the running environment (including VK polling), pauses
writes for a consistent private backup, and retains the previous container.
Health, trusted HTTPS, anonymous API rejection, revision and original artifact
hashes are checked before success. Failed activation restarts the old container;
it does not automatically overwrite the data volume with a backup. Inspect data
changes before deciding on a restore. Failed candidates and private logs are kept
for diagnosis. Never publish backup/container metadata, which include credentials
and customer content. No automatic backup/image pruning is performed.

Release logs are under `/opt/elma-wiki/releases/<revision>-<stamp>/`; backups,
runtime environment and original file hashes are under `/opt/elma-wiki/backups/`.
The `elma-wiki-rollback-<stamp>` container retains the old image and configuration.
To roll back manually after stopping writes, stop and rename the current
`elma-wiki` container, rename the selected rollback container to `elma-wiki`, then
start it and repeat health/HTTPS checks. Preserve the failed container and volume.

Restart requires users to log in again. Two-user shared-content verification and
uncoached usability remain separate acceptance steps; health checks do not prove
those observations.
