// The perf runner's target and its fail-fast guard. Deliberately NOT a Playwright globalSetup: the e2e suite's
// global-setup would `docker compose up -d --build` the DEV project when its target is down (the standing-rule trap).
// This runner never starts, stops or seeds anything — it only checks that the perf stack already answers.
export const PERF_BASE_URL = process.env.PERF_BASE_URL ?? "http://localhost:18080";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `host:port` of the target — what is logged and written into the result files (never the full URL). */
export function perfHost(): string {
  return new URL(PERF_BASE_URL).host;
}

/** Throws a plain-language error unless the target is a local server that answers /readyz. */
export async function assertPerfTargetReady(): Promise<void> {
  const url = new URL(PERF_BASE_URL);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `PERF_BASE_URL must be a local address (localhost / 127.0.0.1), got host ${url.host}: the perf runner signs in as ` +
        `the generated perf accounts and is meant for the local perf stack only.`,
    );
  }
  let status: number;
  try {
    status = (await fetch(new URL("/readyz", url), { signal: AbortSignal.timeout(5_000) })).status;
  } catch {
    throw new Error(
      `The perf target ${url.host} does not answer /readyz. This runner never starts a stack — run 'perf/run.sh up' ` +
        `(or 'perf/run.sh restore') first, or point PERF_BASE_URL at a running server.`,
    );
  }
  if (status !== 200) {
    throw new Error(`The perf target ${url.host} answered /readyz with HTTP ${status} — it is not ready.`);
  }
}
