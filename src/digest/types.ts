export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  hasFailure: boolean;
};

export type DigestCounts = Record<DigestStatus, number>;

export type NightDigest =
  | { kind: 'missing'; night: string }
  | {
      kind: 'present';
      night: string;
      rows: DigestRow[];
      badLineCount: number;
      counts: DigestCounts;
    };

// The synchronous readNight(runsDir, night) function lives in read-night.ts.
export type ReadNight = (runsDir: string, night: string) => NightDigest;
