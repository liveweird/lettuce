import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createTeamManagerPeriod,
  createTeamMembership,
  deleteTeamManagerPeriod,
  deleteTeamMembership,
  listAllTeams,
  listTeamManagerPeriods,
  listTeamMemberships,
  updateTeamManagerPeriod,
  updateTeamMembership,
} from "./teams";
import { getUserTeamHistory } from "./users";
import { jsonResponse } from "../test/http";

describe("dated team structure API wrappers (v4.17.0)", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function stub(response: () => Response = () => new Response(null, { status: 204 })) {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("listAllTeams passes asOf (and omits it by default)", async () => {
    const fetchMock = stub(() => jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 }));
    await listAllTeams({ asOf: "2025-03-01" });
    await listAllTeams();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/teams?page=1&pageSize=100&sort=name&asOf=2025-03-01");
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/v1/teams?page=1&pageSize=100&sort=name");
  });

  test("membership wrappers hit the sub-resource with the right verbs and bodies", async () => {
    const row = { id: 3, userId: 5, userName: "A", userDeleted: false, deactivated: false, startDate: null, endDate: null, current: true };
    const fetchMock = stub(() => jsonResponse(200, { items: [row] }));
    expect(await listTeamMemberships(2)).toEqual([row]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/teams/2/memberships");

    const create = stub(() => jsonResponse(201, row));
    await createTeamMembership(2, { userId: 5, startDate: "2026-01-01", endDate: null });
    expect(String(create.mock.calls[0][0])).toBe("/api/v1/teams/2/memberships");
    expect(create.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(create.mock.calls[0][1]?.body))).toEqual({ userId: 5, startDate: "2026-01-01", endDate: null });

    const update = stub();
    await updateTeamMembership(2, 3, { startDate: null, endDate: "2026-02-01" });
    expect(String(update.mock.calls[0][0])).toBe("/api/v1/teams/2/memberships/3");
    expect(update.mock.calls[0][1]?.method).toBe("PUT");
    expect(JSON.parse(String(update.mock.calls[0][1]?.body))).toEqual({ startDate: null, endDate: "2026-02-01" });

    const del = stub();
    await deleteTeamMembership(2, 3);
    expect(String(del.mock.calls[0][0])).toBe("/api/v1/teams/2/memberships/3");
    expect(del.mock.calls[0][1]?.method).toBe("DELETE");
  });

  test("manager-period wrappers hit the sub-resource with the right verbs and bodies", async () => {
    const row = { id: 4, managerId: 9, managerName: "M", managerDeleted: false, startDate: null, endDate: null, current: true };
    const list = stub(() => jsonResponse(200, { items: [row] }));
    expect(await listTeamManagerPeriods(2)).toEqual([row]);
    expect(String(list.mock.calls[0][0])).toBe("/api/v1/teams/2/managers");

    const create = stub(() => jsonResponse(201, row));
    await createTeamManagerPeriod(2, { managerId: 9, startDate: "2026-05-01" });
    expect(create.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(create.mock.calls[0][1]?.body))).toEqual({ managerId: 9, startDate: "2026-05-01" });

    const update = stub();
    await updateTeamManagerPeriod(2, 4, { managerId: 8, startDate: null });
    expect(String(update.mock.calls[0][0])).toBe("/api/v1/teams/2/managers/4");
    expect(update.mock.calls[0][1]?.method).toBe("PUT");

    const del = stub();
    await deleteTeamManagerPeriod(2, 4);
    expect(String(del.mock.calls[0][0])).toBe("/api/v1/teams/2/managers/4");
    expect(del.mock.calls[0][1]?.method).toBe("DELETE");
  });

  test("getUserTeamHistory reads the person's team history", async () => {
    const body = { memberships: [], managerPeriods: [] };
    const fetchMock = stub(() => jsonResponse(200, body));
    expect(await getUserTeamHistory(7)).toEqual(body);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/users/7/team-history");
  });
});
