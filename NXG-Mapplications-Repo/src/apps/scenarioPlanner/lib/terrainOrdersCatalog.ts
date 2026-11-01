/**
 * Flat catalog of orders for the UnitOrderPicker component.
 * Each entry optionally carries a `milxSidc` that maps to the parametric
 * MilX symbol library for proper APP-6D rendering.
 */

export interface OrderCatalogEntry {
  key: string;
  label: string;
  category: 'Offensive' | 'Defensive' | 'Manoeuvre' | 'Fire Support' | 'Security';
  /** Internal MilX SIDC (e.g. "SVGCOUNTERATTACK") for parametric rendering */
  milxSidc?: string;
  description: string;
}

export const ORDER_CATALOG: OrderCatalogEntry[] = [
  // ── Offensive ──
  { key: 'attack', label: 'Attack', category: 'Offensive', milxSidc: 'SVGAXISNOTCHEDSIMPLE', description: 'Offensive action to destroy or defeat enemy forces, seize terrain, or both.' },
  { key: 'counterattack', label: 'Counter-Attack', category: 'Offensive', milxSidc: 'SVGCOUNTERATTACK', description: 'Attack by a defending force to regain ground or cut off enemy forces.' },
  { key: 'main-attack', label: 'Main Attack', category: 'Offensive', milxSidc: 'SVGMAINATTACK', description: 'The principal offensive effort, concentrating combat power at the decisive point.' },
  { key: 'supporting-attack', label: 'Supporting Attack', category: 'Offensive', milxSidc: 'SVGSUPPORTINGATTACK', description: 'Offensive action to fix or divert enemy forces from the main attack.' },
  { key: 'seize', label: 'Seize', category: 'Offensive', milxSidc: 'SVGSEIZE', description: 'Take possession of an objective by force.' },
  { key: 'secure', label: 'Secure', category: 'Offensive', milxSidc: 'SVGSECURE', description: 'Gain possession of a position or terrain feature, deny its use to the enemy.' },
  { key: 'breach', label: 'Breach', category: 'Offensive', milxSidc: 'SVGBREACH', description: 'Break through or secure a passage through an obstacle or fortification.' },
  { key: 'bypass', label: 'Bypass', category: 'Offensive', milxSidc: 'SVGBYPASS', description: 'Manoeuvre around an obstacle, position, or enemy force to maintain momentum.' },
  { key: 'exploit', label: 'Exploit', category: 'Offensive', milxSidc: 'SVGAXISNOTCHED', description: 'Follow up success to disorganise the enemy in depth.' },
  { key: 'pursue', label: 'Pursue', category: 'Offensive', milxSidc: 'SVGAXISNOTCHEDWIDE', description: 'Offensive action against a retreating enemy to prevent reconstitution.' },
  { key: 'advance', label: 'Advance', category: 'Offensive', milxSidc: 'SVGAXISNOTCHEDSIMPLE', description: 'Move forward to gain contact or occupy terrain.' },
  { key: 'infiltrate', label: 'Infiltrate', category: 'Offensive', description: 'Move through enemy positions without detection.' },
  { key: 'envelop', label: 'Envelop', category: 'Offensive', milxSidc: 'SVGAXISNOTCHEDWIDE', description: 'Avoid the enemy front and attack a flank or rear.' },
  { key: 'penetrate', label: 'Penetrate', category: 'Offensive', milxSidc: 'SVGPENETRATE', description: 'Break through enemy defences on a narrow front.' },
  { key: 'turn', label: 'Turn', category: 'Offensive', description: 'Force the enemy to move from established positions to fight in a different direction.' },

  // ── Defensive ──
  { key: 'defend', label: 'Defend', category: 'Defensive', description: 'Resist an attack, gain time, or achieve conditions for a counter-offensive.' },
  { key: 'hold', label: 'Hold', category: 'Defensive', description: 'Maintain possession of a position and prevent its use by the enemy.' },
  { key: 'block', label: 'Block', category: 'Defensive', milxSidc: 'SVGBLOCK', description: 'Deny the enemy access to an area or prevent advance along a route.' },
  { key: 'fix', label: 'Fix', category: 'Defensive', milxSidc: 'SVGFIX', description: 'Prevent the enemy from moving, reinforcing, or withdrawing.' },
  { key: 'contain', label: 'Contain', category: 'Defensive', milxSidc: 'SVGCONTAIN', description: 'Restrict enemy movement and prevent breakout from a defined area.' },
  { key: 'retain', label: 'Retain', category: 'Defensive', milxSidc: 'SVGRETAIN', description: 'Keep control of terrain or a position.' },
  { key: 'occupy', label: 'Occupy', category: 'Defensive', milxSidc: 'SVGOCCUPY', description: 'Move to and prepare a position for defence or other operations.' },

  // ── Manoeuvre ──
  { key: 'withdraw', label: 'Withdraw', category: 'Manoeuvre', milxSidc: 'SVGWITHDRAW', description: 'Disengage from the enemy and move to the rear.' },
  { key: 'retirement', label: 'Retirement', category: 'Manoeuvre', milxSidc: 'SVGRETIREMENT', description: 'Orderly movement away from the enemy by a force not in contact.' },
  { key: 'delay', label: 'Delay', category: 'Manoeuvre', milxSidc: 'SVGDELAY', description: 'Trade space for time, inflicting maximum casualties without becoming decisively engaged.' },
  { key: 'displace', label: 'Displace', category: 'Manoeuvre', description: 'Move from one position to another while maintaining readiness.' },

  // ── Fire Support ──
  { key: 'destroy', label: 'Destroy', category: 'Fire Support', milxSidc: 'SVGDESTROY', description: 'Render an enemy force combat-ineffective through fires.' },
  { key: 'neutralize', label: 'Neutralize', category: 'Fire Support', milxSidc: 'SVGNEUTRALIZE', description: 'Render enemy personnel or material incapable of interfering with operations.' },
  { key: 'suppress', label: 'Suppress', category: 'Fire Support', description: 'Degrade enemy fire to prevent effective engagement.' },
  { key: 'interdict', label: 'Interdict', category: 'Fire Support', milxSidc: 'SVGINTERDICT', description: 'Disrupt enemy movement and supply lines through fires.' },

  // ── Security ──
  { key: 'screen', label: 'Screen', category: 'Security', milxSidc: 'SVGSCREENSS', description: 'Provide early warning and maintain surveillance along a line or area.' },
  { key: 'guard', label: 'Guard', category: 'Security', milxSidc: 'SVGGUARDGG', description: 'Protect the main force by fighting to gain time and reporting on the enemy.' },
  { key: 'cover', label: 'Cover', category: 'Security', milxSidc: 'SVGCOVERCC', description: 'Operate independently to develop the situation and deny enemy observation.' },
  { key: 'canalize', label: 'Canalize', category: 'Security', milxSidc: 'SVGCANALIZE', description: 'Restrict enemy movement to a narrow zone.' },
];
