-- Chat photo attachments: an object-store key for an image sent in a job conversation.
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;
