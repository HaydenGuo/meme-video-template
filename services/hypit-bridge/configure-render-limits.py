#!/usr/bin/python3
"""服务空闲时以 root 执行；保留模型与凭据，重启由调用者负责。"""
import json
import os
from pathlib import Path
import shutil

def configure(profile=Path('/etc/hypit-bridge/hypit.runtime.json')):
    if os.geteuid() != 0:
        raise SystemExit('需要 root')
    runtime = json.loads(profile.read_text())
    backup = profile.with_name('hypit.runtime.before-render-limits.json')
    if not backup.exists():
        shutil.copy2(profile, backup)
        backup.chmod(0o640)
    wrapper = Path(__file__).resolve().with_name('ffmpeg-bounded.py')
    wrapper.chmod(0o755)
    for endpoint in runtime.get('endpoints', {}).values():
        if endpoint.get('use') not in ('@hypit/media-local', '@hypit/provider-html-local'):
            continue
        config = endpoint.setdefault('config', {})
        config.update(ffmpegPath=str(wrapper), defaultConcurrency=1)
        if endpoint['use'] == '@hypit/provider-html-local':
            config.update(workers=1, maxWorkers=1, browserCapacity=1)
    info = profile.stat()
    candidate = profile.with_suffix('.next')
    candidate.write_text(json.dumps(runtime, indent=2) + '\n')
    candidate.chmod(info.st_mode & 0o777)
    os.chown(candidate, info.st_uid, info.st_gid)
    candidate.replace(profile)
    # 只提高 Runtime 线程名额，模型并发、内存和 CPU 限制保持不变。
    dropin = Path('/etc/systemd/system/hypit-runtime.service.d')
    dropin.mkdir(parents=True, exist_ok=True)
    (dropin / 'render-limits.conf').write_text('[Service]\nTasksMax=512\n')

if __name__ == '__main__':
    configure()
    print('已配置合成资源限制；请在无活动 Build 时重启 hypit-runtime。')
