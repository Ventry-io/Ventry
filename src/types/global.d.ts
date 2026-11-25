declare namespace NodeJS {
    interface ProcessEnv {
        JWT_PRIVATE_KEY: string;
        JWT_PUBLIC_KEY: string;
        JWT_AUDIENCE: string;
        JWT_ISSUER: string;

        BETTER_AUTH_URL: string;
        BETTER_AUTH_TRUSTED_ORIGINS?: string;
        NEXTAUTH_URL?: string;
        BETTER_AUTH_SECRET: string;
        OAUTH_PROXY_SECRET?: string;
        OAUTH_PROXY_PRODUCTION_URL?: string;


        GOOGLE_CLIENT_ID: string;
        GOOGLE_CLIENT_SECRET: string;

        GITHUB_CLIENT_ID: string;
        GITHUB_CLIENT_SECRET: string;

        SUPABASE_API_KEY: string;
        SUPABASE_PUBLISHABLE_KEY: string;
        SUPABASE_URL: string;
        SUPABASE_BUCKET_ID: string;
        SUPABASE_BANNERS_BUCKET_ID?: string;

        SMTP_FROM?: string;

        GIPHY_API_KEY?: string;
    }
}
