"""CT-side Wiki updater; never imports an ELMA configuration."""
import fcntl, hashlib, json, os, pathlib, re, stat, subprocess, sys, tarfile, time, uuid

BASE = pathlib.Path('/opt/elma-wiki')
NAME = 'elma-wiki'
# Host path of the wiki-data volume, mounted at /app/.local in the container.
DATA_SOURCE = '/var/lib/docker/volumes/wiki-data/_data'

# Named non-secret runtime settings an operator may add or change during a rollout. Formats follow
# lib/target-presets.mjs and lib/native-materialization-bridge.mjs, narrowed to production use.
SETTINGS = {
    'WIKI_TARGET_DEV2_URL': re.compile(r'https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?'),
    # Empty withdraws every designation: lib/target-presets.mjs reads it as no candidate, as when unset.
    'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': re.compile(r'([0-9a-f]{64}(,[0-9a-f]{64})*)?'),
    'WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID': re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'),
    'WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER': re.compile(r'(vk|email):[0-9a-f]{64}'),
    'WIKI_NATIVE_MATERIALIZATION_REVISION': re.compile(r'[0-9a-f]{40}'),
    'WIKI_NATIVE_TARGET_PROFILE_TARGET': re.compile(r'dev2'),
    # Explicit adoption of the private designation record (lib/target-designations.mjs). Only `file`;
    # it requires an empty WIKI_TARGET_DEV2_DEPLOY_CANDIDATES so no startup grant survives adoption.
    'WIKI_TARGET_DEV2_DESIGNATIONS': re.compile(r'file'),
}
BRIDGE = ['WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID', 'WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER',
          'WIKI_NATIVE_MATERIALIZATION_REVISION']

class SettingsError(ValueError):
    """A refused runtime setting; its message names keys only and may be printed."""

def apply_settings(previous, settings):
    """Return (env, changed key names): previous entries byte-identical except allowlisted settings."""
    if not isinstance(settings, dict):
        raise SettingsError('Runtime settings must be a mapping')
    for key, value in settings.items():
        # Messages name the key only, never a value.
        if key not in SETTINGS:
            raise SettingsError('Runtime setting is not allowlisted: ' + key)
        if not isinstance(value, str) or not SETTINGS[key].fullmatch(value):
            raise SettingsError('Runtime setting has an invalid format: ' + key)
    env, seen, changed = [], set(), []
    for item in previous:
        key = item.split('=', 1)[0]
        if key in settings:
            seen.add(key)
            if item != key + '=' + settings[key]:
                item = key + '=' + settings[key]
                changed.append(key)
        env.append(item)
    for key in sorted(set(settings) - seen):
        env.append(key + '=' + settings[key])
        changed.append(key)
    merged = dict(item.split('=', 1) for item in env)
    if merged.get('WIKI_TARGET_DEV2_DESIGNATIONS') == 'file' and merged.get('WIKI_TARGET_DEV2_DEPLOY_CANDIDATES'):
        raise SettingsError('File designation mode requires an empty WIKI_TARGET_DEV2_DEPLOY_CANDIDATES')
    # The server ignores a partial bridge configuration; refuse it instead of rolling out a disabled one.
    if any(merged.get(key) for key in BRIDGE + ['WIKI_NATIVE_TARGET_PROFILE_TARGET']):
        missing = [key for key in BRIDGE if not merged.get(key)]
        if missing:
            raise SettingsError('Native materialization settings are incomplete: ' + ', '.join(missing))
    return env, sorted(changed)

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, **kwargs).strip()

def inspect():
    return json.loads(run('docker', 'inspect', NAME))[0]

def data_mount(container):
    assert len(container['Mounts']) == 1
    mount = container['Mounts'][0]
    assert mount['Type'] == 'volume' and mount['Name'] == 'wiki-data' and mount['Destination'] == '/app/.local'
    assert mount['RW'] and mount['Source'] == DATA_SOURCE
    return pathlib.Path(mount['Source'])

def validate(container, origin):
    env = dict(item.split('=', 1) for item in container['Config']['Env'])
    assert container['State']['Running'] and container['State']['Health']['Status'] == 'healthy'
    assert env['PUBLIC_BASE_URL'] == origin and env['DISABLE_LOCAL_LOGIN'] == '1'
    assert container['HostConfig']['PortBindings'] == {'43171/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '43171'}]}
    data_mount(container)
    assert container['HostConfig']['NetworkMode'] in ('default', 'bridge')
    assert container['HostConfig']['CapDrop'] == ['ALL']
    assert 'no-new-privileges:true' in container['HostConfig']['SecurityOpt']
    assert container['HostConfig']['Init'] and container['HostConfig']['RestartPolicy']['Name'] == 'unless-stopped'
    assert not container['HostConfig']['Privileged']
    assert env.get('VK_BOT_AUTH_TOKEN') or (env.get('EMAIL_FROM') and env.get('EMAIL_CRED_KEY'))
    return data_mount(container)

def wait_health():
    for _ in range(40):
        if inspect()['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(2)
    raise RuntimeError('Health check failed')

def update(config, stage):
    revision = config['revision']
    assert re.fullmatch('[0-9a-f]{40}', revision)
    previous = inspect()
    data = validate(previous, config['origin'])
    ca = pathlib.Path('/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt')
    assert ca.is_file()
    run('curl', '--fail', '--silent', '--show-error', '--cacert', str(ca), config['origin'] + '/healthz')
    assert all('\n' not in item and '\r' not in item for item in previous['Config']['Env'])
    env, changed = apply_settings(previous['Config']['Env'], config.get('settings') or {})
    print(('Runtime settings to change: ' + ', '.join(changed)) if changed else 'Runtime settings: no change.', flush=True)
    if config['check']:
        print('CT preflight passed: healthy Wiki, expected origin, preserved volume, trusted HTTPS.', flush=True)
        return
    stamp = time.strftime('%Y%m%d-%H%M%S') + '-' + stage.name[-8:]
    release = BASE / 'releases' / (revision[:12] + '-' + stamp)
    release.mkdir(mode=0o700, parents=True)
    with tarfile.open(stage / 'source.tar.gz') as archive:
        # Git source archives need only regular files/directories, never links or devices.
        for entry in archive.getmembers():
            assert not pathlib.PurePosixPath(entry.name).is_absolute()
            assert '..' not in pathlib.PurePosixPath(entry.name).parts
            assert entry.isfile() or entry.isdir()
        archive.extractall(release)
    image = 'elma-wiki:' + revision
    print('Building the committed revision before stopping production…', flush=True)
    with (release / 'build.log').open('w') as log:
        subprocess.run(['docker', 'build', '--label', 'org.opencontainers.image.revision=' + revision,
                        '-t', image, '.'], cwd=release, stdout=log, stderr=log, check=True)
    # Same focused synthetic image tests used by the established rollout, with no network or production data.
    tests = ['test/server.test.mjs', 'test/solutions-api.test.mjs', 'test/managed-workspace-store.test.mjs',
             'test/managed-workspace-api.test.mjs', 'test/releases.test.mjs', 'test/vk-links.test.mjs',
             'test/solution-visual.test.mjs', 'test/project-snapshots.test.mjs', 'test/solution-handoffs.test.mjs',
             'test/vk-auth.test.mjs', 'test/actors.test.mjs']
    with (release / 'tests.log').open('w') as log:
        subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
                        '--security-opt', 'no-new-privileges:true', '--mount',
                        'type=bind,src=' + str(release / 'test') + ',dst=/app/test,readonly', image,
                        'node', '--test', *tests], stdout=log, stderr=log, check=True)
    assert inspect()['Id'] == previous['Id']
    validate(inspect(), config['origin'])
    backup = BASE / 'backups' / ('pre-' + revision[:12] + '-' + stamp)
    backup.mkdir(mode=0o700, parents=True)
    (backup / 'container.json').write_text(json.dumps(previous))
    # container.json keeps the previous environment; runtime.env is the one the new container receives.
    runtime = backup / 'runtime.env'
    runtime.write_text('\n'.join(env) + '\n')
    old = NAME + '-rollback-' + stamp
    renamed = False
    stopped = False
    try:
        print('Stopping writes and backing up private data…', flush=True)
        # Mark before issuing stop: a command timeout can leave a stopped container.
        stopped = True
        run('docker', 'stop', NAME)
        hashes = {str(p.relative_to(data)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in data.rglob('*') if p.is_file() and not p.is_symlink()}
        (backup / 'files.sha256.json').write_text(json.dumps(hashes))
        run('tar', '-czf', str(backup / 'private-data.tar.gz'), '-C', str(data), '.')
        run('tar', '-tzf', str(backup / 'private-data.tar.gz'))
        run('docker', 'rename', NAME, old)
        renamed = True
        run('docker', 'run', '-d', '--name', NAME, '--restart', 'unless-stopped', '--init',
            '--env-file', str(runtime), '-p', '127.0.0.1:43171:43171', '-v', 'wiki-data:/app/.local',
            '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
            '--label', 'org.opencontainers.image.revision=' + revision,
            '--health-cmd', 'node lib/healthcheck.mjs', '--health-interval', '10s', '--health-timeout', '5s',
            '--health-start-period', '10s', '--health-retries', '3', image)
        wait_health()
        for route, expected in [('/healthz', '200'), ('/api/session', '200'), ('/login', '200'),
                                ('/solutions', '302'), ('/api/solutions', '401'), ('/api/projects', '401'),
                                ('/api/releases', '401'), ('/api/connections', '401')]:
            assert run('curl', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}',
                       '--cacert', str(ca), config['origin'] + route) == expected
        current = inspect()
        assert current['Config']['Image'] == image
        assert current['Config']['Labels']['org.opencontainers.image.revision'] == revision
        validate(current, config['origin'])
        # Previous environment plus exactly the intended settings, nothing else.
        assert current['Config']['Env'] == env
        immutable = {p: h for p, h in hashes.items() if p.startswith(('projects/', 'managed-workspaces/', 'portals/')) or p == 'portals.json'}
        assert all((data / p).is_file() for p in hashes)
        assert all(hashlib.sha256((data / p).read_bytes()).hexdigest() == h for p, h in immutable.items())
        link = BASE / ('current-' + stamp)
        link.symlink_to(release, target_is_directory=True)
        os.replace(link, BASE / 'current')
        print('Updated Wiki production to ' + revision + '. HTTPS/auth guards and original files verified.', flush=True)
        print('Previous container and consistent private backup retained. Human two-user acceptance remains separate.', flush=True)
    except BaseException:
        if renamed:
            # Inspect names, not a success flag: docker run may create a container before failing.
            names = run('docker', 'ps', '-a', '--format', '{{.Names}}').splitlines()
            if NAME in names:
                run('docker', 'stop', NAME)
                run('docker', 'rename', NAME, NAME + '-failed-' + stamp)
            run('docker', 'rename', old, NAME)
        if stopped:
            run('docker', 'start', NAME)
            wait_health()
        print('Update failed; previous container restarted. Backup and candidate retained for inspection.', flush=True)
        raise

# DEV2 designation-only operation (#94). After the operator adopted WIKI_TARGET_DEV2_DESIGNATIONS=file
# with a normal update, this grants or withdraws exact candidate SHA-256 values in one fixed private
# record on the data volume. The running Wiki re-reads it at every delivery check, so nothing is
# built, stopped, restarted or re-created and sessions survive. Only docker inspect is called; no
# other file of the data volume is read or written. Schema: lib/target-designations.mjs.
DESIGNATION_LABEL = 'org.elma-wiki.dev2-designations'
DESIGNATION_SUPPORT = 'file-v1'
DESIGNATION_DIR = 'operator'
DESIGNATION_FILE = 'dev2-designations.json'
DESIGNATION_SCHEMA = 'wiki-dev2-designations'
MAX_DESIGNATIONS = 32
MAX_RECORD_BYTES = 8192
# The record and its directory belong to root and are readable by the Wiki user's group only.
OWNER_UID = 0
SHA256 = re.compile('[0-9a-f]{64}')
ACTIONS = ('grant', 'withdraw', 'withdraw-all')

class DesignationError(ValueError):
    """A refused designation; its message is fixed text that never contains a value and may be printed."""

def parse_designation(request):
    """Return (action, sorted candidates) of a strictly validated request."""
    if not isinstance(request, dict) or set(request) != {'action', 'candidates'}:
        raise DesignationError('Designation request is malformed')
    action, candidates = request['action'], request['candidates']
    if action not in ACTIONS or not isinstance(candidates, list) or len(candidates) > MAX_DESIGNATIONS:
        raise DesignationError('Designation request is malformed')
    if not all(isinstance(item, str) and SHA256.fullmatch(item) for item in candidates) or len(set(candidates)) != len(candidates):
        raise DesignationError('Designation candidates must be distinct lowercase SHA-256 digests')
    if (action == 'withdraw-all') != (not candidates):
        raise DesignationError('withdraw-all takes no candidate; grant and withdraw need at least one')
    return action, sorted(candidates)

def encode_designations(revision, candidates):
    record = {'schema': DESIGNATION_SCHEMA, 'version': 1, 'revision': revision, 'candidates': candidates}
    return (json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')

def parse_designations(raw):
    """Return (revision, candidates) of a record the Wiki would accept, else None. Mirrors parseDesignations."""
    if raw is None or len(raw) > MAX_RECORD_BYTES:
        return None
    try:
        value = json.loads(raw.decode('utf-8'))
    except ValueError:
        return None
    if not isinstance(value, dict) or sorted(value) != ['candidates', 'revision', 'schema', 'version']:
        return None
    revision, candidates = value['revision'], value['candidates']
    if value['schema'] != DESIGNATION_SCHEMA or type(value['version']) is not int or value['version'] != 1:
        return None
    if type(revision) is not int or not 1 <= revision <= 2 ** 53 - 1:
        return None
    if not isinstance(candidates, list) or len(candidates) > MAX_DESIGNATIONS:
        return None
    if not all(isinstance(item, str) and SHA256.fullmatch(item) for item in candidates) or candidates != sorted(set(candidates)):
        return None
    return revision, candidates

def validate_designation_container(container, origin):
    """The running Wiki must already use the record: a revision that supports it and the adopted mode."""
    env = dict(item.split('=', 1) for item in container['Config']['Env'])
    assert container['State']['Running'] and container['State']['Health']['Status'] == 'healthy'
    assert env.get('PUBLIC_BASE_URL') == origin
    data = data_mount(container)
    if (container['Config'].get('Labels') or {}).get(DESIGNATION_LABEL) != DESIGNATION_SUPPORT:
        raise DesignationError('The running Wiki revision does not support file designations; update Wiki first')
    if env.get('WIKI_TARGET_DEV2_DESIGNATIONS') != 'file' or env.get('WIKI_TARGET_DEV2_DEPLOY_CANDIDATES'):
        raise DesignationError('The running Wiki has not adopted WIKI_TARGET_DEV2_DESIGNATIONS=file with an empty WIKI_TARGET_DEV2_DEPLOY_CANDIDATES')
    return data

class DesignationDirectory:
    """The fixed record directory. No link is followed; POSIX operations are relative to its open descriptor."""

    def __init__(self, data, create=True):
        self.path = data / DESIGNATION_DIR
        self.fd = None
        self.missing = False
        root = os.lstat(data)
        if stat.S_ISLNK(root.st_mode) or not stat.S_ISDIR(root.st_mode):
            raise DesignationError('The data volume is not a plain directory')
        self.gid = root.st_gid
        created = False
        try:
            info = os.lstat(self.path)
        except FileNotFoundError:
            if not create:
                # A check reports what would change without creating anything.
                self.missing = True
                return
            os.mkdir(self.path, 0o700)
            created = True
            info = os.lstat(self.path)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise DesignationError('The designation directory is not a plain directory')
        if os.open in os.supports_dir_fd and hasattr(os, 'O_DIRECTORY'):
            self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            opened = os.fstat(self.fd)
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                self.close()
                raise DesignationError('The designation directory changed while it was opened')
            if created:
                # Through the descriptor, never the path, so no link can redirect root's chown/chmod.
                # The mode is explicit: the runner's umask 077 would hide it from the Wiki user's group.
                os.fchown(self.fd, OWNER_UID, self.gid)
                os.fchmod(self.fd, 0o750)
                info = os.fstat(self.fd)
        if hasattr(os, 'getuid') and (info.st_uid != OWNER_UID or info.st_mode & 0o022):
            self.close()
            raise DesignationError('The designation directory is writable by someone other than its owner')

    def _name(self, name):
        return name if self.fd is not None else str(self.path / name)

    def _at(self):
        return {'dir_fd': self.fd} if self.fd is not None else {}

    def read(self):
        """The record's bytes, or None when it does not exist. A link or non-file is refused."""
        if self.missing:
            return None
        linked = None
        if not hasattr(os, 'O_NOFOLLOW'):
            # Without O_NOFOLLOW (Windows) open follows links, so refuse one first and match it after opening.
            try:
                linked = os.lstat(self._name(DESIGNATION_FILE))
            except FileNotFoundError:
                return None
            if not stat.S_ISREG(linked.st_mode):
                raise DesignationError('The designation record is not a plain file')
        try:
            fd = os.open(self._name(DESIGNATION_FILE), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), **self._at())
        except FileNotFoundError:
            return None
        except OSError:
            raise DesignationError('The designation record is not a plain file')
        try:
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode):
                raise DesignationError('The designation record is not a plain file')
            if linked is not None and (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino):
                raise DesignationError('The designation record changed while it was opened')
            return os.read(fd, MAX_RECORD_BYTES + 1)
        finally:
            os.close(fd)

    def write(self, raw):
        """Atomically replace the record: private temporary file, fsync, rename, directory fsync."""
        temporary = '.' + DESIGNATION_FILE + '.' + uuid.uuid4().hex + '.tmp'
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0)
        fd = os.open(self._name(temporary), flags, 0o640, **self._at())
        try:
            try:
                if hasattr(os, 'fchown'):
                    os.fchown(fd, OWNER_UID, self.gid)
                    os.fchmod(fd, 0o640)
                view = memoryview(raw)
                while view:
                    view = view[os.write(fd, view):]
                os.fsync(fd)
            finally:
                os.close(fd)
            if self.fd is not None:
                os.replace(temporary, DESIGNATION_FILE, src_dir_fd=self.fd, dst_dir_fd=self.fd)
                os.fsync(self.fd)
            else:
                os.replace(self._name(temporary), self._name(DESIGNATION_FILE))
        except BaseException:
            try:
                os.unlink(self._name(temporary), **self._at())
            except OSError:
                pass
            raise

    def remove(self):
        try:
            os.unlink(self._name(DESIGNATION_FILE), **self._at())
        except FileNotFoundError:
            pass
        if self.fd is not None:
            os.fsync(self.fd)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

def restore_designations(directory, prior):
    """Put back the exact previous record (or its absence). If that cannot be verified, remove the
    record: a missing record designates nothing, so the Wiki refuses every DEV2 deploy."""
    try:
        if prior is None:
            directory.remove()
        else:
            directory.write(prior)
        if directory.read() == prior:
            print('Designation not applied; the previous record was restored and read back.', flush=True)
            return
    except BaseException:
        pass
    try:
        directory.remove()
        assert directory.read() is None
        print('Designation not applied; the previous record could not be restored, so the record was removed and every DEV2 deploy is refused.', flush=True)
    except BaseException:
        print('Designation not applied and the record state is unverified; inspect it before any DEV2 deploy.', flush=True)

def designate(config):
    action, requested = parse_designation(config.get('designation'))
    if config.get('settings'):
        raise DesignationError('A designation-only operation changes no runtime settings')
    before = inspect()
    data = validate_designation_container(before, config['origin'])
    directory = DesignationDirectory(data, create=not config['check'])
    try:
        prior = directory.read()
        current = parse_designations(prior)
        if prior is not None and current is None and action != 'withdraw-all':
            raise DesignationError('The current designation record is invalid; only withdraw-all may replace it')
        revision, candidates = current or (0, [])
        if action == 'grant':
            target = sorted(set(candidates) | set(requested))
        elif action == 'withdraw':
            target = sorted(set(candidates) - set(requested))
        else:
            target = []
        if len(target) > MAX_DESIGNATIONS:
            raise DesignationError('At most 32 candidates may be designated')
        if current is not None and target == candidates:
            print('Designations: no change (revision %d, %d designated).' % (revision, len(candidates)), flush=True)
            return
        raw = encode_designations(revision + 1, target)
        if config['check']:
            print('Designation check passed: revision %d would designate %d candidate(s). Nothing was changed.' % (revision + 1, len(target)), flush=True)
            return
        # Compare-and-swap under the rollout lock: a record edited since it was read is never overwritten.
        if directory.read() != prior:
            raise DesignationError('The designation record changed during the operation; nothing was written')
        try:
            directory.write(raw)
            if directory.read() != raw or parse_designations(raw) != (revision + 1, target):
                raise DesignationError('Designation read-back did not match')
            after = inspect()
            if after['Id'] != before['Id'] or after['State'].get('StartedAt') != before['State'].get('StartedAt'):
                raise DesignationError('The Wiki container changed during the designation')
        except BaseException:
            restore_designations(directory, prior)
            raise
        print('Designations updated to revision %d: %d designated candidate(s). Wiki was not restarted; sessions were not touched.' % (revision + 1, len(target)), flush=True)
        print('A designation only permits an isolated dev2 test install attempt; no install, read-back or business acceptance was performed.', flush=True)
    finally:
        directory.close()

if __name__ == '__main__':
    os.umask(0o077)
    config = {}
    try:
        stage = pathlib.Path(__file__).resolve().parent
        config = json.loads((stage / 'config.json').read_text())
        # One rollout writer, including preflight, across all local callers.
        # A designation-only operation takes the same lock, so it never overlaps a rollout or another designation.
        with (BASE / '.update.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if 'designation' in config:
                designate(config)
            else:
                update(config, stage)
    except SettingsError as error:
        print(str(error) + '. Production was not changed.', file=sys.stderr)
        sys.exit(1)
    except DesignationError as error:
        print(str(error) + '. Wiki was not restarted.', file=sys.stderr)
        sys.exit(1)
    except BaseException:
        if 'designation' in config:
            print('Designation did not complete. Wiki was not restarted; no success claimed.', file=sys.stderr)
        else:
            print('Production update did not complete. Private build/test logs and backups remain on the CT.', file=sys.stderr)
        sys.exit(1)
