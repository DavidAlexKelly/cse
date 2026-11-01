import { Icon } from "@blueprintjs/core";
import React, { useRef, useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import type { OpforDefinition } from "../scenarioData.js";

interface Props {
  opfor: OpforDefinition;
  onChange: (next: OpforDefinition) => void;
  onDelete: () => void;
}

interface AttachedFile {
  id: string;
  name: string;
}

export const OpforCard: React.FC<Props> = ({ opfor, onChange, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(opfor.title);
  const [draftMeta, setDraftMeta] = useState(opfor.meta);
  const [draftBody, setDraftBody] = useState(opfor.body);

  const [showRegenerate, setShowRegenerate] = useState(false);
  const [direction, setDirection] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const startEdit = () => {
    setDraftTitle(opfor.title);
    setDraftMeta(opfor.meta);
    setDraftBody(opfor.body);
    setEditing(true);
  };

  const saveEdit = () => {
    onChange({
      ...opfor,
      title: draftTitle.trim() || opfor.title,
      meta: draftMeta.trim(),
      body: draftBody.trim() || opfor.body,
      generated: false,
    });
    setEditing(false);
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []).map((f) => ({
      id: `${Date.now()}_${f.name}`,
      name: f.name,
    }));
    setFiles((prev) => [...prev, ...incoming]);
    e.target.value = "";
  };

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  const runRegenerate = () => {
    onChange({ ...opfor, generated: true });
    setFiles([]);
    setDirection("");
    setShowRegenerate(false);
  };

  return (
    <div className="scn-card">
      <div className="scn-section__head" style={{ marginBottom: 8 }}>
        <div className="scn-section__title">
          <Icon icon="shield" size={11} />
          OPFOR definition
          {opfor.generated && <span className="scn-tagline">Generated</span>}
        </div>
        {!editing && (
          <div className="scn-section__actions">
            <MilButton
              icon="refresh"
              variant="ghost"
              onClick={() => setShowRegenerate((s) => !s)}
            >
              Regenerate
            </MilButton>
            <MilButton icon="edit" variant="ghost" onClick={startEdit}>
              Edit
            </MilButton>
            <MilButton
              icon="trash"
              variant="danger"
              iconOnly
              title="Remove this OPFOR"
              onClick={onDelete}
            >
              Delete
            </MilButton>
          </div>
        )}
      </div>

      {showRegenerate && !editing && (
        <div
          style={{
            backgroundColor: "#0b0e18",
            border: "1px solid #2f3860",
            borderRadius: 2,
            padding: 10,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#6a7292",
              marginBottom: 6,
            }}
          >
            Provide guidance or supporting documents
          </div>

          <textarea
            className="scn-edit-textarea"
            placeholder="Direction for the rewrite — e.g. 'add EW capability detail'"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            style={{ minHeight: 60, marginBottom: 8 }}
          />

          {files.length > 0 && (
            <div className="scn-files">
              {files.map((f) => (
                <span key={f.id} className="scn-file">
                  <Icon icon="document" size={11} />
                  {f.name}
                  <span
                    className="scn-file__remove"
                    role="button"
                    tabIndex={0}
                    title="Remove"
                    onClick={() => removeFile(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") removeFile(f.id);
                    }}
                  >
                    <Icon icon="cross" size={10} />
                  </span>
                </span>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="scn-sr-only"
            onChange={onPickFiles}
          />

          <div
            style={{
              display: "flex",
              gap: 6,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <MilButton
              icon="paperclip"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              Attach files
            </MilButton>
            <MilButton variant="ghost" onClick={() => setShowRegenerate(false)}>
              Cancel
            </MilButton>
            <MilButton icon="refresh" variant="primary" onClick={runRegenerate}>
              Regenerate
            </MilButton>
          </div>
        </div>
      )}

      {editing ? (
        <>
          <input
            className="scn-edit-input"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="OPFOR title"
          />
          <input
            className="scn-edit-input"
            value={draftMeta}
            onChange={(e) => setDraftMeta(e.target.value)}
            placeholder="Short descriptor (e.g. 'Near-peer · High readiness')"
            style={{ fontSize: 11, fontWeight: 400, color: "#98a1c0" }}
          />
          <textarea
            className="scn-edit-textarea"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Description of the OPFOR…"
          />
          <div className="scn-edit-actions">
            <MilButton variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </MilButton>
            <MilButton icon="floppy-disk" variant="primary" onClick={saveEdit}>
              Save
            </MilButton>
          </div>
        </>
      ) : (
        <>
          <div className="scn-card__head">
            <div className="scn-card__title">{opfor.title}</div>
            {opfor.meta && <div className="scn-card__meta">{opfor.meta}</div>}
          </div>
          <div className="scn-card__body">{opfor.body}</div>
          {opfor.tags.length > 0 && (
            <div className="scn-card__tags">
              {opfor.tags.map((t) => (
                <MilLabel key={t} intent="green">
                  {t}
                </MilLabel>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
