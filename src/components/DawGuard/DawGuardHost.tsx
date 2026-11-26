import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { subscribeDawGuard, recheckDawGuard, type DawGuardRequest } from '@/lib/dawGuard';

/**
 * The question asked before files of a project open in its DAW are replaced.
 * When the DAW holds the project's files it is open for sure: only "check
 * again" after closing it. When the DAW is running with no sign of this
 * project, the person confirms it is closed.
 */
export function DawGuardHost() {
  const [req, setReq] = useState<DawGuardRequest | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => subscribeDawGuard(setReq), []);
  if (!req) return null;

  const again = async () => {
    setChecking(true);
    try { await recheckDawGuard(); } finally { setChecking(false); }
  };
  const name = `“${req.projectName}”`;
  return (
    <Dialog
      open
      width="sm"
      title={req.holdsFiles ? `${name} is open in ${req.app}` : `Is ${name} closed in ${req.app}?`}
      onClose={() => req.resolve(false)}
      footer={
        <>
          <button type="button" className="ui-btn" onClick={() => req.resolve(false)}>Cancel</button>
          {req.holdsFiles ? (
            <button type="button" className="ui-btn ui-btn-primary" data-autofocus onClick={again} disabled={checking}>
              {checking ? 'Checking…' : 'I closed it, check again'}
            </button>
          ) : (
            <button type="button" className="ui-btn ui-btn-primary" data-autofocus onClick={() => req.resolve(true)}>
              It’s closed, {req.action}
            </button>
          )}
        </>
      }
    >
      <p className="ui-hint">
        {req.holdsFiles
          ? `Close the project in ${req.app} first. ${req.app} keeps its own copy of the song while it’s open, and its next save would put that copy back over the version you want. Nothing has been changed yet.`
          : `${req.app} is running. If ${name} is open in it, close it first: otherwise ${req.app} could save its open copy over the version you want.`}
      </p>
    </Dialog>
  );
}
