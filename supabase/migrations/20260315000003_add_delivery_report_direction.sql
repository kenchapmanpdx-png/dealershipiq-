-- F1-M-001: Add 'delivery_report' to direction CHECK constraint on sms_transcript_log
-- Delivery reports from Sinch should not be tagged as 'outbound' to avoid inflating message cap counts

-- Drop existing constraint dynamically (name may vary)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.sms_transcript_log'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%direction%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sms_transcript_log DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Add updated constraint with delivery_report
ALTER TABLE public.sms_transcript_log
  ADD CONSTRAINT sms_transcript_log_direction_check
  CHECK (direction IN ('inbound', 'outbound', 'delivery_report'));
