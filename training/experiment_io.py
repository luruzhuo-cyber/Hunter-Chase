"""Atomic telemetry writes with bounded retry for Windows read-handle contention."""
import json
from pathlib import Path
import secrets
import time


def write_json(path, value):
    path=Path(path)
    temporary=path.with_name(path.name+'.'+secrets.token_hex(4)+'.tmp')
    try:
        temporary.write_text(json.dumps(value,ensure_ascii=True,allow_nan=False)+'\n',encoding='utf-8')
        for attempt in range(20):
            try:
                temporary.replace(path)
                return
            except PermissionError:
                if attempt==19:
                    raise
                time.sleep(min(.05,.01*(attempt+1)))
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
