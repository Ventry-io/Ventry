import * as mws from "./middlewares/";
import { type NextRequest, NextResponse } from "next/server";

type SubMW = (req: NextRequest, res: NextResponse) => Promise<undefined | NextResponse> | undefined | NextResponse;

const routes: Array<{ pattern: URLPattern, mw: SubMW }> = [
    // Removed auth middleware for /api/user routes since they use NextAuth internally
    { pattern: new URLPattern({ pathname: "/api/admin/:path*" }), mw: mws.admin.middleware },
    { pattern: new URLPattern({ pathname: "/admin" }), mw: mws.admin.middleware },
    { pattern: new URLPattern({ pathname: "/admin/:path*" }), mw: mws.admin.middleware },
];

export async function proxy(req: NextRequest) {
    const res = NextResponse.next();
    const pathname = req.nextUrl.pathname;

    // Require private booking details before entering event registration.
    const profileCheck = await mws.profileCompletion.middleware(req);
    if (profileCheck && profileCheck.status !== 200) return profileCheck;

    // Apply specific route middlewares
    for(const { pattern, mw } of routes) {
        if(pattern.test(req.nextUrl)) {
            const out = await mw(req, res);

            if(out && out !== res && out.status !== 200) return out;

            if(out && out !== res && out.status === 200) {
                out.headers.forEach((v, k) => void res.headers.set(k, v));
            }
        }
    }

    // Apply logging to API routes except auth routes
    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) {
        const out = mws.logging.loggingMiddleware(req);
        if(out && out !== res && out.status !== 200) return out;
        if(out && out !== res && out.status === 200) {
            out.headers.forEach((v, k) => void res.headers.set(k, v));
        }
    }

    // Success
    return res;

}

export const config = {
    matcher: [
        "/api/admin/:path*",
        "/admin",
        "/admin/:path*",
        // Match all API routes (we filter out auth and user routes in the middleware function)
        "/api/:path*",
        // Match all page routes (excluding static assets and files) so the
        // booking details gate can preserve the intended registration URL.
        "/((?!api|_next/static|_next/image|.*\\..*).*)",
    ]
}


