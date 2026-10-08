"""Local SSH transport. Credentials arrive only through stdin; host keys are pinned."""
import json, pathlib, shlex, sys, uuid
try:
    import paramiko
except ImportError:
    print('Install the local SSH prerequisite: python -m pip install paramiko', file=sys.stderr)
    sys.exit(1)

def main():
    config = json.load(sys.stdin)
    client = paramiko.SSHClient()
    client.load_host_keys(config['knownHosts'])
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(config['host'], username=config['user'], password=config['password'],
                       timeout=15, auth_timeout=15, banner_timeout=15, look_for_keys=False, allow_agent=False)
        with client.open_sftp() as sftp:
            stage = sftp.normalize('.') + '/wiki-update-' + uuid.uuid4().hex
            sftp.mkdir(stage, mode=0o700)
            script = pathlib.Path(__file__).with_name('prod-update.py')
            sftp.put(str(script), stage + '/update.py')
            sftp.chmod(stage + '/update.py', 0o600)
            with sftp.open(stage + '/config.json', 'w') as out:
                out.write(json.dumps({k: config[k] for k in ['origin', 'revision', 'check']}))
            sftp.chmod(stage + '/config.json', 0o600)
            if not config['check']:
                sftp.put(config['archive'], stage + '/source.tar.gz')
                sftp.chmod(stage + '/source.tar.gz', 0o600)
        command = 'sudo -S -p "" python3 ' + shlex.quote(stage + '/update.py')
        stdin, stdout, stderr = client.exec_command(command, timeout=1800)
        stdout.channel.set_combine_stderr(True)
        stdin.write(config['password'] + '\n')
        stdin.flush()
        stdin.channel.shutdown_write()
        for line in stdout:
            # Remote runner emits only fixed messages and revision, never Docker inspect/env/logs.
            for key in ['password', 'host', 'user', 'origin']:
                value = config[key]
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
        print('SSH operation failed; check connectivity, trusted host pin and sudo access. No success claimed.', file=sys.stderr)
        sys.exit(1)
