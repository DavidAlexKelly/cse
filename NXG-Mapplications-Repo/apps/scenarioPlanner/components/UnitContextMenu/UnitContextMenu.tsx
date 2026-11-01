import React, { useEffect, useRef } from 'react';
import './UnitContextMenu.css';

interface UnitContextMenuProps {
  /** Mouse position where the right-click happened, relative to the map container */
  position: { x: number; y: number };
  /** Unit name to display at top */
  unitLabel: string;
  /** Called when user clicks 'Edit Unit' */
  onEditUnit: () => void;
  /**
   * True when this placement already has an ORBAT graph. Switches the ORBAT
   * item between "Define ORBAT" and "Edit ORBAT".
   */
  hasOrbat?: boolean;
  /**
   * Called when the user chooses Define/Edit ORBAT. Omit to hide the item
   * (e.g. no scenario context to attach the ORBAT to).
   */
  onDefineOrbat?: () => void;
  /** Called when user clicks 'Assign Orders' */
  onAssignOrders: () => void;
  /** Called when user clicks 'Remove Unit' */
  onRemoveUnit: () => void;
  /** Called to close the menu (click outside, escape, etc.) */
  onClose: () => void;
}

export const UnitContextMenu: React.FC<UnitContextMenuProps> = ({
  position,
  unitLabel,
  onEditUnit,
  hasOrbat = false,
  onDefineOrbat,
  onAssignOrders,
  onRemoveUnit,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Delay adding listeners to avoid immediately closing from the triggering right-click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Use position:absolute (relative to the nearest positioned ancestor — the
  // map container wrapper div in ScenarioMap) instead of position:fixed.
  // position:fixed breaks inside CSS-transformed ancestors such as Foundry
  // widget shells that apply transform: scale() or translate().
  // ScenarioMap already wraps everything in a `position: relative` div, so
  // the coordinates passed in (container-relative) map directly here.
  const style: React.CSSProperties = {
    position: 'absolute',
    left: position.x,
    top: position.y,
    zIndex: 10000,
  };

  return (
    <div className="unit-context-menu" style={style} ref={menuRef}>
      <div className="ucm-header">{unitLabel}</div>
      <div className="ucm-divider" />
      <button className="ucm-item" onClick={() => { onEditUnit(); onClose(); }}>
        <span className="ucm-icon">✏️</span>
        <span>Edit Unit</span>
      </button>
      {onDefineOrbat && (
        <button className="ucm-item" onClick={() => { onDefineOrbat(); onClose(); }}>
          <span className="ucm-icon">{hasOrbat ? "🌳" : "❗"}</span>
          <span>{hasOrbat ? "Edit ORBAT" : "Define ORBAT"}</span>
        </button>
      )}
      <button className="ucm-item" onClick={() => { onAssignOrders(); onClose(); }}>
        <span className="ucm-icon">⚔️</span>
        <span>Assign Orders</span>
      </button>
      <div className="ucm-divider" />
      <button className="ucm-item ucm-item--danger" onClick={() => { onRemoveUnit(); onClose(); }}>
        <span className="ucm-icon">🗑️</span>
        <span>Remove Unit</span>
      </button>
    </div>
  );
};

export default UnitContextMenu;
