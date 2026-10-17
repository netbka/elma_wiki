"""Synthetic CT regressions; no SSH, Docker, credentials or production writes."""
import copy, importlib.util, io, json, os, pathlib, sys, tarfile, tempfile, types, unittest
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
               {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ' '}, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ','},
               {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ',' + 'd' * 64}, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'd' * 63},
               {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': 'd' * 64 + ',,' + 'e' * 64},
               {'WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID': 'not-a-uuid'}, {'WIKI_NATIVE_MATERIALIZATION_REVISION': 'A' * 40},
               {'WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER': 'local'}, {'WIKI_NATIVE_TARGET_PROFILE_TARGET': 'main-dev'},
               {'WIKI_NATIVE_TARGET_PROFILE_TARGET': 'dev2\n'}, {'WIKI_NATIVE_TARGET_PROFILE_TARGET': ''}]
        for settings in bad:
            with self.assertRaises(m.SettingsError) as raised:
                m.apply_settings(self.previous, settings)
            value = next(iter(settings.values()))
            if len(value) > 3:
                self.assertNotIn(value, str(raised.exception))

    def test_empty_candidate_list_withdraws_designation_and_other_keys_refuse_empty(self):
        designated = self.previous + ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES=' + SETTINGS['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES']]
        env, changed = m.apply_settings(designated, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ''})
        self.assertEqual(env, self.previous + ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES='])
        self.assertEqual(changed, ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES'])
        self.assertEqual(m.apply_settings(env, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ''}), (env, []))
        for key in sorted(set(SETTINGS) - {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES'}):
            with self.assertRaises(m.SettingsError) as raised:
                m.apply_settings(self.previous, {key: ''})
            self.assertEqual(str(raised.exception), 'Runtime setting has an invalid format: ' + key)

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

class DesignationTests(unittest.TestCase):
    """Designation-only operation on a temporary data root; only `docker inspect` is simulated."""
    A, B, C = 'a' * 64, 'b' * 64, 'c' * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = pathlib.Path(self.tmp.name) / 'data'
        self.data.mkdir()
        # Synthetic stand-ins for state the operation must never read or change.
        for name, content in [('auth/sessions.json', b'{"synthetic":true}'), ('vk-login/state.json', b'{}'),
                              ('projects/p1/original.e365', b'preserve me'), ('delivery/connections/presets/x.json', b'{}')]:
            (self.data / name).parent.mkdir(parents=True, exist_ok=True)
            (self.data / name).write_bytes(content)
        self.record = self.data / 'operator' / 'dev2-designations.json'
        self.patches = [patch.object(m, 'DATA_SOURCE', str(self.data))]
        if hasattr(os, 'getuid'):
            # The CT runner is root; a test owns its temporary directory instead.
            self.patches.append(patch.object(m, 'OWNER_UID', os.getuid()))
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.tmp.cleanup()

    def container(self, adopted=True, label=True, started='2026-10-17T00:00:00Z', candidates=None):
        value = container()
        value['Mounts'][0]['Source'] = str(self.data)
        value['State']['StartedAt'] = started
        if adopted:
            value['Config']['Env'].append('WIKI_TARGET_DEV2_DESIGNATIONS=file')
        if candidates is not None:
            value['Config']['Env'].append('WIKI_TARGET_DEV2_DEPLOY_CANDIDATES=' + candidates)
        if label:
            value['Config']['Labels'][m.DESIGNATION_LABEL] = m.DESIGNATION_SUPPORT
        return value

    def others(self):
        """Bytes and modification time of every file outside the record directory."""
        return {str(p.relative_to(self.data)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.data.rglob('*') if p.is_file() and 'operator' not in p.relative_to(self.data).parts}

    def designate(self, action, candidates=(), check=False, containers=None, settings=None):
        sequence = list(containers or [self.container()])
        inspected = []
        def inspect():
            inspected.append(1)
            return sequence[min(len(inspected), len(sequence)) - 1]
        def forbidden(*args, **kwargs):
            raise AssertionError('a designation runs no command')
        config = {'origin': 'https://wiki.example.org', 'revision': 'a' * 40, 'check': check, 'settings': settings or {},
                  'designation': {'action': action, 'candidates': list(candidates)}}
        printed = io.StringIO()
        before = self.others()
        with patch.object(m, 'inspect', side_effect=inspect), patch.object(m, 'run', side_effect=forbidden), \
             patch.object(m.subprocess, 'run', side_effect=forbidden), patch.object(m.subprocess, 'check_output', side_effect=forbidden), \
             patch('sys.stdout', printed):
            try:
                m.designate(config)
            finally:
                # Authentication, sessions and every other private file stay untouched, also on refusal.
                self.assertEqual(self.others(), before)
                self.output = printed.getvalue()
                for digest in (self.A, self.B, self.C):
                    self.assertNotIn(digest, self.output)
        return self.output

    def current(self):
        return m.parse_designations(self.record.read_bytes())

    def test_grant_and_withdraw_without_restart_preserving_other_designations(self):
        output = self.designate('grant', [self.B])
        self.assertEqual(self.current(), (1, [self.B]))
        self.assertIn('Wiki was not restarted', output)
        self.assertIn('no install, read-back or business acceptance was performed', output)
        # Another operator's grant is preserved: changes are applied to the current record under the lock.
        self.designate('grant', [self.A])
        self.assertEqual(self.current(), (2, [self.A, self.B]))
        self.assertIn('no change', self.designate('grant', [self.A]))
        self.assertEqual(self.current(), (2, [self.A, self.B]))
        self.designate('withdraw', [self.B, self.C])
        self.assertEqual(self.current(), (3, [self.A]))
        self.designate('withdraw-all')
        self.assertEqual(self.current(), (4, []))
        # The exact encoding the Wiki reader accepts; nothing else is left in the directory.
        self.assertEqual(self.record.read_bytes(), m.encode_designations(4, []))
        self.assertEqual(sorted(p.name for p in self.record.parent.iterdir()), ['dev2-designations.json'])
        if hasattr(os, 'getuid'):
            self.assertEqual(self.record.parent.stat().st_mode & 0o777, 0o750)
            self.assertEqual(self.record.stat().st_mode & 0o777, 0o640)

    def test_check_reports_without_creating_or_writing(self):
        output = self.designate('grant', [self.A], check=True)
        self.assertIn('Nothing was changed', output)
        self.assertFalse(self.record.parent.exists())
        self.designate('grant', [self.A])
        self.designate('withdraw-all', check=True)
        self.assertEqual(self.current(), (1, [self.A]))

    def test_refuses_unsupported_revision_unadopted_mode_or_startup_grants_before_writing(self):
        for running in [self.container(label=False), self.container(adopted=False), self.container(candidates=self.A)]:
            with self.assertRaises(m.DesignationError) as raised:
                self.designate('grant', [self.A], containers=[running])
            self.assertNotIn(self.A, str(raised.exception))
            self.assertFalse(self.record.parent.exists())
        with self.assertRaises(m.DesignationError):
            self.designate('grant', [self.A], settings={'WIKI_TARGET_DEV2_URL': 'https://dev2.example.test'})
        bad_origin = self.container()
        bad_origin['Config']['Env'][0] = 'PUBLIC_BASE_URL=https://other.example.org'
        with self.assertRaises(AssertionError):
            self.designate('grant', [self.A], containers=[bad_origin])
        self.assertFalse(self.record.parent.exists())

    def test_requests_carry_only_an_action_and_exact_digests(self):
        bad = [None, [], {'action': 'grant'}, {'action': 'grant', 'candidates': [self.A], 'path': '/etc/passwd'},
               {'action': 'grant', 'candidates': ['*']}, {'action': 'grant', 'candidates': [self.A.upper()]},
               {'action': 'grant', 'candidates': [self.A, self.A]}, {'action': 'grant', 'candidates': []},
               {'action': 'grant', 'candidates': self.A}, {'action': 'withdraw-all', 'candidates': [self.A]},
               {'action': 'replace', 'candidates': [self.A]}, {'action': 'grant', 'candidates': ['%064x' % i for i in range(33)]}]
        for request in bad:
            with self.assertRaises(m.DesignationError):
                m.parse_designation(request)
        self.assertEqual(m.parse_designation({'action': 'grant', 'candidates': [self.B, self.A]}), ('grant', [self.A, self.B]))

    def test_at_most_32_designations_after_merging(self):
        self.record.parent.mkdir(mode=0o750)
        self.record.write_bytes(m.encode_designations(7, ['%064x' % i for i in range(32)]))
        with self.assertRaises(m.DesignationError):
            self.designate('grant', [self.A])
        self.assertEqual(self.current()[0], 7)

    def test_invalid_record_blocks_grants_but_withdraw_all_replaces_it(self):
        self.record.parent.mkdir(mode=0o750)
        for invalid in [b'not json', b'{"schema":"wiki-dev2-designations","version":1,"revision":1,"candidates":["' + self.B.encode() + b'","' + self.A.encode() + b'"]}',
                        m.encode_designations(1, [self.A])[:-2] + b',"extra":1}', b'x' * 9000]:
            self.record.write_bytes(invalid)
            with self.assertRaises(m.DesignationError):
                self.designate('grant', [self.C])
            self.assertEqual(self.record.read_bytes(), invalid)
        self.designate('withdraw-all')
        self.assertEqual(self.current(), (1, []))

    def test_record_or_directory_links_are_refused(self):
        outside = pathlib.Path(self.tmp.name) / 'outside'
        outside.mkdir()
        try:
            (self.data / 'operator').symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('creating a symbolic link needs extra privileges on this Windows host')
        with self.assertRaises(m.DesignationError):
            self.designate('grant', [self.A])
        self.assertEqual(list(outside.iterdir()), [])
        (self.data / 'operator').unlink()
        self.record.parent.mkdir(mode=0o750)
        target = outside / 'elsewhere.json'
        target.write_bytes(m.encode_designations(1, [self.B]))
        self.record.symlink_to(target)
        with self.assertRaises(m.DesignationError):
            self.designate('grant', [self.A])
        self.assertEqual(target.read_bytes(), m.encode_designations(1, [self.B]))
        self.assertTrue(self.record.is_symlink())

    @unittest.skipUnless(hasattr(os, 'getuid'), 'ownership and permission bits exist only on POSIX; the CT is Linux')
    def test_group_writable_directory_is_refused(self):
        self.record.parent.mkdir(mode=0o750)
        os.chmod(self.record.parent, 0o770)
        with self.assertRaises(m.DesignationError):
            self.designate('grant', [self.A])
        self.assertFalse(self.record.exists())

    def test_record_changed_by_another_writer_is_never_overwritten(self):
        self.designate('grant', [self.A])
        original = m.DesignationDirectory.read
        calls = []
        def concurrent(directory):
            calls.append(1)
            if len(calls) == 2:
                self.record.write_bytes(m.encode_designations(2, [self.A, self.C]))
            return original(directory)
        with patch.object(m.DesignationDirectory, 'read', concurrent), self.assertRaises(m.DesignationError) as raised:
            self.designate('grant', [self.B])
        self.assertIn('changed during the operation', str(raised.exception))
        self.assertEqual(self.current(), (2, [self.A, self.C]))

    def test_failed_read_back_restores_the_previous_record(self):
        self.designate('grant', [self.A])
        prior = self.record.read_bytes()
        original = m.DesignationDirectory.write
        def corrupt(directory, raw):
            original(directory, raw if raw == prior else raw.replace(b'"revision":2', b'"revision":9'))
        with patch.object(m.DesignationDirectory, 'write', corrupt), self.assertRaises(m.DesignationError):
            self.designate('grant', [self.B])
        self.assertEqual(self.record.read_bytes(), prior)
        self.assertIn('previous record was restored and read back', self.output)

    def test_failed_first_designation_leaves_no_record(self):
        original = m.DesignationDirectory.write
        def corrupt(directory, raw):
            original(directory, raw[:-3] + b'"]}\n')
        with patch.object(m.DesignationDirectory, 'write', corrupt), self.assertRaises(m.DesignationError):
            self.designate('grant', [self.B])
        self.assertFalse(self.record.exists())

    def test_unrestorable_record_is_removed_so_designations_fail_closed(self):
        self.designate('grant', [self.A])
        original, calls = m.DesignationDirectory.write, []
        def failing(directory, raw):
            calls.append(raw)
            if len(calls) == 1:
                original(directory, raw.replace(b'"revision":2', b'"revision":9'))
            else:
                raise OSError('disk full')
        with patch.object(m.DesignationDirectory, 'write', failing), self.assertRaises(m.DesignationError):
            self.designate('grant', [self.B])
        self.assertFalse(self.record.exists())
        self.assertIn('record was removed', self.output)

    def test_a_container_restart_during_the_operation_restores_the_previous_record(self):
        self.designate('grant', [self.A])
        prior = self.record.read_bytes()
        with self.assertRaises(m.DesignationError):
            self.designate('grant', [self.B], containers=[self.container(), self.container(started='2026-10-17T01:00:00Z')])
        self.assertEqual(self.record.read_bytes(), prior)

    def test_records_match_the_wiki_schema(self):
        self.assertEqual(m.parse_designations(m.encode_designations(3, [self.A, self.B])), (3, [self.A, self.B]))
        for raw in [m.encode_designations(0, []), m.encode_designations(True, []), m.encode_designations(1, [self.A.upper()]),
                    b'{"schema":"wiki-dev2-designations","version":2,"revision":1,"candidates":[]}',
                    b'{"schema":"other","version":1,"revision":1,"candidates":[]}', b'[]', b'\xff']:
            self.assertIsNone(m.parse_designations(raw))

    def test_adopting_file_mode_requires_an_empty_startup_candidate_list(self):
        previous = ['PUBLIC_BASE_URL=https://wiki.example.org', 'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES=' + self.A]
        with self.assertRaises(m.SettingsError) as raised:
            m.apply_settings(previous, {'WIKI_TARGET_DEV2_DESIGNATIONS': 'file'})
        self.assertNotIn(self.A, str(raised.exception))
        env, changed = m.apply_settings(previous, {'WIKI_TARGET_DEV2_DESIGNATIONS': 'file', 'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': ''})
        self.assertEqual(changed, ['WIKI_TARGET_DEV2_DEPLOY_CANDIDATES', 'WIKI_TARGET_DEV2_DESIGNATIONS'])
        # Once adopted, no startup grant can be added back.
        with self.assertRaises(m.SettingsError):
            m.apply_settings(env, {'WIKI_TARGET_DEV2_DEPLOY_CANDIDATES': self.B})
        for value in ['env', 'FILE', '']:
            with self.assertRaises(m.SettingsError):
                m.apply_settings(previous, {'WIKI_TARGET_DEV2_DESIGNATIONS': value})

    def test_transport_sends_the_designation_and_never_source_for_it(self):
        base = {'origin': 'https://wiki.example.org', 'revision': 'a' * 40, 'check': False, 'settings': {}, 'password': 'synthetic', 'host': 'ct.example.test'}
        self.assertEqual(ssh.remote_config(base), {'origin': base['origin'], 'revision': base['revision'], 'check': False, 'settings': {}})
        self.assertTrue(ssh.uploads_archive(base))
        request = {'action': 'grant', 'candidates': [self.A]}
        designation = dict(base, designation=request, archive=None)
        self.assertEqual(ssh.remote_config(designation)['designation'], request)
        self.assertNotIn('password', ssh.remote_config(designation))
        self.assertFalse(ssh.uploads_archive(designation))

if __name__ == '__main__': unittest.main()
