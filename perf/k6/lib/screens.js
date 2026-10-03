// Replays the SPA's request sequence for Performance -> Team's performance (web/src/pages/ReviewsDashboard.tsx,
// web/src/api/{teams,reviews,users}.ts, hooks/useIsManager.ts, useReviewPeriodOptions.tsx, useDictionaryOptions.ts).
//
// What the browser does on mount (React Query fires every enabled query at once):
//   probe      GET /teams?page=1&pageSize=1&managerId=<me>                       (useIsManagerStatus)
//   periods    GET /review-periods                                               (then picks the CURRENT period)
//   dictionaries  GET /dictionaries/{career-paths,career-specializations,seniority-levels}
//   roster     listAllTeamMembers("managed", includeIndirect?) — pageSize 100, page after page, SEQUENTIAL
//              (auditor scope: listAllUsers() instead — users?page&pageSize=100&sort=id)
//   reviews    listAllPerformanceReviews — enabled once periods resolved, pageSize 100, SEQUENTIAL
//              (managed: view=managed&includeIndirect=true&periodId; auditor: view=all&periodId)
// An HR caller who manages no team also fires the default-scope roster fetch once before the probe resolves
// ("direct", page 1 only: they have no reports, so total = 0) — replayed as `stray-roster`.
//
// k6 has no cheap in-iteration concurrency, so the chains run one after another; the per-chain sums are kept
// so `screen_critical_ms` can estimate the browser's critical path (roster chain || periods -> reviews chain).
import http from 'k6/http';
import { check } from 'k6';
import { PERSONAS } from './auth.js';
import {
  recordRequest, chainWall, chainRequests, chainStmt, chainTx,
  screenWall, screenCritical, screenDb, screenRequests, screenStmt, screenTx,
} from './metrics.js';

const PAGE_SIZE = 100;

// buildQuery (web/src/api/http.ts): insertion order, no encoding surprises for the values used here
// (k6 has no global URLSearchParams).
function qs(params) {
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}
const DICTIONARIES = ['career-paths', 'career-specializations', 'seniority-levels'];

// The SPA's `isCurrentPeriod`: startMonth <= now <= endMonth, zero-padded ISO months compare as strings.
// No period contains today -> the newest (the SPA's fallback), exactly like the picker.
function currentPeriodId(periods) {
  const now = new Date().toISOString().slice(0, 7);
  const current = periods.find((p) => p.startMonth <= now && now <= p.endMonth);
  return (current || periods[periods.length - 1]).id;
}

class Chain {
  constructor(base, token, persona, name) {
    this.base = base;
    this.headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    this.persona = persona;
    this.name = name;
    this.wall = 0;
    this.db = 0;
    this.stmt = 0;
    this.tx = 0;
    this.requests = 0;
    this.failed = false;
  }

  get(path, endpoint) {
    const res = http.get(`${this.base}${path}`, {
      headers: this.headers,
      tags: { persona: this.persona, endpoint },
    });
    const ok = check(res, { [`${endpoint} 200`]: (r) => r.status === 200 });
    const r = recordRequest(res, { persona: this.persona, endpoint });
    this.wall += r.wall;
    this.db += r.db;
    this.stmt += r.stmt;
    this.tx += r.tx;
    this.requests += 1;
    if (!ok) this.failed = true;
    return ok ? res : null;
  }

  /** The `listAll*` idiom: page after page until the accumulated item count reaches `total`. */
  pageAll(pathForPage, endpoint) {
    let seen = 0;
    for (let page = 1; ; page += 1) {
      const res = this.get(pathForPage(page), endpoint);
      if (res === null) return seen;
      const body = res.json();
      seen += body.items.length;
      if (seen >= body.total || body.items.length === 0) return seen;
    }
  }

  finish() {
    const tags = { persona: this.persona, chain: this.name };
    chainWall.add(this.wall, tags);
    chainRequests.add(this.requests, tags);
    chainStmt.add(this.stmt, tags);
    chainTx.add(this.tx, tags);
    return this;
  }
}

/** One load of the screen for `personaName`; returns the sums for the caller. */
export function reviewsTeamView(base, session, personaName) {
  const persona = PERSONAS[personaName];
  const auditor = persona.scope === 'auditor';
  const chains = [];
  const chain = (name) => {
    const c = new Chain(base, session.token, personaName, name);
    chains.push(c);
    return c;
  };

  const probe = chain('probe');
  probe.get(`/api/v1/teams?${qs({ page: 1, pageSize: 1, managerId: session.userId })}`, 'probe');
  probe.finish();

  const dicts = chain('dictionaries');
  for (const slug of DICTIONARIES) dicts.get(`/api/v1/dictionaries/${slug}`, 'dictionaries');
  dicts.finish();

  const periodsChain = chain('periods');
  const periodsRes = periodsChain.get('/api/v1/review-periods', 'periods');
  periodsChain.finish();
  if (periodsRes === null) return finishScreen(chains, null, null);
  const periodId = currentPeriodId(periodsRes.json().items);

  // Roster chain.
  const roster = chain(auditor ? 'users' : 'members');
  if (auditor) {
    const stray = chain('stray-roster');
    stray.get(`/api/v1/teams/members?${qs({ view: 'managed', page: 1, pageSize: PAGE_SIZE })}`, 'members');
    stray.finish();
    roster.pageAll(
      (page) => `/api/v1/users?${qs({ page, pageSize: PAGE_SIZE, sort: 'id' })}`,
      'users',
    );
  } else {
    roster.pageAll((page) => {
      const q = { view: 'managed', page, pageSize: PAGE_SIZE };
      if (persona.scope === 'all') q.includeIndirect = true;
      return `/api/v1/teams/members?${qs(q)}`;
    }, 'members');
  }
  roster.finish();

  // Reviews chain (after the period is known).
  const reviews = chain('reviews');
  reviews.pageAll((page) => {
    const q = auditor
      ? { view: 'all', page, pageSize: PAGE_SIZE, periodId }
      : { view: 'managed', page, pageSize: PAGE_SIZE, periodId, includeIndirect: true };
    return `/api/v1/performance-reviews?${qs(q)}`;
  }, 'reviews');
  reviews.finish();

  return finishScreen(chains, roster, auditor ? probe : null, periodsChain, reviews);
}

function finishScreen(chains, roster, probeBeforeRoster, periodsChain, reviews) {
  const tags = { persona: chains[0].persona };
  const sum = (key) => chains.reduce((acc, c) => acc + c[key], 0);
  // Browser critical path: the roster chain (auditor: after the probe) runs beside periods -> reviews;
  // the dictionaries ride along in parallel and are shorter than either.
  const rosterPath = roster ? roster.wall + (probeBeforeRoster ? probeBeforeRoster.wall : 0) : 0;
  const reviewsPath = periodsChain && reviews ? periodsChain.wall + reviews.wall : sum('wall');
  screenWall.add(sum('wall'), tags);
  screenCritical.add(Math.max(rosterPath, reviewsPath), tags);
  screenDb.add(sum('db'), tags);
  screenRequests.add(sum('requests'), tags);
  screenStmt.add(sum('stmt'), tags);
  screenTx.add(sum('tx'), tags);
  return { failed: chains.some((c) => c.failed) };
}
