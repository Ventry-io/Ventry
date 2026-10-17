import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth } from "@/lib/auth/admin";
import { crewUpdateSchema } from "@/types/schemas/crew";

async function access(req: NextRequest, organizationId: string) {
  const auth = await checkAdminAuth(req.headers);
  if (!auth.authorized || !auth.adminId) return null;
  return prisma.adminOrganizationMembership.findUnique({
    where: { adminId_organizationId: { adminId: auth.adminId, organizationId } },
    select: { accessLevel: true, adminId: true, organization: { select: { ownerId: true } } },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await access(req, id);
  if (!member) return NextResponse.json({ error: "No access to this crew" }, { status: 403 });
  const organization = await prisma.adminOrganization.findUniqueOrThrow({
    where: { id },
    select: { departments: { orderBy: { name: "asc" } }, crewResources: true, updatedAt: true },
  });
  return NextResponse.json({
    ...organization,
    canWrite: member.accessLevel === "WRITE" || member.adminId === member.organization.ownerId,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await access(req, id);
  const owner = !!member && member.adminId === member.organization.ownerId;
  if (!member || (!owner && member.accessLevel !== "WRITE"))
    return NextResponse.json({ error: "Read-only crew access" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = crewUpdateSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Check the department name, planning text or link", issues: parsed.error.issues },
      { status: 400 },
    );
  const data = parsed.data;
  try {
    if (data.action === "resources") {
      const updated = await prisma.adminOrganization.updateMany({
        where: { id, updatedAt: new Date(data.updatedAt) },
        data: { crewResources: data.resources },
      });
      if (!updated.count)
        return NextResponse.json(
          {
            error:
              "Shared links changed since you opened this page. Review the latest links, then save again.",
          },
          { status: 409 },
        );
    } else if (data.action === "deleteDepartment") {
      if (!owner)
        return NextResponse.json(
          { error: "Only the owner can delete departments" },
          { status: 403 },
        );
      const deleted = await prisma.crewDepartment.deleteMany({
        where: { id: data.id, organizationId: id },
      });
      if (!deleted.count)
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
    } else if (data.id) {
      const department = await prisma.crewDepartment.findFirst({
        where: { id: data.id, organizationId: id },
      });
      if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
      if (!owner && department.name !== data.name)
        return NextResponse.json(
          { error: "Only the owner can rename departments" },
          { status: 403 },
        );
      await prisma.crewDepartment.update({
        where: { id: department.id },
        data: { name: data.name, planning: data.planning },
      });
    } else {
      if (!owner)
        return NextResponse.json({ error: "Only the owner can add departments" }, { status: 403 });
      await prisma.crewDepartment.create({
        data: { organizationId: id, name: data.name, planning: data.planning },
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json(
        { error: "A department with this name already exists" },
        { status: 409 },
      );
    console.error("Crew update failed:", error);
    return NextResponse.json(
      { error: "Could not save crew changes. Please retry." },
      { status: 500 },
    );
  }
}
