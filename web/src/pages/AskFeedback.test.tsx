import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AskFeedback from "./AskFeedback";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;


function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

function renderAskFeedback(query = "?providerId=10&providerName=Manny%20Manager") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/ask${query}`]}>
          <Routes>
            <Route path="/feedback/ask" element={<AskFeedback />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("AskFeedback page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "3"); // me
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("redirects to the managers tab when providerId is missing", () => {
    renderAskFeedback("");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=managers");
    expect(screen.queryByRole("heading", { name: /ask for feedback/i })).toBeNull();
  });

  test("shows the provider and offers the requester-inclusive visibilities", async () => {
    renderAskFeedback();

    expect(screen.getByRole("heading", { name: /ask for feedback/i })).toBeInTheDocument();
    // The parties render as labeled persona displays (avatar chip / plain "You"), not inputs.
    expect(screen.getByText("Manny Manager")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    // Visibility is the only editable field — there is no content box.
    expect(screen.queryByLabelText("Content")).toBeNull();

    fireEvent.click(screen.getByLabelText("Visibility", { selector: "input" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Provider + requester",
      "Provider + requester + subject",
      "Public",
    ]);
  });

  test("submits a REQUESTED feedback with self as subject+requester and returns to managers", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url === "/api/v1/feedbacks" ? jsonResponse(201, { id: 99 }) : jsonResponse(404, {})),
    );
    const user = userEvent.setup();
    renderAskFeedback();

    await user.click(screen.getByRole("button", { name: /send request/i }));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      requesterId: 3,
      subjectId: 3,
      providerId: 10,
      visibility: "PROVIDER_REQUESTER_SUBJECT",
      status: "REQUESTED",
      content: "",
    });

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=managers"));
  });

  test("includes the trimmed requester message in the payload when filled", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url === "/api/v1/feedbacks" ? jsonResponse(201, { id: 99 }) : jsonResponse(404, {})),
    );
    const user = userEvent.setup();
    renderAskFeedback();

    await user.type(
      screen.getByLabelText("Message to the provider"),
      "  Please focus on my leadership skills  ",
    );
    await user.click(screen.getByRole("button", { name: /send request/i }));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      requesterId: 3,
      subjectId: 3,
      providerId: 10,
      visibility: "PROVIDER_REQUESTER_SUBJECT",
      status: "REQUESTED",
      content: "",
      requesterMessage: "Please focus on my leadership skills",
    });
  });

  test("honors an explicit back param on submit and discard", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url === "/api/v1/feedbacks" ? jsonResponse(201, { id: 99 }) : jsonResponse(404, {})),
    );
    const user = userEvent.setup();
    // back = "/?tab=peers", url-encoded
    renderAskFeedback(
      `?providerId=10&providerName=Manny%20Manager&back=${encodeURIComponent("/?tab=peers")}`,
    );

    // Discard link points back at the originating tab, not the managers default.
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: /discard/i })).toHaveAttribute(
      "href",
      "/?tab=peers",
    );
    await user.click(within(dialog).getByRole("button", { name: /keep editing/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Submitting also returns to the originating tab.
    await user.click(screen.getByRole("button", { name: /send request/i }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=peers"));
  });

  test("shows a permission error when the request is forbidden", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url === "/api/v1/feedbacks" ? jsonResponse(403, {}) : jsonResponse(404, {})),
    );
    const user = userEvent.setup();
    renderAskFeedback();

    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(await screen.findByText(/don't have permission to request/i)).toBeInTheDocument();
    // Stays on the page rather than navigating away.
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("maps 400 to a validation message and other statuses to a generic one", async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url === "/api/v1/feedbacks" ? jsonResponse(400, {}) : jsonResponse(404, {})),
    );
    const first = renderAskFeedback();
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(await screen.findByText(/validation error/i)).toBeInTheDocument();
    first.unmount();

    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(url === "/api/v1/feedbacks" ? jsonResponse(500, {}) : jsonResponse(404, {})),
    );
    renderAskFeedback();
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(await screen.findByText(/request failed \(500\)/i)).toBeInTheDocument();
  });
});
