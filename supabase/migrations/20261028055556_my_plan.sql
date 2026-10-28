-- PAT-01, in part: "My plan" (PRD M13, J5.7; Frontend Specification "My plan"). Recommended
-- defaults chosen under the user's standing approval, 28 October 2026 (docs/runbooks/my-plan.md).
-- A My plan link reads, for its own episode only, what the page shows and nothing else: the
-- patient's name, the newest plan's home programme and length, the next visit with its centre
-- (map link, phone) and physio, the live package's sessions and validity (never a price), and the
-- signed sessions' pain readings. One function rather than table rights: the patient role reaches
-- no table row through it, and no column beyond these. Patients still write nothing here.
CREATE OR REPLACE FUNCTION internal.my_plan() RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH link AS (
    SELECT l.patient_id, l.episode_id
    FROM public.patient_link l
    WHERE l.id = internal.jwt_patient_link_id()
      AND l.purpose = 'my_plan' AND l.episode_id IS NOT NULL
      AND l.revoked_at IS NULL AND l.expires_at > now()
      AND EXISTS (SELECT 1 FROM public.episode e
        WHERE e.id = l.episode_id AND e.patient_id = l.patient_id)
  ),
  plan AS (
    SELECT p.home_programme, p.weeks, p.sessions_per_week, p.created_at
    FROM public.plan_of_care p JOIN link ON p.episode_id = link.episode_id
    ORDER BY p.version DESC LIMIT 1
  ),
  next_visit AS (
    SELECT a.starts_at, t.name AS type_name, c.name AS centre_name, c.map_link, c.phone,
      s.name AS physio_name
    FROM public.appointment a
    JOIN link ON a.episode_id = link.episode_id
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    JOIN public.centre c ON c.id = a.centre_id
    JOIN public.staff_user s ON s.id = a.physio_id
    WHERE a.status IN ('booked', 'confirmed', 'checked_in') AND a.ends_at > now()
    ORDER BY a.starts_at LIMIT 1
  ),
  -- The package signing takes sessions from (internal.session_sign: active, oldest payment first);
  -- with none active, the newest not cancelled, which the page words as used up or expired.
  held AS (
    SELECT k.name, k.sessions_total, k.sessions_used, k.valid_until, k.reschedules_left
    FROM public.package k JOIN link ON k.episode_id = link.episode_id
    WHERE k.cancelled_at IS NULL
    ORDER BY (k.sessions_used < k.sessions_total
        AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date) DESC,
      CASE WHEN k.sessions_used < k.sessions_total
        AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date
        THEN k.paid_at END ASC,
      k.paid_at DESC, k.id
    LIMIT 1
  ),
  pain AS (
    SELECT s.number, s.signed_at, s.pain_rest, s.pain_activity, s.pain_after
    FROM public.session s JOIN link ON s.episode_id = link.episode_id
    WHERE s.status = 'signed'
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM link) THEN NULL ELSE jsonb_build_object(
    'name', (SELECT pt.name FROM public.patient pt JOIN link ON pt.id = link.patient_id),
    'episodeStatus', (SELECT e.status FROM public.episode e JOIN link ON e.id = link.episode_id),
    'centrePhone', (SELECT c.phone FROM public.episode e JOIN link ON e.id = link.episode_id
      JOIN public.centre c ON c.id = e.centre_id),
    'plan', (SELECT jsonb_build_object('homeProgramme', plan.home_programme, 'weeks', plan.weeks,
      'sessionsPerWeek', plan.sessions_per_week, 'since', plan.created_at) FROM plan),
    'next', (SELECT jsonb_build_object('startsAt', n.starts_at, 'type', n.type_name,
      'centre', n.centre_name, 'mapLink', n.map_link, 'phone', n.phone, 'physio', n.physio_name)
      FROM next_visit n),
    'package', (SELECT jsonb_build_object('name', h.name, 'total', h.sessions_total,
      'used', h.sessions_used, 'validUntil', h.valid_until, 'reschedulesLeft', h.reschedules_left)
      FROM held h),
    'pain', coalesce((SELECT jsonb_agg(jsonb_build_object('number', p.number,
      'signedAt', p.signed_at, 'rest', p.pain_rest, 'activity', p.pain_activity,
      'after', p.pain_after) ORDER BY p.number) FROM pain p), '[]'::jsonb)
  ) END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.my_plan() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.my_plan() TO clinic_patient;
--> statement-breakpoint

-- Before WhatsApp (the TAD's reissue), the front desk shows the patient a QR for their My plan link:
-- those who check patients in read and issue My plan links for episodes at their centres.
CREATE POLICY patient_link_my_plan_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'my_plan'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_my_plan_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'my_plan'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );
--> statement-breakpoint

-- Whether the episode has a plan of care, for those who issue its My plan link: the desk reads no
-- plan of care itself (it is clinical), so only this yes or no, at its centres.
CREATE OR REPLACE FUNCTION internal.episode_has_plan(p_episode_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT internal.jwt_checks_in()), false)
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = p_episode_id AND internal.jwt_sees_centre(e.centre_id))
    AND EXISTS (SELECT 1 FROM public.plan_of_care p WHERE p.episode_id = p_episode_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_has_plan(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_has_plan(uuid) TO authenticated;
--> statement-breakpoint

-- Only the newest My plan link works (decision 22 October 2026). Issuing one stops the patient's
-- older ones, at any centre, which the desk can neither read nor change itself: this does it for
-- a working My plan link of `p_patient_id` just issued by someone who checks in at its episode's
-- centre, or by the server's own system transaction (no role switched: the WhatsApp reissue).
CREATE OR REPLACE FUNCTION internal.stop_older_my_plan_links(p_patient_id uuid, p_keep uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  stopped integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_link l
    WHERE l.id = p_keep AND l.patient_id = p_patient_id AND l.purpose = 'my_plan'
      AND l.revoked_at IS NULL AND l.expires_at > now()
      AND (current_setting('role') = 'none'
        OR (coalesce((SELECT internal.jwt_checks_in()), false)
          AND NOT coalesce((SELECT internal.jwt_support()), false)
          AND EXISTS (SELECT 1 FROM public.episode e
            WHERE e.id = l.episode_id AND e.patient_id = l.patient_id
              AND internal.jwt_sees_centre(e.centre_id))))
  ) THEN
    RAISE EXCEPTION 'Only a working My plan link you issued stops the older ones.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.patient_link
    SET revoked_at = now()
    WHERE patient_id = p_patient_id AND purpose = 'my_plan' AND id <> p_keep
      AND revoked_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS stopped = ROW_COUNT;
  RETURN stopped;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.stop_older_my_plan_links(uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.stop_older_my_plan_links(uuid, uuid) TO authenticated;
