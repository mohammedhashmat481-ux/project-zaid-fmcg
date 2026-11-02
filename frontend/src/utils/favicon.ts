import { resolveFileUrl } from '../services/api';

/**
 * Dynamically updates the browser tab favicon, shortcut icon, and apple-touch-icon
 * to match the company logo saved in Company Settings, with fallback to /logo.png.
 */
export function updateAppFavicon(iconUrl?: string | null): void {
  if (typeof document === 'undefined') return;

  const rawUrl = (iconUrl || '').trim();
  const resolved = rawUrl ? (resolveFileUrl(rawUrl) || rawUrl) : '/logo.png';
  const finalUrl = resolved || '/logo.png';

  // Cache in localStorage for immediate rendering on subsequent page loads
  try {
    localStorage.setItem('tenantLogoUrl', finalUrl);
  } catch {
    // Ignore storage quota or access errors
  }

  const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];

  rels.forEach((rel) => {
    let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.appendChild(link);
    }

    if (rel !== 'apple-touch-icon') {
      if (finalUrl.endsWith('.ico')) {
        link.type = 'image/x-icon';
      } else if (finalUrl.endsWith('.svg')) {
        link.type = 'image/svg+xml';
      } else {
        link.type = 'image/png';
      }
    }

    link.href = finalUrl;
  });
}
