#!/usr/bin/env python3
"""既有 VPS 的 Bridge 更新：固定提交、空闲检查、私有备份、健康检查与自动回滚。"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--revision', required=True)
parser.add_argument('--reference-hashes', help='仅含 siteId、templateId、hashes 的 JSON 文件')
args = parser.parse_args()
if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', args.revision):
    raise SystemExit('需要 root 和完整提交 SHA')
os.umask(0o027)
config_path = Path('/etc/hypit-bridge/bridge.config.json')
config_stat = config_path.stat()
config = json.loads(config_path.read_text())
current = Path('/opt/meme-video/current')
previous = current.resolve(strict=True)
release = Path('/opt/meme-video/releases') / args.revision

def run(*argv):
    return subprocess.run(argv, check=True, stdout=subprocess.DEVNULL)

def ensure_idle():
    db_path = Path(config['dataDir']) / 'jobs.sqlite'
    with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as db:
        count = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('running','preparing','submitting','attention')").fetchone()[0]
    if count:
        raise RuntimeError('Bridge 存在活动或提交状态不明的任务，停止更新')

ensure_idle()
if not release.exists():
    run('git', 'clone', '--no-checkout', 'https://github.com/HaydenGuo/meme-video-template.git', str(release))
run('git', '-C', str(release), 'fetch', 'origin', args.revision)
run('git', '-C', str(release), 'checkout', '--detach', args.revision)
actual = subprocess.check_output(['git', '-C', str(release), 'rev-parse', 'HEAD'], text=True).strip()
if actual != args.revision:
    raise SystemExit('提交不匹配')
for source in (release / 'services/hypit-bridge/src').glob('*.mjs'):
    run('/usr/local/bin/node', '--check', str(source))
run('chown', '-R', 'root:hypit', str(release))

if args.reference_hashes:
    update = json.loads(Path(args.reference_hashes).read_text())
    template = config['sites'][update['siteId']]['templates'][update['templateId']]
    hashes = update['hashes']
    if set(hashes) != {str(n) for n in template['durations']}:
        raise SystemExit('哈希时长与模板不匹配')
    for values in hashes.values():
        if not isinstance(values, list) or not 1 <= len(values) <= 4 or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for v in values):
            raise SystemExit('无效的已批准哈希')
    template['referenceHashes'] = hashes

backup = config_path.parent / ('bridge-update-' + args.revision)
backup.mkdir(mode=0o700, exist_ok=False)
shutil.copy2(config_path, backup / config_path.name)
(backup / config_path.name).chmod(0o600)
token = next(line.split('=', 1)[1] for line in (config_path.parent / 'bridge.env').read_text().splitlines() if line.startswith('BRIDGE_TOKEN='))

def switch(target):
    candidate = current.with_name('bridge-update-candidate')
    if candidate.exists() or candidate.is_symlink():
        raise RuntimeError('切换临时路径已存在')
    candidate.symlink_to(target, target_is_directory=True)
    candidate.replace(current)

run('systemctl', 'stop', 'hypit-bridge.service')
try:
    # 停止接收新任务后再次检查，防止检查与停止之间有任务进入。
    ensure_idle()
    if args.reference_hashes:
        candidate = config_path.with_suffix('.update.json')
        candidate.write_text(json.dumps(config, indent=2) + '\n')
        shutil.copystat(config_path, candidate)
        stat = config_path.stat()
        os.chown(candidate, stat.st_uid, stat.st_gid)
        candidate.replace(config_path)
    switch(release)
    run('systemctl', 'start', 'hypit-bridge.service')
    for attempt in range(10):
        try:
            req = urllib.request.Request('http://127.0.0.1:8788/health', headers={'Authorization': 'Bearer ' + token})
            health = json.load(urllib.request.urlopen(req, timeout=3))
            if health.get('ok') and health.get('mode') == config['mode']:
                break
        except OSError:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('新版健康检查失败')
except Exception:
    shutil.copy2(backup / config_path.name, config_path)
    # 备份刻意收紧为 0600，恢复后还原服务所需的属组与权限。
    os.chown(config_path, config_stat.st_uid, config_stat.st_gid)
    config_path.chmod(config_stat.st_mode & 0o777)
    if current.resolve() != previous:
        switch(previous)
    run('systemctl', 'restart', 'hypit-bridge.service')
    raise RuntimeError('更新未完成，已恢复之前的 Bridge 代码和配置') from None
print(json.dumps({'revision': actual, 'previous': str(previous), 'health': health, 'modelInvoked': False}))
