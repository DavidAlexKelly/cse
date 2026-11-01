import React, { useMemo, useCallback } from 'react';
import './UnitOrderPicker.css';

interface OrderInfo {
  key: string;
  label: string;
  sidc?: string;
  category: string;
  icon?: string;
}

interface UnitOrderPickerProps {
  unitLabel: string;
  unitSidc: string;
  orders: OrderInfo[];
  existingOrders: Array<{ orderKey: string; orderLabel: string; targetName?: string }>;
  onSelectOrder: (order: OrderInfo) => void;
  onRemoveOrder?: (index: number) => void;
  onClose: () => void;
  motionTypeForOrder: (key: string) => 'movement' | 'static' | 'area' | 'control-measure';
}

const CATEGORY_CONFIG = [
  {
    name: 'Offensive',
    colour: '#DC3232',
    keys: [
      'counterattack', 'main-attack', 'supporting-attack', 'attack', 'seize',
      'secure', 'breach', 'bypass', 'exploit', 'pursue', 'advance',
      'infiltrate', 'envelop', 'penetrate', 'turn',
    ],
  },
  {
    name: 'Defensive',
    colour: '#3278DC',
    keys: ['hold', 'defend', 'fix', 'contain', 'block', 'retain', 'occupy'],
  },
  {
    name: 'Manoeuvre',
    colour: '#DCB432',
    keys: ['withdraw', 'retirement', 'delay', 'displace'],
  },
  {
    name: 'Fire Support',
    colour: '#DC6432',
    keys: ['destroy', 'neutralize', 'suppress', 'interdict'],
  },
  {
    name: 'Security',
    colour: '#32B478',
    keys: ['screen', 'guard', 'cover', 'canalize'],
  },
];

function motionIndicator(motionType: 'movement' | 'static' | 'area' | 'control-measure'): string {
  switch (motionType) {
    case 'movement':
      return '→';
    case 'static':
      return '(static)';
    case 'area':
      return '◇';
    default:
      return '';
  }
}

export const UnitOrderPicker: React.FC<UnitOrderPickerProps> = ({
  unitLabel,
  unitSidc,
  orders,
  existingOrders,
  onSelectOrder,
  onRemoveOrder,
  onClose,
  motionTypeForOrder,
}) => {
  // Filter out control-measure orders and group by category
  const categories = useMemo(() => {
    const filteredOrders = orders.filter(
      (o) => motionTypeForOrder(o.key) !== 'control-measure',
    );

    return CATEGORY_CONFIG.map((cat) => {
      const catOrders = filteredOrders.filter((o) => cat.keys.includes(o.key));
      return { name: cat.name, colour: cat.colour, orders: catOrders };
    }).filter((cat) => cat.orders.length > 0);
  }, [orders, motionTypeForOrder]);

  const handleSelectOrder = useCallback(
    (order: OrderInfo) => {
      onSelectOrder(order);
    },
    [onSelectOrder],
  );

  return (
    <div className="uop-backdrop" onClick={onClose}>
      <div className="uop-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Assign Orders">
        {/* Header */}
        <div className="uop-header">
          <div>
            <h2 className="uop-title">Assign Orders</h2>
            <div className="uop-subtitle">
              <span className="uop-sidc" title={unitSidc}>[{unitSidc}]</span>
              {' '}{unitLabel}
            </div>
          </div>
          <button className="uop-close" onClick={onClose}>×</button>
        </div>

        {/* Body — order grid by category */}
        <div className="uop-body">
          {categories.map((cat) => (
            <div key={cat.name} className="uop-category">
              <div className="uop-category-header" style={{ borderColor: cat.colour, color: cat.colour }}>
                {cat.name}
              </div>
              <div className="uop-order-grid">
                {cat.orders.map((order) => {
                  const mt = motionTypeForOrder(order.key);
                  return (
                    <button
                      key={order.key}
                      className="uop-order-tile"
                      title={`${order.label} (${mt})`}
                      onClick={() => handleSelectOrder(order)}
                    >
                      <span className="uop-order-label">{order.label}</span>
                      <span className="uop-order-motion">{motionIndicator(mt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Existing orders */}
        {existingOrders.length > 0 && (
          <div className="uop-existing">
            <div className="uop-existing-header">Current Orders</div>
            {existingOrders.map((eo, i) => (
              <div key={i} className="uop-existing-row">
                <span>
                  {eo.orderLabel}
                  {eo.targetName ? ` → ${eo.targetName}` : ''}
                </span>
                {onRemoveOrder && (
                  <button onClick={() => onRemoveOrder(i)}>🗑</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnitOrderPicker;
