-- #chat: reply-to-message support. Nullable, so existing rows are unaffected and this is a safe add.
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
