// ── Delete Confirmation Modal ──────────────────────────────────────────────

import React from "react";
import {
  MilModal,
} from "../../shared/components/Modal.js";

interface DeleteConfirmModalProps {
  taskTitle: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  taskTitle,
  onConfirm,
  onClose,
}) => (
  <MilModal
    title="Remove Task"
    titleIcon="warning-sign"
    size="sm"
    onClose={onClose}
    actions={[
      { label: "Cancel",  variant: "default", onClick: onClose   },
      { label: "Remove",  variant: "danger",  icon: "trash", onClick: onConfirm },
    ]}
  >
    <p style={{ fontSize: 13, color: "#e6eaf8", lineHeight: 1.6 }}>
      Are you sure you want to remove{" "}
      <strong style={{ color: "#ffffff" }}>{taskTitle}</strong> from the workflow?
    </p>
    <p style={{ fontSize: 11, color: "#6a7292", marginTop: 4 }}>
      This action cannot be undone.
    </p>
  </MilModal>
);
