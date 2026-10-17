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

## Operator browser sign-in

An operator may save a VK Teams sign-in link in the ignored local `.env` as
`WIKI_OPERATOR_LOGIN_URL`. Treat the entire URL as a credential. With the
operator's authorization, use it to open a browser session on the configured
Wiki service; verify that it redirects to the authenticated Solutions page.
The link and session expire. When sign-in fails or expires, obtain a fresh link
from the existing VK Teams bot and replace the private value.

This optional local reference is not server configuration, a bridge token or
authorization to install an ELMA candidate. `prod:update` does not consume or
deploy it. Never commit the value, put it in documentation, test fixtures or
logs, or include it in a release archive. Documentation uses the variable name
only; the real value stays in the operator-managed private `.env`.

## Production SSH authentication

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

## Add or change named runtime settings

A rollout copies the running container's environment unchanged. To add or change one
of these non-secret settings, put it in the private, ignored file
`.local/prod-runtime-settings.env` (`KEY=value` lines; a missing file changes nothing):

| Key | Accepted value |
| --- | --- |
| `WIKI_TARGET_DEV2_URL` | lowercase HTTPS origin, no path or credentials, e.g. `https://dev2.example.invalid` |
| `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` | the owner-designated frozen candidate SHA-256 values: 64 lowercase hex each, comma-separated without spaces; an empty value (`WIKI_TARGET_DEV2_DEPLOY_CANDIDATES=`) withdraws every designation |
| `WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID` | the bridge's UUID (v4, lowercase) |
| `WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER` | the owning Wiki user ID: `vk:` or `email:` plus 64 lowercase hex |
| `WIKI_NATIVE_MATERIALIZATION_REVISION` | the pinned 40-hex elma365 worker revision |
| `WIKI_NATIVE_TARGET_PROFILE_TARGET` | `dev2` |
| `WIKI_TARGET_DEV2_DESIGNATIONS` | `file`: adopt the private designation record ([below](#designate-dev2-candidates-without-restarting-wiki)); requires an empty `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` |

Any other key, a malformed value, an empty value for any key other than
`WIKI_TARGET_DEV2_DEPLOY_CANDIDATES`, or a native materialization configuration
that would remain incomplete after merging is refused before anything changes; the
message names the key, never a value. The Wiki server (`lib/target-presets.mjs`)
reads an empty candidate list exactly like an unset one: DEV2 stays available
with no designated candidate, so every DEV2 deploy is refused. Setting it empty is
therefore how a designation is withdrawn. Both `--check` and a normal update print the key
names that would change (`Runtime settings to change: …` or `no change`). Every other
environment entry stays byte-identical. After activation the new container must have
exactly the previous environment plus those changes, otherwise the update rolls back to
the previous container. Settings already applied report `no change` on later rollouts.
Removing a key from the environment is not supported by this path; the empty candidate list above clears its designations. The backup's `container.json` keeps the
previous environment and `runtime.env` the one given to the new container.

## Designate DEV2 candidates without restarting Wiki

Sessions live in Wiki's process memory, so every update above logs every user out.
Changing `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` is such an update. PLAN-01 P8 needs
several designation changes (freeze a candidate, designate its digest, later a
recovery candidate), so after a one-time adoption the designations live in a private
operator record that the running Wiki re-reads at every delivery check.

**Adopt once (one normal update, one restart).** Put both lines in
`.local/prod-runtime-settings.env` and run `npm run prod:update`:

```sh
WIKI_TARGET_DEV2_DESIGNATIONS=file
WIKI_TARGET_DEV2_DEPLOY_CANDIDATES=
```

The update refuses `file` while the startup list still holds a digest, and refuses a
non-empty list afterwards, so no startup grant survives adoption. The deployed image
must carry the label `org.elma-wiki.dev2-designations=file-v1` (every revision since
this mode). After adoption DEV2 designates nothing until the first designation.
Remove both lines from the settings file afterwards; re-sending them reports `no change`.
Leaving the mode unset keeps the legacy startup list working unchanged.

**Designate (no restart, no build).** From clean `main`:

```sh
npm run prod:update -- --designate-grant=<sha256>[,<sha256>...]
npm run prod:update -- --designate-withdraw=<sha256>[,<sha256>...]
npm run prod:update -- --designate-withdraw-all
```

Add `--check` to see the resulting revision and count without changing anything.
Arguments carry only the action and exact 64-hex lowercase digests (up to 32); there
is no wildcard, path, host, setting or command. The same SSH pin, key and NOPASSWD rule
are used; no source archive is sent and no runtime settings file is read. On the CT the
runner takes the rollout lock, then:

1. verifies with `docker inspect` only that the running, healthy container serves the
   expected origin from the `wiki-data` volume, carries the label above and runs with
   `WIKI_TARGET_DEV2_DESIGNATIONS=file` and an empty startup list;
2. reads `<volume>/operator/dev2-designations.json` (root-owned, group of the Wiki
   user, directory `0750`, file `0640`), refusing links, non-files, group/other-writable
   directories and records over 8 KiB;
3. applies the change to the current record, so a concurrent grant is preserved
   (`withdraw-all` is the only action that may replace an invalid record);
4. refuses if the record changed since it was read, writes a temporary file, fsyncs and
   renames it atomically, reads it back and checks the exact bytes and that the
   container's ID and start time are unchanged;
5. on any failure restores the previous record (or its absence) and reads it back; if
   that cannot be verified, it removes the record so DEV2 designates nothing.

It prints only fixed messages, the revision and counts, never a digest or configuration
value. It does not build, stop, start, rename or re-create a container, call `curl`,
or read or write any other file of the volume, including authentication state.

Record format (`lib/target-designations.mjs`), one line, keys sorted, candidates sorted
and unique: `{"candidates":["<sha256>",...],"revision":<n>,"schema":"wiki-dev2-designations","version":1}`.
In file mode a missing, linked, unreadable, malformed or oversized record designates
nothing, and so does a record whose revision is lower than one the running process has
already read (a restored backup cannot resurrect a withdrawn digest). After such a
rollback, or after a failed designation whose new record the process may have read,
run another designation: it writes a higher revision. Delivery re-reads the record at
`prepare`, at its final guarded write, at `confirm`, at the last guard before dispatch
and in the operator bridge's dispatch call, and selects the read-back policy from it at
`verify`. A withdrawal never cancels an operation that is already running.

A designation only permits an attempt of an isolated dev2 test install of that exact
frozen candidate under every existing delivery guard. It is not build, native,
business or release acceptance. Its regressions (`test/prod-update.test.py`,
`test/prod-settings.test.mjs`, `test/target-designations.test.mjs`,
`test/target-presets.test.mjs`) are synthetic: temporary directories, a simulated
`docker inspect` and stand-in Targets. No live designation, install or read-back has
been run with this mode.

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

**Production status (recorded 2026-10-17):** the owner has done steps 1–5. A dedicated,
key-only `wiki-deploy` user exists with the single NOPASSWD rule
`/usr/bin/python3 /home/wiki-deploy/wiki-update-*/update.py`. The private `.env` sets
`PROD_USER=wiki-deploy` and `PROD_SSH_KEY_FILE`. The key-mode check passed on
2026-10-17. The owner deliberately keeps `PROD_PASS` in the private `.env`: it
is the administrator account's password and key mode does not use it (the updater
ignores it and reports that it is set). Step 6 is therefore not planned. The password
fallback in `tools/prod-auth.mjs` and `deploy/prod-ssh.py` stays until its scheduled
removal date, 2026-11-30.

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
