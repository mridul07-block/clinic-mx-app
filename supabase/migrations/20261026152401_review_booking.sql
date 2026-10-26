-- OUT-06: the 6 week review (PRD J6.1; user decisions 26 October 2026). When an episode turns
-- Active (its plan chosen and paid), the database queues `review.book` once for it: the job books
-- the Review with the consultant who signed the consultation at their first free time from the
-- plan's review date, within `scheduling.review_search_days`, or gives the front desk a task. Staff
-- cannot add jobs (as in ALT-04); the job's key keeps it to one per episode, whatever happens later.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('scheduling.review_search_days', '7', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.review_booking_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('review.book', jsonb_build_object('episodeId', NEW.id), 'review.book:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.review_booking_job() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER review_booking_job AFTER UPDATE OF status ON public.episode
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION internal.review_booking_job();
