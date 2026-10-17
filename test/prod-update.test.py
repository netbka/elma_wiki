"""Synthetic CT regressions; no SSH, Docker, credentials or production writes."""
import copy, importlib.util, io, json, pathlib, sys, tarfile, tempfile, types, unittest
from unittest.mock import patch

# Windows runs orchestration tests; the actual lock belongs to the Linux CT.
if sys.platform == 'win32':
    sys.modules.setdefault('fcntl', types.SimpleNamespace())
spec = importlib.util.spec_from_file_location('prod_update', pathlib.Path(__file__).parents[1] / 'deploy/prod-update.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
# The local transport is imported without Paramiko or a network; only its pure helpers are tested.
sys.modules.setdefault('paramiko', types.SimpleNamespace())
ssh_spec = importlib.util.spec_from_file_location('prod_ssh', pathlib.Path(__file__).parents[1] / 'deploy/prod-ssh.py')
ssh = importlib.util.module_from_spec(ssh_spec)
ssh_spec.loader.exec_module(ssh)

def container():
    return {'Id': 'old-id', 'Config': {'Image': 'old-image', 'Env': ['PUBLIC_BASE_URL=https://wiki.example.org',
            'DISABLE_LOCAL_LOGIN=1', 'VK_BOT_AUTH_TOKEN=synthetic-token'], 'Labels': {}},
            'State': {'Running': True, 'Health': {'Status': 'healthy'}},
            'Mounts': [{'Type': 'volume', 'Name': 'wiki-data', 'Destination': '/app/.local', 'RW': True,
                        'Source': '/var/lib/docker/volumes/wiki-data/_data'}],
            'HostConfig': {'PortBindings': {'43171/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '43171'}]},
                           'NetworkMode': 'default', 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'],
                           'Init': True, 'RestartPolicy': {'Name': 'unless-stopped'}, 'Privileged': False}}

# Fictional values only.
SETTINGS = {'WIKI_TARGET_DEV2_URL': 'https://dev2.example.test',
            'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'd' * 64 + ',' + 'e' * 64,
            'WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID': '0b0e5c1a-1111-4222-8333-444455556666',
            'WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER': 'vk:' + 'ab' * 32,
            'WIKI_NATIVE_MATERIALIZATION_REVISION': 'c' * 40,
            'WIKI_NATIVE_TARGET_PROFILE_TARGET': 'dev2'}

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

    def exercise(self, failure, settings=None, drift=False):
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
                    # Docker receives exactly the environment file the updater wrote.
                    env_file = pathlib.Path(args[args.index('--env-file') + 1])
                    active[0]['Config']['Env'] = env_file.read_text().splitlines() + (['UNEXPECTED=1'] if drift else [])
                    active[0]['Config']['Image'] = 'elma-wiki:' + 'a' * 40
                    active[0]['Config']['Labels']['org.opencontainers.image.revision'] = 'a' * 40
                if failure == 'success' and args[0] == 'curl' and '%{http_code}' in args:
                    route = args[-1].removeprefix('https://wiki.example.org')
                    return '302' if route == '/solutions' else ('401' if route in ['/api/solutions', '/api/projects', '/api/releases', '/api/connections'] else '200')
                if args[0:3] == ('docker', 'ps', '-a'):
                    return 'elma-wiki\nelma-wiki-rollback'
                return ''
            config = {'revision': 'a' * 40, 'origin': 'https://wiki.example.org', 'check': failure == 'check', 'settings': settings}
            printed = io.StringIO()
            with patch.object(m, 'BASE', base), patch.object(m, 'inspect', side_effect=lambda: active[0]), \
                 patch.object(m, 'validate', return_value=data), patch.object(m, 'run', side_effect=run), \
                 patch.object(m, 'wait_health', side_effect=[RuntimeError('health failed'), None] if failure == 'health' else None), patch.object(m.subprocess, 'run'), \
                 patch.object(pathlib.Path, 'is_file', return_value=True), patch('sys.stdout', printed):
                if drift:
                    with patch.object(pathlib.Path, 'symlink_to'), patch.object(m.os, 'replace'), self.assertRaises(AssertionError):
                        m.update(config, stage)
                    # The unexpected container is set aside and the previous one restored and restarted.
                    self.assertTrue(any(a[0:2] == ('docker', 'rename') and a[2].startswith('elma-wiki-rollback-') and a[3] == 'elma-wiki' for a in calls))
                    self.assertIn(('docker', 'start', 'elma-wiki'), calls)
                elif failure == 'check':
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
                    expected, _ = m.apply_settings(container()['Config']['Env'], settings or {})
                    self.assertEqual(active[0]['Config']['Env'], expected)
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
                if failure not in ('check', 'success') and not drift:
                    saved = list((base / 'backups').glob('*/runtime.env'))[0].read_text()
                    self.assertEqual(saved, '\n'.join(container()['Config']['Env']) + '\n')
                    self.assertEqual((data / 'original.bin').read_bytes(), b'preserve me')
            return printed.getvalue(), calls

    def test_check_never_stops_or_builds(self): self.exercise('check')
    def test_backup_failure_restarts_original_without_replacement(self): self.exercise('backup')
    def test_partial_container_creation_failure_restores_original(self): self.exercise('create')
    def test_health_failure_restores_and_checks_original(self): self.exercise('health')
    def test_success_preserves_volume_and_verifies_https_routes(self):
        output, _ = self.exercise('success')
        self.assertIn('Runtime settings: no change.', output)

    def test_success_applies_runtime_settings_and_prints_only_key_names(self):
        output, _ = self.exercise('success', SETTINGS)
        self.assertIn('Runtime settings to change: ' + ', '.join(sorted(SETTINGS)), output)
        for value in SETTINGS.values():
            self.assertNotIn(value, output)

    def test_check_reports_runtime_setting_changes_without_docker(self):
        output, calls = self.exercise('check', {'WIKI_TARGET_DEV2_URL': SETTINGS['WIKI_TARGET_DEV2_URL']})
        self.assertIn('Runtime settings to change: WIKI_TARGET_DEV2_URL', output)
        self.assertNotIn(SETTINGS['WIKI_TARGET_DEV2_URL'], output)
        self.assertFalse(any(args[0] == 'docker' for args in calls))

    def test_unexpected_environment_after_update_restores_previous_container(self):
        self.exercise('success', SETTINGS, drift=True)

    def test_invalid_setting_is_refused_before_any_docker_or_backup(self):
        with self.assertRaises(m.SettingsError):
            self.exercise('success', {'WIKI_TARGET_DEV2_URL': 'http://dev2.example.test'})

class RuntimeSettingsTests(unittest.TestCase):
    previous = ['PATH=/usr/local/bin', 'PUBLIC_BASE_URL=https://wiki.example.org', 'WIKI_TARGET_DEV2_URL=https://old.example.test',
                'VK_BOT_AUTH_TOKEN=synthetic-token']

    def test_replaces_in_place_appends_new_keys_and_keeps_other_entries_identical(self):
        env, changed = m.apply_settings(self.previous, SETTINGS)
        self.assertEqual(env[:4], ['PATH=/usr/local/bin', 'PUBLIC_BASE_URL=https://wiki.example.org',
                                   'WIKI_TARGET_DEV2_URL=' + SETTINGS['WIKI_TARGET_DEV2_URL'], 'VK_BOT_AUTH_TOKEN=synthetic-token'])
        self.assertEqual(env[4:], [k + '=' + SETTINGS[k] for k in sorted(SETTINGS) if k != 'WIKI_TARGET_DEV2_URL'])
        self.assertEqual(changed, sorted(SETTINGS))

    def test_no_settings_or_identical_values_change_nothing(self):
        self.assertEqual(m.apply_settings(self.previous, {}), (self.previous, []))
        self.assertEqual(m.apply_settings(self.previous, {'WIKI_TARGET_DEV2_URL': 'https://old.example.test'}), (self.previous, []))

    def test_rejects_unlisted_keys_and_malformed_values_naming_only_the_key(self):
        bad = [{'VK_BOT_AUTH_TOKEN': 'x'}, {'PUBLIC_BASE_URL': 'https://other.example.org'},
               {'WIKI_TARGET_DEV2_URL': 'http://dev2.example.test'}, {'WIKI_TARGET_DEV2_URL': 'https://dev2.example.test/path'},
               {'WIKI_TARGET_DEV2_URL': 'https://user:pass@dev2.example.test'}, {'WIKI_TARGET_DEV2_URL': 'https://dev2.example.test\nX=1'},
               {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'D' * 64}, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'd' * 64 + ', ' + 'e' * 64},
               {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'd' * 64 + ','}, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'd' * 64 + '\n'},
               {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ''},
               {'WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID': 'not-a-uuid'}, {'WIKI_NATIVE_MATERIALIZATION_REVISION': 'A' * 40},
               {'WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER': 'local'}, {'WIKI_NATIVE_TARGET_PROFILE_TARGET': 'main-dev'},
               {'WIKI_NATIVE_TARGET_PROFILE_TARGET': 'dev2\n'}, {'WIKI_NATIVE_TARGET_PROFILE_TARGET': ''}]
        for settings in bad:
            with self.assertRaises(m.SettingsError) as raised:
                m.apply_settings(self.previous, settings)
            value = next(iter(settings.values()))
            if value:
                self.assertNotIn(value, str(raised.exception))

    def test_refuses_incomplete_native_materialization_configuration(self):
        partial = {k: SETTINGS[k] for k in ['WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID', 'WIKI_NATIVE_TARGET_PROFILE_TARGET']}
        with self.assertRaises(m.SettingsError) as raised:
            m.apply_settings(self.previous, partial)
        self.assertIn('WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER', str(raised.exception))
        # Completing a configuration that already exists in the previous environment is accepted.
        existing = self.previous + [k + '=' + SETTINGS[k] for k in ['WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER', 'WIKI_NATIVE_MATERIALIZATION_REVISION']]
        self.assertEqual(m.apply_settings(existing, partial)[1], sorted(partial))

class SshTransportTests(unittest.TestCase):
    stage = '/home/wiki-deploy/wiki-update-0123'

    def test_key_file_mode_never_offers_or_pipes_a_password(self):
        config = {'user': 'wiki-deploy', 'keyFile': '/keys/deploy', 'useAgent': False, 'password': 'left-over'}
        kwargs = ssh.connect_kwargs(config)
        self.assertNotIn('password', kwargs)
        self.assertEqual((kwargs['key_filename'], kwargs['allow_agent'], kwargs['look_for_keys']), ('/keys/deploy', False, False))
        self.assertEqual(ssh.remote_command(self.stage, config), 'sudo -n python3 ' + self.stage + '/update.py')

    def test_agent_mode_uses_the_agent_only(self):
        kwargs = ssh.connect_kwargs({'user': 'wiki-deploy', 'keyFile': None, 'useAgent': True, 'password': None})
        self.assertEqual((kwargs['key_filename'], kwargs['allow_agent']), (None, True))
        self.assertNotIn('password', kwargs)

    def test_deprecated_password_fallback_is_unchanged(self):
        config = {'user': 'wiki-deploy', 'keyFile': None, 'useAgent': False, 'password': 'synthetic'}
        kwargs = ssh.connect_kwargs(config)
        self.assertEqual((kwargs['password'], kwargs['allow_agent']), ('synthetic', False))
        self.assertTrue(ssh.remote_command(self.stage, config).startswith('sudo -S -p "" python3 '))

if __name__ == '__main__': unittest.main()
