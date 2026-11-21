-- Work-in-progress page design; "pageDesign" stays the published version visitors see.
ALTER TABLE "Event" ADD COLUMN "pageDesignDraft" JSONB;
ALTER TABLE "Event" ADD COLUMN "pageDesignPublishedAt" TIMESTAMP(3);
