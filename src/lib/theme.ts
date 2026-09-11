/**
 * Theme is a per-browser preference, not app data — it never touches the
 * BudgetRepository, so it is never shared across devices in the add-on
 * deployment (§ CLAUDE.md "the server is simply the truth" applies to the
 * budget, not to how a given screen renders it).
 */

export type ThemePref = 'system' | 'dark' | 'light';
export type EffectiveTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'budget-tracker:theme';

/** Narrows unknown storage/markup input to a known preference, defaulting to system. */
export function parseThemePref(raw: string | null): ThemePref {
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
}

/** The preference, resolved against the OS setting, into what CSS keys off. */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): EffectiveTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light';
  return pref;
}

export function readThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function writeThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private browsing / storage disabled: theme just won't persist.
  }
}

export function systemPrefersDark(): boolean {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}
