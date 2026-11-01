/* eslint-disable jsx-a11y/no-autofocus */
// ============================================================
//  Sides Panel — CRUD for Sides + Groups
// ============================================================

import React, { useState } from "react";
import type { Side, UnitGroup } from "./types.js";
import { IDENTITY_LABELS, BRANCH_LABELS } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";
import { countPersonnel, countUnits } from "./treeUtils.js";
import { MilButton } from "../shared/components/Button.js";
import {
  MilModal, MilFormGroup,
  MilTextInput, MilTextArea,
} from "../shared/components/Modal.js";

const IDENTITY_OPTIONS: Array<{
  value: Side["standardIdentity"];
  label: string;
  shape: string;
  desc: string;
}> = [
  { value: "friend",        label: "Friend",         shape: "rectangle",      desc: "Confirmed friendly force — solid blue rectangle" },
  { value: "hostile",       label: "Hostile",        shape: "diamond",        desc: "Confirmed enemy force — solid red diamond" },
  { value: "neutral",       label: "Neutral",        shape: "square",         desc: "Neutral party — solid green square" },
  { value: "unknown",       label: "Unknown",        shape: "quatrefoil",     desc: "Unknown affiliation — yellow quatrefoil" },
  { value: "pending",       label: "Pending",        shape: "dashed-rect",    desc: "Pending classification — dashed yellow rectangle" },
  { value: "assumedFriend", label: "Assumed Friend", shape: "dashed-rect",    desc: "Assumed friendly — dashed blue rectangle" },
  { value: "suspect",       label: "Suspect",        shape: "dashed-diamond", desc: "Suspected hostile — dashed red diamond" },
];

const BRANCH_OPTIONS = Object.entries(BRANCH_LABELS) as [UnitGroup["branch"], string][];

const IDENTITY_COLOURS: Record<Side["standardIdentity"], string> = {
  friend: "#63a2ff", hostile: "#ef4d4d", neutral: "#27AE60",
  unknown: "#f5b955", pending: "#9ab8d8", assumedFriend: "#9ab8d8", suspect: "#e07070",
};

interface SidesPanelProps {
  sides: Side[];
  onBuildGroup: (sideId: string, groupId: string) => void;
  onCreateSide: (input: Record<string, string>) => Promise<void>;
  onUpdateSide: (id: string, input: Record<string, string>) => Promise<void>;
  onDeleteSide: (id: string) => Promise<void>;
  onCreateGroup: (sideId: string, input: Record<string, string>) => Promise<void>;
  onDeleteGroup: (sideId: string, groupId: string) => Promise<void>;
  onApplyGroupTemplate: (sideId: string, groupId: string, templateId: string) => Promise<void>;
  groupTemplates: import("./types.js").GroupTemplate[];
}

interface SideFormState {
  name: string;
  standardIdentity: Side["standardIdentity"];
  description: string;
}

interface GroupFormState {
  name: string;
  branch: UnitGroup["branch"];
  description: string;
}

export const SidesPanel: React.FC<SidesPanelProps> = ({
  sides, onBuildGroup, onCreateSide, onUpdateSide, onDeleteSide,
  onCreateGroup, onDeleteGroup, onApplyGroupTemplate, groupTemplates,
}) => {
  const [sideDialogOpen, setSideDialogOpen]   = useState(false);
  const [editingSide, setEditingSide]         = useState<Side | null>(null);
  const [sideForm, setSideForm]               = useState<SideFormState>({ name: "", standardIdentity: "friend", description: "" });

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupSideId, setGroupSideId]         = useState<string | null>(null);
  const [groupForm, setGroupForm]             = useState<GroupFormState>({ name: "", branch: "army", description: "" });

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateTarget, setTemplateTarget]         = useState<{ sideId: string; groupId: string } | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const [expandedSides, setExpandedSides] = useState<Set<string>>(new Set(sides.map(s => s.id)));
  // Inline delete confirmations — avoids confirm() in iframe
  const [confirmDeleteSideId, setConfirmDeleteSideId]   = useState<string | null>(null);
  const [confirmDeleteGroupKey, setConfirmDeleteGroupKey] = useState<string | null>(null); // "sideId::groupId"


  const openCreateSide = () => {
    setEditingSide(null);
    setSideForm({ name: "", standardIdentity: "friend", description: "" });
    setSideDialogOpen(true);
  };

  const openEditSide = (s: Side) => {
    setEditingSide(s);
    setSideForm({ name: s.name, standardIdentity: s.standardIdentity, description: s.description });
    setSideDialogOpen(true);
  };

  const handleSideSubmit = async () => {
    if (!sideForm.name.trim()) return;
    const colour = IDENTITY_COLOURS[sideForm.standardIdentity];
    if (editingSide) {
      await onUpdateSide(editingSide.id, { ...sideForm, colour });
    } else {
      await onCreateSide({ ...sideForm, colour });
    }
    setSideDialogOpen(false);
  };

  const handleCreateGroup = async () => {
    if (!groupSideId || !groupForm.name.trim()) return;
    await onCreateGroup(groupSideId, { ...groupForm });
    setGroupDialogOpen(false);
  };

  const openApplyTemplate = (sideId: string, groupId: string) => {
    setTemplateTarget({ sideId, groupId });
    setSelectedTemplateId(groupTemplates[0]?.id ?? "");
    setTemplateDialogOpen(true);
  };

  const handleApplyTemplate = async () => {
    if (!templateTarget || !selectedTemplateId) return;
    await onApplyGroupTemplate(templateTarget.sideId, templateTarget.groupId, selectedTemplateId);
    setTemplateDialogOpen(false);
  };

  const toggleSide = (id: string) => {
    setExpandedSides(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedDesc = IDENTITY_OPTIONS.find(o => o.value === sideForm.standardIdentity)?.desc ?? "";

  return (
    <div className="orbat-panel">
      {/* ── Header ── */}
      <div className="orbat-panel__header">
        <span className="orbat-panel__title">Sides</span>
        <MilButton variant="primary" icon="add" onClick={openCreateSide}>New Side</MilButton>
      </div>

      {/* ── Content ── */}
      <div className="orbat-panel__content">
        {sides.length === 0 ? (
          <div className="mil-empty">
            <div style={{ fontSize: 32, opacity: 0.3 }}>🌍</div>
            <div className="mil-empty__text">No sides defined</div>
            <div style={{ fontSize: 11, color: "var(--mil-muted)", maxWidth: 220, textAlign: "center", lineHeight: 1.5 }}>
              Create a side (e.g. Allied Forces) then add groups and units.
            </div>
            <MilButton variant="primary" icon="add" onClick={openCreateSide}>New Side</MilButton>
          </div>
        ) : (
          sides.map(side => {
            const expanded   = expandedSides.has(side.id);
            const totalPax   = side.groups.reduce((a, g) => a + countPersonnel(g.units), 0);
            const totalUnits = side.groups.reduce((a, g) => a + countUnits(g.units), 0);
            const colour     = side.colour || IDENTITY_COLOURS[side.standardIdentity];
            return (
              <div key={side.id} style={{
                background: "var(--mil-bg-3)",
                border: `1px solid ${colour}44`,
                borderLeft: `3px solid ${colour}`,
                borderRadius: 2,
                marginBottom: 8,
                overflow: "hidden",
              }}>
                {/* Side header */}
                <div
                  role="button" tabIndex={0}
                  onClick={() => toggleSide(side.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSide(side.id); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px", cursor: "pointer",
                    background: "var(--mil-surface)",
                  }}
                >
                  <NatoSymbol standardIdentity={side.standardIdentity} echelon="division" icon="headquarters" size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mil-text)" }}>{side.name}</div>
                    <div style={{ fontSize: 10, color: "var(--mil-text-2)", marginTop: 1 }}>
                      {IDENTITY_LABELS[side.standardIdentity]}
                      {totalPax > 0 && <> · {totalPax.toLocaleString()} pax · {totalUnits} units</>}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                    padding: "2px 6px", borderRadius: 2,
                    background: `${colour}22`, border: `1px solid ${colour}55`, color: colour,
                  }}>
                    {IDENTITY_LABELS[side.standardIdentity]}
                  </span>
                  <MilButton
                    variant="ghost" icon="edit" iconOnly
                    onClick={e => { e.stopPropagation(); openEditSide(side); }}
                    title="Edit side"
                  />
                  <MilButton
                    variant="danger" icon="trash" iconOnly
                    onClick={e => { e.stopPropagation(); setConfirmDeleteSideId(side.id); }}
                    title="Delete side"
                  />
                  <span style={{ color: "var(--mil-muted)", fontSize: 11, marginLeft: 2 }}>{expanded ? "▲" : "▼"}</span>
                </div>

                {/* Inline delete confirm for side */}
                {confirmDeleteSideId === side.id && (
                  <div style={{ padding: "8px 12px", background: "rgba(239, 77, 77,0.1)", borderTop: "1px solid rgba(239, 77, 77,0.35)", display: "flex", alignItems: "center", gap: 10 }}>

                    <span style={{ fontSize: 11, color: "#ef4d4d", flex: 1 }}>Delete side &quot;{side.name}&quot; and ALL its units?</span>
                    <MilButton variant="danger" icon="trash" onClick={() => { void onDeleteSide(side.id); setConfirmDeleteSideId(null); }}>Delete</MilButton>
                    <MilButton variant="default" onClick={() => setConfirmDeleteSideId(null)}>Cancel</MilButton>
                  </div>
                )}

                {/* Groups */}
                {expanded && (
                  <div style={{ padding: "6px 8px" }}>
                    {side.groups.length === 0 && (
                      <div style={{ fontSize: 11, color: "var(--mil-muted)", padding: "4px 0 6px" }}>
                        No groups yet.
                      </div>
                    )}
                    {side.groups.map(g => {
                      const gpax   = countPersonnel(g.units);
                      const gunits = countUnits(g.units);
                      return (
                        <React.Fragment key={g.id}>
                          <div className="mil-list-item" style={{ marginBottom: 4, padding: "6px 8px" }}>
                            <NatoSymbol standardIdentity={side.standardIdentity} echelon="company" icon="infantry" size={22} style={{ flexShrink: 0 }} />
                            <div className="mil-list-item__content">
                              <div className="mil-list-item__title" style={{ fontSize: 12 }}>{g.name}</div>
                              <div className="mil-list-item__meta">
                                {BRANCH_LABELS[g.branch]} · {gpax.toLocaleString()} pax · {gunits} units
                              </div>
                            </div>
                            {groupTemplates.length > 0 && (
                              <MilButton variant="ghost" icon="layers" iconOnly
                                onClick={() => openApplyTemplate(side.id, g.id)}
                                title="Apply group template"
                              />
                            )}
                            <MilButton variant="primary" icon="build"
                              onClick={() => onBuildGroup(side.id, g.id)}>
                              Build
                            </MilButton>
                            <MilButton variant="danger" icon="trash" iconOnly
                              onClick={() => setConfirmDeleteGroupKey(`${side.id}::${g.id}`)}
                              title="Delete group"
                            />
                          </div>
                          {/* Inline delete confirm for group */}
                          {confirmDeleteGroupKey === `${side.id}::${g.id}` && (
                            <div style={{ marginBottom: 4, padding: "6px 8px", background: "rgba(239, 77, 77,0.1)", border: "1px solid rgba(239, 77, 77,0.3)", borderRadius: 2, display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, color: "#ef4d4d", flex: 1 }}>Delete &quot;{g.name}&quot;?</span>
                              <MilButton variant="danger" icon="trash" onClick={() => { void onDeleteGroup(side.id, g.id); setConfirmDeleteGroupKey(null); }}>Delete</MilButton>
                              <MilButton variant="default" onClick={() => setConfirmDeleteGroupKey(null)}>Cancel</MilButton>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}

                    <div style={{ marginTop: 6 }}>
                      <MilButton
                        variant="ghost" icon="add"
                        onClick={() => {
                          setGroupSideId(side.id);
                          setGroupForm({ name: "", branch: "army", description: "" });
                          setGroupDialogOpen(true);
                        }}
                      >
                        Add Group
                      </MilButton>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Create / Edit Side Dialog ── */}
      {sideDialogOpen && (
        <MilModal
          title={editingSide ? "Edit Side" : "Create New Side"}
          titleIcon="globe"
          onClose={() => setSideDialogOpen(false)}
          actions={[
            { label: "Cancel",  variant: "default", onClick: () => setSideDialogOpen(false) },
            { label: editingSide ? "Save Changes" : "Create Side", variant: "primary",
              disabled: !sideForm.name.trim(), onClick: handleSideSubmit },
          ]}
        >
          <MilFormGroup label="Side Name">
            <MilTextInput
              value={sideForm.name}
              onChange={v => setSideForm(f => ({ ...f, name: v }))}
              placeholder="e.g. Allied Forces / United Kingdom"
              autoFocus
            />
          </MilFormGroup>

          <div>
            <div className="mel-form-label" style={{ marginBottom: 8 }}>Standard Identity / Affiliation</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {IDENTITY_OPTIONS.map(opt => {
                const sel = sideForm.standardIdentity === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSideForm(f => ({ ...f, standardIdentity: opt.value }))}
                    style={{
                      background: sel ? "var(--mil-olive-mut)" : "var(--mil-bg-2)",
                      border: `2px solid ${sel ? "var(--mil-olive)" : "var(--mil-border-lt)"}`,
                      borderRadius: 2, padding: "8px 10px", cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      minWidth: 72, transition: "border-color 0.1s, background 0.1s",
                    }}
                  >
                    <NatoSymbol standardIdentity={opt.value} echelon="battalion" icon="headquarters" size={44} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: sel ? "var(--mil-olive-lt)" : "var(--mil-text)" }}>
                      {opt.label}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--mil-muted)", textAlign: "center", lineHeight: 1.3 }}>
                      {opt.shape}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedDesc && (
              <div style={{ fontSize: 11, color: "var(--mil-text-2)", fontStyle: "italic" }}>{selectedDesc}</div>
            )}
          </div>

          <MilFormGroup label="Description">
            <MilTextArea
              value={sideForm.description}
              onChange={v => setSideForm(f => ({ ...f, description: v }))}
              placeholder="Optional description..."
              rows={2}
            />
          </MilFormGroup>
        </MilModal>
      )}

      {/* ── Add Group Dialog ── */}
      {groupDialogOpen && (
        <MilModal
          title="Add Group"
          titleIcon="layers"
          onClose={() => setGroupDialogOpen(false)}
          actions={[
            { label: "Cancel",    variant: "default", onClick: () => setGroupDialogOpen(false) },
            { label: "Add Group", variant: "primary",
              disabled: !groupForm.name.trim(), onClick: handleCreateGroup },
          ]}
        >
          <MilFormGroup label="Group Name">
            <MilTextInput
              value={groupForm.name}
              onChange={v => setGroupForm(f => ({ ...f, name: v }))}
              placeholder="e.g. 1st Armoured Brigade"
              autoFocus
            />
          </MilFormGroup>

          <div>
            <div className="mel-form-label" style={{ marginBottom: 6 }}>Branch</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {BRANCH_OPTIONS.map(([v, l]) => (
                <button key={v}
                  onClick={() => setGroupForm(f => ({ ...f, branch: v }))}
                  style={{
                    padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                    background: groupForm.branch === v ? "var(--mil-olive-mut)" : "var(--mil-bg-2)",
                    border: `1px solid ${groupForm.branch === v ? "var(--mil-olive)" : "var(--mil-border-lt)"}`,
                    color: groupForm.branch === v ? "var(--mil-olive-lt)" : "var(--mil-text-2)",
                    transition: "all 0.1s",
                  }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <MilFormGroup label="Description">
            <MilTextArea
              value={groupForm.description}
              onChange={v => setGroupForm(f => ({ ...f, description: v }))}
              rows={2}
            />
          </MilFormGroup>
        </MilModal>
      )}

      {/* ── Apply Group Template Dialog ── */}
      {templateDialogOpen && (
        <MilModal
          title="Apply Group Template"
          titleIcon="application"
          onClose={() => setTemplateDialogOpen(false)}
          actions={[
            { label: "Cancel",         variant: "default", onClick: () => setTemplateDialogOpen(false) },
            { label: "Apply Template", variant: "primary",
              disabled: !selectedTemplateId, onClick: handleApplyTemplate },
          ]}
        >
          {groupTemplates.map(gt => (
            <button key={gt.id}
              onClick={() => setSelectedTemplateId(gt.id)}
              style={{
                display: "flex", flexDirection: "column", gap: 3, width: "100%",
                padding: "10px 12px", borderRadius: 2, cursor: "pointer", textAlign: "left",
                background: selectedTemplateId === gt.id ? "var(--mil-olive-mut)" : "var(--mil-bg-2)",
                border: `1px solid ${selectedTemplateId === gt.id ? "var(--mil-olive)" : "var(--mil-border-lt)"}`,
                marginBottom: 6, transition: "all 0.1s",
              }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--mil-text)" }}>{gt.name}</div>
              <div style={{ fontSize: 11, color: "var(--mil-text-2)" }}>{gt.description}</div>
            </button>
          ))}
        </MilModal>
      )}
    </div>
  );
};
