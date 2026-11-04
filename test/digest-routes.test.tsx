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
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-route-'));
  temporaryDirs.push(dir);
  return dir;
}

function event(at: string, job: string, status: string, owner: string | null, error?: string): string {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('renders and returns the same ordered digest, including retry, failure, null, and offset data', async () => {
    const runsDir = makeRunsDir();
    writeFileSync(join(runsDir, '2026-03-01.jsonl'), [
      event('2026-03-01T01:00:00+01:00', 'zeta', 'retry', 'first-owner'),
      event('2026-03-01T00:01:00Z', 'zeta', 'retry', 'retry-owner'),
      event('2026-03-01T00:02:00Z', 'zeta', 'retry', 'retry-owner'),
      event('2026-03-01T03:00:00+03:00', 'zeta', 'fail', 'on-call', 'disk <full> & unavailable'),
      event('2026-03-01T00:04:00Z', 'zeta', 'ok', null),
      event('2026-03-01T00:05:00Z', 'alpha', 'ok', null),
      '{broken',
    ].join('\n'));
    const app = createApp(configFor(runsDir));

    const htmlResponse = await app.request('/digest/2026-03-01');
    const html = await htmlResponse.text();
    const jsonResponse = await app.request('/api/digest/2026-03-01');
    const json = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('<h1>digest · 2026-03-01</h1>');
    expect(html).toContain('1 malformed line skipped.');
    const renderedJobs = [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map(
      (match) => match[1],
    );
    expect(renderedJobs).toEqual(['alpha', 'zeta']);
    const zetaRow = html.slice(
      html.indexOf('<th scope="row">zeta</th>'),
      html.indexOf('</tr>', html.indexOf('<th scope="row">zeta</th>')),
    );
    expect(zetaRow).toContain('3<span class="warn"> (high retries)</span>');
    expect(zetaRow).toContain('yes (failure occurred)');
    expect(zetaRow).toContain('disk &lt;full&gt; &amp; unavailable');
    expect(zetaRow).toContain('2026-03-01T01:00:00+01:00');
    expect(zetaRow).toContain('2026-03-01T00:04:00Z');

    expect(jsonResponse.status).toBe(200);
    expect(json).toEqual({
      kind: 'present',
      night: '2026-03-01',
      badLineCount: 1,
      counts: { ok: 2, retry: 3, fail: 1 },
      rows: [
        {
          job: 'alpha', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-03-01T00:05:00Z', lastAt: '2026-03-01T00:05:00Z', hasFailure: false,
        },
        {
          job: 'zeta', owner: null, runs: 5, retries: 3, lastStatus: 'ok',
          lastError: 'disk <full> & unavailable', firstAt: '2026-03-01T01:00:00+01:00',
          lastAt: '2026-03-01T00:04:00Z', hasFailure: true,
        },
      ],
    });
  });

  it('returns a present empty digest for an existing empty night', async () => {
    const runsDir = makeRunsDir();
    writeFileSync(join(runsDir, '2026-03-02.jsonl'), '');
    const app = createApp(configFor(runsDir));

    const htmlResponse = await app.request('/digest/2026-03-02');
    const html = await htmlResponse.text();
    const jsonResponse = await app.request('/api/digest/2026-03-02');

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('<p class="mute">nothing ran</p>');
    expect(html).not.toContain('<tbody>');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      kind: 'present', night: '2026-03-02', rows: [], badLineCount: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns 404 for a missing night in both representations', async () => {
    const app = createApp(configFor(makeRunsDir()));

    expect((await app.request('/digest/2026-03-03')).status).toBe(404);
    expect((await app.request('/api/digest/2026-03-03')).status).toBe(404);
  });

  it('returns 404 for an invalid calendar date in both representations', async () => {
    const app = createApp(configFor(makeRunsDir()));

    expect((await app.request('/digest/2026-02-30')).status).toBe(404);
    expect((await app.request('/api/digest/2026-02-30')).status).toBe(404);
  });
});
