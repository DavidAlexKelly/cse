import React, { useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import type { TrainingAudienceRecord } from "../trainingAudienceData.js";

interface Props {
  audience: TrainingAudienceRecord;
  onChange: (next: TrainingAudienceRecord) => void;
  onDelete?: () => void;
  /** When true, the card is rendered with the "primary" visual accent. */
  primaryStyle?: boolean;
}

export const AudienceCard: React.FC<Props> = ({
  audience,
  onChange,
  onDelete,
  primaryStyle = false,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(audience.name);
  const [draftDesc, setDraftDesc] = useState(audience.description);
  const [draftCount, setDraftCount] = useState<string>(
    String(audience.participantCount),
  );
  const [draftDirectorates, setDraftDirectorates] = useState<string>(
    audience.directorates.join(", "),
  );

  const startEdit = () => {
    setDraftName(audience.name);
    setDraftDesc(audience.description);
    setDraftCount(String(audience.participantCount));
    setDraftDirectorates(audience.directorates.join(", "));
    setEditing(true);
  };

  const save = () => {
    const parsedCount = Number(draftCount.replace(/[^0-9]/g, ""));
    onChange({
      ...audience,
      name: draftName.trim() || audience.name,
      description: draftDesc.trim() || audience.description,
      participantCount: Number.isFinite(parsedCount)
        ? parsedCount
        : audience.participantCount,
      directorates: draftDirectorates
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
    });
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  const typeBadge =
    audience.audienceType === "primary" ? (
      <MilLabel intent="blue">Primary</MilLabel>
    ) : (
      <MilLabel intent="grey">Secondary</MilLabel>
    );

  return (
    <div className={`scn-card ${primaryStyle ? "scn-card--primary" : ""}`}>
      <div className="scn-card__head">
        {editing ? (
          <input
            className="scn-edit-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Audience name"
            style={{ marginBottom: 0 }}
          />
        ) : (
          <div className="scn-card__title">{audience.name}</div>
        )}
        {!editing && (
          <div
            className="scn-card__meta"
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <span>
              {audience.audienceType === "primary" ? "Primary" : "Secondary"}
            </span>
            <span style={{ color: "#454c68" }}>·</span>
            <span>~{audience.participantCount} participants</span>
          </div>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="scn-edit-textarea"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            placeholder="Description of who this audience trains…"
            style={{ minHeight: 80 }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: 8,
              marginTop: 8,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#6a7292",
                  marginBottom: 4,
                }}
              >
                Participants
              </div>
              <input
                className="scn-edit-input"
                value={draftCount}
                onChange={(e) => setDraftCount(e.target.value)}
                placeholder="e.g. 420"
                style={{ fontSize: 13, fontWeight: 400, marginBottom: 0 }}
              />
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#6a7292",
                  marginBottom: 4,
                }}
              >
                Directorates (comma-separated)
              </div>
              <input
                className="scn-edit-input"
                value={draftDirectorates}
                onChange={(e) => setDraftDirectorates(e.target.value)}
                placeholder="e.g. J1, J2, J3"
                style={{ fontSize: 13, fontWeight: 400, marginBottom: 0 }}
              />
            </div>
          </div>
          <div className="scn-edit-actions">
            <MilButton variant="ghost" onClick={cancel}>
              Cancel
            </MilButton>
            <MilButton icon="floppy-disk" variant="primary" onClick={save}>
              Save
            </MilButton>
          </div>
        </>
      ) : (
        <>
          <div className="scn-card__body">{audience.description}</div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div className="scn-card__tags">
              {typeBadge}
              <MilLabel intent="green">
                ~{audience.participantCount} participants
              </MilLabel>
              {audience.directorates.length > 0 && (
                <MilLabel intent="grey">
                  {audience.directorates.join(" · ")}
                </MilLabel>
              )}
            </div>

            <div
              style={{ display: "flex", gap: 6, alignItems: "center" }}
            >
              <MilButton icon="edit" variant="ghost" onClick={startEdit}>
                Edit
              </MilButton>
              {onDelete && (
                <MilButton
                  icon="trash"
                  variant="danger"
                  iconOnly
                  title="Remove this audience"
                  onClick={onDelete}
                >
                  Delete
                </MilButton>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
