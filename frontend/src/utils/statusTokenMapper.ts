// INK CRM Dynamic Status-to-Token Mapper
// Automatically maps lead stages/statuses to semantic token families
// without brittle hard-coding, with a neutral fallback for custom stages.

export type StatusTokenFamily = 'hot' | 'warm' | 'info' | 'success' | 'pending' | 'danger' | 'neutral';

export interface StatusTokens {
  family: StatusTokenFamily;
  accentRgb: string;     // Channel string for direct inline use if needed (e.g. "239 68 68")
  accentHex: string;     // Hex code for charts/SVG
  badgeClass: string;    // Tailwind badge classes
  dotClass: string;      // Tailwind indicator dot class
  barClass: string;      // Card top accent bar class
  iconBgClass: string;   // Floating icon background
  iconTextClass: string; // Floating icon stroke color
}

interface StatusInput {
  id?: string;
  name?: string;
  color?: string;
  isSuccess?: boolean;
  isFinal?: boolean;
  pipelinePosition?: number;
}

const parseHexToHsl = (hex: string): { h: number; s: number; l: number } => {
  let c = hex.replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return { h: 215, s: 16, l: 47 };

  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = Math.round(h * 60);
  }

  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
};

export const resolveStatusFamily = (status: StatusInput | string): StatusTokenFamily => {
  if (typeof status === 'string') {
    status = { name: status };
  }

  const { isSuccess, isFinal, color, name } = status;

  // 1. Explicit semantic flags take precedence
  if (isSuccess) return 'success';
  if (isFinal && !isSuccess) return 'danger';

  // 2. If an administrative color is defined, map based on hue angle
  if (color && color.startsWith('#')) {
    const { h, s } = parseHexToHsl(color);
    // If desaturated (< 15%), it's a neutral stage
    if (s < 15) return 'neutral';

    if (h >= 345 || h <= 15) return 'hot';       // Red / Rose / Crimson
    if (h > 15 && h <= 55) return 'warm';        // Orange / Amber / Gold
    if (h >= 85 && h <= 165) return 'success';   // Green / Lime / Emerald
    if (h > 165 && h <= 250) return 'info';      // Teal / Cyan / Sky / Blue
    if (h > 250 && h < 345) return 'pending';    // Violet / Purple / Indigo
  }

  // 3. Fallback heuristic on semantic keyword tokens
  const cleanName = (name || '').toLowerCase().trim();
  if (!cleanName) return 'neutral';

  if (/(hot|urgent|priority|immediate|flame)/.test(cleanName)) return 'hot';
  if (/(warm|progress|contacted|qualified|working)/.test(cleanName)) return 'warm';
  if (/(disbursed|won|approved|success|closed won|disbuse)/.test(cleanName)) return 'success';
  if (/(reject|lost|drop|dead|closed lost|cancel)/.test(cleanName)) return 'danger';
  if (/(doc|document|cibil|cedil|verify|verification|review|login|proposal|negotiation)/.test(cleanName)) return 'info';
  if (/(pending|queue|wait|hold|callback|follow|call back)/.test(cleanName)) return 'pending';

  // 4. Clean fallback for unknown custom stages
  return 'neutral';
};

export const getStatusTokens = (status: StatusInput | string): StatusTokens => {
  const family = resolveStatusFamily(status);

  switch (family) {
    case 'hot':
      return {
        family: 'hot',
        accentRgb: '239 68 68',
        accentHex: '#EF4444',
        badgeClass: 'bg-status-hot-bg text-status-hot-text border border-status-hot-border',
        dotClass: 'bg-status-hot',
        barClass: 'bg-status-hot',
        iconBgClass: 'bg-status-hot-bg border border-status-hot-border text-status-hot',
        iconTextClass: 'text-status-hot'
      };
    case 'warm':
      return {
        family: 'warm',
        accentRgb: '245 158 11',
        accentHex: '#F59E0B',
        badgeClass: 'bg-status-warm-bg text-status-warm-text border border-status-warm-border',
        dotClass: 'bg-status-warm',
        barClass: 'bg-status-warm',
        iconBgClass: 'bg-status-warm-bg border border-status-warm-border text-status-warm',
        iconTextClass: 'text-status-warm'
      };
    case 'info':
      return {
        family: 'info',
        accentRgb: '2 132 199',
        accentHex: '#0284C7',
        badgeClass: 'bg-status-info-bg text-status-info-text border border-status-info-border',
        dotClass: 'bg-status-info',
        barClass: 'bg-status-info',
        iconBgClass: 'bg-status-info-bg border border-status-info-border text-status-info',
        iconTextClass: 'text-status-info'
      };
    case 'success':
      return {
        family: 'success',
        accentRgb: '16 185 129',
        accentHex: '#10B981',
        badgeClass: 'bg-status-success-bg text-status-success-text border border-status-success-border',
        dotClass: 'bg-status-success',
        barClass: 'bg-status-success',
        iconBgClass: 'bg-status-success-bg border border-status-success-border text-status-success',
        iconTextClass: 'text-status-success'
      };
    case 'pending':
      return {
        family: 'pending',
        accentRgb: '139 92 246',
        accentHex: '#8B5CF6',
        badgeClass: 'bg-status-pending-bg text-status-pending-text border border-status-pending-border',
        dotClass: 'bg-status-pending',
        barClass: 'bg-status-pending',
        iconBgClass: 'bg-status-pending-bg border border-status-pending-border text-status-pending',
        iconTextClass: 'text-status-pending'
      };
    case 'danger':
      return {
        family: 'danger',
        accentRgb: '244 63 94',
        accentHex: '#F43F5E',
        badgeClass: 'bg-status-danger-bg text-status-danger-text border border-status-danger-border',
        dotClass: 'bg-status-danger',
        barClass: 'bg-status-danger',
        iconBgClass: 'bg-status-danger-bg border border-status-danger-border text-status-danger',
        iconTextClass: 'text-status-danger'
      };
    case 'neutral':
    default:
      return {
        family: 'neutral',
        accentRgb: '100 116 139',
        accentHex: '#64748B',
        badgeClass: 'bg-status-neutral-bg text-status-neutral-text border border-status-neutral-border',
        dotClass: 'bg-status-neutral',
        barClass: 'bg-status-neutral',
        iconBgClass: 'bg-status-neutral-bg border border-status-neutral-border text-status-neutral',
        iconTextClass: 'text-status-neutral'
      };
  }
};
