import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PasswordStrengthMeter from "@/components/auth/PasswordStrengthMeter";

describe("PasswordStrengthMeter", () => {
  it("renders nothing and clears the warning for an empty password", async () => {
    const setWarning = vi.fn();
    const { container } = render(<PasswordStrengthMeter password="" setWarning={setWarning} />);
    await waitFor(() => expect(setWarning).toHaveBeenLastCalledWith(null));
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks submit while the estimator loads, then warns on a weak password", async () => {
    const setWarning = vi.fn();
    render(<PasswordStrengthMeter password="password" setWarning={setWarning} />);
    expect(setWarning).toHaveBeenNthCalledWith(1, { message: null, suggestions: [] });
    expect(await screen.findByText("Very Weak")).toBeInTheDocument();
    expect(setWarning).toHaveBeenLastCalledWith({
      message: "This is a heavily used password.",
      suggestions: ["Add more words that are less common."],
    });
  });

  it("keeps the warning for a Fair (score 2) password", async () => {
    const setWarning = vi.fn();
    render(<PasswordStrengthMeter password="Summer2024!" setWarning={setWarning} />);
    expect(await screen.findByText("Fair")).toBeInTheDocument();
    expect(setWarning).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Choose a longer, less predictable password." }),
    );
  });

  it("clears the warning for a strong password", async () => {
    const setWarning = vi.fn();
    render(<PasswordStrengthMeter password="correcthorsebatterystaple" setWarning={setWarning} />);
    expect(await screen.findByText("Strong")).toBeInTheDocument();
    expect(setWarning).toHaveBeenLastCalledWith(null);
  });
});
