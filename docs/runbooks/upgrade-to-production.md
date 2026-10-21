# Upgrade to production

Clinic Mx is built on Vercel Hobby and Supabase Free. Before go live (OPS-08) every item below is
done; until then FND-02, FND-03 and FND-12 are only complete for the free plans.

## Why

- Vercel Hobby is for personal, non commercial use; the live clinic system needs Vercel Pro.
- Supabase Free pauses after a week without activity, has no downloadable daily backups and no spend
  cap setting; production needs Supabase Pro with Small compute (TAD section 2).

## Steps

1. **Vercel Pro.** Move project `clinic-mx-app` to a Pro team (or upgrade the scope). Keep functions
   in `bom1`. Add a separate production environment or project so staging and production are
   different deployments with different variables.
2. **Supabase production project** in Mumbai (`ap-south-1`) on Pro with Small compute, spend cap on.
   Keep `clinic-mx-staging` for staging and previews.
3. **Production variables** set in Vercel's Production target only, pointing at the production
   Supabase project; staging values move to the staging environment.
4. **Spend alerts** on Vercel, Supabase and the AI gateway (FND-12).
5. **Backups**: confirm Supabase daily backups plus the independent nightly copy (FND-13), then run
   and record a restore test.
6. **Domain**: production hostname on the clinic domain through Cloudflare (FND-05).
7. Update `environments.md` and the FND-02, FND-03 and FND-12 rows in `docs/PROGRESS.md`.
