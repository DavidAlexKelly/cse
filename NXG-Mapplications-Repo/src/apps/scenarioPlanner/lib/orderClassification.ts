export type OrderMotionType = 'movement' | 'static' | 'area' | 'control-measure';

export const ORDER_MOTION: Record<string, OrderMotionType> = {
  // Movement — need destination, show reachability envelope
  'counterattack': 'movement',
  'main-attack': 'movement',
  'supporting-attack': 'movement',
  'attack': 'movement',
  'seize': 'movement',
  'secure': 'movement',
  'breach': 'movement',
  'bypass': 'movement',
  'exploit': 'movement',
  'pursue': 'movement',
  'advance': 'movement',
  'infiltrate': 'movement',
  'envelop': 'movement',
  'penetrate': 'movement',
  'turn': 'movement',
  'withdraw': 'movement',
  'retirement': 'movement',
  'delay': 'movement',
  'displace': 'movement',

  // Static — apply in-place, no movement
  'hold': 'static',
  'defend': 'static',
  'fix': 'static',
  'contain': 'static',
  'block': 'static',
  'retain': 'static',
  'occupy': 'static',
  'neutralize': 'static',
  'destroy': 'static',
  'suppress': 'static',
  'interdict': 'static',

  // Area — define a line/zone
  'screen': 'area',
  'guard': 'area',
  'cover': 'area',
  'canalize': 'area',

  // Control-measure — map annotations
  'phase-line': 'control-measure',
  'boundary': 'control-measure',
  'objective': 'control-measure',
  'assembly-area': 'control-measure',
  'attack-position': 'control-measure',
};

export function getMotionType(orderKey: string): OrderMotionType {
  return ORDER_MOTION[orderKey] ?? 'movement';
}

export function isMovementOrder(orderKey: string): boolean {
  return getMotionType(orderKey) === 'movement';
}

export function isStaticOrder(orderKey: string): boolean {
  return getMotionType(orderKey) === 'static';
}
