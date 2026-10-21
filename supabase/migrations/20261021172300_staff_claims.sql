-- IAM-03: each staff member's role, ticks and centres in every Supabase token (TAD section 5),
-- for the row level security policies of IAM-05.
--
-- internal.staff_claims builds them from the staff tables. Supabase Auth calls
-- internal.custom_access_token_hook whenever it issues a token (sign in, two step code, refresh)
-- and puts the result in the `clinic` claim. The app compares the claim with staff_claims on
-- every staff request and refreshes the token when they differ (apps/web/proxy.ts), so a change
-- of role, ticks or centres reaches the token on the next request. Enable the hook only after
-- this migration is applied (docs/runbooks/auth.md): a hook that does not exist stops sign in.

-- The claims for a login, or null when it is not an active staff member before any end date.
-- Super Admin and Finance see every centre by role (PRD section 2); `centres` lists assignments.
CREATE OR REPLACE FUNCTION internal.staff_claims(auth_user_id uuid) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'staff_id', s.id,
    'role', s.role,
    'treats_patients', s.treats_patients,
    'consultant', s.consultant,
    'all_centres', s.role IN ('super_admin', 'finance'),
    'centres', coalesce(
      (SELECT jsonb_agg(c.centre_id ORDER BY c.centre_id)
         FROM public.staff_user_centre c
        WHERE c.staff_user_id = s.id),
      '[]'::jsonb)
  )
  FROM public.staff_user s
  WHERE s.auth_user_id = staff_claims.auth_user_id
    AND s.active
    AND (s.access_ends_at IS NULL OR s.access_ends_at > now())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.staff_claims(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The custom access token hook: the token's claims plus `clinic`, or without it for anyone who
-- is not an active staff member. Every standard claim is kept.
CREATE OR REPLACE FUNCTION internal.custom_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  clinic jsonb := internal.staff_claims((event ->> 'user_id')::uuid);
BEGIN
  IF clinic IS NULL THEN
    claims := claims - 'clinic';
  ELSE
    claims := jsonb_set(claims, '{clinic}', clinic);
  END IF;
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT USAGE ON SCHEMA internal TO supabase_auth_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.custom_access_token_hook(jsonb) TO supabase_auth_admin;--> statement-breakpoint

-- Readers of the signed in person's claims for row level security policies (IAM-05). They read
-- only the caller's own token, so the API role may use them.
CREATE OR REPLACE FUNCTION internal.jwt_clinic() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT auth.jwt() -> 'clinic' $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.jwt_staff_role() RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT internal.jwt_clinic() ->> 'role' $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.jwt_treats() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT coalesce((internal.jwt_clinic() ->> 'treats_patients')::boolean, false) $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.jwt_consultant() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT coalesce((internal.jwt_clinic() ->> 'consultant')::boolean, false) $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.jwt_centre_ids() RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(array_agg(value::uuid), '{}')
  FROM jsonb_array_elements_text(coalesce(internal.jwt_clinic() -> 'centres', '[]'::jsonb))
$$;--> statement-breakpoint

-- Whether the signed in person sees a centre's rows: every centre for Super Admin and Finance.
CREATE OR REPLACE FUNCTION internal.jwt_sees_centre(centre_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce((internal.jwt_clinic() ->> 'all_centres')::boolean, false)
      OR jwt_sees_centre.centre_id = ANY (internal.jwt_centre_ids())
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA internal TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_clinic(), internal.jwt_staff_role(), internal.jwt_treats(),
  internal.jwt_consultant(), internal.jwt_centre_ids(), internal.jwt_sees_centre(uuid)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_clinic(), internal.jwt_staff_role(), internal.jwt_treats(),
  internal.jwt_consultant(), internal.jwt_centre_ids(), internal.jwt_sees_centre(uuid)
  TO authenticated;
