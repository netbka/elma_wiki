"""CT-side Wiki updater; never imports an ELMA configuration."""
import fcntl, hashlib, json, os, pathlib, re, subprocess, sys, tarfile, time

BASE = pathlib.Path('/opt/elma-wiki')
NAME = 'elma-wiki'

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, **kwargs).strip()

def inspect():
    return json.loads(run('docker', 'inspect', NAME))[0]

def validate(container, origin):
    env = dict(item.split('=', 1) for item in container['Config']['Env'])
    assert container['State']['Running'] and container['State']['Health']['Status'] == 'healthy'
    assert env['PUBLIC_BASE_URL'] == origin and env['DISABLE_LOCAL_LOGIN'] == '1'
    assert container['HostConfig']['PortBindings'] == {'43171/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '43171'}]}
    assert len(container['Mounts']) == 1
    mount = container['Mounts'][0]
    assert mount['Type'] == 'volume' and mount['Name'] == 'wiki-data' and mount['Destination'] == '/app/.local'
    assert mount['RW'] and mount['Source'] == '/var/lib/docker/volumes/wiki-data/_data'
    assert container['HostConfig']['NetworkMode'] in ('default', 'bridge')
    assert container['HostConfig']['CapDrop'] == ['ALL']
    assert 'no-new-privileges:true' in container['HostConfig']['SecurityOpt']
    assert container['HostConfig']['Init'] and container['HostConfig']['RestartPolicy']['Name'] == 'unless-stopped'
    assert not container['HostConfig']['Privileged']
    assert env.get('VK_BOT_AUTH_TOKEN') or (env.get('EMAIL_FROM') and env.get('EMAIL_CRED_KEY'))
    return pathlib.Path(mount['Source'])

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
    assert all('\n' not in item and '\r' not in item for item in previous['Config']['Env'])
    runtime = backup / 'runtime.env'
    runtime.write_text('\n'.join(previous['Config']['Env']) + '\n')
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
        assert current['Config']['Env'] == previous['Config']['Env']
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

if __name__ == '__main__':
    os.umask(0o077)
    try:
        stage = pathlib.Path(__file__).resolve().parent
        config = json.loads((stage / 'config.json').read_text())
        # One rollout writer, including preflight, across all local callers.
        with (BASE / '.update.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            update(config, stage)
    except BaseException:
        print('Production update did not complete. Private build/test logs and backups remain on the CT.', file=sys.stderr)
        sys.exit(1)
