import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditAlert from "./EditAlert";
import { epochToDatetimeLocal } from "../utils/datetime";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea; the real wrapper is covered by
// MarkdownEditor.test.tsx.
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderEditAlert(entry = "/alerts/5/edit") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/alerts/:id/edit" element={<EditAlert />} />
            <Route path="/alerts" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const STARTS = Date.UTC(2026, 5, 1, 10, 0);
const LOADED = {
  id: 5,
  title: "Loaded Title",
  content: "# Loaded",
  isActive: false,
  startsAt: STARTS,
  endsAt: null,
};

function getReturns(mockFetch: ReturnType<typeof vi.fn>, response: Response) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/v1/alerts/5") return Promise.resolve(response);
    return Promise.resolve(jsonResponse(404, {}));
  });
}

describe("EditAlert page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("loads the alert and populates all form fields", async () => {
    getReturns(mockFetch, jsonResponse(200, LOADED));
    renderEditAlert();

    expect(await screen.findByDisplayValue("Loaded Title")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("# Loaded")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    // Bounds render as local datetime-local strings; the unset end stays empty.
    expect(screen.getByLabelText(/visible from/i)).toHaveValue(epochToDatetimeLocal(STARTS));
    expect(screen.getByLabelText(/visible until/i)).toHaveValue("");
  });

  test("404 shows the not-found message with a back link", async () => {
    getReturns(mockFetch, jsonResponse(404, { title: "Not Found" }));
    renderEditAlert();

    expect(await screen.findByText(/does not exist or was deleted/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to alerts/i })).toBeInTheDocument();
  });

  test("a non-404 load error shows the failed-to-load alert", async () => {
    getReturns(mockFetch, jsonResponse(500, { title: "Internal" }));
    renderEditAlert();

    expect(await screen.findByText(/failed to load the alert/i)).toBeInTheDocument();
  });

  test("successful save PUTs all fields and navigates to /alerts", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/v1/alerts/5") {
        return Promise.resolve(jsonResponse(200, LOADED));
      }
      if (method === "PUT" && url === "/api/v1/alerts/5") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditAlert();

    const title = await screen.findByDisplayValue("Loaded Title");
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/alerts"));

    const putCall = mockFetch.mock.calls.find(
      ([url, init]) => (init as RequestInit | undefined)?.method === "PUT" && url === "/api/v1/alerts/5",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      title: "Renamed",
      content: "# Loaded",
      isActive: true,
      startsAt: STARTS,
      endsAt: null,
    });
  });

  test("404 on save shows 'no longer exists'", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/v1/alerts/5") {
        return Promise.resolve(jsonResponse(200, LOADED));
      }
      if (method === "PUT" && url === "/api/v1/alerts/5") {
        return Promise.resolve(jsonResponse(404, { title: "Not Found" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditAlert();

    await screen.findByDisplayValue("Loaded Title");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
  });

  test("non-admin is redirected away", () => {
    localStorage.setItem(ROLE_KEY, "USER");
    renderEditAlert();
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("an invalid id redirects to /alerts", () => {
    renderEditAlert("/alerts/abc/edit");
    expect(screen.getByTestId("probe")).toHaveTextContent("/alerts");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
