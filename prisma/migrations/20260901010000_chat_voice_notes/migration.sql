-- #chat: voice-note attachments. Both nullable, so existing rows are unaffected — safe add.
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "audioKey" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "audioDurationMs" INTEGER;
