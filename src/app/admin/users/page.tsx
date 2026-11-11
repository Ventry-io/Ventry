import { checkAdminAuth } from "@/lib/auth/admin";
import { redirect } from "next/navigation";
import RegistrationManager from "@/components/admin/registrations/RegistrationManager";
import { Suspense } from "react";
import PageLoadingState from "@/components/common/PageLoadingState";

type Props = { searchParams: Promise<{ eventId?: string }> };

export default function AdminUsersPage({ searchParams }: Props) {
    return (
        <Suspense fallback={<PageLoadingState />}>
            <AdminUsersPageContent searchParams={searchParams} />
        </Suspense>
    );
}

async function AdminUsersPageContent({ searchParams }: Props) {
    const authResult = await checkAdminAuth();
    
    if (!authResult.authorized) {
        if (authResult.error === "Not authenticated") {
            redirect("/login?callbackUrl=/admin/users");
        }
        return (
            <div style={{ padding: '20px', color: 'red' }}>
                {authResult.error || "Access Denied"}
            </div>
        );
    }

    const { eventId } = await searchParams;
    if (!eventId) redirect("/admin/events");
    return <RegistrationManager key={eventId} eventId={eventId} />;
}
