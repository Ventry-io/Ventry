import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { hasCheckInIdentity, hasBillingAddress } from "@/lib/user/profile-completion";

// Collect booking details before ticket selection; browsing remains accessible.
const middleware = async (req: NextRequest) => {
    const { pathname, search } = req.nextUrl;
    if (!/^\/events\/[^/]+\/register\/?$/.test(pathname)) return NextResponse.next();

    const sessionToken =
        req.cookies.get("VENTRY.session_token")?.value ||
        req.cookies.get("__Secure-VENTRY.session_token")?.value;
    if (!sessionToken) return NextResponse.next();

    const session = await getSession(req.headers);
    if (!session?.user) return NextResponse.next();
    // Address fields use returned:false in Better Auth and are absent from sessions.
    const identity = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { legalName: true, addressLine1: true, addressCity: true, addressPostalCode: true, addressCountry: true },
    });
    if (identity && hasCheckInIdentity(identity) && hasBillingAddress(identity)) return NextResponse.next();

    const url = new URL("/complete-profile", req.url);
    url.searchParams.set("intent", "billing");
    url.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(url);
};

export { middleware };
