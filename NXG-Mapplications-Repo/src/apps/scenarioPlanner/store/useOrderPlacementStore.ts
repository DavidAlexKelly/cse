import { create } from 'zustand';
import type { OSRMRoute, IsochroneResult, MobilityClass } from '@/shared/routing/types';
import type { PlacedUnit } from '../map/types';
import { getMotionType } from '../lib/orderClassification';
import { getMobilityClass } from '../lib/unitMobility';

/* ------------------------------------------------------------------ */
/*  Local types – kept lean, not imported from tacticOrders            */
/* ------------------------------------------------------------------ */

interface OrderInfo {
  key: string;
  label: string;
  sidc?: string;
  category: string;
}

/* ------------------------------------------------------------------ */
/*  State-machine steps                                                */
/* ------------------------------------------------------------------ */

type PlacementStep =
  | 'idle'               // nothing selected
  | 'selectingOrder'     // unit selected, order picker visible
  | 'computingIsochrone' // loading spinner while worker computes
  | 'reachabilityShown'  // envelope visible, waiting for destination click
  | 'confirming';        // route confirmed, generating graphic

/* ------------------------------------------------------------------ */
/*  Store interface                                                    */
/* ------------------------------------------------------------------ */

interface OrderPlacementState {
  // State
  step: PlacementStep;
  selectedUnit: PlacedUnit | null;
  selectedOrder: OrderInfo | null;
  mobilityClass: MobilityClass | null;
  timeBudgetSec: number;
  isochrone: IsochroneResult | null;
  previewRoute: OSRMRoute | null;
  previewDestination: [number, number] | null;
  confirmedRoute: OSRMRoute | null;
  confirmedDestination: [number, number] | null;
  unitScreenPosition: { x: number; y: number } | null;
  tooltipPosition: { x: number; y: number } | null;
  tooltipText: string | null;
  isComputingRoute: boolean;

  // Actions
  selectUnit: (unit: PlacedUnit, screenPos: { x: number; y: number }) => void;
  selectOrder: (order: OrderInfo) => void;
  setIsochrone: (result: IsochroneResult) => void;
  setPreviewRoute: (route: OSRMRoute | null, dest: [number, number] | null) => void;
  confirmDestination: (dest: [number, number], route: OSRMRoute) => void;
  cancel: () => void;
  reset: () => void;
  setTooltip: (pos: { x: number; y: number } | null, text: string | null) => void;
  setComputingRoute: (computing: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Initial / reset values                                             */
/* ------------------------------------------------------------------ */

const INITIAL_STATE = {
  step: 'idle' as PlacementStep,
  selectedUnit: null as PlacedUnit | null,
  selectedOrder: null as OrderInfo | null,
  mobilityClass: null as MobilityClass | null,
  timeBudgetSec: 3600,
  isochrone: null as IsochroneResult | null,
  previewRoute: null as OSRMRoute | null,
  previewDestination: null as [number, number] | null,
  confirmedRoute: null as OSRMRoute | null,
  confirmedDestination: null as [number, number] | null,
  unitScreenPosition: null as { x: number; y: number } | null,
  tooltipPosition: null as { x: number; y: number } | null,
  tooltipText: null as string | null,
  isComputingRoute: false,
};

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useOrderPlacementStore = create<OrderPlacementState>((set, get) => ({
  ...INITIAL_STATE,

  /* -- selectUnit -------------------------------------------------- */
  selectUnit: (unit, screenPos) =>
    set({
      step: 'selectingOrder',
      selectedUnit: unit,
      unitScreenPosition: screenPos,
      selectedOrder: null,
      mobilityClass: null,
      isochrone: null,
      previewRoute: null,
      previewDestination: null,
      confirmedRoute: null,
      confirmedDestination: null,
    }),

  /* -- selectOrder ------------------------------------------------- */
  selectOrder: (order) => {
    const motionType = getMotionType(order.key);

    // Static / area orders: transition to 'confirming' immediately with a
    // zero-length route so ScenarioMap's confirming useEffect fires and
    // creates the PlacedArrow at the unit's current position.
    if (motionType === 'static' || motionType === 'area') {
      const unit = get().selectedUnit;
      if (!unit) { set({ selectedOrder: order }); return; }
      set({
        selectedOrder: order,
        step: 'confirming',
        confirmedDestination: [unit.lat, unit.lng],
        // Synthesise a minimal zero-distance route so the confirming handler
        // doesn't bail out on a null check.
        confirmedRoute: {
          waypoints: [[unit.lat, unit.lng], [unit.lat, unit.lng]],
          distanceKm: 0,
          durationSec: 0,
        } as import('@/shared/routing/types').OSRMRoute,
        mobilityClass: unit ? getMobilityClass(unit) : null,
      });
      return;
    }

    // Movement order – transition to computing the isochrone envelope.
    const unit = get().selectedUnit;
    const mobility = unit ? getMobilityClass(unit) : null;

    set({
      step: 'computingIsochrone',
      selectedOrder: order,
      mobilityClass: mobility,
    });
  },

  /* -- setIsochrone ------------------------------------------------ */
  setIsochrone: (result) =>
    set({
      step: 'reachabilityShown',
      isochrone: result,
    }),

  /* -- setPreviewRoute --------------------------------------------- */
  setPreviewRoute: (route, dest) =>
    set({
      previewRoute: route,
      previewDestination: dest,
      isComputingRoute: false,
    }),

  /* -- confirmDestination ------------------------------------------ */
  confirmDestination: (dest, route) =>
    set({
      step: 'confirming',
      confirmedDestination: dest,
      confirmedRoute: route,
    }),

  /* -- cancel ------------------------------------------------------ */
  cancel: () => {
    const { step } = get();

    if (step === 'reachabilityShown' || step === 'computingIsochrone') {
      // Go back to order selection – keep the unit selected.
      set({
        step: 'selectingOrder',
        selectedOrder: null,
        mobilityClass: null,
        isochrone: null,
        previewRoute: null,
        previewDestination: null,
        confirmedRoute: null,
        confirmedDestination: null,
      });
    } else {
      // Full reset for any other step.
      set(INITIAL_STATE);
    }
  },

  /* -- reset ------------------------------------------------------- */
  reset: () => set(INITIAL_STATE),

  /* -- setTooltip -------------------------------------------------- */
  setTooltip: (pos, text) =>
    set({
      tooltipPosition: pos,
      tooltipText: text,
    }),

  /* -- setComputingRoute ------------------------------------------- */
  setComputingRoute: (computing) =>
    set({ isComputingRoute: computing }),
}));

/* ------------------------------------------------------------------ */
/*  Convenience selector                                               */
/* ------------------------------------------------------------------ */

export const useIsEnvelopeActive = () =>
  useOrderPlacementStore(
    (s) => s.step === 'reachabilityShown' || s.step === 'computingIsochrone',
  );
