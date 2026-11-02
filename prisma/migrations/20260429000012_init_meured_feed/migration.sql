CREATE SCHEMA IF NOT EXISTS "meured_feed";

CREATE TABLE "meured_feed"."MeuredTimelineEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorAuthUserId" TEXT NOT NULL,
  "objectType" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeuredTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeuredTimelineEvent_actorAuthUserId_idx" ON "meured_feed"."MeuredTimelineEvent"("actorAuthUserId");
CREATE INDEX "MeuredTimelineEvent_createdAt_idx" ON "meured_feed"."MeuredTimelineEvent"("createdAt");
CREATE INDEX "MeuredTimelineEvent_type_idx" ON "meured_feed"."MeuredTimelineEvent"("type");

