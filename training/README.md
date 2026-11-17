# Hunter Arena offline training

Python owns Gymnasium and MaskablePPO; one persistent Node subprocess per environment owns the authoritative TypeScript simulation. No Python map, collision, skill, sensor, mask, or reward implementation is maintained. Node.js with the project's `tsx` dependency must be available (`npm install` at the repository root).

## Setup (PowerShell)

Run in `apps/hunter-arena/training`. On this workstation the bundled interpreter is:

```powershell
$runtimePython = 'C:\Users\gao\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
New-Item -ItemType Directory -Force .tmp | Out-Null
$env:TEMP = (Resolve-Path .tmp).Path
$env:TMP = $env:TEMP
$env:MPLCONFIGDIR = Join-Path $env:TEMP 'matplotlib'
& $runtimePython -m venv .venv
& .venv\Scripts\python.exe -m pip install -e '.[test]'
& .venv\Scripts\python.exe -m pytest -q
```

Fixed direct dependencies: Gymnasium 1.2.1, stable-baselines3 2.7.0, sb3-contrib 2.7.0, PyTorch 2.8.0, NumPy 2.3.3, pytest 8.4.2. MaskablePPO applies the legal action masks during both rollout sampling and PPO updates. Windows sandbox installations may require network approval; setting a writable temporary directory avoids `ensurepip` permission failures.

## Training and evaluation

```powershell
& .venv\Scripts\python.exe train.py --generations 1 --steps 2048 --output ../public/models/smoke
& .venv\Scripts\python.exe train.py --generations 5 --steps 250000 --output ../public/models/training
& .venv\Scripts\python.exe train.py --generations 1 --steps 250000 --output ../public/models/training --resume
& .venv\Scripts\python.exe evaluate.py --runner-policy ../public/models/training/runner-policy.json --hunter-policy ../public/models/training/hunter-policy.json --output ../public/models/training/evaluation.json
```

Each generation trains a shared runner actor (one randomly selected runner is controlled each episode) against the previous frozen hunter; the other seven runners use the previous frozen runner or scripted fallback. Hunter training then samples uniformly from the latest runner snapshot and up to three historical snapshots. Opponents are fixed for each episode. Each snapshot saves both actor/critic/optimizer checkpoint ZIP and browser actor JSON. `--steps` is the requested minimum per side; PPO rounds up to its rollout size. Default rollout is 2048.

`--resume` adds the requested number of generations from the last **fully completed generation**, loading both optimizer checkpoints. Seed and max-ticks must match. A phase interrupted within a later generation is recomputed from the last complete generation; this is not a mid-rollout/RNG checkpoint. An interrupted first generation has no complete checkpoint and should be restarted in a fresh output directory. Saved opponent references are local absolute paths; moving a run directory is not supported by resume.

The schema handshake fixes runner/hunter input sizes at 316/313 and actions at 18. Observations are the same partial sensor whitelist and encoded slots as browser inference. The initial runner is selected deterministically from the Gym seed; reset options accept `runner_index` from 0 to 7. Invalid/masked actions raise `ValueError`. Individual runner death terminates its episode; `episode_stats` from that side are censored for the other seven runners. Full-game statistics come from `evaluate.py`, which controls the immortal hunter until the world ends. The simulation's deadline is a Gym truncation; captures/last-survivor outcomes are terminations.

`metrics.json` contains reward curves, cumulative training steps, frozen-pool references, episode telemetry, and export parity. Evaluation records every runner's mean/median survival, last-survivor and skill-use rates, skill timing, post-skill survival, capture/exposure counts, blocked movement ticks, hunter discovery/loss counts and all-eliminated time. A blocked movement tick is a movement request with no position change, not proof of a permanently trapped map. Missing skill observations are null. Without JSON policies evaluation uses seeded legal-random hunter actions and the existing runner fallback.

## Compatibility evidence

`tests/fixtures/contract-v1.json` stores complete fixed-seed TS maps, observation vectors, masks and reward terms. `bridge.test.ts` checks the authoritative TS engine against those fixtures; pytest checks the Gym transport against the same expected values. Regenerate deliberately using `tsx export-fixtures.ts`; review fixture changes when the simulation contract changes. Run `tsx --test bridge.test.ts` for the TS fixture test.

Every policy export persists 100 real observations and raw actor logits from both PyTorch and the actual browser `runPolicy` in `*-policy.parity.json`. The maximum absolute error must be below `1e-5`; this is not a second Python implementation of browser inference. No VecNormalize is used, so JSON normalization is identity.

The checked-in `public/models/smoke` files are only pipeline validation (2048 steps per side), not trained quality evidence or a browser default. Their 3600-tick episode horizon exceeds the smoke rollout, so their training episode arrays may be empty. `evaluation-smoke.json` uses an explicitly shortened 128-tick horizon to exercise terminal metrics. Run full-horizon fixed-seed evaluation before selecting any production/default model. This task does not auto-promote policies.
