"""Synthetic CT regressions; no SSH, Docker, credentials or production writes."""
import copy, importlib.util, io, json, pathlib, sys, tarfile, tempfile, types, unittest
from unittest.mock import patch

# Windows runs orchestration tests; the actual lock belongs to the Linux CT.
if sys.platform == 'win32':
    sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('prod_update', pathlib.Path(__file__).parents[1] / 'deploy/prod-update.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def container():
    return {'Id': 'old-id', 'Config': {'Image': 'old-image', 'Env': ['PUBLIC_BASE_URL=https://wiki.example.org',
            'DISABLE_LOCAL_LOGIN=1', 'VK_BOT_AUTH_TOKEN=synthetic-token'], 'Labels': {}},
            'State': {'Running': True, 'Health': {'Status': 'healthy'}},
            'Mounts': [{'Type': 'volume', 'Name': 'wiki-data', 'Destination': '/app/.local', 'RW': True,
                        'Source': '/var/lib/docker/volumes/wiki-data/_data'}],
            'HostConfig': {'PortBindings': {'43171/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '43171'}]},
                           'NetworkMode': 'default', 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
                           'Init': True, 'RestartPolicy': {'Name': 'unless-stopped'}, 'Privileged': False}}

class ProductionUpdateTests(unittest.TestCase):
    def test_rejects_wrong_origin_volume_or_public_binding(self):
        good = container()
        m.validate(good, 'https://wiki.example.org')
        variants = [copy.deepcopy(good) for _ in range(3)]
        variants[0]['Config']['Env'][0] = 'PUBLIC_BASE_URL=https://other.example.org'
        variants[1]['Mounts'][0]['Name'] = 'other-volume'
        variants[2]['HostConfig']['PortBindings']['43171/tcp'][0]['HostIp'] = '0.0.0.0'
        for bad in variants:
            with self.assertRaises(AssertionError):
                m.validate(bad, 'https://wiki.example.org')

    def exercise(self, failure):
        with tempfile.TemporaryDirectory() as tmp:
            base = pathlib.Path(tmp)
            stage = base / 'stage-12345678'
            stage.mkdir()
            with tarfile.open(stage / 'source.tar.gz', 'w:gz') as archive:
                item = tarfile.TarInfo('Dockerfile'); item.size = 4
                archive.addfile(item, io.BytesIO(b'test'))
            data = base / 'data'; data.mkdir()
            (data / 'original.bin').write_bytes(b'preserve me')
            calls = []
            active = [container()]
            def run(*args, **kwargs):
                calls.append(args)
                if failure == 'backup' and args[0:2] == ('tar', '-czf'):
                    raise RuntimeError('backup failed')
                if failure == 'create' and args[0:3] == ('docker', 'run', '-d'):
                    raise RuntimeError('container created but command failed')
                if failure == 'success' and args[0:3] == ('docker', 'run', '-d'):
                    active[0] = container()
                    active[0]['Config']['Image'] = 'elma-wiki:' + 'a' * 40
                    active[0]['Config']['Labels']['org.opencontainers.image.revision'] = 'a' * 40
                if failure == 'success' and args[0] == 'curl' and '%{http_code}' in args:
                    route = args[-1].removeprefix('https://wiki.example.org')
                    return '302' if route == '/solutions' else ('401' if route in ['/api/solutions', '/api/projects', '/api/releases', '/api/connections'] else '200')
                if args[0:3] == ('docker', 'ps', '-a'):
                    return 'elma-wiki\nelma-wiki-rollback'
                return ''
            config = {'revision': 'a' * 40, 'origin': 'https://wiki.example.org', 'check': failure == 'check'}
            with patch.object(m, 'BASE', base), patch.object(m, 'inspect', side_effect=lambda: active[0]), \
                 patch.object(m, 'validate', return_value=data), patch.object(m, 'run', side_effect=run), \
                 patch.object(m, 'wait_health', side_effect=[RuntimeError('health failed'), None] if failure == 'health' else None), patch.object(m.subprocess, 'run'), \
                 patch.object(pathlib.Path, 'is_file', return_value=True):
                if failure == 'check':
                    m.update(config, stage)
                    self.assertFalse(any(args[0] == 'docker' for args in calls))
                elif failure == 'success':
                    # Symlink creation requires extra privileges on some Windows installations.
                    with patch.object(pathlib.Path, 'symlink_to'), patch.object(m.os, 'replace'):
                        m.update(config, stage)
                    self.assertFalse(('docker', 'start', 'elma-wiki') in calls)
                    creates = [a for a in calls if a[0:3] == ('docker', 'run', '-d')]
                    self.assertEqual(len(creates), 1)
                    self.assertIn('wiki-data:/app/.local', creates[0])
                    self.assertEqual(len([a for a in calls if a[0] == 'curl']), 9)
                else:
                    with self.assertRaises(RuntimeError):
                        m.update(config, stage)
                    self.assertIn(('docker', 'start', 'elma-wiki'), calls)
                    if failure == 'backup':
                        self.assertFalse(any(args[0:2] == ('docker', 'rename') for args in calls))
                    else:
                        self.assertIn(('docker', 'stop', 'elma-wiki'), calls)
                        renames = [a for a in calls if a[0:2] == ('docker', 'rename')]
                        self.assertEqual(len(renames), 3)
                    saved = list((base / 'backups').glob('*/runtime.env'))[0].read_text()
                    self.assertEqual(saved, '\n'.join(container()['Config']['Env']) + '\n')
                    self.assertEqual((data / 'original.bin').read_bytes(), b'preserve me')

    def test_check_never_stops_or_builds(self): self.exercise('check')
    def test_backup_failure_restarts_original_without_replacement(self): self.exercise('backup')
    def test_partial_container_creation_failure_restores_original(self): self.exercise('create')
    def test_health_failure_restores_and_checks_original(self): self.exercise('health')
    def test_success_preserves_volume_and_verifies_https_routes(self): self.exercise('success')

if __name__ == '__main__': unittest.main()
