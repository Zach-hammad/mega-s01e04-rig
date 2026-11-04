import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

function ownerCell(html: string, job: string): string {
  const row = html.match(new RegExp(`<tr><th scope="row">${job}</th>(.*?)</tr>`));
  expect(row).toBeDefined();
  const owner = row?.[1]?.match(/<td>(.*?)<\/td>/);
  expect(owner).toBeDefined();
  return owner?.[1] ?? '';
}

describe('digest owner display', () => {
  it('renders null and blank owners as missing while preserving nonblank text', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-view-'));
    try {
      const at = '2026-10-30T01:00:00Z';
      writeFileSync(
        join(runsDir, '2026-10-30.jsonl'),
        [
          { at, job: 'null-owner', status: 'ok', owner: null },
          { at, job: 'empty-owner', status: 'ok', owner: '' },
          { at, job: 'blank-owner', status: 'ok', owner: '   ' },
          { at, job: 'named-owner', status: 'ok', owner: ' pager ' },
        ].map((event) => JSON.stringify(event)).join('\n'),
      );

      const response = await createApp(configFor(runsDir)).request('/digest/2026-10-30');
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(ownerCell(html, 'null-owner')).toBe('—');
      expect(ownerCell(html, 'empty-owner')).toBe('—');
      expect(ownerCell(html, 'blank-owner')).toBe('—');
      expect(ownerCell(html, 'named-owner')).toBe(' pager ');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});
