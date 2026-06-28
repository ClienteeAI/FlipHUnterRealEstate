-- Per-user attribution: who approved / dismissed a lead.
-- Apply once in the Supabase SQL editor.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS approved_by  TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS dismissed_by TEXT;
