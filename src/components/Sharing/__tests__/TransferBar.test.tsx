import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransferBar } from '../TransferBar';

describe('TransferBar', () => {
  it('shows the percentage, the sizes and the file being moved', () => {
    render(<TransferBar transfer={{ phase: 'download', fileIndex: 3, fileCount: 12, fileName: 'kick.wav', bytesDone: 13 * 1048576, bytesTotal: 126 * 1048576 }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
    expect(screen.getByRole('group', { name: 'Downloading 10%' })).toHaveTextContent('Downloading 13 of 126 MB · 10% · kick.wav (3 of 12)');
  });

  it('says uploading, and leaves out the count for one file', () => {
    render(<TransferBar transfer={{ phase: 'upload', fileIndex: 1, fileCount: 1, bytesDone: 512, bytesTotal: 1024 }} />);
    expect(screen.getByRole('group')).toHaveTextContent('Uploading 0.5 of 1 KB · 50%');
    expect(screen.getByRole('group')).not.toHaveTextContent('of 1)');
  });
});
