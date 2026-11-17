import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
describe('Windows launchers', () => {
  it('opens the demon game through a dedicated entry without starting training', () => {
    const cmd = readFileSync(resolve(root, 'START-DEMON-ARENA.cmd'), 'utf8');
    const game = readFileSync(resolve(root, 'start-hunter.ps1'), 'utf8');
    expect(cmd).toContain('-Demon');
    expect(game).toContain('[switch]$Demon');
    expect(game).toContain('?mode=demon&map=01&seed=1');
    expect(game).toContain('hunter-arena-app');
    expect(readFileSync(resolve(root,'apps/hunter-arena/index.html'),'utf8')).toContain('hunter-arena-app');
    expect(cmd).not.toMatch(/train\.py|pip.*install/i);
  });
  it('keeps ordinary launch free of training commands and prints the URL', () => {
    const game = readFileSync(resolve(root, 'start-hunter.ps1'), 'utf8');
    expect(game).toContain('http://127.0.0.1:5175');
    expect(game).not.toMatch(/train\.py|训练模型|pip.*install/i);
    expect(game).toMatch(/Read-Host/);
    expect(game).toMatch(/Wait-Job/);
    expect(game).toMatch(/Receive-Job[^\r\n]*-Keep/);
    expect(game).toMatch(/\.State/);
    expect(game).toMatch(/KeyAvailable/);
    expect(game).not.toMatch(/Stop-Process|taskkill|Get-Job\s*\|/i);
  });

  it('training launcher creates a venv, trains, evaluates, and promotes only accepted models', () => {
    const training = readFileSync(resolve(root, 'apps/hunter-arena/training/训练模型.cmd'), 'utf8');
    expect(training).toMatch(/\.venv/);
    expect(training).toMatch(/train\.py/);
    expect(training).toMatch(/evaluate\.py/);
    expect(training).toMatch(/--verify-determinism/);
    expect(training).toMatch(/promote_models\.py/);
  });
});
