import inspect
from console_service import RunManager, validate_config
from hunter_arena_env.env import HunterArenaEnv
from train import train
from evaluate import evaluate, _evaluate_once


def test_new_task_and_python_entrypoints_default_to_200_seconds():
    assert validate_config({})['max_ticks'] == 2000
    for entrypoint in (HunterArenaEnv.__init__, train, evaluate, _evaluate_once):
        assert inspect.signature(entrypoint).parameters['max_ticks'].default == 2000


def test_saved_task_time_limits_are_not_rewritten(tmp_path):
    manager = RunManager(tmp_path)
    saved = manager.create({'max_ticks': 3600})
    reopened = RunManager(tmp_path).detail(saved['id'])
    assert reopened['config']['max_ticks'] == 3600
    assert manager.create({})['config']['max_ticks'] == 2000
