import type { MobilityClass } from '@/shared/routing/types';

export function getMobilityClass(unit: { sidc: string }): MobilityClass {
  const sidc = unit.sidc;
  if (sidc.length < 10) return 'wheeled';

  const dimension = sidc[2];

  // Air and space platforms ignore terrain. 'P' (space) would otherwise fall
  // through to 'wheeled' and be routed along roads.
  if (dimension === 'A' || dimension === 'P') return 'air';

  if (dimension === 'G') {
    const funcId = sidc.substring(4, 10);

    if (funcId.startsWith('UCA')) return 'tracked';
    if (funcId.startsWith('UCIM') || funcId.startsWith('UCIZ')) return 'tracked';
    if (funcId.startsWith('UCI')) return 'foot';
    if (funcId.startsWith('UCR')) return 'wheeled';

    return 'wheeled';
  }

  return 'wheeled';
}

export function getMobilityClassFromCategory(category: string): MobilityClass {
  switch (category) {
    case 'Armour':
      return 'tracked';
    case 'Infantry':
      return 'foot';
    case 'Aviation':
    case 'UAS':
      return 'air';
    case 'Recce':
    case 'Artillery':
    case 'Engineer':
    case 'Signal':
    case 'CBRN':
    case 'Medical':
    case 'Logistics':
    case 'Military Police':
    case 'HQ':
      return 'wheeled';
    default:
      return 'wheeled';
  }
}

export function getTimeBudgetSec(
  phaseStartOffset: number,
  phaseEndOffset: number,
  orderModifier: number = 0.8,
): number {
  return Math.floor(
    (phaseEndOffset - phaseStartOffset) * 24 * 3600 * orderModifier,
  );
}

export function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}
