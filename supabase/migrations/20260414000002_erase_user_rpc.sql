-- S4: GDPR Art. 17 / CCPA erasure RPC.
-- Deletes or anonymizes all PII associated with a user across every table that
-- references the user either by user_id or by phone. Runs with SECURITY DEFINER
-- so it can bypass RLS; callers must gate access (admins / the user themselves).
--
-- Called from DELETE /api/users/[id] and from any future "delete my account"
-- self-service flow.
--
-- Strategy per-table:
--   - Hard DELETE where the data is worthless without the user (training_results,
--     conversation_sessions, challenge_results, coach_sessions, delivery_logs).
--   - Anonymize transcript_log (retain aggregate deliverability metrics but drop
--     phone + message_body).
--   - Hard DELETE dealership_memberships + sms_opt_outs keyed by the phone.
--   - Anonymize users (keep row for FK integrity where something survived).
--
-- The caller is responsible for also deleting the auth.users row via
-- supabase.auth.admin.deleteUser(user_id). That is handled in the API route.

CREATE OR REPLACE FUNCTION public.erase_user_everywhere(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_deleted JSONB := '{}'::jsonb;
  v_n INT;
BEGIN
  -- Capture the phone before anonymizing so we can also purge phone-keyed rows.
  SELECT phone INTO v_phone FROM public.users WHERE id = p_user_id;

  -- Hard-delete child rows keyed by user_id.
  DELETE FROM public.training_results WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('training_results', v_n);

  DELETE FROM public.conversation_sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('conversation_sessions', v_n);

  -- challenge_results may not exist in all deployments; wrap in try/catch
  BEGIN
    EXECUTE 'DELETE FROM public.challenge_results WHERE user_id = $1' USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('challenge_results', v_n);
  EXCEPTION WHEN undefined_table THEN
    v_deleted := v_deleted || jsonb_build_object('challenge_results', 'table_missing');
  END;

  BEGIN
    EXECUTE 'DELETE FROM public.coach_sessions WHERE user_id = $1' USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('coach_sessions', v_n);
  EXCEPTION WHEN undefined_table THEN
    v_deleted := v_deleted || jsonb_build_object('coach_sessions', 'table_missing');
  END;

  BEGIN
    EXECUTE 'DELETE FROM public.sms_delivery_log WHERE user_id = $1' USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('sms_delivery_log', v_n);
  EXCEPTION WHEN undefined_table THEN
    v_deleted := v_deleted || jsonb_build_object('sms_delivery_log', 'table_missing');
  END;

  -- Anonymize transcript rows (retain aggregate metrics; strip PII).
  UPDATE public.sms_transcript_log
    SET phone = NULL,
        message_body = '[erased]',
        metadata = NULL
    WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('sms_transcript_log_anonymized', v_n);

  -- Hard-delete rows keyed by phone.
  IF v_phone IS NOT NULL THEN
    DELETE FROM public.sms_opt_outs WHERE phone = v_phone;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object('sms_opt_outs', v_n);
  END IF;

  -- Hard-delete memberships.
  DELETE FROM public.dealership_memberships WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('dealership_memberships', v_n);

  -- Anonymize the users row. Keeping the row (vs deleting) preserves FK integrity
  -- for anything we missed; the row is now PII-free.
  UPDATE public.users
    SET phone = NULL,
        full_name = '[erased user]',
        status = 'erased',
        language = 'en',
        updated_at = NOW()
    WHERE id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('users_anonymized', v_n);

  RETURN v_deleted;
END;
$$;

-- Revoke broad grants; only service_role should call this.
REVOKE ALL ON FUNCTION public.erase_user_everywhere(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.erase_user_everywhere(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.erase_user_everywhere(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.erase_user_everywhere(UUID) TO service_role;

COMMENT ON FUNCTION public.erase_user_everywhere(UUID) IS
  'S4/GDPR Art.17: cascade-purge all PII associated with a user. ' ||
  'Caller must additionally delete the auth.users row via the admin API. ' ||
  'Returns JSONB summary of rows affected per table.';
