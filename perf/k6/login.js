// k6 scenario `login`: POST /api/v1/login (pages/Login.tsx, api/auth.ts) — bcrypt cost 12 on the app's C1-only JVM. Each
// iteration is one sign-in of the VU's persona (the 7 accounts, round-robin). The response is anonymous: no Server-Timing (it
// would be an account-enumeration oracle), so only wall time is measured; the pgss window shows the 3-5 statements a login runs.
// Shape: `perf/run.sh k6 login --vus 50 --ramp-up 30s --duration 1m` ramps 0 -> 50 VUs and holds (a login storm, e.g. the
// Monday-morning peak); 1 VU x N iterations gives the unloaded cost of one bcrypt verification.
import { defineScenario } from './lib/replay.js';
import { PERF_PASSWORD, ALL_PERSONAS } from './lib/auth.js';

const def = {
  name: 'login',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  screens: {
    login: {
      endpoints: ['login'],
      run(s) {
        const p = ALL_PERSONAS[s.persona];
        s.send('POST', '/api/v1/login', { email: p.email, password: p.password || PERF_PASSWORD }, 'login', [200], true);
      },
    },
  },
  personaScreens: {},
};
for (const p of def.personas) def.personaScreens[p] = ['login'];

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
