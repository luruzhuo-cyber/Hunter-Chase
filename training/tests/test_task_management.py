import pytest
from console_service import RunManager


def test_named_task_rename_and_restore_keep_configuration(tmp_path):
    manager = RunManager(tmp_path)
    run = manager.create({'name': '猎人一号', 'steps': 5000, 'generations': 3, 'seed': 42})
    assert run['name'] == '猎人一号'
    assert 'name' not in run['config']
    assert manager.rename(run['id'], '第二版')['name'] == '第二版'
    manager.archive(run['id'])
    assert manager.list_runs() == []
    assert manager.list_runs(archived=True)[0]['id'] == run['id']
    assert manager.folder(run['id']).exists()
    manager.restore(run['id'])
    restored = manager.detail(run['id'])
    assert restored['config']['steps'] == 5000
    assert restored['config']['generations'] == 3
    assert restored['config']['seed'] == 42
    assert restored['name'] == '第二版'


def test_active_task_cannot_archive_and_archived_cannot_start(tmp_path):
    manager = RunManager(tmp_path)
    run = manager.create({})
    from experiment_io import write_json
    write_json(manager.folder(run['id']) / 'task.json', {**run, 'status': 'running'})
    with pytest.raises(ValueError, match='停止'):
        manager.archive(run['id'])
    write_json(manager.folder(run['id']) / 'task.json', {**run, 'status': 'created'})
    manager.archive(run['id'])
    with pytest.raises(ValueError, match='恢复'):
        manager.start(run['id'])
    for name in ('x' * 81, 'bad\nname'):
        with pytest.raises(ValueError):
            manager.rename(run['id'], name)


def test_edit_created_config_and_fork_started_task(tmp_path):
    manager = RunManager(tmp_path)
    run = manager.create({'name': '基线', 'steps': 5000})
    edited = manager.configure(run['id'], {'steps': 8000, 'seed': 123, 'generations': 2})
    assert edited['id'] == run['id']
    assert edited['config']['steps'] == 8000
    from experiment_io import write_json
    write_json(manager.folder(run['id']) / 'task.json', {**edited, 'status': 'stopped'})
    fork = manager.configure(run['id'], {'steps': 16000, 'hunter_speed_ratio': 1.5})
    assert fork['id'] != run['id']
    assert fork['parentId'] == run['id']
    assert fork['status'] == 'created'
    assert fork['config']['hunter_speed_ratio'] == 1.5
    assert manager.detail(run['id'])['config']['steps'] == 8000
    with pytest.raises(ValueError):
        manager.configure(run['id'], {'seed': -1})
