import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateAlert from "./CreateAlert";
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

function renderCreateAlert() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/alerts/new"]}>
          <Routes>
            <Route path="/alerts/new" element={<CreateAlert />} />
            <Route path="/alerts" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateAlert page", () => {
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

  test("successful create POSTs the body with epoch bounds and navigates to /alerts", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/alerts") {
        return Promise.resolve(
          jsonResponse(201, {
            id: 7,
            title: "Maintenance",
            content: "Down",
            isActive: true,
            startsAt: null,
            endsAt: null,
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateAlert();

    await user.type(screen.getByLabelText("Title"), "Maintenance");
    const content = await screen.findByLabelText("Content");
    await user.type(content, "Down");
    // Both bounds are opt-in: the datetime inputs stay disabled until their checkbox is set.
    // Checkbox and input share the accessible name, so queries disambiguate by role/selector.
    const fromInput = screen.getByLabelText(/visible from/i, { selector: "input[type='datetime-local']" });
    const untilInput = screen.getByLabelText(/visible until/i, { selector: "input[type='datetime-local']" });
    expect(fromInput).toBeDisabled();
    expect(untilInput).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /visible from/i }));
    await user.click(screen.getByRole("checkbox", { name: /visible until/i }));
    await user.type(fromInput, "2026-07-01T08:00");
    await user.type(untilInput, "2026-07-02T08:00");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/alerts"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => (init as RequestInit | undefined)?.method === "POST" && url === "/api/v1/alerts",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.title).toBe("Maintenance");
    expect(body.content).toBe("Down");
    expect(body.isActive).toBe(true);
    // datetime-local strings are converted to epoch millis (local timezone).
    expect(body.startsAt).toBe(new Date("2026-07-01T08:00").getTime());
    expect(body.endsAt).toBe(new Date("2026-07-02T08:00").getTime());
  });

  test("client-side validation rejects an empty title and content without a POST", async () => {
    const user = userEvent.setup();
    renderCreateAlert();

    await screen.findByLabelText("Content");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/title must be 1–150 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/content must not be empty/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("client-side validation rejects an end before the start", async () => {
    const user = userEvent.setup();
    renderCreateAlert();

    await user.type(screen.getByLabelText("Title"), "Window");
    const content = await screen.findByLabelText("Content");
    await user.type(content, "x");
    await user.click(screen.getByRole("checkbox", { name: /visible from/i }));
    await user.click(screen.getByRole("checkbox", { name: /visible until/i }));
    await user.type(
      screen.getByLabelText(/visible from/i, { selector: "input[type='datetime-local']" }),
      "2026-07-02T08:00",
    );
    await user.type(
      screen.getByLabelText(/visible until/i, { selector: "input[type='datetime-local']" }),
      "2026-07-01T08:00",
    );
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/must be after/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a checked bound with no value blocks the submit without a POST", async () => {
    const user = userEvent.setup();
    renderCreateAlert();

    await user.type(screen.getByLabelText("Title"), "Incomplete");
    await user.type(await screen.findByLabelText("Content"), "x");
    await user.click(screen.getByRole("checkbox", { name: /visible from/i }));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/pick a date and time/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("unchecked bounds are sent as null", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/alerts") {
        return Promise.resolve(
          jsonResponse(201, {
            id: 8,
            title: "Unbounded",
            content: "x",
            isActive: true,
            startsAt: null,
            endsAt: null,
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateAlert();

    await user.type(screen.getByLabelText("Title"), "Unbounded");
    await user.type(await screen.findByLabelText("Content"), "x");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/alerts"));
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => (init as RequestInit | undefined)?.method === "POST" && url === "/api/v1/alerts",
    );
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.startsAt).toBeNull();
    expect(body.endsAt).toBeNull();
  });

  test("a 400 from the server shows the validation error alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/alerts") {
        return Promise.resolve(jsonResponse(400, { title: "Bad Request" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateAlert();

    await user.type(screen.getByLabelText("Title"), "Broken");
    await user.type(await screen.findByLabelText("Content"), "x");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/the alert data is invalid/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("a network error shows the network alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/alerts") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateAlert();

    await user.type(screen.getByLabelText("Title"), "Offline");
    await user.type(await screen.findByLabelText("Content"), "x");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });

  test("Cancel opens a discard confirmation whose Discard links back to /alerts", async () => {
    const user = userEvent.setup();
    renderCreateAlert();

    await screen.findByLabelText("Content");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByText(/discard changes\?/i)).toBeInTheDocument();
    expect(
      screen.getByText(/any unsaved changes to this alert will be lost/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /discard/i })).toHaveAttribute("href", "/alerts");
  });

  test("non-admin is redirected away without rendering the form", () => {
    localStorage.setItem(ROLE_KEY, "USER");
    renderCreateAlert();

    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
