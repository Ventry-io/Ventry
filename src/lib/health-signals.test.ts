import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHealthSignal, recordHealthSignal } from "./health-signals";

const ok = { success: true, durationMs: 1 };
const down = { success: false, durationMs: 1, code: "P1001" };
const read = () => getHealthSignal("db", 60_000, 10_000);

describe("health signals", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "Date"] });
    vi.stubGlobal("ventryHealthSignals", undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("knows nothing until something is recorded", () => {
    expect(read()).toBeUndefined();
  });

  it("expires successes after their validity window", () => {
    recordHealthSignal("db", ok);
    vi.advanceTimersByTime(59_999);
    expect(read()).toMatchObject({ success: true, checkedAt: expect.any(String) });
    vi.advanceTimersByTime(1);
    expect(read()).toBeUndefined();
  });

  it("lets a newer failure override a fresh success", () => {
    recordHealthSignal("db", ok);
    vi.advanceTimersByTime(1);
    recordHealthSignal("db", down);
    expect(read()).toMatchObject({ success: false, code: "P1001" });
  });

  it("keeps a failure authoritative until its own window ends, even with an older fresh success", () => {
    recordHealthSignal("db", ok);
    vi.advanceTimersByTime(1);
    recordHealthSignal("db", down);
    vi.advanceTimersByTime(10_000);
    expect(read()).toBeUndefined();
  });

  it("ignores a success that started before the failure but finished after it", () => {
    const startedAt = performance.now();
    vi.advanceTimersByTime(5);
    recordHealthSignal("db", down);
    vi.advanceTimersByTime(5);
    recordHealthSignal("db", ok, startedAt);
    expect(read()).toMatchObject({ success: false });
  });

  it("treats a success starting at the same instant as the failure as not proving recovery", () => {
    recordHealthSignal("db", down);
    recordHealthSignal("db", ok);
    expect(read()).toMatchObject({ success: false });
  });

  it("recovers on a success that started after the failure, regardless of completion order", () => {
    vi.advanceTimersByTime(1);
    recordHealthSignal("db", down);
    vi.advanceTimersByTime(1);
    const lateStart = performance.now();
    const earlyStart = lateStart - 10;
    recordHealthSignal("db", ok, lateStart);
    recordHealthSignal("db", ok, earlyStart);
    expect(read()).toMatchObject({ success: true });
  });

  it("keeps dependencies separate", () => {
    recordHealthSignal("db", down);
    expect(getHealthSignal("giphy", 60_000, 10_000)).toBeUndefined();
  });
});
