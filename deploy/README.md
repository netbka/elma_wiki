# Update Wiki production from the local checkout

```sh
npm run prod:update
```

Run from clean `main`. The command fetches origin and fast-forwards main, sends
only a Git archive of that committed revision to the configured CT, and builds
and tests the image there before stopping the running Wiki. It never deploys an
ELMA configuration. Node 22+, Git and Python with Paramiko are local prerequisites
(`python -m pip install paramiko`).

Connection settings come from private `.env`: `PROD_IP`, `PROD_USER`, `PROD_URL`
(HTTPS origin or hostname) and an SSH key: `PROD_SSH_KEY_FILE` (path to a private key
kept outside this repository) or `PROD_SSH_AGENT=1` (a key already loaded into
ssh-agent, e.g. an encrypted key). Optional `PROD_PYTHON` selects the Python
executable. The existing verified CT key in `.local/prod-known-hosts` is required;
unknown or changed host keys are rejected. No credentials enter Git, command
arguments or the release archive; only the key's path is passed, never its content.
No new production host is inferred.

`PROD_PASS` (password login, with the same password piped to `sudo`) is a
**deprecated fallback allowed only until 2026-11-30** (engineering-platform EP-031,
owner decision engineering-platform#82). It is used only when no key or agent is
configured, and every run then prints a deprecation warning. From 2026-12-01
(local date) `tools/prod-auth.mjs` refuses password login and asks for a key. When a key is
configured, a leftover `PROD_PASS` is ignored and reported.

```sh
npm run prod:update -- --check
```

The check connects and verifies the existing service without building or stopping
it. It creates only a private staging directory and acquires the rollout lock.

This updater targets the established CT layout: `/opt/elma-wiki`, container
`elma-wiki`, volume `wiki-data` at `/app/.local`, loopback port 43171, and Caddy's
local CA. It refuses incompatible layouts instead of silently converting them.
With a key, the runner starts with `sudo -n` (no password), so the deploy user
needs the NOPASSWD rule from the owner checklist below; with the deprecated password
fallback, the SSH password must also permit `sudo`. Remote Python 3.11+, Docker,
curl and tar are required.

## Owner checklist: move production login to an SSH key

These steps change the production host and credentials, so they are the owner's;
no agent performs them. Do them in order and keep the old password path until step 5
passes.

1. **Create a key** on the owner's machine, for example
   `ssh-keygen -t ed25519 -f ~/.ssh/wiki-deploy_ed25519 -C wiki-deploy`, with a
   passphrase if you will use ssh-agent.
2. **Store it** in Infisical or the password manager, and keep the private key file
   outside this repository. Put its path in the private `.env` as
   `PROD_SSH_KEY_FILE`, or load it into ssh-agent and set `PROD_SSH_AGENT=1`.
3. **Install the public key** for a dedicated deploy user on the CT (recommended:
   a new user such as `wiki-deploy` used only for this updater), in that user's
   `~/.ssh/authorized_keys`, and disable password login for that user.
4. **Allow only the deploy command without a password.** As root, `visudo -f
   /etc/sudoers.d/wiki-deploy` with a single line such as
   `wiki-deploy ALL=(root) NOPASSWD: /usr/bin/python3 /home/wiki-deploy/wiki-update-*/update.py`.
   The deploy user uploads that script itself, so this rule still lets the holder of
   the key act as root; that is why the user is dedicated and key-only. It removes
   the shared, reusable sudo password, not the need to protect the key.
5. **Test** with `npm run prod:update -- --check`. It must connect with the key, print
   no deprecation warning and pass the existing checks. Then run one normal update.
6. **Remove the password**: delete `PROD_PASS` from the private `.env`, rotate or
   disable the old account's password, and open a follow-up PR that deletes the
   password fallback from `tools/prod-auth.mjs` and `deploy/prod-ssh.py` before
   2026-11-30.

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
