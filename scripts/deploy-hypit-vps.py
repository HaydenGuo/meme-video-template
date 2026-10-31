#!/usr/bin/env python3
"""在 Debian VPS 以 root 执行；源码只从指定 GitHub commit 获取。不会发起模型调用。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import sqlite3
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--revision', required=True)
parser.add_argument('--engine', choices=['notoken', 'hypit'], default='notoken')
args = parser.parse_args()
if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', args.revision):
    raise SystemExit('需要 root 和完整的 Git commit SHA')
os.umask(0o027)
os.environ['DEBIAN_FRONTEND'] = 'noninteractive'
os.environ['PATH'] = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
if Path('/etc/hypit-bridge/bridge.config.json').exists():
    raise SystemExit('已有 Bridge 安装；请使用 update-hypit-bridge.py 更新')

def run(*argv, **kwargs):
    return subprocess.run(argv, check=True, **kwargs)

def write_new(path, value, mode=0o640):
    path = Path(path)
    if not path.exists():
        path.write_text(value)
        path.chmod(mode)

print('Installing Debian dependencies', flush=True)
run('apt-get', 'update', '-qq')
run('apt-get', 'install', '-y', '-qq', 'git', 'ca-certificates', 'curl', 'xz-utils', 'ffmpeg', 'python3')

# 固定 Node 版本，并校验官方发布的 SHA256；不执行下载的 shell 脚本。
version = 'v24.14.0'
archive = f'node-{version}-linux-x64.tar.xz'
node_root = Path('/opt') / f'node-{version}-linux-x64'
if not node_root.exists():
    base = f'https://nodejs.org/dist/{version}/'
    sums = urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=60).read().decode()
    expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == archive)
    target = Path('/var/tmp') / archive
    urllib.request.urlretrieve(base + archive, target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise SystemExit('Node SHA256 mismatch')
    # Debian 12 的 Python 3.11 没有 extractall(filter=...)；只解包校验后的官方归档。
    run('tar', '--extract', '--xz', '--file', str(target), '--directory', '/opt', '--no-same-owner')
for binary in ['node', 'npm', 'npx']:
    target = Path('/usr/local/bin') / binary
    desired = node_root / 'bin' / binary
    if target.is_symlink():
        if target.resolve() == desired.resolve():
            continue
        raise SystemExit('已有不同 Node 安装，停止覆盖')
    if target.exists():
        raise SystemExit('已有同名二进制文件，停止覆盖')
    target.symlink_to(desired)
run('node', '--version')

try:
    account = pwd.getpwnam('hypit')
except KeyError:
    run('useradd', '--system', '--create-home', '--home-dir', '/var/lib/hypit', '--shell', '/usr/sbin/nologin', 'hypit')
    account = pwd.getpwnam('hypit')
release = Path('/opt/meme-video/releases') / args.revision
release.parent.mkdir(parents=True, exist_ok=True)
if not release.exists():
    run('git', 'clone', '--no-checkout', 'https://github.com/HaydenGuo/meme-video-template.git', str(release))
    run('git', '-C', str(release), 'checkout', '--detach', args.revision)
actual = subprocess.check_output(['git', '-C', str(release), 'rev-parse', 'HEAD'], text=True).strip()
if actual != args.revision:
    raise SystemExit('Release revision mismatch')
run('chown', '-R', 'root:hypit', '/opt/meme-video')

project = Path('/var/lib/hypit/project')
project.mkdir(parents=True, exist_ok=True)
config = Path('/etc/hypit-bridge')
config.mkdir(mode=0o750, exist_ok=True)
if args.engine == 'hypit':
    write_new(project / 'package.json', json.dumps({
        'name': 'meme-video-hypit-runtime', 'private': True, 'type': 'module', 'hypit': {'project': True},
        'dependencies': {'@hypit/hypit': '0.3.1', '@hypit/runtime-local': '0.1.1', '@hypit/generation': '0.1.0', '@hypit/seedance': '0.2.0'}
    }, indent=2) + '\n')
    run('chown', '-R', 'hypit:hypit', '/var/lib/hypit')
    if not (project / 'node_modules/@hypit/hypit/bin/hypit.mjs').exists():
        print('Installing pinned Hypit packages', flush=True)
        command = ['npm', 'ci' if (project / 'package-lock.json').exists() else 'install', '--no-audit', '--no-fund']
        run('runuser', '-u', 'hypit', '--', *command, cwd=project)

    runtime = {
        'format': 'hypit.runtime-local@1', 'dataRoot': '/var/lib/hypit/execution',
        'credentials': {'env': {'use': '@hypit/credential-store-env'}},
        'endpoints': {'media.local': {'use': '@hypit/media-local'}}, 'bindings': {},
        'worker': {'executionMemoryMb': 1024},
    }
    write_new(config / 'hypit.runtime.json', json.dumps(runtime, indent=2) + '\n')
write_new(config / 'bridge.env', 'BRIDGE_TOKEN=' + secrets.token_hex(32) + '\nBRIDGE_OUTPUT_SECRET=' + secrets.token_hex(32) +
          '\nBRIDGE_CONFIG=/etc/hypit-bridge/bridge.config.json\nHOME=/var/lib/hypit\n', 0o640)
write_new(config / 'provider.env', '# Keep provider credentials on this VPS; never store them in Git.\n', 0o640)
bridge_config = {
    'host': '127.0.0.1', 'port': 8788, 'publicUrl': 'http://127.0.0.1:8788',
    # mode stays hypit for existing Workers; engine selects the actual generation provider.
    'mode': 'hypit', 'engine': args.engine,
    'dataDir': str(project / '.hypit/bridge'),
    'maxActive': 8 if args.engine == 'notoken' else 1,
    'maxQueued': 100 if args.engine == 'notoken' else 20,
    'ffmpegConcurrency': 2,
    'maxAgeMs': 2100000, 'retentionMs': 86400000, 'maxStorageBytes': 2147483648,
    'projectRoot': str(project), 'runtimeProfile': str(config / 'hypit.runtime.json'),
    # 没有模型 API 和正式站点资料时，拒绝全部任务；健康可用不表示生成能力已接通。
    'sites': {},
}
config_file = config / 'bridge.config.json'
config_file.write_text(json.dumps(bridge_config, indent=2) + '\n')
config_file.chmod(0o640)
run('chown', '-R', 'root:hypit', str(config))

current = Path('/opt/meme-video/current')
previous = str(current.resolve()) if current.is_symlink() else None
candidate = current.with_name('current.next')
if candidate.is_symlink():
    candidate.unlink()
candidate.symlink_to(release, target_is_directory=True)
candidate.replace(current)
Path('/etc/systemd/journald.conf.d').mkdir(exist_ok=True)
write_new('/etc/systemd/journald.conf.d/hypit-limits.conf', '[Journal]\nSystemMaxUse=128M\nRuntimeMaxUse=32M\nMaxRetentionSec=7day\n', 0o644)
run('systemctl', 'restart', 'systemd-journald')
unit_common = '''User=hypit
Group=hypit
WorkingDirectory=/var/lib/hypit/project
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOME=/var/lib/hypit
EnvironmentFile=/etc/hypit-bridge/provider.env
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/hypit
UMask=0027
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
TasksMax=128
CPUQuota=150%
'''
if args.engine == 'hypit':
    runtime_unit = '''[Unit]
Description=Hypit Runtime Worker supervisor
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
''' + unit_common + '''ExecStart=/usr/bin/python3 /opt/meme-video/current/services/hypit-bridge/runtime-supervisor.py
MemoryHigh=1536M
MemoryMax=2048M
[Install]
WantedBy=multi-user.target
'''
    Path('/etc/systemd/system/hypit-runtime.service').write_text(runtime_unit)
bridge_dependency = 'After=network-online.target hypit-runtime.service\nWants=network-online.target hypit-runtime.service\n' if args.engine == 'hypit' else 'After=network-online.target\nWants=network-online.target\n'
bridge_unit = '''[Unit]
Description=Meme Video Hypit Bridge
''' + bridge_dependency + '''[Service]
Type=simple
''' + unit_common + '''EnvironmentFile=/etc/hypit-bridge/bridge.env
ExecStart=/usr/local/bin/node /opt/meme-video/current/services/hypit-bridge/src/server.mjs
MemoryHigh=768M
MemoryMax=1024M
[Install]
WantedBy=multi-user.target
'''
Path('/etc/systemd/system/hypit-bridge.service').write_text(bridge_unit)
if args.engine == 'hypit':
    run('python3', str(release / 'services/hypit-bridge/configure-render-limits.py'))
run('systemctl', 'daemon-reload')
if args.engine == 'hypit':
    run('systemctl', 'enable', 'hypit-runtime.service')
else:
    # A direct NoToken Bridge must not start the Hypit Runtime or depend on it.
    subprocess.run(['systemctl', 'disable', '--now', 'hypit-runtime.service'], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
run('systemctl', 'enable', 'hypit-bridge.service')
run('systemctl', 'restart', 'hypit-bridge.service')

# 留一份本机受限备份：用于误改配置后的恢复，不上传到 GitHub。
backup = config / 'initial-backup'
backup.mkdir(mode=0o700, exist_ok=True)
for name in ['bridge.env', 'provider.env', 'bridge.config.json', 'hypit.runtime.json']:
    if not (backup / name).exists():
        shutil.copy2(config / name, backup / name)
        (backup / name).chmod(0o600)

token = next(line.split('=', 1)[1] for line in (config / 'bridge.env').read_text().splitlines() if line.startswith('BRIDGE_TOKEN='))
response = None
for attempt in range(15):
    try:
        req = urllib.request.Request('http://127.0.0.1:8788/health', headers={'Authorization': 'Bearer ' + token})
        response = json.load(urllib.request.urlopen(req, timeout=5))
        break
    except OSError:
        time.sleep(2)
if response is not None and (response.get('mode') != bridge_config['mode'] or response.get('engine') != args.engine):
    response = None
if response is None:
    if previous:
        candidate.symlink_to(previous, target_is_directory=True)
        candidate.replace(current)
        run('systemctl', 'restart', 'hypit-bridge.service')
    raise SystemExit('Bridge health or engine check failed; inspect systemctl/journalctl. No secrets printed.')
report = {'revision': actual, 'release': str(release), 'previous': previous,
          'node': version, 'bridgeHealth': response, 'engine': args.engine, 'generationReady': False,
          'pending': ['provider API credentials in /etc/hypit-bridge/provider.env', 'site and template registration', 'HTTPS domain before Cloudflare connection']}
Path('/var/lib/hypit/deployment.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
