// ── PMESII Analysis — Comments Panel ─────────────────────────────────────

import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { MilButton } from "../shared/components/Button.js";
import type { PmesiiComment } from "./types.js";

interface CommentsPanelProps {
  comments: PmesiiComment[];
  onAdd: (text: string) => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({ comments, onAdd }) => {
  const [draft,     setDraft]     = useState("");
  const [expanded,  setExpanded]  = useState(false);

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <div className="pa-comments">

      {/* ── Collapsible header ────────────────────────────────────────── */}
      <button
        className="pa-comments__header"
        onClick={() => setExpanded(prev => !prev)}
      >
        <Icon icon="chat" size={12} />
        <span className="pa-comments__header-label">
          Comments
          {comments.length > 0 && (
            <span className="pa-comments__count">{comments.length}</span>
          )}
        </span>
        <Icon
          icon="chevron-up"
          size={12}
          className="pa-comments__chevron"
          style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
        />
      </button>

      {/* ── Comment list (only when expanded) ────────────────────────── */}
      {expanded && (
        <div className="pa-comments__list">
          {comments.length === 0 && (
            <p className="pa-comments__empty">No comments yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="pa-comment">
              <div className="pa-comment__avatar">
                {c.rank.slice(0, 2).toUpperCase()}
              </div>
              <div className="pa-comment__body">
                <div className="pa-comment__meta">
                  <span className="pa-comment__author">{c.author}</span>
                  <span className="pa-comment__time">{c.timestamp}</span>
                </div>
                <p className="pa-comment__text">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add comment input (always visible) ───────────────────────── */}
      <div className="pa-comments__input-row">
        <input
          className="mel-input pa-comments__input"
          placeholder="Add a comment…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <MilButton variant="primary" size="sm" onClick={handleAdd}>
          Add
        </MilButton>
      </div>
    </div>
  );
};
