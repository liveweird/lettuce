import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SelfReflection from "./SelfReflection";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea (see mockMarkdownEditor). Import inside the
// (hoisted) factory to avoid the top-level-variable restriction.
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return (
    <div data-testid="probe">{`${location.pathname}${location.search}`}</div>
  );
}

function renderSelfReflection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/feedback/self"]}>
          <Routes>
            <Route path="/feedback/self" element={<SelfReflection />} />
            <Route path="/feedback" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("SelfReflection page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("shows the title and both parties as You with default visibility", () => {
    renderSelfReflection();
    expect(screen.getByText("Self-reflection")).toBeInTheDocument();
    // Provider and subject are both the current user — two plain "You" texts.
    expect(screen.getAllByText("You")).toHaveLength(2);
    expect((screen.getByPlaceholderText("Select visibility") as HTMLInputElement).value).toBe(
      "Provider + subject",
    );
  });

  test("visibility offers only Provider+subject and Public", async () => {
    const user = userEvent.setup();
    renderSelfReflection();

    await user.click(screen.getByPlaceholderText("Select visibility"));
    // The Template select's listbox is empty in this test, so the only options in the
    // DOM are the visibility ones.
    const options = (await screen.findAllByRole("option", { hidden: true })).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["Provider + subject", "Public"]);
  });

  test("Save draft submits provider == subject with no requester and returns to the provided tab", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(201, { id: 99 })));
    const user = userEvent.setup();
    renderSelfReflection();

    await user.type(screen.getByLabelText("Content"), "I should delegate more");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=provided"),
    );

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      subjectId: 7,
      providerId: 7,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: "I should delegate more",
    });
    expect("requesterId" in body).toBe(false);
  });

  test("Save & send submits with status SENT", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(201, { id: 101 })));
    const user = userEvent.setup();
    renderSelfReflection();

    await user.type(screen.getByLabelText("Content"), "Quarterly self-review");
    await user.click(screen.getByRole("button", { name: /save & send/i }));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=provided"),
    );

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.status).toBe("SENT");
    expect(body.subjectId).toBe(7);
    expect(body.providerId).toBe(7);
  });

  test("surfaces an error alert when the API rejects the feedback", async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { error: "bad_request", message: "nope" }));
    const user = userEvent.setup();
    renderSelfReflection();

    await user.type(screen.getByLabelText("Content"), "x");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    expect(await screen.findByText(/validation error/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("redirects to the dashboard when not signed in", () => {
    localStorage.removeItem(USER_ID_KEY);
    renderSelfReflection();
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
