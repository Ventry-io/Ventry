import { describe, expect, it } from "vitest";
import { checkPasswordStrength } from "./password-strength";

describe("checkPasswordStrength", () => {
  it.each(["password", "P@ssw0rd", "qwerty123"])("rejects common password %s", (pw) => {
    const r = checkPasswordStrength(pw);
    expect(r.score).toBe(0);
    expect(r.strengthText).toBe("Very Weak");
    expect(r.isStrong).toBe(false);
    expect(r.feedback.warning).toMatch(/commonly used|heavily used/);
  });

  it.each(["correcthorsebatterystaple", "Gx7!pQ2z_Lm9"])("accepts strong password %s", (pw) => {
    const r = checkPasswordStrength(pw);
    expect(r.score).toBe(4);
    expect(r.strengthText).toBe("Strong");
    expect(r.isStrong).toBe(true);
    expect(r.feedback).toEqual({ warning: null, suggestions: [] });
  });

  it("penalizes passwords built from user inputs", () => {
    const pw = "maxmustermann1990";
    expect(checkPasswordStrength(pw).isStrong).toBe(true);
    const r = checkPasswordStrength(pw, ["Max", "Mustermann", "max@example.com"]);
    expect(r.score).toBeLessThan(2);
    expect(r.isStrong).toBe(false);
    expect(r.feedback.warning).toBeTruthy();
  });

  it("applies minStrength as an inclusive threshold", () => {
    expect(checkPasswordStrength("Summer2024!").score).toBe(2);
    expect(checkPasswordStrength("Summer2024!", [], 2).isStrong).toBe(true);
    expect(checkPasswordStrength("Summer2024!", [], 3).isStrong).toBe(false);
  });

  it("handles empty input", () => {
    const r = checkPasswordStrength("");
    expect(r.score).toBe(0);
    expect(r.isStrong).toBe(false);
    expect(Array.isArray(r.feedback.suggestions)).toBe(true);
  });

  it("stays fast on very long input (ReDoS regression)", () => {
    const start = performance.now();
    checkPasswordStrength("a".repeat(50_000));
    checkPasswordStrength("1a!".repeat(20_000));
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
