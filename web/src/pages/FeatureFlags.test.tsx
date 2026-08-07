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
  { id: 1, name: "Alice", email: "alice@example.com", roles: [], disabledFeatures: [] as string[] },
  { id: 2, name: "Bob", email: "bob@example.com", roles: [], disabledFeatures: ["FEEDBACKS"] as string[] },
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
    mockFetch.mockImplementation((_input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        return Promise.resolve(
          putStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putStatus, { title: "err", status: putStatus }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length }),
      );
    });
  }

  function lastListUrl(): URL {
    const getCalls = mockFetch.mock.calls.filter(
      ([, init]) => ((init as RequestInit)?.method ?? "GET") === "GET",
    );
    return new URL(String(getCalls[getCalls.length - 1]![0]), "http://localhost");
  }

  test("renders per-user switches reflecting the picked feature's state", async () => {
    mockApi();
    renderFeatureFlags();

    // Default feature: FEEDBACKS. Bob has it disabled, Alice enabled.
    const aliceSwitch = (await screen.findByRole("switch", {
      name: "Toggle Feedbacks for Alice",
    })) as HTMLInputElement;
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
