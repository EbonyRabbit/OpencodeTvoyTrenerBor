-- Migration: grant_plan_pauses_permissions
-- Description: plan_pauses was created after grant_table_permissions, so the
-- conditional grant there never ran. Without these grants service_role cannot
-- delete pauses during program activation.

GRANT ALL ON public.plan_pauses TO service_role;
