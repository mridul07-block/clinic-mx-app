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
4. **Spend alerts and monitoring** (FND-12, `monitoring.md`):
   - Vercel Pro: Settings, Billing, Spend Management on, with an amount, email notifications to
     the on call inbox, and pausing production off (the clinic keeps working; the alert is enough).
   - Supabase Pro: spend cap on; usage emails to the on call inbox.
   - AI gateway: a monthly budget alert to the on call inbox, when the AI tickets add the gateway.
   - Better Stack: checks every minute (a paid plan), as TAD section 10 asks.
   - A separate Sentry environment (`production`) is set by Vercel; run the drill on production.
5. **Backups** (`backups.md`): confirm Supabase daily backups on Pro; add the production secrets and
   a production job to `backup.yml`; run it, then run and record a restore test from its copy.
6. **Domain**: production hostname on the clinic domain through Cloudflare (FND-05).
7. Update `environments.md` and the FND-02, FND-03 and FND-12 rows in `docs/PROGRESS.md`.
