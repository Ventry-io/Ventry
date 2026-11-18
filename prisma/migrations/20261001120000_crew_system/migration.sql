CREATE TYPE "CrewAccessLevel" AS ENUM ('READ', 'WRITE');
ALTER TABLE "AdminOrganization" ADD COLUMN "crewResources" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "CrewDepartment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "planning" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "CrewDepartment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrewDepartment_organizationId_name_key" ON "CrewDepartment"("organizationId", "name");
ALTER TABLE "CrewDepartment" ADD CONSTRAINT "CrewDepartment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "AdminOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminOrganizationMembership" ADD COLUMN "accessLevel" "CrewAccessLevel" NOT NULL DEFAULT 'WRITE', ADD COLUMN "departmentId" TEXT, ADD COLUMN "role" TEXT;
ALTER TABLE "AdminInvitation" ADD COLUMN "accessLevel" "CrewAccessLevel" NOT NULL DEFAULT 'WRITE', ADD COLUMN "departmentId" TEXT, ADD COLUMN "role" TEXT;
ALTER TABLE "AdminOrganizationMembership" ADD CONSTRAINT "AdminOrganizationMembership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "CrewDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminInvitation" ADD CONSTRAINT "AdminInvitation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "CrewDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
