import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));

function withRunsDir(check: (runsDir: string) => void): void {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  try {
    check(runsDir);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}

function event(at: string, job: string, status: string, owner: string | null, error?: string): string {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

describe('readNight', () => {
  it('reads the real night into sorted job rows while counting its truncated line', () => {
    const digest = readNight(fixtureDir, '2026-10-28');
    expect(digest.kind).toBe('present');
    if (digest.kind !== 'present') return;

    expect(digest.badLineCount).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest.rows[0]).toMatchObject({ owner: null, runs: 1, retries: 0, lastStatus: 'ok' });
    expect(digest.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(digest.rows[3]).toMatchObject({ runs: 1, retries: 0, lastStatus: 'fail', hasFailure: true });
    expect(digest.rows[4]).toMatchObject({ runs: 1, retries: 0, lastStatus: 'ok' });
  });

  it('orders instants across offsets and keeps a recovered failure and earlier error', () => withRunsDir((runsDir) => {
    writeFileSync(join(runsDir, '2026-03-01.jsonl'), [
      event('2026-03-01T01:00:00+01:00', 'zeta', 'ok', 'initial'),
      event('2026-02-28T22:30:00-01:00', 'zeta', 'fail', 'before', 'disk full'),
      event('2026-03-01T00:30:00Z', 'zeta', 'retry', 'retry-owner', 'lock held'),
      event('2026-03-01T01:30:00+01:00', 'zeta', 'ok', null),
      event('2026-03-01T01:31:00+01:00', 'alpha', 'ok', 'other'),
    ].join('\n'));

    const digest = readNight(runsDir, '2026-03-01');
    expect(digest.kind).toBe('present');
    if (digest.kind !== 'present') return;
    expect(digest.counts).toEqual({ ok: 3, retry: 1, fail: 1 });
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'zeta']);
    expect(digest.rows[1]).toEqual({
      job: 'zeta', owner: null, runs: 4, retries: 1, lastStatus: 'ok',
      lastError: 'lock held', firstAt: '2026-02-28T22:30:00-01:00',
      lastAt: '2026-03-01T01:30:00+01:00', hasFailure: true,
    });
  }));

  it('orders sub-millisecond instants, equivalent fractions, and times before the epoch', () => withRunsDir((runsDir) => {
    writeFileSync(join(runsDir, '1969-12-31.jsonl'), [
      event('2026-01-01T00:00:00.0009Z', 'precise', 'fail', 'later', 'newer error'),
      event('2026-01-01T00:00:00.0001Z', 'precise', 'ok', 'earlier', 'older error'),
      event('2026-01-01T01:00:00.1+01:00', 'tie', 'retry', 'first'),
      event('2026-01-01T00:00:00.1000Z', 'tie', 'ok', null),
      event('1969-12-31T23:59:59.9Z', 'epoch', 'ok', 'before'),
      event('1970-01-01T00:00:00Z', 'epoch', 'fail', 'after'),
    ].join('\n'));

    const digest = readNight(runsDir, '1969-12-31');
    expect(digest.kind).toBe('present');
    if (digest.kind !== 'present') return;
    expect(digest.badLineCount).toBe(0);
    expect(digest.counts).toEqual({ ok: 3, retry: 1, fail: 2 });
    expect(digest.rows.map((row) => row.job)).toEqual(['epoch', 'precise', 'tie']);
    expect(digest.rows[0]).toMatchObject({
      firstAt: '1969-12-31T23:59:59.9Z', lastAt: '1970-01-01T00:00:00Z',
      lastStatus: 'fail', owner: 'after',
    });
    expect(digest.rows[1]).toEqual({
      job: 'precise', owner: 'later', runs: 2, retries: 0, lastStatus: 'fail',
      lastError: 'newer error', firstAt: '2026-01-01T00:00:00.0001Z',
      lastAt: '2026-01-01T00:00:00.0009Z', hasFailure: true,
    });
    expect(digest.rows[2]).toMatchObject({
      owner: null, runs: 2, retries: 1, lastStatus: 'ok',
      firstAt: '2026-01-01T01:00:00.1+01:00', lastAt: '2026-01-01T00:00:00.1000Z',
    });
  }));

  it('counts invalid JSON, invalid shapes, and actual blank lines but ignores a terminal newline', () => withRunsDir((runsDir) => {
    writeFileSync(join(runsDir, '2026-02-28.jsonl'), [
      event('2026-02-28T00:00:00+00:00', 'valid', 'ok', null),
      '{broken',
      'null',
      event('2026-02-28T00:00:00+00:00', 'invalid-status', 'done', 'owner'),
      event('2026-02-28T00:00:00', 'no-offset', 'ok', 'owner'),
      event('2026-02-30T00:00:00+00:00', 'bad-date', 'ok', 'owner'),
      JSON.stringify({ at: '2026-02-28T00:00:00Z', job: 'bad-owner', status: 'ok', owner: 3 }),
      '  ',
      '',
      '',
    ].join('\n'));

    const digest = readNight(runsDir, '2026-02-28');
    expect(digest).toEqual({
      kind: 'present', night: '2026-02-28', badLineCount: 8,
      counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{
        job: 'valid', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, firstAt: '2026-02-28T00:00:00+00:00',
        lastAt: '2026-02-28T00:00:00+00:00', hasFailure: false,
      }],
    });
  }));

  it('distinguishes empty and missing nights, rejects invalid names, and surfaces read errors', () => withRunsDir((runsDir) => {
    writeFileSync(join(runsDir, '2026-01-01.jsonl'), '');
    expect(readNight(runsDir, '2026-01-01')).toEqual({
      kind: 'present', night: '2026-01-01', rows: [], badLineCount: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(readNight(runsDir, '2026-01-02')).toEqual({ kind: 'missing', night: '2026-01-02' });
    for (const night of ['../2026-01-01', '2026-02-29', '2026-13-01', '2026-01-01/../../x']) {
      expect(readNight('\0', night)).toEqual({ kind: 'missing', night });
    }

    mkdirSync(join(runsDir, '2026-01-03.jsonl'));
    let readError: unknown;
    try {
      readNight(runsDir, '2026-01-03');
    } catch (error) {
      readError = error;
    }
    expect(readError).toMatchObject({ code: 'EISDIR' });
  }));

  it('rejects an oversized file instead of returning a partial digest', () => withRunsDir((runsDir) => {
    const path = join(runsDir, '2026-01-04.jsonl');
    writeFileSync(path, '');
    truncateSync(path, 32 * 1024 * 1024 + 1);
    expect(() => readNight(runsDir, '2026-01-04')).toThrow('Night log exceeds 33554432 bytes');
  }));
});
