import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppHeader from "./AppHeader";

vi.mock("@/lib/auth/client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/common/NotificationBell/NotificationBell", () => ({ default: () => null }));

const fetchMock = vi.fn<typeof fetch>();
const warning = "We might experience some issues right now.";

describe("AppHeader health warning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset().mockResolvedValue(Response.json({ status: "ok", cacheTtlMs: 60_000 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps navigation usable while health checks are pending", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: "Ventry" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the warning when healthy", async () => {
    await act(async () => { render(<AppHeader />); });
    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      cache: "no-store", signal: expect.any(AbortSignal),
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a warning when any health check fails", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "error" }, { status: 500 }));
    await act(async () => { render(<AppHeader />); });
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
  });

  it("shows a warning when a response reports an unhealthy status", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "error" }));
    await act(async () => { render(<AppHeader />); });
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
  });

  it("shows a warning when the health endpoint is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { render(<AppHeader />); });
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
  });

  it("shows a warning for an invalid health response", async () => {
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 502 }));
    await act(async () => { render(<AppHeader />); });
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
  });

  it("removes the warning after recovery on the next poll", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "error", cacheTtlMs: 3_000 }, { status: 500 }));
    await act(async () => { render(<AppHeader />); });
    expect(screen.getByRole("alert")).toHaveTextContent(warning);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the server interval when subsequent requests fail", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "ok", cacheTtlMs: 3_000 }));
    await act(async () => { render(<AppHeader />); });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, 0, -1, "3000", 1.5])("uses a safe fallback for an invalid server interval: %s", async (cacheTtlMs) => {
    fetchMock.mockResolvedValue(Response.json({ status: "ok", cacheTtlMs }));
    await act(async () => { render(<AppHeader />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts pending checks and stops polling on unmount", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<AppHeader />);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
