// INK CRM Enterprise Dynamic Theme Generator
// Calculates 50-950 brand color scale & WCAG AA contrast ratio from a single hex color

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export const hexToRgb = (hex: string): RgbColor => {
  let cleanHex = (hex || '').replace('#', '').trim();
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  if (cleanHex.length !== 6) {
    // Default fallback to Slate/Navy
    return { r: 2, g: 132, b: 199 };
  }

  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

/**
 * Blend two colors together (weight 0 = color1, weight 1 = color2)
 */
const blendRgb = (c1: RgbColor, c2: RgbColor, weight: number): RgbColor => {
  return {
    r: Math.round(c1.r * (1 - weight) + c2.r * weight),
    g: Math.round(c1.g * (1 - weight) + c2.g * weight),
    b: Math.round(c1.b * (1 - weight) + c2.b * weight)
  };
};

/**
 * Calculate relative luminance according to WCAG 2.1 specifications
 */
export const getRelativeLuminance = (rgb: RgbColor): number => {
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

/**
 * Calculate contrast ratio between two colors (range: 1 to 21)
 */
export const getContrastRatio = (color1: RgbColor, color2: RgbColor): number => {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

export interface BrandScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
  dark: string;
  contrast: string;
}

/**
 * Generate full 50-950 scale + contrast token from a single brand hex
 */
export const generateBrandScale = (hex?: string): BrandScale => {
  // Default to calm financial navy / blue if invalid or not provided
  const base = hex ? hexToRgb(hex) : { r: 2, g: 132, b: 199 };
  const white: RgbColor = { r: 255, g: 255, b: 255 };
  const darkNavy: RgbColor = { r: 11, g: 19, b: 43 };
  const pitchBlack: RgbColor = { r: 7, g: 11, b: 20 };

  const scale: Record<string, RgbColor> = {
    50: blendRgb(base, white, 0.94),
    100: blendRgb(base, white, 0.85),
    200: blendRgb(base, white, 0.65),
    300: blendRgb(base, white, 0.45),
    400: blendRgb(base, white, 0.22),
    500: base,
    600: blendRgb(base, darkNavy, 0.20),
    700: blendRgb(base, darkNavy, 0.40),
    800: blendRgb(base, darkNavy, 0.60),
    900: blendRgb(base, darkNavy, 0.80),
    950: blendRgb(base, pitchBlack, 0.90)
  };

  // Determine WCAG AA Contrast for text on top of brand-500 surface
  const contrastWithWhite = getContrastRatio(base, white);
  const contrastToken = contrastWithWhite >= 4.5 ? '255 255 255' : '15 23 42';

  // Deep navy brand topbar color (tinted subtly with brand hue)
  const brandDarkRgb = blendRgb(darkNavy, base, 0.08);

  const formatRgb = (c: RgbColor) => `${c.r} ${c.g} ${c.b}`;

  return {
    50: formatRgb(scale[50]),
    100: formatRgb(scale[100]),
    200: formatRgb(scale[200]),
    300: formatRgb(scale[300]),
    400: formatRgb(scale[400]),
    500: formatRgb(scale[500]),
    600: formatRgb(scale[600]),
    700: formatRgb(scale[700]),
    800: formatRgb(scale[800]),
    900: formatRgb(scale[900]),
    950: formatRgb(scale[950]),
    dark: formatRgb(brandDarkRgb),
    contrast: contrastToken
  };
};

/**
 * Applies the generated brand tokens to documentElement CSS custom properties
 */
export const applyBrandScaleToDOM = (hex?: string) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const scale = generateBrandScale(hex);

  root.style.setProperty('--brand-50', scale[50]);
  root.style.setProperty('--brand-100', scale[100]);
  root.style.setProperty('--brand-200', scale[200]);
  root.style.setProperty('--brand-300', scale[300]);
  root.style.setProperty('--brand-400', scale[400]);
  root.style.setProperty('--brand-500', scale[500]);
  root.style.setProperty('--brand-600', scale[600]);
  root.style.setProperty('--brand-700', scale[700]);
  root.style.setProperty('--brand-800', scale[800]);
  root.style.setProperty('--brand-900', scale[900]);
  root.style.setProperty('--brand-950', scale[950]);
  root.style.setProperty('--brand-dark', scale.dark);
  root.style.setProperty('--brand-contrast', scale.contrast);
};
