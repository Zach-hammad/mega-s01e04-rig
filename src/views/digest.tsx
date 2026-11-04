import type { DigestRow } from '../digest/types.js';

export function DigestPage(props: {
  night: string;
  rows: DigestRow[];
  badLineCount: number;
}) {
  const { night, rows, badLineCount } = props;
  return (
    <>
      <h1>digest · {night}</h1>
      {badLineCount > 0 && (
        <p class="warn" role="status">
          {badLineCount} malformed {badLineCount === 1 ? 'line' : 'lines'} skipped.
        </p>
      )}
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <div class="table-scroll" role="region" aria-label={`Digest for ${night}`} tabindex={0}>
          <table class="digest-table">
            <thead>
              <tr>
                <th scope="col">job</th>
                <th scope="col">owner</th>
                <th scope="col">runs</th>
                <th scope="col">retries</th>
                <th scope="col">last status</th>
                <th scope="col">last error</th>
                <th scope="col">first time</th>
                <th scope="col">last time</th>
                <th scope="col">failure observed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr>
                  <th scope="row">{row.job}</th>
                  <td>{row.owner !== null && row.owner.trim() !== '' ? row.owner : '—'}</td>
                  <td>{row.runs}</td>
                  <td>
                    {row.retries}
                    {row.retries >= 3 && <span class="warn"> (high retries)</span>}
                  </td>
                  <td>{row.lastStatus === 'fail' ? <span class="warn">fail</span> : row.lastStatus}</td>
                  <td class="error-cell">{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td>
                    {row.hasFailure ? <span class="warn">yes (failure occurred)</span> : 'no'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
