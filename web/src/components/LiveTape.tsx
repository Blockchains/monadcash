'use client';
import { useEffect, useState } from 'react';
import styles from '../app/research/tape.module.css';

export type TapeObs = {
  readAt: string;
  ok: boolean;
  rpc?: string;
  block?: number;
  baseFeeGwei?: string;
  shMonUnstakeFeePercent?: string;
  error?: string;
};

const RAW = 'https://raw.githubusercontent.com/Blockchains/policypilot-monad/main/web/public/research/live.json';

export function LiveTape({ initial, localUrl }: { initial: TapeObs[]; localUrl: string }) {
  const [rows, setRows] = useState(initial);
  useEffect(() => {
    let gone = false;
    (async () => {
      for (const url of [localUrl, RAW]) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) continue;
          const body = await res.json();
          const next = Array.isArray(body.observations) ? body.observations as TapeObs[] : [];
          if (gone) return;
          setRows(cur => (next.length >= cur.length ? next : cur));
          return;
        } catch {
          /* try the raw log if the deployed copy is older */
        }
      }
    })();
    return () => { gone = true; };
  }, [localUrl]);
  const shown = [...rows].reverse().slice(0, 8);
  if (!shown.length) {
    return <p>The hourly read has not written a line yet. The historical blotter above is the 16 October pass.</p>;
  }
  return (
    <div className={styles.live}>
      {shown.map(row => (
        <div className={styles.liveRow} key={row.readAt}>
          <div>
            <b>{row.ok ? 'Public read' : 'Read failed'}</b>
            <span>{row.readAt.replace('T', ' ').replace('Z', ' UTC')}</span>
          </div>
          <div>
            {row.ok ? (
              <>
                {row.block != null && <a href={`https://monadvision.com/block/${row.block}`}>block {row.block.toLocaleString('en-US')}</a>}
                {row.baseFeeGwei != null && <span>base fee {row.baseFeeGwei} gwei</span>}
                {row.shMonUnstakeFeePercent != null && <span>shMON unstake {row.shMonUnstakeFeePercent}%</span>}
              </>
            ) : <span>{row.error || 'The public RPC did not answer.'}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
