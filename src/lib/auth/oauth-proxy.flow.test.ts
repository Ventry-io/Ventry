// End-to-end OAuth proxy flow between a callback host and a preview, each with its own in-memory database.
// Only the provider (GitHub) is mocked; everything else is the real Better Auth plugin with our configuration.
import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getOAuthProxyConfig, isBlockedOAuthProxyPath, oauthProxyPlugins } from "./oauth-proxy";

const HOST = "https://dev.example.org";
const PREVIEW = "https://pr-7.dev.example.org";
const PROXY_SECRET = "s".repeat(40);

function instance(url: string, env: Record<string, string>) {
    const db: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] };
    const config = getOAuthProxyConfig({ BETTER_AUTH_URL: url, ...env } as NodeJS.ProcessEnv);
    const auth = betterAuth({
        baseURL: url,
        secret: `${url}-own-better-auth-secret-0123456789`,
        database: memoryAdapter(db),
        plugins: oauthProxyPlugins(config),
        hooks: {
            before: createAuthMiddleware(async (ctx) => {
                if (isBlockedOAuthProxyPath(config, ctx.path)) throw new APIError("NOT_FOUND");
            }),
        },
        socialProviders: {
            // Previews only know the client ID; the host holds the secret and exchanges the code.
            github: { clientId: "staging-client", clientSecret: env.GITHUB_CLIENT_SECRET ?? "" },
        },
    });
    return { auth, db };
}

function mockGitHub() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith("https://github.com/login/oauth/access_token")) {
            return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "read:user,user:email" });
        }
        if (url === "https://api.github.com/user") {
            return Response.json({ id: 4242, login: "octo", name: "Octo Cat", email: "octo@example.org", avatar_url: "" });
        }
        if (url === "https://api.github.com/user/emails") {
            return Response.json([{ email: "octo@example.org", primary: true, verified: true }]);
        }
        throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
}

async function startSignIn(preview: ReturnType<typeof instance>) {
    const response = await preview.auth.handler(new Request(`${PREVIEW}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: PREVIEW },
        body: JSON.stringify({ provider: "github", callbackURL: "/dashboard" }),
    }));
    expect(response.status).toBe(200);
    return new URL((await response.json()).url as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("OAuth proxy flow", () => {
    const host = () => instance(HOST, { OAUTH_PROXY_SECRET: PROXY_SECRET, GITHUB_CLIENT_SECRET: "staging-secret" });
    const preview = (secret = PROXY_SECRET) => instance(PREVIEW, { OAUTH_PROXY_SECRET: secret, OAUTH_PROXY_PRODUCTION_URL: HOST });

    it("signs the user in on the preview, storing user and session only in the preview database", async () => {
        const callbackHost = host();
        const pr = preview();
        mockGitHub();

        const authorize = await startSignIn(pr);
        expect(authorize.origin).toBe("https://github.com");
        // The provider only ever sees the registered callback host.
        expect(authorize.searchParams.get("redirect_uri")).toBe(`${HOST}/api/auth/callback/github`);

        const hostResponse = await callbackHost.auth.handler(new Request(
            `${HOST}/api/auth/callback/github?code=abc&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`,
        ));
        expect(hostResponse.status).toBe(302);
        const completion = new URL(hostResponse.headers.get("location") ?? "");
        expect(completion.origin).toBe(PREVIEW);
        expect(completion.pathname).toBe("/api/auth/callback/github/oauth-proxy");
        expect(callbackHost.db.user).toHaveLength(0);
        expect(callbackHost.db.session).toHaveLength(0);

        const previewResponse = await pr.auth.handler(new Request(completion));
        expect(previewResponse.status).toBe(302);
        expect(previewResponse.headers.get("location")).toBe("/dashboard");
        expect(previewResponse.headers.get("set-cookie")).toMatch(/session_token=/);
        expect(pr.db.user).toMatchObject([{ email: "octo@example.org" }]);
        expect(pr.db.session).toHaveLength(1);

        // The forwarded profile is single-use: its OAuth state is consumed.
        const replay = await pr.auth.handler(new Request(completion));
        expect(replay.headers.get("location")).toMatch(/error=state_mismatch/);
        expect(pr.db.session).toHaveLength(1);
    });

    it("refuses proxied profiles on the callback host, even when correctly encrypted", async () => {
        const callbackHost = host();
        mockGitHub();
        const authorize = await startSignIn(preview());
        const hostResponse = await callbackHost.auth.handler(new Request(
            `${HOST}/api/auth/callback/github?code=abc&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`,
        ));
        const forged = new URL(hostResponse.headers.get("location") ?? "");
        const response = await callbackHost.auth.handler(new Request(`${HOST}${forged.pathname}${forged.search}`));
        expect(response.status).toBe(404);
        const legacy = await callbackHost.auth.handler(new Request(`${HOST}/api/auth/oauth-proxy-callback${forged.search}`));
        expect(legacy.status).toBe(404);
        expect(callbackHost.db.session).toHaveLength(0);
    });

    it("rejects a preview that does not share the proxy secret", async () => {
        const callbackHost = host();
        mockGitHub();
        const authorize = await startSignIn(preview("x".repeat(40)));
        const hostResponse = await callbackHost.auth.handler(new Request(
            `${HOST}/api/auth/callback/github?code=abc&state=${encodeURIComponent(authorize.searchParams.get("state") ?? "")}`,
        ));
        // The host cannot decrypt the state, so it falls back to a normal callback that fails without forwarding anything.
        expect(hostResponse.headers.get("location") ?? "").not.toContain(PREVIEW);
        expect(callbackHost.db.session).toHaveLength(0);
    });
});
