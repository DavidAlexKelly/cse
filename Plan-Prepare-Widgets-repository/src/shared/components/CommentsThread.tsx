import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { CURRENT_USER_ID, personById } from "../data/index.js";
import type { CommentRecord } from "../data/index.js";
import { MilButton } from "./Button.js";

interface Props {
  comments: CommentRecord[];
  onAdd: (text: string) => void;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `Today ${hhmm}`;
  if (isYesterday) return `Yesterday ${hhmm}`;
  return `${d.toLocaleDateString()} ${hhmm}`;
}

export const CommentsThread: React.FC<Props> = ({ comments, onAdd }) => {
  const [draft, setDraft] = useState("");
  const me = personById(CURRENT_USER_ID);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };

  return (
    <div className="scn-section">
      <div className="scn-section__head">
        <div className="scn-section__title">
          <Icon icon="chat" size={11} />
          Comments &amp; review thread
          <span style={{ color: "#454c68" }}>·</span>
          <span style={{ color: "#98a1c0", fontWeight: 600 }}>
            {comments.length}
          </span>
        </div>
      </div>

      <div className="scn-thread">
        {comments.length === 0 && (
          <div
            style={{
              color: "#6a7292",
              fontSize: 12,
              padding: "10px 0",
              textAlign: "center",
            }}
          >
            No comments yet — start the review thread below.
          </div>
        )}

        {comments.map((c) => {
          const person = personById(c.__links.authoredBy);
          if (!person) return null;
          return (
            <div key={c.commentId} className="scn-comment">
              <div
                className="scn-comment__avatar"
                style={{ background: person.avatarBg }}
                title={person.role}
              >
                {person.initials}
              </div>
              <div className="scn-comment__content">
                <div className="scn-comment__head">
                  <div className="scn-comment__name">{person.name}</div>
                  <div className="scn-comment__time">
                    {formatTimestamp(c.timestamp)}
                  </div>
                </div>
                <div className="scn-comment__text">{c.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="scn-composer">
        {me && (
          <div
            className="scn-composer__avatar"
            style={{ background: me.avatarBg }}
            title={me.name}
          >
            {me.initials}
          </div>
        )}
        <textarea
          className="scn-composer__input"
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="scn-composer__actions">
          <MilButton
            icon="send-message"
            variant="primary"
            disabled={draft.trim() === ""}
            onClick={submit}
          >
            Send
          </MilButton>
        </div>
      </div>
    </div>
  );
};
