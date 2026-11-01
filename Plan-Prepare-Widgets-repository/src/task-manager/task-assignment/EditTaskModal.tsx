// ── Edit Workflow Task Modal ───────────────────────────────────────────────

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

interface EditTaskModalProps {
  task: WorkflowTask;
  teamMembers: { name: string }[];
  onSave: (updated: WorkflowTask) => void;
  onClose: () => void;
}

const SECTION_OPTIONS = TASK_SECTIONS.map(s => ({ value: s, label: s }));

const buildAssignOptions = (members: { name: string }[]) => [
  { value: "", label: "— Assign —" },
  ...members.map(m => ({ value: m.name, label: m.name })),
];

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  task,
  teamMembers,
  onSave,
  onClose,
}) => {
  const [title,    setTitle]    = useState(task.title);
  const [desc,     setDesc]     = useState(task.description);
  const [section,  setSection]  = useState<TaskSection>(task.section);
  const [due,      setDue]      = useState(task.due);
  const [approver, setApprover] = useState(task.approver ?? "");
  const [owner,    setOwner]    = useState(task.owner    ?? "");

  const isValid = title.trim() !== "";

  const handleSave = () => {
    if (!isValid) return;
    const ap = approver || null;
    const ow = owner    || null;
    onSave({
      ...task,
      title:       title.trim(),
      description: desc.trim(),
      section,
      due:         due.trim() || "—",
      approver:    ap,
      owner:       ow,
      status:      deriveStatus(ap, ow),
    });
    onClose();
  };

  const assignOpts = buildAssignOptions(teamMembers);

  return (
    <MilModal
      title="Edit Workflow Task"
      titleIcon="edit"
      onClose={onClose}
      actions={[
        { label: "Cancel",       variant: "default",  onClick: onClose  },
        { label: "Save Changes", variant: "primary",  icon: "tick", disabled: !isValid, onClick: handleSave },
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
