import { Icon } from "@blueprintjs/core";
import React, { useRef, useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import type { ScenarioState } from "../scenarioData.js";

interface Props {
  context: ScenarioState["strategicContext"];
  onChange: (next: ScenarioState["strategicContext"]) => void;
}

interface AttachedFile {
  id: string;
  name: string;
}

export const StrategicContextCard: React.FC<Props> = ({ context, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(context.title);
  const [draftBody, setDraftBody] = useState(context.body);

  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [direction, setDirection] = useState("");
  const [showRegenerate, setShowRegenerate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const startEdit = () => {
    setDraftTitle(context.title);
    setDraftBody(context.body);
    setEditing(true);
  };

  const saveEdit = () => {
    onChange({
      ...context,
      title: draftTitle.trim() || context.title,
      body: draftBody.trim() || context.body,
      generated: false, // user-edited
      lastEdited: nowHHmm(),
    });
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

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
    // No real AI call — simulate a regenerate that just marks edited.
    onChange({
      ...context,
      generated: true,
      generatedFrom:
        files.length > 0
          ? `${files.length} attached document${files.length > 1 ? "s" : ""}`
          : direction.trim()
            ? "guidance note"
            : context.generatedFrom,
      lastEdited: nowHHmm(),
    });
    setFiles([]);
    setDirection("");
    setShowRegenerate(false);
  };

  return (
    <div className="scn-card">
      <div className="scn-section__head" style={{ marginBottom: 8 }}>
        <div className="scn-section__title">
          <Icon icon="globe-network" size={11} />
          Strategic context
          {context.generated && <span className="scn-tagline">Generated</span>}
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
          </div>
        )}
      </div>

      {/* Regenerate panel */}
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
            placeholder="Direction for the rewrite — e.g. 'shift emphasis to cyber operations'"
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

      {/* Edit mode */}
      {editing ? (
        <>
          <input
            className="scn-edit-input"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Scenario title"
          />
          <textarea
            className="scn-edit-textarea"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Strategic context narrative…"
          />
          <div className="scn-edit-actions">
            <MilButton variant="ghost" onClick={cancelEdit}>
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
            <div className="scn-card__title">{context.title}</div>
            <div className="scn-card__meta">
              {context.generatedFrom
                ? `From ${context.generatedFrom}`
                : "Manual entry"}
              {context.lastEdited && (
                <>
                  <span style={{ margin: "0 6px", color: "#454c68" }}>·</span>
                  Edited {context.lastEdited}
                </>
              )}
            </div>
          </div>

          <div className="scn-card__body">{context.body}</div>

          {context.tags.length > 0 && (
            <div className="scn-card__tags">
              {context.tags.map((t) => (
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

function nowHHmm(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
