import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

const temporaryDirs: string[] = [];

function makeRunsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-board-'));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('status board digest links', () => {
  it('links each checked-in night and shows its event counts', async () => {
    const response = await createApp(configFor('runs')).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('2026-10-28</a> · ok 10 · retry 4 · fail 1');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('2026-10-27</a> · ok 7 · retry 0 · fail 0');
  });

  it('keeps an empty runs directory empty', async () => {
    const response = await createApp(configFor(makeRunsDir())).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });

  it('shows event counts for a night in the configured runs directory', async () => {
    const runsDir = makeRunsDir();
    writeFileSync(
      join(runsDir, '2026-10-30.jsonl'),
      [
        JSON.stringify({ at: '2026-10-30T01:00:00Z', job: 'a', status: 'ok', owner: null }),
        JSON.stringify({ at: '2026-10-30T01:01:00Z', job: 'a', status: 'retry', owner: null }),
        JSON.stringify({ at: '2026-10-30T01:02:00Z', job: 'b', status: 'fail', owner: null }),
      ].join('\n'),
    );

    const response = await createApp(configFor(runsDir)).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-30"');
    expect(html).toContain('2026-10-30</a> · ok 1 · retry 1 · fail 1');
  });
});
