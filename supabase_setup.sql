-- ============================================================
--  SUPABASE DATABASE SETUP
--  Run this entire file in your Supabase SQL Editor once.
--  Go to: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- 1. Create the patients table
CREATE TABLE IF NOT EXISTS patients (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Patient info
  ward                 TEXT NOT NULL CHECK (ward IN ('ward_a', 'ward_b', 'icu_1', 'icu_2')),
  patient_name         TEXT NOT NULL,
  room_number          TEXT,
  mrn                  TEXT,

  -- Positional guidelines
  positional_supine    BOOLEAN DEFAULT FALSE,
  positional_sidelying BOOLEAN DEFAULT FALSE,
  note_positional      TEXT,

  -- Splinting guideline
  splinting            BOOLEAN,   -- NULL = not set, TRUE = yes, FALSE = no
  note_splinting       TEXT,

  -- Speech guideline
  speech               BOOLEAN,   -- NULL = not set, TRUE = yes, FALSE = no
  note_speech          TEXT
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- 3. Allow all operations for now (open access).
--    When you are ready to add authentication, replace these policies.
CREATE POLICY "Allow all" ON patients
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Enable realtime so changes appear across devices instantly
ALTER PUBLICATION supabase_realtime ADD TABLE patients;
