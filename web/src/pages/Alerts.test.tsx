import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Alerts from "./Alerts";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;

type AlertItem = {
  id: number;
  title: string;
  content: string;
  isActive: boolean;
  startsAt: number | null;
  endsAt: number | null;
};

function alertsPage(items: AlertItem[], total = items.length) {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total });
}

const SEED: AlertItem[] = [
  {
    id: 1,
    title: "Maintenance",
    content: "Down tonight",
    isActive: true,
    startsAt: Date.UTC(2026, 0, 1, 12, 0),
    endsAt: null,
  },
  { id: 2, title: "Old news", content: "Past", isActive: false, startsAt: null, endsAt: null },
];

function setupMocks(mockFetch: FetchMock, listByUrl: (url: string) => Response) {
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/alerts?")) return Promise.resolve(listByUrl(url));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderAlerts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/alerts"]}>
          <Routes>
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("Alerts page", () => {
  let mockFetch: FetchMock;

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

  test("renders rows with title, active badge and formatted/empty bounds", async () => {
    setupMocks(mockFetch, () => alertsPage(SEED));
    renderAlerts();

    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Old news")).toBeInTheDocument();
    // The heading carries the data-tour anchor for the (admin-only) Config → Alerts step.
    expect(screen.getByRole("heading", { name: "Alerts" })).toHaveAttribute(
      "data-tour",
      "config-alerts",
    );
    // Active flag renders as a Yes/No badge.
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    // An unset bound renders as an em-dash; a set one as a local timestamp.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/alerts\?/),
      expect.any(Object),
    );
  });

  test("non-admin is redirected away and no list call is made", () => {
    localStorage.setItem(ROLE_KEY, "[]");
    setupMocks(mockFetch, () => alertsPage(SEED));
    renderAlerts();

    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("typing in the Title filter triggers a refetch with title=", async () => {
    setupMocks(mockFetch, () => alertsPage(SEED));
    const user = userEvent.setup();
    renderAlerts();

    await screen.findByText("Maintenance");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Title"), "Main");

    await waitFor(
      () => {
        const called = mockFetch.mock.calls.some(
          ([url]) =>
            typeof url === "string" &&
            url.startsWith("/api/v1/alerts?") &&
            url.includes("title=Main"),
        );
        expect(called).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  test("selecting the Active filter refetches with isActive=", async () => {
    setupMocks(mockFetch, () => alertsPage(SEED));
    const user = userEvent.setup();
    renderAlerts();

    await screen.findByText("Maintenance");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    // happy-dom does not open Mantine comboboxes via userEvent's pointer simulation.
    fireEvent.click(screen.getByLabelText("Active", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Yes" }));

    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" &&
          url.startsWith("/api/v1/alerts?") &&
          url.includes("isActive=true"),
      );
      expect(called).toBe(true);
    });
  });

  test("toggling the Title sort header refetches with sort=title", async () => {
    setupMocks(mockFetch, () => alertsPage(SEED));
    const user = userEvent.setup();
    renderAlerts();

    await screen.findByText("Maintenance");
    await user.click(screen.getByRole("button", { name: /^title$/i }));

    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" &&
          url.startsWith("/api/v1/alerts?") &&
          url.includes("sort=title"),
      );
      expect(called).toBe(true);
    });
  });

  test("shows the empty state when the API returns zero items", async () => {
    setupMocks(mockFetch, () => alertsPage([], 0));
    renderAlerts();

    expect(await screen.findByText(/no alerts/i)).toBeInTheDocument();
  });

  test("load failure surfaces a 'Failed to load alerts' alert", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/alerts?")) {
        return Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderAlerts();

    expect(await screen.findByText(/failed to load alerts/i)).toBeInTheDocument();
  });

  test("shows a 'New alert' link pointing at /alerts/new and Edit links per row", async () => {
    setupMocks(mockFetch, () => alertsPage(SEED));
    renderAlerts();

    await screen.findByText("Maintenance");
    expect(screen.getByRole("link", { name: /new alert/i })).toHaveAttribute(
      "href",
      "/alerts/new",
    );
    const editLinks = screen.getAllByRole("link", { name: /^edit /i });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0]).toHaveAttribute("href", "/alerts/1/edit");
  });

  test("confirming a delete triggers DELETE /api/v1/alerts/:id and refetches", async () => {
    let listCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && /^\/api\/v1\/alerts\/\d+$/.test(url)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.startsWith("/api/v1/alerts?")) {
        listCount++;
        return Promise.resolve(alertsPage(listCount === 1 ? SEED : [SEED[0]]));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderAlerts();

    await user.click(await screen.findByRole("button", { name: /delete old news/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByText("Old news")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" &&
        url === "/api/v1/alerts/2",
    );
    expect(deleteCall).toBeDefined();
    expect(listCount).toBeGreaterThanOrEqual(2);
  });

  test("Cancel in the delete modal closes it without calling DELETE", async () => {
    setupMocks(mockFetch, () => alertsPage(SEED));
    const user = userEvent.setup();
    renderAlerts();

    await user.click(await screen.findByRole("button", { name: /delete old news/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeUndefined();
  });
});
