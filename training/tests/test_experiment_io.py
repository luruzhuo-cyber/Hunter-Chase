import json
from pathlib import Path
from experiment_io import write_json


def test_atomic_writer_retries_windows_read_handle_contention(tmp_path, monkeypatch):
    original=Path.replace
    attempts=[]
    def flaky(self,target):
        attempts.append(1)
        if len(attempts)==1:
            raise PermissionError('simulated Windows reader sharing contention')
        return original(self,target)
    monkeypatch.setattr(Path,'replace',flaky)
    write_json(tmp_path/'live.json',{'reward':1.5})
    assert len(attempts)==2
    assert json.loads((tmp_path/'live.json').read_text())=={'reward':1.5}
    assert list(tmp_path.glob('*.tmp'))==[]
