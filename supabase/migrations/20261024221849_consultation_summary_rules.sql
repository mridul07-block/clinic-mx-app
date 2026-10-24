-- ALT-06: the consultation summary. On signing (PRD J4.1), in the same transaction, the database
-- queues the summary's generation and the bundled WhatsApp message (sent once WhatsApp exists);
-- each addendum queues the next version of the summary (TAD section 9: regenerating after an
-- addendum creates a new version). Staff cannot add jobs themselves (`job` has no staff policy),
-- so these SECURITY DEFINER triggers do it, as ALT-04's no show follow up does. Each job's key
-- names the event, so a repeat is ignored and a generation that runs twice makes one version.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('documents.summary_prints_category', 'false', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.consultation_summary_jobs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'signed' THEN
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('documents.consultation_summary', jsonb_build_object('consultationId', NEW.id),
      'consultation_summary:sign:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('whatsapp.consultation_summary', jsonb_build_object('consultationId', NEW.id),
      'whatsapp.consultation_summary:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultation_summary_jobs() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER consultation_summary_jobs AFTER UPDATE OF status ON public.consultation
  FOR EACH ROW EXECUTE FUNCTION internal.consultation_summary_jobs();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.addendum_summary_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('documents.consultation_summary',
    jsonb_build_object('consultationId', NEW.consultation_id),
    'consultation_summary:addendum:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.addendum_summary_job() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER addendum_summary_job AFTER INSERT ON public.addendum
  FOR EACH ROW EXECUTE FUNCTION internal.addendum_summary_job();
