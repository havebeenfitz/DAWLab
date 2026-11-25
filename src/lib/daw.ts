import logicLogo from '@/assets/logic_logo.png';
import abletonLogo from '@/assets/ableton_live_logo.png';
import flLogo from '@/assets/fl_logo.png';
import reaperLogo from '@/assets/reaper_logo.png';
import protoolsLogo from '@/assets/protools_logo.svg';

export interface DawInfo {
  /** Name as people say it: "Logic Pro", "Ableton Live"… */
  name: string;
  logo: string | null;
}

const KNOWN: Array<{ match: RegExp; name: string; logo: string }> = [
  { match: /^logic/i, name: 'Logic Pro', logo: logicLogo },
  { match: /^ableton/i, name: 'Ableton Live', logo: abletonLogo },
  { match: /^fl( studio)?$/i, name: 'FL Studio', logo: flLogo },
  { match: /^reaper$/i, name: 'Reaper', logo: reaperLogo },
  { match: /^pro ?tools$/i, name: 'Pro Tools', logo: protoolsLogo },
];

/** Normalises the DAW label stored in a project log ("Logic Pro X", "fl", "Ableton") to a display name and logo. */
export function dawInfo(daw?: string | null): DawInfo {
  const label = String(daw ?? '').trim();
  const hit = KNOWN.find((k) => k.match.test(label));
  return hit ? { name: hit.name, logo: hit.logo } : { name: label || 'your DAW', logo: null };
}
