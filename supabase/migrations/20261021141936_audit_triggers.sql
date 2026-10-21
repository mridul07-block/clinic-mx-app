-- FND-11: every write to an audited table records who, what, the row before and after (rule 5).
--
-- Writes name their actor with `select set_config('audit.actor', 'staff:<uuid>', true)` inside
-- their transaction (withActor in packages/db does this). A write without an actor is refused,
-- so a forgotten audit cannot slip through. Every new table gets this trigger in its migration;
-- a CI test fails for any table in public that has neither the trigger nor an exemption.

CREATE SCHEMA IF NOT EXISTS internal;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.audit_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := nullif(current_setting('audit.actor', true), '');
  before_row jsonb;
  after_row jsonb;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Every write must name its actor: % on % has none', TG_OP, TG_TABLE_NAME
      USING HINT = 'Run the write inside withActor() (packages/db), which sets audit.actor.',
            ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN after_row := to_jsonb(NEW); END IF;
  -- An update that changed nothing is not an event.
  IF TG_OP = 'UPDATE' AND before_row = after_row THEN RETURN NULL; END IF;

  INSERT INTO public.audit_event (actor, action, entity, entity_id, before, after, ip)
  VALUES (
    actor,
    lower(TG_OP)::public.audit_action,
    TG_TABLE_NAME,
    coalesce(after_row, before_row) ->> 'id',
    before_row,
    after_row,
    nullif(current_setting('audit.ip', true), '')
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.audit_change() FROM PUBLIC;--> statement-breakpoint

-- The audit trail itself never changes: no update, no delete, for any role.
CREATE OR REPLACE FUNCTION internal.audit_event_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'The audit trail cannot be changed (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION internal.audit_event_append_only();--> statement-breakpoint

-- Audited tables so far. The job table is queue bookkeeping and is exempt (see the CI test).
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.centre
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.staff_user
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.staff_user_centre
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.task
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();
