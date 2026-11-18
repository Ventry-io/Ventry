-- CreateEnum
CREATE TYPE "RoomInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "AdminOrgPermission" ADD VALUE 'HOTEL_MANAGEMENT';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "roomGroupCutoffAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "maxOccupants" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "minOccupants" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "HotelRoom" (
    "id" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "hotelId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomGroup" (
    "id" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomInvitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "inviterRegistrationId" TEXT NOT NULL,
    "inviteeRegistrationId" TEXT NOT NULL,
    "status" "RoomInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAssignment" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "assignedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAuditLog" (
    "id" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "groupId" TEXT,
    "actorUserId" TEXT,
    "actorAdminId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelRoom_eventId_productId_idx" ON "HotelRoom"("eventId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "HotelRoom_eventId_reference_key" ON "HotelRoom"("eventId", "reference");

-- CreateIndex
CREATE INDEX "RoomGroup_eventId_idx" ON "RoomGroup"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomGroupMember_registrationId_key" ON "RoomGroupMember"("registrationId");

-- CreateIndex
CREATE INDEX "RoomGroupMember_groupId_idx" ON "RoomGroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomInvitation_token_key" ON "RoomInvitation"("token");

-- CreateIndex
CREATE INDEX "RoomInvitation_groupId_status_idx" ON "RoomInvitation"("groupId", "status");

-- CreateIndex
CREATE INDEX "RoomInvitation_inviteeRegistrationId_status_idx" ON "RoomInvitation"("inviteeRegistrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomAssignment_groupId_key" ON "RoomAssignment"("groupId");

-- CreateIndex
CREATE INDEX "RoomAssignment_roomId_idx" ON "RoomAssignment"("roomId");

-- CreateIndex
CREATE INDEX "RoomAuditLog_eventId_createdAt_idx" ON "RoomAuditLog"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "HotelRoom" ADD CONSTRAINT "HotelRoom_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomGroup" ADD CONSTRAINT "RoomGroup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomGroupMember" ADD CONSTRAINT "RoomGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoomGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomGroupMember" ADD CONSTRAINT "RoomGroupMember_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvitation" ADD CONSTRAINT "RoomInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoomGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvitation" ADD CONSTRAINT "RoomInvitation_inviterRegistrationId_fkey" FOREIGN KEY ("inviterRegistrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInvitation" ADD CONSTRAINT "RoomInvitation_inviteeRegistrationId_fkey" FOREIGN KEY ("inviteeRegistrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "HotelRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RoomGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAuditLog" ADD CONSTRAINT "RoomAuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

