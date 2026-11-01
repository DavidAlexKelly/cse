import React, { useState, useCallback, useEffect } from 'react';
import './UnitEditDialog.css';

interface PlacedUnitInfo {
  id: string;
  templateId?: string;
  label: string;
  sidc: string;
  lat: number;
  lng: number;
  affiliation?: 'friend' | 'hostile';
}

interface UnitEditDialogProps {
  unit: PlacedUnitInfo;
  onSave: (updates: { label?: string; sidc?: string; affiliation?: 'friend' | 'hostile' }) => void;
  onClose: () => void;
}

export const UnitEditDialog: React.FC<UnitEditDialogProps> = ({ unit, onSave, onClose }) => {
  const [label, setLabel] = useState(unit.label);
  const [sidc, setSidc] = useState(unit.sidc);
  const [affiliation, setAffiliation] = useState<'friend' | 'hostile'>(unit.affiliation ?? 'friend');

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = useCallback(() => {
    onSave({
      label: label !== unit.label ? label : undefined,
      sidc: sidc !== unit.sidc ? sidc : undefined,
      affiliation: affiliation !== unit.affiliation ? affiliation : undefined,
    });
    onClose();
  }, [label, sidc, affiliation, unit, onSave, onClose]);

  return (
    <div className="ued-backdrop" onClick={onClose}>
      <div className="ued-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit Unit">
        {/* Header */}
        <div className="ued-header">
          <h2 className="ued-title">Edit Unit</h2>
          <button className="ued-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className="ued-body">
          <div className="ued-field">
            <label className="ued-label">Unit Name</label>
            <input
              className="ued-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., 1st Battalion, 3rd Brigade"
              autoFocus
            />
          </div>

          <div className="ued-field">
            <label className="ued-label">SIDC</label>
            <input
              className="ued-input ued-input--mono"
              value={sidc}
              onChange={(e) => setSidc(e.target.value)}
              placeholder="15-character APP-6D SIDC"
              maxLength={20}
            />
            <div className="ued-hint">APP-6D Symbol Identification Code</div>
          </div>

          <div className="ued-field">
            <label className="ued-label">Affiliation</label>
            <div className="ued-toggle-group">
              <button
                className={`ued-toggle ${affiliation === 'friend' ? 'ued-toggle--active ued-toggle--friend' : ''}`}
                onClick={() => setAffiliation('friend')}
              >
                Friendly
              </button>
              <button
                className={`ued-toggle ${affiliation === 'hostile' ? 'ued-toggle--active ued-toggle--hostile' : ''}`}
                onClick={() => setAffiliation('hostile')}
              >
                Hostile
              </button>
            </div>
          </div>

          <div className="ued-field">
            <label className="ued-label">Position</label>
            <div className="ued-position">
              <span>Lat: {unit.lat.toFixed(5)}</span>
              <span>Lng: {unit.lng.toFixed(5)}</span>
            </div>
            <div className="ued-hint">Drag the unit on the map to reposition</div>
          </div>
        </div>

        {/* Footer */}
        <div className="ued-footer">
          <button className="ued-btn ued-btn--secondary" onClick={onClose}>Cancel</button>
          <button className="ued-btn ued-btn--primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
};

export default UnitEditDialog;
