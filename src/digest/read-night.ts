import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestCounts, DigestRow, DigestStatus, ReadNight } from './types.js';

// A corrupt or unexpectedly large log must fail explicitly, not exhaust the server.
const MAX_NIGHT_BYTES = 32 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

type RunEvent = {
  at: string;
  instant: number;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

type JobState = {
  row: DigestRow;
  firstInstant: number;
  lastInstant: number;
  lastErrorInstant: number;
};

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function parseInstant(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !isCalendarDate(match[1])) return null;

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offset = match[5];
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null;

  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function parseEvent(value: unknown): RunEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.at !== 'string' || typeof record.job !== 'string' || !record.job.trim()) return null;
  if (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') return null;
  if (record.owner !== null && typeof record.owner !== 'string') return null;
  if ('error' in record && typeof record.error !== 'string') return null;

  const instant = parseInstant(record.at);
  if (instant === null) return null;

  return {
    at: record.at,
    instant,
    job: record.job,
    status: record.status,
    owner: record.owner,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

function readBoundedFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  let readFailure: unknown;
  try {
    if (fstatSync(fd).size > MAX_NIGHT_BYTES) throw new Error(`Night log exceeds ${MAX_NIGHT_BYTES} bytes`);

    const buffer = Buffer.alloc(READ_CHUNK_BYTES);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, MAX_NIGHT_BYTES + 1 - totalBytes), null);
      if (bytes === 0) break;
      totalBytes += bytes;
      if (totalBytes > MAX_NIGHT_BYTES) throw new Error(`Night log exceeds ${MAX_NIGHT_BYTES} bytes`);
      chunks.push(Buffer.from(buffer.subarray(0, bytes)));
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch (error) {
    readFailure = error;
    throw error;
  } finally {
    try {
      closeSync(fd);
    } catch (closeError) {
      if (readFailure === undefined) throw closeError;
    }
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isCalendarDate(night)) return { kind: 'missing', night };

  const content = readBoundedFile(join(runsDir, `${night}.jsonl`));
  if (content === null) return { kind: 'missing', night };

  const counts: DigestCounts = { ok: 0, retry: 0, fail: 0 };
  const jobs = new Map<string, JobState>();
  let badLineCount = 0;
  if (content.length > 0) {
    const lines = content.split(/\r?\n/);
    if (content.endsWith('\n')) lines.pop();

    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        badLineCount++;
        continue;
      }
      const event = parseEvent(parsed);
      if (event === null) {
        badLineCount++;
        continue;
      }

      counts[event.status]++;
      const current = jobs.get(event.job);
      const error = typeof event.error === 'string' && event.error.trim().length > 0 ? event.error : null;
      if (!current) {
        jobs.set(event.job, {
          row: {
            job: event.job,
            owner: event.owner,
            runs: 1,
            retries: event.status === 'retry' ? 1 : 0,
            lastStatus: event.status,
            lastError: error,
            firstAt: event.at,
            lastAt: event.at,
            hasFailure: event.status === 'fail',
          },
          firstInstant: event.instant,
          lastInstant: event.instant,
          lastErrorInstant: error === null ? -Infinity : event.instant,
        });
        continue;
      }

      current.row.runs++;
      if (event.status === 'retry') current.row.retries++;
      if (event.status === 'fail') current.row.hasFailure = true;
      if (event.instant < current.firstInstant) {
        current.firstInstant = event.instant;
        current.row.firstAt = event.at;
      }
      if (event.instant >= current.lastInstant) {
        current.lastInstant = event.instant;
        current.row.lastAt = event.at;
        current.row.lastStatus = event.status;
        current.row.owner = event.owner;
      }
      if (error !== null && event.instant >= current.lastErrorInstant) {
        current.lastErrorInstant = event.instant;
        current.row.lastError = error;
      }
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row);
  rows.sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { kind: 'present', night, rows, badLineCount, counts };
};
