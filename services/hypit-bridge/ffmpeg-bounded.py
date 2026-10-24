#!/usr/bin/python3
"""限定本地媒体自动线程规模，不记录媒体路径或凭据。"""
import os
import sys

# CPUQuota 不改变 FFmpeg 探测到的 CPU 数，Chrome 线程也计入 TasksMax。
os.execv('/usr/bin/ffmpeg', [
    '/usr/bin/ffmpeg', '-cpucount', '2', '-filter_threads', '1',
    '-filter_complex_threads', '1', *sys.argv[1:],
])
