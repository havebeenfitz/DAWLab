import { useEffect, useRef, useState } from 'react';
import { Server } from 'lucide-react';
import { hub } from '@/components/Sharing/hub';
import { errorMessage } from '@/lib/notify';

/**
 * "DAWLab server": the one place to connect the server that shared folders go
 * through. The password is only needed to create shared folders; joining one
 * needs nothing but an invite.
 */
export function ServerSettings() {
  const [hubUrl, setHubUrl] = useState('');
  const [password, setPassword] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hub.getSettings().then((s) => { setHubUrl(s.hubUrl); setHasKey(s.hasKey); }).catch(() => {});
    if (window.location.hash.endsWith('#server')) {
      setTimeout(() => sectionRef.current?.scrollIntoView({ block: 'start' }), 50);
    }
  }, []);

  const save = async () => {
    setBusy(true); setResult(null);
    try {
      const candidate = { hubUrl, ...(password ? { hubKey: password } : {}) };
      const check = await hub.testConnection(candidate);
      setResult(check);
      if (check.ok) {
        const saved = await hub.saveSettings(candidate);
        setHubUrl(saved.hubUrl); setHasKey(saved.hasKey); setPassword('');
      }
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-field" id="server" ref={sectionRef}>
      <label className="form-field-label" htmlFor="server-address">DAWLab server</label>
      <div className="form-field-content server-settings">
        <p className="field-hint" style={{ marginTop: 0 }}>
          <Server size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} aria-hidden />
          Shared folders sync through your own DAWLab server. Joining a folder only needs an invite; sharing your own folders needs the server&apos;s password.
        </p>
        <div className="ui-field">
          <label htmlFor="server-address">Address</label>
          <input
            id="server-address"
            className="ui-input"
            value={hubUrl}
            onChange={(e) => { setHubUrl(e.target.value); setResult(null); }}
            placeholder="https://your-server.onrender.com"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <div className="ui-field">
          <label htmlFor="server-password">Password {hasKey && <span className="ui-badge ui-badge-ok">saved</span>}</label>
          <input
            id="server-password"
            className="ui-input"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setResult(null); }}
            placeholder={hasKey ? 'Leave empty to keep the saved password' : 'The password you set when you deployed the server'}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <div className="ui-input-row">
          <button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={busy || !hubUrl.trim()}>
            {busy ? 'Checking…' : 'Check and save'}
          </button>
          {result && (
            <span className={`ui-status ${result.ok ? 'ui-status-ok' : 'ui-status-error'}`} role={result.ok ? 'status' : 'alert'}>
              {result.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
