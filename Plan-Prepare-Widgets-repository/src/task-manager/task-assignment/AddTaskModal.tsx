// ── Add Workflow Task Modal ────────────────────────────────────────────────

import React, { useState } from "react";
import {
  MilModal,
  MilFormRow,
  MilFormGroup,
  MilTextInput,
  MilTextArea,
  MilSelect,
} from "../../shared/components/Modal.js";
import { TASK_SECTIONS } from "./mockData.js";
import type { TaskSection, WorkflowTask } from "./types.js";
import { deriveStatus } from "./types.js";

interface AddTaskModalProps {
  teamMembers: { name: string }[];
  onAdd: (task: WorkflowTask) => void;
  onClose: () => void;
}

const SECTION_OPTIONS = TASK_SECTIONS.map(s => ({ value: s, label: s }));

const ASSIGN_OPTIONS = (members: { name: string }[]) => [
  { value: "", label: "— Assign —" },
  ...members.map(m => ({ value: m.name, label: m.name })),
];

export const AddTaskModal: React.FC<AddTaskModalProps> = ({
  teamMembers,
  onAdd,
  onClose,
}) => {
  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [section,  setSection]  = useState<TaskSection>(TASK_SECTIONS[0]);
  const [due,      setDue]      = useState("");
  const [approver, setApprover] = useState("");
  const [owner,    setOwner]    = useState("");

  const isValid = title.trim() !== "";

  const handleAdd = () => {
    if (!isValid) return;
    const ap = approver || null;
    const ow = owner    || null;
    onAdd({
      id:          `wt-${Date.now()}`,
      section,
      phaseId:     null,
      title:       title.trim(),
      description: desc.trim(),
      approver:    ap,
      owner:       ow,
      due:         due.trim() || "—",
      status:      deriveStatus(ap, ow),
    });
    onClose();
  };

  const assignOpts = ASSIGN_OPTIONS(teamMembers);

  return (
    <MilModal
      title="Add Workflow Task"
      titleIcon="add"
      onClose={onClose}
      actions={[
        { label: "Cancel",   variant: "default",  onClick: onClose  },
        { label: "Add Task", variant: "primary", icon: "add", disabled: !isValid, onClick: handleAdd },
      ]}
    >
      {/* Title */}
      <MilFormRow>
        <MilFormGroup label="Task Title">
          <MilTextInput
            value={title}
            onChange={setTitle}
            placeholder="e.g. Training audience"
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Description */}
      <MilFormRow>
        <MilFormGroup label="Description">
          <MilTextArea
            value={desc}
            onChange={setDesc}
            placeholder="Brief description of what this task covers"
            rows={3}
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Section + Due */}
      <MilFormRow>
        <MilFormGroup label="Section">
          <MilSelect
            value={section}
            options={SECTION_OPTIONS}
            onChange={v => setSection(v as TaskSection)}
          />
        </MilFormGroup>
        <MilFormGroup label="Due Window" compact>
          <MilTextInput
            value={due}
            onChange={setDue}
            placeholder="e.g. 0-45"
          />
        </MilFormGroup>
      </MilFormRow>

      {/* Approver + Owner */}
      <MilFormRow>
        <MilFormGroup label="Approver">
          <MilSelect
            value={approver}
            options={assignOpts}
            onChange={setApprover}
          />
        </MilFormGroup>
        <MilFormGroup label="Task Owner">
          <MilSelect
            value={owner}
            options={assignOpts}
            onChange={setOwner}
          />
        </MilFormGroup>
      </MilFormRow>
    </MilModal>
  );
};
