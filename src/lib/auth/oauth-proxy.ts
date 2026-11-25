import { oAuthProxy } from "better-auth/plugins";

// Endpoints that turn an encrypted, proxied OAuth profile into a local session.
const COMPLETION_PATHS = new Set(["/callback/:id/oauth-proxy", "/oauth-proxy-callback"]);

export type OAuthProxyConfig = {
    secret: string;
    /** Origin of the stable callback host that is registered with Google and GitHub. */
    productionURL: string;
    /** This instance is the callback host itself, not a preview. */
    isCallbackHost: boolean;
};

function httpsOrigin(value: string | undefined) {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.origin : null;
    } catch {
        return null;
    }
}

/**
 * Better Auth OAuth Proxy, used only by the staging callback host and approved PR previews.
 * Disabled (null) unless OAUTH_PROXY_SECRET is set, so production never loads it.
 * Misconfiguration throws at startup instead of silently weakening authentication.
 */
export function getOAuthProxyConfig(env: NodeJS.ProcessEnv = process.env): OAuthProxyConfig | null {
    const secret = env.OAUTH_PROXY_SECRET;
    if (!secret) return null;
    if (secret.length < 32) throw new Error("OAUTH_PROXY_SECRET must be at least 32 characters");
    if (secret === env.BETTER_AUTH_SECRET) throw new Error("OAUTH_PROXY_SECRET must differ from BETTER_AUTH_SECRET");

    const ownOrigin = httpsOrigin(env.BETTER_AUTH_URL || env.NEXTAUTH_URL);
    const productionURL = env.OAUTH_PROXY_PRODUCTION_URL ? httpsOrigin(env.OAUTH_PROXY_PRODUCTION_URL) : ownOrigin;
    if (!ownOrigin || !productionURL) {
        throw new Error("OAuth proxy needs https BETTER_AUTH_URL and OAUTH_PROXY_PRODUCTION_URL values");
    }
    return { secret, productionURL, isCallbackHost: productionURL === ownOrigin };
}

export function oauthProxyPlugins(config: OAuthProxyConfig | null) {
    return config ? [oAuthProxy({ productionURL: config.productionURL, secret: config.secret })] : [];
}

/**
 * The callback host never starts proxied sign-ins, so it never legitimately receives a proxied profile.
 * Rejecting completions there stops any other holder of the shared secret from asserting identities on it.
 */
export function isBlockedOAuthProxyPath(config: OAuthProxyConfig | null, path: string | undefined) {
    return !!config?.isCallbackHost && !!path && COMPLETION_PATHS.has(path);
}
