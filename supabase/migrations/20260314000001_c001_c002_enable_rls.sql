-- AUDIT-1 C-001: Enable RLS on chain_templates (tenant-scoped data)
ALTER TABLE chain_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chain_templates_select_authenticated"
  ON chain_templates FOR SELECT TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

-- AUDIT-1 C-002: Enable RLS on model_years (public reference data — read-only for everyone)
ALTER TABLE model_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_years_select_public"
  ON model_years FOR SELECT TO authenticated
  USING (true);
