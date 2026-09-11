import { useEffect, useState } from 'react';
import {
  parseThemePref,
  readThemePref,
  resolveTheme,
  systemPrefersDark,
  writeThemePref,
  type ThemePref,
} from '../lib/theme';

/**
 * Theme lives in this browser's localStorage, not in AppSettings — it's a
 * display preference per device, never something the server-backed
 * repository shares across everyone who opens the add-on.
 */
export function useTheme(): { pref: ThemePref; setPref: (pref: ThemePref) => void } {
  const [pref, setPref] = useState<ThemePref>(() => readThemePref());

  useEffect(() => {
    writeThemePref(pref);

    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(pref, systemPrefersDark());
    };
    apply();

    if (pref !== 'system') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [pref]);

  // Pick up a change made in another tab.
  useEffect(() => {
    const onStorage = () => setPref(readThemePref());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { pref, setPref: (next) => setPref(parseThemePref(next)) };
}
