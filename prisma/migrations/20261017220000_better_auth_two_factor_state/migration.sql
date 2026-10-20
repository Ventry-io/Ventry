-- Existing two-factor secrets remain verified; new enrollments set verified=false.
ALTER TABLE "twoFactor"
    ADD COLUMN "verified" BOOLEAN DEFAULT true,
    ADD COLUMN "failedVerificationCount" INTEGER DEFAULT 0,
    ADD COLUMN "lockedUntil" TIMESTAMP(3);
