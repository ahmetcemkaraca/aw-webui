export function detectPreferredTheme(): 'light' | 'dark' {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(theme: 'light' | 'dark' | 'auto'): void {
  if (typeof document === 'undefined') return;
  const effective = theme === 'auto' ? detectPreferredTheme() : theme;
  document
    .querySelectorAll('link[data-peak-theme], link[href="/dark.css"]')
    .forEach(link => link.remove());
  if (effective === 'dark') {
    const link = document.createElement('link');
    link.href = '/dark.css';
    link.rel = 'stylesheet';
    link.setAttribute('data-peak-theme', 'dark');
    document.head.appendChild(link);
  }
}
