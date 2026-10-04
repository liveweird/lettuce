// The perf personas (perf/k6/lib/auth.js ALL_PERSONAS — keep the two lists in step): the accounts the dataset generator
// creates, all with one shared password, plus the V6 seed admin. Which screens a persona loads is decided per spec by what
// the SPA lets that role reach (a screen a role cannot open measures nothing real).
export type PersonaKey = "ceo" | "director" | "lead" | "lead2" | "ic" | "hr" | "admin";

export interface Credentials {
  email: string;
  password: string;
}

const DOMAIN = "perf.lettuce.local";
export const PERF_PASSWORD = "perf-pass-2026";

const PERF_ACCOUNTS: Record<PersonaKey, Credentials> = {
  ceo: { email: `perf-ceo@${DOMAIN}`, password: PERF_PASSWORD }, // level 1, ~510 transitive reports
  director: { email: `perf-dir-01@${DOMAIN}`, password: PERF_PASSWORD }, // ~50 transitive reports
  lead: { email: `perf-lead-001@${DOMAIN}`, password: PERF_PASSWORD }, // 6-7 direct reports
  lead2: { email: `perf-lead-042@${DOMAIN}`, password: PERF_PASSWORD }, // under another director
  ic: { email: `perf-ic-0001@${DOMAIN}`, password: PERF_PASSWORD }, // no reports
  hr: { email: `perf-hr@${DOMAIN}`, password: PERF_PASSWORD }, // auditor, no team
  admin: { email: "admin@lettuce.local", password: "changeme" }, // the V6 seed admin (development mode)
};

// PERF_SMOKE=1: harness self-check against the DEV stack's seed accounts (PERF_BASE_URL=http://localhost:8080) — proves the
// runner works end to end without touching the perf stack. The numbers it writes mean nothing (a handful of rows).
const SMOKE_ACCOUNTS: Record<PersonaKey, Credentials> = {
  ceo: { email: "manager-aaa@lettuce.local", password: "changeme" },
  director: { email: "manager-aaa@lettuce.local", password: "changeme" },
  lead: { email: "manager-aaa@lettuce.local", password: "changeme" },
  lead2: { email: "manager-ccc@lettuce.local", password: "changeme" },
  ic: { email: "aaa-one@lettuce.local", password: "changeme" },
  hr: { email: "hr@lettuce.local", password: "changeme" },
  admin: { email: "admin@lettuce.local", password: "changeme" },
};

export const SMOKE = process.env.PERF_SMOKE === "1";

export function credentials(key: PersonaKey): Credentials {
  return (SMOKE ? SMOKE_ACCOUNTS : PERF_ACCOUNTS)[key];
}
