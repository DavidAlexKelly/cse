// ── Add Team Member Modal ──────────────────────────────────────────────────

import React, { useState } from "react";
import {
  MilModal,
  MilFormRow,
  MilFormGroup,
  MilTextInput,
  MilSelect,
} from "../../shared/components/Modal.js";
import type { TeamMember } from "./types.js";

interface AddMemberModalProps {
  existingMembers: TeamMember[];
  onAdd: (member: TeamMember) => void;
  onClose: () => void;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  existingMembers,
  onAdd,
  onClose,
}) => {
  const [selectedId, setSelectedId] = useState("");
  const [rank,       setRank]       = useState("");
  const [role,       setRole]       = useState("");

  const memberOptions = [
    { value: "", label: "— Select person —" },
    ...existingMembers.map(m => ({ value: m.id, label: `${m.name} (${m.rank})` })),
  ];

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const found = existingMembers.find(m => m.id === id);
    // Auto-populate rank and role immediately from the selected person
    setRank(found ? found.rank : "");
    setRole(found ? found.role : "");
  };

  const selectedMember = existingMembers.find(m => m.id === selectedId);
  const isValid = !!selectedMember && rank.trim() !== "" && role.trim() !== "";

  const handleAdd = () => {
    if (!isValid || !selectedMember) return;
    onAdd({
      id:   `tm-${Date.now()}`,
      name: selectedMember.name,
      rank: rank.trim(),
      role: role.trim(),
    });
    onClose();
  };

  return (
    <MilModal
      title="Add Team Member"
      titleIcon="person"
      size="sm"
      onClose={onClose}
      actions={[
        { label: "Cancel",     variant: "default", onClick: onClose  },
        { label: "Add Member", variant: "primary",  icon: "add", disabled: !isValid, onClick: handleAdd },
      ]}
    >
      <MilFormRow>
        <MilFormGroup label="Select Person">
          <MilSelect
            value={selectedId}
            options={memberOptions}
            onChange={handleSelect}
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Rank + Role — pre-populated once a person is selected, still editable */}
      <MilFormRow>
        <MilFormGroup label="Rank" compact>
          <MilTextInput
            value={rank}
            onChange={setRank}
            placeholder="Auto-filled"
          />
        </MilFormGroup>
        <MilFormGroup label="Role">
          <MilTextInput
            value={role}
            onChange={setRole}
            placeholder="Auto-filled"
          />
        </MilFormGroup>
      </MilFormRow>
    </MilModal>
  );
};
