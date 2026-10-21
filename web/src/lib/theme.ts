export type ThemePref = 'system' | 'light' | 'dark';

export function getStoredTheme(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  const t = localStorage.getItem('theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function applyTheme(pref: ThemePref) {
  const light =
    pref === 'light' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.classList.toggle('light', light);
}

export function setTheme(pref: ThemePref) {
  localStorage.setItem('theme', pref);
  applyTheme(pref);
}
