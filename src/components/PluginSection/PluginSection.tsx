import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Check, ExternalLink } from 'lucide-react';
import { PluginInfo } from '@/types/project.types';
import './PluginSection.css';
import type { PluginDiff, PluginChange } from '../../../shared/version-diff';

interface InstalledPlugin {
  name: string;
  type: 'AU' | 'VST3' | 'VST2';
  path: string;
}

interface PluginSectionProps {
  plugins: PluginInfo[];
  /** Plugin changes against the previous version, when known. */
  changes?: PluginDiff | null;
}

/**
 * Check if a project plugin is locally installed.
 * Uses case-insensitive, whitespace-insensitive substring matching.
 */
function isPluginInstalled(pluginName: string, installedPlugins: InstalledPlugin[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const needle = norm(pluginName);
  if (!needle) return false;
  return installedPlugins.some(installed => {
    const haystack = norm(installed.name);
    return !!haystack && (haystack.includes(needle) || needle.includes(haystack));
  });
}

export const PluginSection: React.FC<PluginSectionProps> = ({ plugins, changes }) => {
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInstalled = async () => {
      try {
        const result = await window.ipcRenderer.invoke('get-installed-plugins');
        setInstalledPlugins(result || []);
      } catch (err) {
        console.error('[PluginSection] Failed to fetch installed plugins:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchInstalled();
  }, []);

  // Deduplicate plugins by name (keep first occurrence)
  const uniquePlugins = useMemo(() => {
    const seen = new Set<string>();
    return plugins.filter(p => {
      const key = `${p.builtin ? 'builtin:' : ''}${p.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [plugins]);

  // Split into instruments and effects
  const { instruments, effects } = useMemo(() => {
    const instruments: (PluginInfo & { installed: boolean })[] = [];
    const effects: (PluginInfo & { installed: boolean })[] = [];

    uniquePlugins.forEach(plugin => {
      // Without a list of installed plugins (scan failed or not on a Mac) don't claim anything is missing.
      const installed = !!plugin.builtin || installedPlugins.length === 0 || isPluginInstalled(plugin.name, installedPlugins);
      const enriched = { ...plugin, installed };
      if (plugin.is_instrument) {
        instruments.push(enriched);
      } else {
        effects.push(enriched);
      }
    });

    // Sort: missing first, then alphabetical
    const sortFn = (a: typeof instruments[0], b: typeof instruments[0]) => {
      if (a.installed !== b.installed) return a.installed ? 1 : -1;
      return a.name.localeCompare(b.name);
    };
    instruments.sort(sortFn);
    effects.sort(sortFn);

    return { instruments, effects };
  }, [uniquePlugins, installedPlugins]);

  const changeOf = useMemo(() => {
    const m = new Map<string, PluginChange>();
    for (const c of changes?.changes ?? []) m.set(c.plugin.name.toLowerCase(), c);
    return m;
  }, [changes]);
  const removed = (changes?.changes ?? []).filter(c => c.kind === 'removed');

  const handleGetPlugin = (plugin: PluginInfo) => {
    const query = plugin.manufacturer && plugin.manufacturer !== 'Unknown'
      ? `${plugin.name} ${plugin.manufacturer} plugin download`
      : `${plugin.name} audio plugin download`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    window.ipcRenderer.invoke('open-external-url', url);
  };

  if (loading) {
    return (
      <div className="plugin-section">
        <h2 className="plugin-section-title">Plugins</h2>
        <div className="plugin-container">
          <div className="plugin-loading">Scanning plugins...</div>
        </div>
      </div>
    );
  }



  return (
    <div className="plugin-section">
      <div className="plugin-container">
        {changes && (
          <div className="plugin-changes-summary">
            {changes.added + changes.removed + changes.countChanged === 0 ? (
              <span className="chg-same">No plugin changes since the previous version</span>
            ) : (
              <>
                {changes.added > 0 && <span className="chg-added">+{changes.added} added</span>}
                {changes.removed > 0 && <span className="chg-removed">−{changes.removed} removed</span>}
                {changes.countChanged > 0 && <span className="chg-modified">~{changes.countChanged} used more or less</span>}
              </>
            )}
          </div>
        )}
        {uniquePlugins.length === 0 && removed.length === 0 ? (
          <div className="plugin-empty">No plugins detected in this project</div>
        ) : (
          <>
            {instruments.length > 0 && (
              <PluginGroup
                label="Instruments"
                plugins={instruments}
                keyPrefix="inst"
                onGetPlugin={handleGetPlugin}
                changeOf={changeOf}
              />
            )}

            {effects.length > 0 && (
              <PluginGroup
                label="Effects"
                plugins={effects}
                keyPrefix="fx"
                onGetPlugin={handleGetPlugin}
                changeOf={changeOf}
              />
            )}

            {removed.length > 0 && (
              <div className="plugin-group">
                <div className="plugin-group-label">Removed in this version</div>
                {removed.map((c, i) => (
                  <div key={`rm-${i}`} className="plugin-row plugin-row-removed">
                    <span className="plugin-change-mark chg-removed" aria-label="Removed">−</span>
                    <span className="plugin-name-group">
                      <span className="plugin-name">{c.plugin.name}</span>
                      {c.plugin.manufacturer && c.plugin.manufacturer !== 'Unknown' && (
                        <span className="plugin-manufacturer">{c.plugin.manufacturer}</span>
                      )}
                    </span>
                    <span />
                    <span className="plugin-type-badge">{c.plugin.type}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

interface PluginGroupProps {
  label: string;
  plugins: (PluginInfo & { installed: boolean })[];
  keyPrefix: string;
  onGetPlugin: (plugin: PluginInfo) => void;
  changeOf: Map<string, PluginChange>;
}

const PluginGroup: React.FC<PluginGroupProps> = ({ label, plugins, keyPrefix, onGetPlugin, changeOf }) => {
  const missing = plugins.filter(p => !p.installed);
  const installed = plugins.filter(p => p.installed);

  return (
    <div className="plugin-group">
      <div className="plugin-group-label">{label}</div>
      {missing.length > 0 && (
        <div className="plugin-missing-group">
          {missing.map((plugin, i) => (
            <PluginRow
              key={`${keyPrefix}-miss-${i}`}
              plugin={plugin}
              installed={false}
              onGetPlugin={onGetPlugin}
              change={changeOf.get(plugin.name.toLowerCase())}
            />
          ))}
        </div>
      )}
      {installed.map((plugin, i) => (
        <PluginRow
          key={`${keyPrefix}-ok-${i}`}
          plugin={plugin}
          installed={true}
          onGetPlugin={onGetPlugin}
          change={changeOf.get(plugin.name.toLowerCase())}
        />
      ))}
    </div>
  );
};

interface PluginRowProps {
  plugin: PluginInfo;
  installed: boolean;
  onGetPlugin: (plugin: PluginInfo) => void;
  change?: PluginChange;
}

const PluginRow: React.FC<PluginRowProps> = ({ plugin, installed, onGetPlugin, change }) => {
  return (
    <div className={`plugin-row ${installed ? '' : 'plugin-row-missing'} ${change?.kind === 'added' ? 'plugin-row-added' : ''}`}>
      <span className={`plugin-status-icon ${installed ? 'installed' : 'missing'}`}>
        {installed ? <Check size={16} /> : <AlertTriangle size={16} />}
      </span>
      <span className="plugin-name-group">
        <span className="plugin-name">
          {change?.kind === 'added' && <span className="plugin-change-mark chg-added" aria-label="Added">+ </span>}
          {plugin.name}
          {change && change.after > 1 && change.kind === 'same' && <span className="plugin-count"> ×{change.after}</span>}
          {change?.kind === 'count' && (
            <span className="plugin-count chg-modified" title="Times used: before → now"> ×{change.before} → ×{change.after}</span>
          )}
        </span>
        {/* The DAW's own plugins carry its badge already; their maker would only crowd out the tracks. */}
        {plugin.manufacturer && plugin.manufacturer !== 'Unknown' && !plugin.builtin && (
          <span className="plugin-manufacturer">{plugin.manufacturer}</span>
        )}
        {plugin.tracks && plugin.tracks.length > 0 && (
          <span className="plugin-tracks" title={`On ${plugin.tracks.join(', ')}`}>
            {plugin.tracks.join(', ')}
          </span>
        )}
      </span>
      {!installed ? (
        <button
          className="plugin-get-btn"
          onClick={(e) => {
            e.stopPropagation();
            onGetPlugin(plugin);
          }}
          title="Search for plugin"
        >
          Get plugin <ExternalLink size={12} />
        </button>
      ) : (
        <span />
      )}
      <span className="plugin-type-badge">{plugin.type}</span>
    </div>
  );
};
