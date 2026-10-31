import { describe, expect, it } from 'vitest';
import { demoTarget } from './guard';
import { DEMO_EMAIL_DOMAIN, demoPerson } from './names';

// The demo data goes to the local stack or the staging project only (docs/runbooks/demo-data.md).
describe('demoTarget', () => {
  const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const staging = 'postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres';
  const pooled =
    'postgresql://postgres.abcdefghijklmnop:secret@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
  const refused = (env: NodeJS.ProcessEnv) => {
    const checked = demoTarget(env);
    return 'refused' in checked ? checked.refused : '';
  };

  it('takes the local stack for local', () => {
    expect(demoTarget({ CLINIC_MX_SEED_TARGET: 'local', DIRECT_DATABASE_URL: local })).toEqual({
      target: 'local',
    });
  });

  it('refuses another host for local', () => {
    expect(refused({ CLINIC_MX_SEED_TARGET: 'local', DIRECT_DATABASE_URL: staging })).toMatch(
      /local stack/,
    );
  });

  it('takes staging only when the address is the staging project, direct or pooled', () => {
    const env = { CLINIC_MX_SEED_TARGET: 'staging', SUPABASE_PROJECT_REF: 'abcdefghijklmnop' };
    expect(demoTarget({ ...env, DIRECT_DATABASE_URL: staging })).toEqual({ target: 'staging' });
    expect(demoTarget({ ...env, DIRECT_DATABASE_URL: pooled })).toEqual({ target: 'staging' });
    expect(
      refused({ ...env, SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzz', DIRECT_DATABASE_URL: staging }),
    ).toMatch(/not the staging project/);
    expect(refused({ CLINIC_MX_SEED_TARGET: 'staging', DIRECT_DATABASE_URL: staging })).toMatch(
      /SUPABASE_PROJECT_REF/,
    );
  });

  it('refuses any other target, or none', () => {
    expect(refused({ CLINIC_MX_SEED_TARGET: 'production', DIRECT_DATABASE_URL: local })).toMatch(
      /local or staging/,
    );
    expect(refused({ DIRECT_DATABASE_URL: local })).toMatch(/local or staging/);
    expect(refused({ CLINIC_MX_SEED_TARGET: 'local' })).toMatch(/not set/);
  });
});

describe('demoPerson', () => {
  it('makes the same made up person for a slug every time, marked as demo', () => {
    const person = demoPerson('hsr-01');
    expect(demoPerson('hsr-01')).toEqual(person);
    expect(person.email).toBe(`hsr-01@${DEMO_EMAIL_DOMAIN}`);
    expect(person.phone).toMatch(/^\+9199\d{8}$/);
    expect(person.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(demoPerson('hsr-02')).not.toEqual(person);
  });
});
