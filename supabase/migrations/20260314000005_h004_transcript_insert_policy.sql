-- AUDIT-1 H-004: Add INSERT policy on sms_transcript_log
-- Unblocks migration of push/training, users/import, users/[id]/encourage
-- from serviceClient to authenticated client for transcript logging.
CREATE POLICY "sms_transcript_log_insert_authenticated"
  ON sms_transcript_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_dealership_id()) = dealership_id);

-- AUDIT-1 C-003: billing_events is service-role-only by design (cron/webhook writes, no dashboard reads).
-- No authenticated policies needed. Documenting intent here.
COMMENT ON TABLE billing_events IS 'Service-role-only operational table. No authenticated policies by design. Written by Stripe webhook and dunning cron.';
