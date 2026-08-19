import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import FeatureFlags from "./FeatureFlags";
import { theme } from "../theme";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderFeatureFlags() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/feature-flags"]}>
          <Routes>
            <Route path="/feature-flags" element={<FeatureFlags />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const USERS = [
  {
    id: 1,
    name: "Alice",
    email: "alice@example.com",
    roles: [],
    disabledFeatures: [] as string[],
    teams: [
      { id: 5, name: "AAA" },
      { id: 6, name: "BBB" },
    ],
  },
  {
    id: 2,
    name: "Bob",
    email: "bob@example.com",
    roles: [],
    disabledFeatures: ["FEEDBACKS"] as string[],
    teams: [] as { id: number; name: string }[],
  },
];

const TEAMS = [
  { id: 5, name: "AAA", managerId: 9 },
  { id: 6, name: "BBB", managerId: 9 },
];

describe("FeatureFlags page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function mockApi({ items = USERS, putStatus = 204 }: { items?: typeof USERS; putStatus?: number } = {}) {
    mockFetch.mockImplementation((input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        return Promise.resolve(
          putStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putStatus, { title: "err", status: putStatus }),
        );
      }
      if (String(input).startsWith("/api/v1/teams")) {
        return Promise.resolve(
          jsonResponse(200, { items: TEAMS, page: 1, pageSize: 100, total: TEAMS.length }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length }),
      );
    });
  }

  function lastListUrl(): URL {
    const getCalls = mockFetch.mock.calls.filter(
      ([input, init]) =>
        ((init as RequestInit)?.method ?? "GET") === "GET" && String(input).startsWith("/api/v1/users"),
    );
    return new URL(String(getCalls[getCalls.length - 1]![0]), "http://localhost");
  }

  function putCalls() {
    return mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
  }

  test("renders per-user switches reflecting the picked feature's state", async () => {
    mockApi();
    renderFeatureFlags();

    // Default feature: FEEDBACKS. Bob has it disabled, Alice enabled.
    const aliceSwitch = (await screen.findByRole("switch", {
      name: "Toggle Feedbacks for Alice",
    })) as HTMLInputElement;
    // The heading carries the data-tour anchor for the (admin-only) Config → Feature flags step.
    expect(screen.getByRole("heading", { name: "Feature flags" })).toHaveAttribute(
      "data-tour",
      "config-feature-flags",
    );
    expect(aliceSwitch.checked).toBe(true);
    expect(
      (screen.getByRole("switch", { name: "Toggle Feedbacks for Bob" }) as HTMLInputElement).checked,
    ).toBe(false);
    // The "any" state deliberately sends NEITHER pair param.
    const url = lastListUrl();
    expect(url.searchParams.get("feature")).toBeNull();
    expect(url.searchParams.get("featureEnabled")).toBeNull();
  });

  test("the state filter sends the feature/featureEnabled pair", async () => {
    mockApi();
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    // The filter panel starts collapsed — open it first (the Alerts.test idiom).
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(screen.getByRole("combobox", { name: "State" }));
    await user.click(await screen.findByRole("option", { name: "Disabled" }));

    await waitFor(() => {
      const url = lastListUrl();
      expect(url.searchParams.get("feature")).toBe("FEEDBACKS");
      expect(url.searchParams.get("featureEnabled")).toBe("false");
    });
  });

  test("toggling a row PUTs the wholesale toggled set and toasts", async () => {
    mockApi();
    const showSpy = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderFeatureFlags();

    await user.click(await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      expect(putCall![0]).toBe("/api/v1/users/1/features");
      expect(JSON.parse((putCall![1] as { body: string }).body)).toEqual({
        disabledFeatures: ["FEEDBACKS"],
      });
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Features saved" }));
  });

  test("re-enabling drops only the picked feature from the row's set", async () => {
    mockApi({
      items: [
        {
          id: 3,
          name: "Cara",
          email: "cara@example.com",
          roles: [],
          disabledFeatures: ["FEEDBACKS", "GOALS"],
          teams: [],
        },
      ],
    });
    const user = userEvent.setup();
    renderFeatureFlags();

    await user.click(await screen.findByRole("switch", { name: "Toggle Feedbacks for Cara" }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      expect(JSON.parse((putCall![1] as { body: string }).body)).toEqual({
        disabledFeatures: ["GOALS"],
      });
    });
  });

  test("a failing toggle shows an inline error", async () => {
    mockApi({ putStatus: 403 });
    const user = userEvent.setup();
    renderFeatureFlags();

    await user.click(await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" }));
    expect(
      await screen.findByText("You don't have permission to change this user's features."),
    ).toBeInTheDocument();
  });

  test("switching the feature relabels the switches", async () => {
    mockApi();
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(screen.getByRole("combobox", { name: "Feature" }));
    await user.click(await screen.findByRole("option", { name: "Goals" }));

    const goalsSwitch = (await screen.findByRole("switch", {
      name: "Toggle Goals for Bob",
    })) as HTMLInputElement;
    // Bob's disabled set holds FEEDBACKS only — his Goals flag is on.
    expect(goalsSwitch.checked).toBe(true);
  });

  test("rows show member-of team badges, a dash when none", async () => {
    mockApi();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    const table = screen.getByRole("table");
    expect(within(table).getByText("AAA")).toBeInTheDocument();
    expect(within(table).getByText("BBB")).toBeInTheDocument();
    // Bob is in no team — his row renders the dash placeholder.
    expect(within(table).getByText("—")).toBeInTheDocument();
  });

  test("user names link to their details view — except one's own row", async () => {
    localStorage.setItem(USER_ID_KEY, "1"); // the viewer is Alice
    mockApi();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    expect(screen.getByRole("link", { name: "User details for Bob" })).toHaveAttribute(
      "href",
      "/users/2/details?name=Bob&from=users",
    );
    // Self stays a plain chip (the Users-list rule).
    expect(screen.queryByRole("link", { name: "User details for Alice" })).not.toBeInTheDocument();
  });

  test("the team filter sends teamId", async () => {
    mockApi();
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(screen.getByRole("combobox", { name: "Team" }));
    await user.click(await screen.findByRole("option", { name: "BBB" }));

    await waitFor(() => {
      expect(lastListUrl().searchParams.get("teamId")).toBe("6");
    });
  });

  test("bulk disable confirms with the affected count and PUTs only rows not already disabled", async () => {
    mockApi();
    const showSpy = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    // Bob already has FEEDBACKS disabled — only Alice is affected.
    await user.click(screen.getByRole("button", { name: "Disable for all matching" }));
    expect(
      await screen.findByText("This will disable Feedbacks for 1 user."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      const puts = putCalls();
      expect(puts).toHaveLength(1);
      expect(puts[0]![0]).toBe("/api/v1/users/1/features");
      expect(JSON.parse((puts[0]![1] as { body: string }).body)).toEqual({
        disabledFeatures: ["FEEDBACKS"],
      });
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Features saved" }));
    // The modal is gone after the run.
    expect(screen.queryByText("Bulk change")).toBeNull();
  });

  test("bulk enable targets only the disabled rows", async () => {
    mockApi();
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    await user.click(screen.getByRole("button", { name: "Enable for all matching" }));
    expect(
      await screen.findByText("This will enable Feedbacks for 1 user."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      const puts = putCalls();
      expect(puts).toHaveLength(1);
      expect(puts[0]![0]).toBe("/api/v1/users/2/features");
      expect(JSON.parse((puts[0]![1] as { body: string }).body)).toEqual({
        disabledFeatures: [],
      });
    });
  });

  test("bulk with nothing to change toasts and never opens the modal", async () => {
    mockApi({
      items: [
        {
          id: 1,
          name: "Alice",
          email: "alice@example.com",
          roles: [],
          disabledFeatures: [],
          teams: [],
        },
      ],
    });
    const showSpy = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    // Everyone already has FEEDBACKS enabled.
    await user.click(screen.getByRole("button", { name: "Enable for all matching" }));
    await waitFor(() => {
      expect(showSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Nothing to change — every matching user is already in that state.",
        }),
      );
    });
    expect(screen.queryByText("Bulk change")).toBeNull();
    expect(putCalls()).toHaveLength(0);
  });

  test("a bulk partial failure names the failed users and Retry re-runs exactly them", async () => {
    // Both users start enabled; Bob's PUT fails until the retry.
    const bothEnabled = USERS.map((u) => ({ ...u, disabledFeatures: [] as string[] }));
    let failBob = true;
    mockFetch.mockImplementation((input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        return Promise.resolve(
          failBob && String(input).includes("/users/2/")
            ? jsonResponse(500, { status: 500 })
            : new Response(null, { status: 204 }),
        );
      }
      if (String(input).startsWith("/api/v1/teams")) {
        return Promise.resolve(jsonResponse(200, { items: TEAMS, page: 1, pageSize: 100, total: TEAMS.length }));
      }
      return Promise.resolve(jsonResponse(200, { items: bothEnabled, page: 1, pageSize: 20, total: 2 }));
    });
    const showSpy = vi.spyOn(notifications, "show");
    // The spy instance persists across this file's tests (never restored) — drop their calls.
    showSpy.mockClear();
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    await user.click(screen.getByRole("button", { name: "Disable for all matching" }));
    expect(await screen.findByText("This will disable Feedbacks for 2 users.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disable" }));

    // Alice's PUT landed; Bob failed — named in the alert, no success toast.
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The change failed for 1 user — the others were updated:")).toBeInTheDocument();
    expect(within(alert).getByText("Bob")).toBeInTheDocument();
    expect(putCalls()).toHaveLength(2);
    expect(showSpy).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Features saved" }));

    // Retry re-PUTs ONLY Bob; on success the alert clears and the toast fires.
    failBob = false;
    await user.click(within(alert).getByRole("button", { name: "Retry the failed users" }));
    await waitFor(() => expect(putCalls()).toHaveLength(3));
    expect(putCalls()[2]![0]).toBe("/api/v1/users/2/features");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Features saved" }));
  });

  test("a failed bulk prepare surfaces an error and never opens the modal", async () => {
    let failLists = false;
    mockFetch.mockImplementation((input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (String(input).startsWith("/api/v1/teams")) {
        return Promise.resolve(jsonResponse(200, { items: TEAMS, page: 1, pageSize: 100, total: TEAMS.length }));
      }
      if (method === "GET" && failLists) return Promise.resolve(jsonResponse(500, { status: 500 }));
      return Promise.resolve(jsonResponse(200, { items: USERS, page: 1, pageSize: 20, total: USERS.length }));
    });
    const user = userEvent.setup();
    renderFeatureFlags();
    await screen.findByRole("switch", { name: "Toggle Feedbacks for Alice" });

    failLists = true;
    await user.click(screen.getByRole("button", { name: "Enable for all matching" }));

    expect(await screen.findByText("Saving features failed (500)")).toBeInTheDocument();
    expect(screen.queryByText("Bulk change")).toBeNull();
    expect(putCalls()).toHaveLength(0);
  });

  test("a non-admin is redirected home", () => {
    localStorage.setItem(ROLE_KEY, "[]");
    mockApi();
    renderFeatureFlags();
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
  });

  test("an empty result renders the empty state", async () => {
    mockApi({ items: [] });
    renderFeatureFlags();
    expect(await screen.findByText("No users")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryAllByRole("switch")).toHaveLength(0);
  });
});
