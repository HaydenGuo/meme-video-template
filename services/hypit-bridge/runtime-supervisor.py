#!/usr/bin/env python3
"""用公开 CLI 维持 Hypit Worker；只管理进程，不提交生成任务。"""
import os
import signal
import subprocess
import threading

stop = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())
project = os.environ.get('HYPIT_PROJECT', '/var/lib/hypit/project')
profile = os.environ.get('HYPIT_RUNTIME', '/etc/hypit-bridge/hypit.runtime.json')
cli = project + '/node_modules/@hypit/hypit/bin/hypit.mjs'

def command(action):
    return subprocess.run(['node', cli, 'runtime', action, profile, '--project', project, '--json'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90).returncode

try:
    while not stop.is_set():
        if command('up') != 0:
            print('Hypit runtime up failed; inspect runtime status and logs.', flush=True)
        stop.wait(30)
finally:
    command('down')
