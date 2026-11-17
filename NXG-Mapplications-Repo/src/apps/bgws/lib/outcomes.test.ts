import { describe, expect, it } from "vitest";
import type { CommandOutcomeRow } from "../types";
import { groupByCommand, isTerminal, parseAcknowledgement, summarise } from "./outcomes";

const row = (stage: string, at: string, detail?: string): CommandOutcomeRow => ({
  command_id: "c1",
  stage,
  observed_at: `2026-06-01T08:00:${at}Z`,
  operation: "MOVE",
  detail,
});

describe("parseAcknowledgement", () => {
  it("reads the bridge's ETR task status text", () => {
    expect(parseAcknowledgement("2026-06-01T08:00:01Z - task status: Accepted")).toBe("accepted");
    expect(parseAcknowledgement("… - task status: Executing")).toBe("executing");
    expect(parseAcknowledgement("… - task status: Completed")).toBe("completed");
    expect(parseAcknowledgement("… - task status: Cancelled")).toBe("cancelled");
    expect(parseAcknowledgement("… - task status: Refused")).toBe("refused");
    expect(parseAcknowledgement("… - task status: Error")).toBe("error");
    expect(parseAcknowledgement("… - task status: unknown")).toBeNull();
  });
  it("reads SMC_Response", () => {
    expect(parseAcknowledgement("… - SMC_Response: accepted")).toBe("accepted");
    expect(parseAcknowledgement("… - SMC_Response: rejected/failed")).toBe("refused");
  });
  it("ignores anything else", () => {
    expect(parseAcknowledgement(null)).toBeNull();
    expect(parseAcknowledgement("hello")).toBeNull();
  });
});

describe("summarise", () => {
  it("is queued with no rows yet", () => {
    expect(summarise("c1", [])).toMatchObject({ state: "queued", trail: ["queued"] });
  });

  it("follows queued → sent → accepted → executing → completed", () => {
    const s = summarise("c1", [
      row("SENT", "01"),
      row("ACKNOWLEDGED", "02", "x - SMC_Response: accepted"),
      row("ACKNOWLEDGED", "02", "x - task status: Accepted"),
      row("ACKNOWLEDGED", "03", "x - task status: Executing"),
      row("ACKNOWLEDGED", "40", "x - task status: Completed"),
    ]);
    expect(s.state).toBe("completed");
    expect(s.trail).toEqual(["queued", "sent", "accepted", "executing", "completed"]);
    expect(isTerminal(s.state)).toBe(true);
  });

  it("does not go backwards when rows arrive out of order", () => {
    const s = summarise("c1", [row("ACKNOWLEDGED", "40", "x - task status: Completed"), row("SENT", "01"), row("ACKNOWLEDGED", "50", "x - task status: Accepted")]);
    expect(s.state).toBe("completed");
  });

  it("reports the streamer's refusal with its detail", () => {
    const s = summarise("c1", [row("REFUSED", "01", '{"error":"entity not found"}')]);
    expect(s).toMatchObject({ state: "refused", detail: '{"error":"entity not found"}' });
  });

  it("reports a superseded order as cancelled", () => {
    const s = summarise("c1", [row("SENT", "01"), row("ACKNOWLEDGED", "02", "x - task status: Executing"), row("ACKNOWLEDGED", "09", "x - task status: Cancelled")]);
    expect(s.state).toBe("cancelled");
  });

  it("ignores DUPLICATE rows", () => {
    expect(summarise("c1", [row("SENT", "01"), row("DUPLICATE", "02")]).state).toBe("sent");
  });
});

describe("groupByCommand", () => {
  it("groups by command_id and skips rows without one", () => {
    const g = groupByCommand([row("SENT", "01"), { ...row("SENT", "02"), command_id: "c2" }, { ...row("SENT", "03"), command_id: "" }]);
    expect([...g.keys()]).toEqual(["c1", "c2"]);
  });
});
