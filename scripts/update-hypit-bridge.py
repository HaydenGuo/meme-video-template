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
from urllib.parse import urlsplit
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--revision', required=True)
parser.add_argument('--reference-hashes', help='仅含 siteId、templateId、hashes 的 JSON 文件')
parser.add_argument('--site-fragment', help='site:init 生成的单站点 bridge-site.json')
parser.add_argument('--engine', choices=['notoken', 'hypit'], help='切换实际执行引擎；协议 mode 保持不变')
parser.add_argument('--max-active', type=int, help='同时运行的异步模型任务上限')
parser.add_argument('--max-queued', type=int, help='Bridge 等待队列上限')
parser.add_argument('--ffmpeg-concurrency', type=int, help='VPS 本地媒体任务并发上限')
args = parser.parse_args()
if args.reference_hashes and args.site_fragment:
    raise SystemExit('不能同时使用 --reference-hashes 和 --site-fragment')
if any(value is not None and value < 1 for value in (args.max_active, args.max_queued, args.ffmpeg_concurrency)):
    raise SystemExit('并发和队列值必须大于 0')
if os.geteuid() != 0 or not re.fullmatch(r'[a-f0-9]{40}', args.revision):
    raise SystemExit('需要 root 和完整提交 SHA')
os.umask(0o027)
config_path = Path('/etc/hypit-bridge/bridge.config.json')
config_stat = config_path.stat()
config = json.loads(config_path.read_text())
previous_engine = config.get('engine', 'hypit')
current = Path('/opt/meme-video/current')
bridge_unit_path = Path('/etc/systemd/system/hypit-bridge.service')
runtime_unit_path = Path('/etc/systemd/system/hypit-runtime.service')
previous_bridge_unit = bridge_unit_path.read_text()
previous_runtime_unit = runtime_unit_path.read_text() if runtime_unit_path.exists() else None
previous_runtime_enabled = subprocess.run(['systemctl', 'is-enabled', 'hypit-runtime.service'],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
previous_runtime_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'hypit-runtime.service'],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
previous = current.resolve(strict=True)
release = Path('/opt/meme-video/releases') / args.revision

def run(*argv):
    return subprocess.run(argv, check=True, stdout=subprocess.DEVNULL)

def merge_site_fragment(config, path):
    fragment = json.loads(Path(path).read_text())
    if not isinstance(fragment, dict) or len(fragment) != 1:
        raise ValueError('站点片段必须只包含一个 siteId')
    site_id, incoming = next(iter(fragment.items()))
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', site_id) or not isinstance(incoming, dict):
        raise ValueError('站点片段格式无效')
    site = config.get('sites', {}).get(site_id)
    if not isinstance(site, dict):
        raise ValueError('Bridge 未登记该 siteId')
    origins = incoming.get('mediaOrigins')
    if not isinstance(origins, list) or not origins or any(
        not isinstance(v, str) or (parsed := urlsplit(v)).scheme != 'https' or not parsed.hostname
        or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
        for v in origins
    ):
        raise ValueError('mediaOrigins 必须是 HTTPS origin 列表')
    templates = incoming.get('templates')
    if not isinstance(templates, dict) or len(templates) != 1:
        raise ValueError('站点片段必须只包含一个模板')
    template_id, values = next(iter(templates.items()))
    template = site.get('templates', {}).get(template_id)
    if not isinstance(template, dict) or not isinstance(values, dict):
        raise ValueError('Bridge 未登记该 templateId')
    durations = template.get('durations')
    if values.get('durations') != durations:
        raise ValueError('站点片段时长必须与 Bridge 已登记时长一致')
    workflow = values.get('workflow')
    hashes = values.get('referenceHashes')
    if workflow is not None:
        cuts = workflow.get('cutFrames') if isinstance(workflow, dict) else None
        limit = max(durations) * 30 if durations else 0
        if (not isinstance(workflow, dict) or workflow.get('type') != 'reference-remix-v1' or workflow.get('frameRate') != 30
                or not isinstance(cuts, list) or not cuts or cuts[0] != 0
                or any(type(n) is not int or n < 0 or n >= limit or (i and n <= cuts[i - 1]) for i, n in enumerate(cuts))):
            raise ValueError('reference-remix-v1 工作流或 cutFrames 无效')
        if not isinstance(hashes, dict) or set(hashes) != {str(n) for n in durations}:
            raise ValueError('参考片哈希必须覆盖全部时长')
        normalized = {}
        for seconds, value in hashes.items():
            values_for_duration = value if isinstance(value, list) else [value]
            if not 1 <= len(values_for_duration) <= 4 or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9]{64}', v) for v in values_for_duration):
                raise ValueError('参考片 SHA-256 格式无效')
            normalized[seconds] = values_for_duration
        values['referenceHashes'] = normalized
    elif hashes is not None:
        raise ValueError('参考片哈希不能脱离工作流使用')
    allowed = {'durations', 'model', 'resolution', 'aspectRatio', 'imagePersonReference',
               'videoPersonReference', 'workflow', 'referenceHashes', 'prompt'}
    if set(values) - allowed:
        raise ValueError('站点片段含不支持的模板字段')
    site['mediaOrigins'] = origins
    template.update(values)
    return site_id, template_id

def verify_site_fragment(config, path):
    fragment = json.loads(Path(path).read_text())
    site_id, incoming = next(iter(fragment.items()))
    template_id, expected = next(iter(incoming['templates'].items()))
    site = config.get('sites', {}).get(site_id, {})
    actual_template = site.get('templates', {}).get(template_id, {})
    if site.get('mediaOrigins') != incoming.get('mediaOrigins'):
        raise RuntimeError('Bridge 站点媒体来源回读不匹配')
    for key in ('durations', 'workflow'):
        if actual_template.get(key) != expected.get(key):
            raise RuntimeError(f'Bridge 站点模板配置回读不匹配：{key}')
    expected_hashes = expected.get('referenceHashes', {})
    normalized_hashes = {str(seconds): value if isinstance(value, list) else [value]
                         for seconds, value in expected_hashes.items()}
    if actual_template.get('referenceHashes') != normalized_hashes:
        raise RuntimeError('Bridge 站点模板配置回读不匹配：referenceHashes')
    return {
        'siteId': site_id,
        'templateId': template_id,
        'durations': actual_template['durations'],
        'workflowConfigured': actual_template.get('workflow', {}).get('type') == 'reference-remix-v1',
        'referenceHashDurations': sorted(actual_template.get('referenceHashes', {}).keys(), key=int),
    }

def ensure_idle():
    db_path = Path(config['dataDir']) / 'jobs.sqlite'
    with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as db:
        count = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('running','preparing','submitting','attention')").fetchone()[0]
    if count:
        raise RuntimeError('Bridge 存在活动或提交状态不明的任务，停止更新')

ensure_idle()
if args.engine == 'notoken':
    provider_env = config_path.parent / 'provider.env'
    key = next((line.split('=', 1)[1].strip() for line in provider_env.read_text().splitlines()
                if line.startswith('NOTOKEN_API_KEY=')), '')
    if len(key) < 16:
        raise SystemExit('provider.env 缺少有效的 NOTOKEN_API_KEY（值不会显示）')
    del key
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
elif args.site_fragment:
    try:
        merge_site_fragment(config, args.site_fragment)
    except (KeyError, TypeError, ValueError) as error:
        raise SystemExit(str(error)) from None

if args.engine is not None:
    config['engine'] = args.engine
    config['maxActive'] = args.max_active if args.max_active is not None else (8 if args.engine == 'notoken' else 1)
    config['maxQueued'] = args.max_queued if args.max_queued is not None else (100 if args.engine == 'notoken' else 20)
    config['ffmpegConcurrency'] = args.ffmpeg_concurrency if args.ffmpeg_concurrency is not None else 2
else:
    if args.max_active is not None:
        config['maxActive'] = args.max_active
    if args.max_queued is not None:
        config['maxQueued'] = args.max_queued
    if args.ffmpeg_concurrency is not None:
        config['ffmpegConcurrency'] = args.ffmpeg_concurrency

backup = config_path.parent / f'bridge-update-{args.revision}-{time.time_ns()}'
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
    if args.reference_hashes or args.site_fragment or args.engine is not None or args.max_active is not None or args.max_queued is not None or args.ffmpeg_concurrency is not None:
        candidate = config_path.with_suffix('.update.json')
        candidate.write_text(json.dumps(config, indent=2) + '\n')
        shutil.copystat(config_path, candidate)
        stat = config_path.stat()
        os.chown(candidate, stat.st_uid, stat.st_gid)
        candidate.replace(config_path)
    if args.engine is not None:
        lines = []
        for line in previous_bridge_unit.splitlines():
            if line.startswith('After=') or line.startswith('Wants='):
                key, _, value = line.partition('=')
                services = value.split()
                if args.engine == 'notoken':
                    services = [name for name in services if name != 'hypit-runtime.service']
                elif 'hypit-runtime.service' not in services:
                    services.append('hypit-runtime.service')
                line = key + '=' + ' '.join(services)
            lines.append(line)
        bridge_unit_path.write_text('\n'.join(lines) + '\n')
        run('systemctl', 'daemon-reload')
        if args.engine == 'notoken':
            run('systemctl', 'disable', '--now', 'hypit-runtime.service')
            if subprocess.run(['systemctl', 'is-enabled', '--quiet', 'hypit-runtime.service'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                raise RuntimeError('Hypit Runtime remains enabled')
            if subprocess.run(['systemctl', 'is-active', '--quiet', 'hypit-runtime.service'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                raise RuntimeError('Hypit Runtime remains active')
        else:
            if previous_runtime_unit is None:
                raise RuntimeError('Hypit Runtime systemd unit is missing')
            run('systemctl', 'enable', 'hypit-runtime.service')
            run('systemctl', 'start', 'hypit-runtime.service')
    switch(release)
    run('systemctl', 'start', 'hypit-bridge.service')
    for attempt in range(10):
        try:
            req = urllib.request.Request('http://127.0.0.1:8788/health', headers={'Authorization': 'Bearer ' + token})
            health = json.load(urllib.request.urlopen(req, timeout=3))
            expected_engine = args.engine if args.engine is not None else previous_engine
            if health.get('ok') and health.get('mode') == config['mode'] and health.get('engine') == expected_engine:
                break
        except OSError:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('新版健康检查或执行引擎核对失败')
    site_summary = None
    if args.site_fragment:
        installed = json.loads(config_path.read_text())
        site_summary = verify_site_fragment(installed, args.site_fragment)
except Exception:
    shutil.copy2(backup / config_path.name, config_path)
    # 备份刻意收紧为 0600，恢复后还原服务所需的属组与权限。
    os.chown(config_path, config_stat.st_uid, config_stat.st_gid)
    config_path.chmod(config_stat.st_mode & 0o777)
    if args.engine is not None:
        bridge_unit_path.write_text(previous_bridge_unit)
        if previous_runtime_unit is not None:
            runtime_unit_path.write_text(previous_runtime_unit)
        run('systemctl', 'daemon-reload')
        if previous_runtime_enabled:
            subprocess.run(['systemctl', 'enable', 'hypit-runtime.service'], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.run(['systemctl', 'disable', 'hypit-runtime.service'], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if previous_runtime_active:
            subprocess.run(['systemctl', 'start', 'hypit-runtime.service'], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.run(['systemctl', 'stop', 'hypit-runtime.service'], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if current.resolve() != previous:
        switch(previous)
    run('systemctl', 'restart', 'hypit-bridge.service')
    raise RuntimeError('更新未完成，已恢复之前的 Bridge 代码、配置和服务依赖') from None
print(json.dumps({'revision': actual, 'previous': str(previous), 'health': health, 'siteConfig': site_summary, 'modelInvoked': False}))
