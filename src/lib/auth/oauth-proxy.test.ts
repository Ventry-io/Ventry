import { describe, expect, it } from "vitest";
import { getOAuthProxyConfig, isBlockedOAuthProxyPath, oauthProxyPlugins } from "./oauth-proxy";

const secret = "p".repeat(32);
const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

describe("OAuth proxy config", () => {
    it("is disabled without OAUTH_PROXY_SECRET, so production loads no plugin", () => {
        const config = getOAuthProxyConfig(env({ BETTER_AUTH_URL: "https://venuva.dog" }));
        expect(config).toBeNull();
        expect(oauthProxyPlugins(config)).toEqual([]);
    });

    it("rejects weak or reused secrets", () => {
        expect(() => getOAuthProxyConfig(env({ OAUTH_PROXY_SECRET: "short", BETTER_AUTH_URL: "https://dev.venuva.dog" }))).toThrow(/32/);
        expect(() => getOAuthProxyConfig(env({
            OAUTH_PROXY_SECRET: secret, BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: "https://dev.venuva.dog",
        }))).toThrow(/differ/);
    });

    it("requires https origins", () => {
        expect(() => getOAuthProxyConfig(env({ OAUTH_PROXY_SECRET: secret, BETTER_AUTH_URL: "http://pr-1.dev.venuva.dog" }))).toThrow(/https/);
        expect(() => getOAuthProxyConfig(env({
            OAUTH_PROXY_SECRET: secret, BETTER_AUTH_URL: "https://pr-1.dev.venuva.dog", OAUTH_PROXY_PRODUCTION_URL: "not a url",
        }))).toThrow(/https/);
    });

    it("treats an instance without a separate production URL as the callback host", () => {
        const config = getOAuthProxyConfig(env({ OAUTH_PROXY_SECRET: secret, BETTER_AUTH_URL: "https://dev.venuva.dog/" }));
        expect(config).toEqual({ secret, productionURL: "https://dev.venuva.dog", isCallbackHost: true });
        expect(oauthProxyPlugins(config)).toHaveLength(1);
    });

    it("points previews at the callback host", () => {
        const config = getOAuthProxyConfig(env({
            OAUTH_PROXY_SECRET: secret,
            BETTER_AUTH_URL: "https://pr-12.dev.venuva.dog",
            OAUTH_PROXY_PRODUCTION_URL: "https://dev.venuva.dog/",
        }));
        expect(config).toEqual({ secret, productionURL: "https://dev.venuva.dog", isCallbackHost: false });
    });
});

describe("OAuth proxy completion guard", () => {
    const host = { secret, productionURL: "https://dev.venuva.dog", isCallbackHost: true };
    const preview = { ...host, isCallbackHost: false };

    it("blocks proxied profile completion on the callback host only", () => {
        expect(isBlockedOAuthProxyPath(host, "/callback/:id/oauth-proxy")).toBe(true);
        expect(isBlockedOAuthProxyPath(host, "/oauth-proxy-callback")).toBe(true);
        expect(isBlockedOAuthProxyPath(preview, "/callback/:id/oauth-proxy")).toBe(false);
        expect(isBlockedOAuthProxyPath(null, "/callback/:id/oauth-proxy")).toBe(false);
    });

    it("never blocks the normal provider callback", () => {
        expect(isBlockedOAuthProxyPath(host, "/callback/:id")).toBe(false);
        expect(isBlockedOAuthProxyPath(host, undefined)).toBe(false);
    });
});
