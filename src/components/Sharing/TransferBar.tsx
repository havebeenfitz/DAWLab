import type { TransferProgress } from '../../../shared/transfer-progress';
import { formatTransferBytes, transferPercent } from '../../../shared/transfer-progress';
import './TransferBar.css';

/** A thin progress bar with "12.4 of 126 MB · kick.wav (3 of 12)" under it. */
export function TransferBar({ transfer, compact = false }: { transfer: TransferProgress; compact?: boolean }) {
  const pct = transferPercent(transfer);
  const verb = transfer.phase === 'download' ? 'Downloading' : 'Uploading';
  const which = transfer.fileCount > 1 ? ` (${transfer.fileIndex} of ${transfer.fileCount})` : '';
  return (
    <div className={`transfer-bar${compact ? ' is-compact' : ''}`} role="group" aria-label={`${verb} ${pct}%`}>
      <div className="transfer-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="transfer-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="transfer-text">
        {verb} {formatTransferBytes(transfer.bytesDone, transfer.bytesTotal)} · {pct}%
        {transfer.fileName ? <> · <span className="transfer-file" title={transfer.fileName}>{transfer.fileName}</span></> : null}
        {which}
      </span>
    </div>
  );
}
