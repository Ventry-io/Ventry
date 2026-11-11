export async function verifyTurnstile(headers?: Headers | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!secret && !siteKey) return true;
  const token = headers?.get("x-captcha-response");
  if (!secret || !siteKey || !token || token.length > 2048) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { success?: boolean; action?: string; hostname?: string };
    const hostnames = process.env.TURNSTILE_HOSTNAMES?.split(",").map(host => host.trim()).filter(Boolean);
    return response.ok && result.success === true && result.action === "authenticate" &&
      (!hostnames?.length || !!result.hostname && hostnames.includes(result.hostname));
  } catch {
    return false;
  }
}
