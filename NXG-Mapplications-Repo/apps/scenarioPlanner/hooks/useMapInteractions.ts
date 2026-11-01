// src/map/ScenarioPlanning/hooks/useMapInteractions.ts
// Map interaction state — ported from the widgetSet with full arrow/objective/
// unit-placement support. Used by the unified ScenarioPlanWidget.

import { useCallback, useState } from "react";
import type {
  ArrowDraft,
  DrawingTool,
  MapUnit,
  MovementArrow,
  Objective,
  UnitAffiliation,
} from "../shared/types";

interface UseMapInteractionsProps {
  selectedPhaseId: string | null;
  onUnitsChange: (units: MapUnit[]) => void;
  onArrowsChange: (arrows: MovementArrow[]) => void;
  onObjectivesChange: (objectives: Objective[]) => void;
}

export function useMapInteractions({
  selectedPhaseId,
  onUnitsChange,
  onArrowsChange,
  onObjectivesChange,
}: UseMapInteractionsProps) {
  const [activeTool, setActiveTool] = useState<DrawingTool>("select");
  const [arrowDraft, setArrowDraft] = useState<ArrowDraft | null>(null);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [pendingUnitPosition, setPendingUnitPosition] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [objectiveNamePending, setObjectiveNamePending] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // ── Tool selection ────────────────────────────────────────────────────────
  const selectTool = useCallback((tool: DrawingTool) => {
    setActiveTool(tool);
    setArrowDraft(null);
    setUnitPickerOpen(false);
    setPendingUnitPosition(null);
    setObjectiveNamePending(null);
  }, []);

  // ── Map click handler ─────────────────────────────────────────────────────
  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      switch (activeTool) {
        case "place-unit":
          setPendingUnitPosition({ lat, lng });
          setUnitPickerOpen(true);
          break;

        case "draw-arrow":
          if (!arrowDraft) {
            setArrowDraft({
              fromLat: lat,
              fromLng: lng,
              toLatCursor: lat,
              toLngCursor: lng,
            });
          } else {
            const newArrow: MovementArrow = {
              id: `arrow-${Date.now()}`,
              fromLat: arrowDraft.fromLat,
              fromLng: arrowDraft.fromLng,
              toLat: lat,
              toLng: lng,
              phaseId: selectedPhaseId ?? undefined,
            };
            onArrowsChange([newArrow]);
            setArrowDraft(null);
          }
          break;

        case "place-objective":
          setObjectiveNamePending({ lat, lng });
          break;

        case "select":
          break;
      }
    },
    [activeTool, arrowDraft, selectedPhaseId, onArrowsChange],
  );

  // ── Mouse move — live arrow preview ──────────────────────────────────────
  const handleMapMouseMove = useCallback(
    (lat: number, lng: number) => {
      if (activeTool === "draw-arrow" && arrowDraft) {
        setArrowDraft((d) =>
          d ? { ...d, toLatCursor: lat, toLngCursor: lng } : null,
        );
      }
    },
    [activeTool, arrowDraft],
  );

  // ── Unit picker confirm ───────────────────────────────────────────────────
  const confirmUnitPlacement = useCallback(
    (
      sidc: string,
      identifier: string,
      affiliation: UnitAffiliation,
      echelon: string,
    ) => {
      if (!pendingUnitPosition) return;
      const newUnit: MapUnit = {
        id: `unit-${Date.now()}`,
        unitIdentifier: identifier,
        sidc,
        affiliation,
        latitude: pendingUnitPosition.lat,
        longitude: pendingUnitPosition.lng,
        echelon,
        phaseId: selectedPhaseId ?? undefined,
      };
      onUnitsChange([newUnit]);
      setPendingUnitPosition(null);
      setUnitPickerOpen(false);
    },
    [pendingUnitPosition, selectedPhaseId, onUnitsChange],
  );

  const cancelUnitPlacement = useCallback(() => {
    setPendingUnitPosition(null);
    setUnitPickerOpen(false);
  }, []);

  // ── Objective confirm ─────────────────────────────────────────────────────
  const confirmObjective = useCallback(
    (name: string) => {
      if (!objectiveNamePending) return;
      const newObj: Objective = {
        id: `obj-${Date.now()}`,
        name,
        latitude: objectiveNamePending.lat,
        longitude: objectiveNamePending.lng,
        phaseId: selectedPhaseId ?? undefined,
      };
      onObjectivesChange([newObj]);
      setObjectiveNamePending(null);
    },
    [objectiveNamePending, selectedPhaseId, onObjectivesChange],
  );

  const cancelObjective = useCallback(() => {
    setObjectiveNamePending(null);
  }, []);

  return {
    activeTool,
    selectTool,
    arrowDraft,
    unitPickerOpen,
    objectiveNamePending,
    handleMapClick,
    handleMapMouseMove,
    confirmUnitPlacement,
    cancelUnitPlacement,
    confirmObjective,
    cancelObjective,
  };
}
