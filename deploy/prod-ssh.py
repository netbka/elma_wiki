"""Local SSH transport. Credentials arrive only through stdin; host keys are pinned.

Key mode (PROD_SSH_KEY_FILE or PROD_SSH_AGENT=1) is the supported path: SSH uses the key and the
remote runner starts with `sudo -n`, which needs a NOPASSWD rule for exactly this command
(deploy/README.md). Password mode is a deprecated, time-limited fallback (engineering-platform
EP-031, until 2026-11-30): the same password logs in and is piped to `sudo -S`.
"""
import json, pathlib, shlex, sys, uuid
try:
    import paramiko
except ImportError:
    print('Install the local SSH prerequisite: python -m pip install paramiko', file=sys.stderr)
    sys.exit(1)

def key_mode(config):
    return bool(config.get('keyFile') or config.get('useAgent'))

def connect_kwargs(config):
    kwargs = dict(username=config['user'], timeout=15, auth_timeout=15, banner_timeout=15, look_for_keys=False)
    if key_mode(config):
        # Never offer a password in key mode, even if one was left in the private .env.
        kwargs.update(key_filename=config.get('keyFile') or None, allow_agent=bool(config.get('useAgent')))
    else:
        kwargs.update(password=config['password'], allow_agent=False)
    return kwargs

def remote_command(stage, config):
    script = shlex.quote(stage + '/update.py')
    if key_mode(config):
        return 'sudo -n python3 ' + script
    return 'sudo -S -p "" python3 ' + script

def main():
    config = json.load(sys.stdin)
    client = paramiko.SSHClient()
    client.load_host_keys(config['knownHosts'])
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(config['host'], **connect_kwargs(config))
        with client.open_sftp() as sftp:
            stage = sftp.normalize('.') + '/wiki-update-' + uuid.uuid4().hex
            sftp.mkdir(stage, mode=0o700)
            script = pathlib.Path(__file__).with_name('prod-update.py')
            sftp.put(str(script), stage + '/update.py')
            sftp.chmod(stage + '/update.py', 0o600)
            with sftp.open(stage + '/config.json', 'w') as out:
                out.write(json.dumps({k: config.get(k) for k in ['origin', 'revision', 'check', 'settings']}))
            sftp.chmod(stage + '/config.json', 0o600)
            if not config['check']:
                sftp.put(config['archive'], stage + '/source.tar.gz')
                sftp.chmod(stage + '/source.tar.gz', 0o600)
        stdin, stdout, stderr = client.exec_command(remote_command(stage, config), timeout=1800)
        stdout.channel.set_combine_stderr(True)
        if not key_mode(config):
            stdin.write(config['password'] + '\n')
            stdin.flush()
        stdin.channel.shutdown_write()
        for line in stdout:
            # Remote runner emits only fixed messages and revision, never Docker inspect/env/logs.
            private = [config.get(key) or '' for key in ['password', 'host', 'user', 'origin', 'keyFile']]
            for value in private + list((config.get('settings') or {}).values()):
                if len(value) > 3:
                    line = line.replace(value, '[private]')
            print(line, end='', flush=True)
        return stdout.channel.recv_exit_status()
    finally:
        client.close()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('SSH operation failed; check connectivity, trusted host pin, SSH key/agent and the NOPASSWD sudo rule. No success claimed.', file=sys.stderr)
        sys.exit(1)
