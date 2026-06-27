import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditFeedback from "./EditFeedback";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FEEDBACK = {
  id: 5,
  requesterId: null,
  subjectId: 8,
  providerId: 7,
  visibility: "PROVIDER_SUBJECT",
  status: "DRAFT",
  content: "Initial thoughts",
};

// A pending request (provider = caller 7). The detail endpoint resolves party names.
const REQUESTED_FEEDBACK = {
  id: 5,
  requesterId: 9,
  subjectId: 8,
  providerId: 7,
  visibility: "PROVIDER_REQUESTER_SUBJECT",
  status: "REQUESTED",
  content: "",
  requesterName: "Rita Requester",
  subjectName: "Sam Subject",
  providerName: "Pat Provider",
};
const ACCEPTED_DRAFT = { ...REQUESTED_FEEDBACK, status: "DRAFT" };

function renderEditFeedback(query = "?subjectName=Mona") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/5/edit${query}`]}>
          <Routes>
            <Route path="/feedback/:id/edit" element={<EditFeedback />} />
            <Route path="/feedback" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("EditFeedback page", () => {
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

  test("pre-fills the form from the loaded feedback", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    renderEditFeedback();

    expect((await screen.findByLabelText("Content")) as HTMLTextAreaElement).toHaveValue(
      "Initial thoughts",
    );
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Mona");
    expect((screen.getByPlaceholderText("Select visibility") as HTMLInputElement).value).toBe(
      "Provider + subject",
    );
    // No requester on this feedback → no Requester field.
    expect(screen.queryByLabelText("Requester")).toBeNull();
  });

  test("with a requester, visibility offers the requester options and shows a read-only Requester", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, ACCEPTED_DRAFT));
    const user = userEvent.setup();
    renderEditFeedback();

    // ACCEPTED_DRAFT is a DRAFT with a requester, so the editor (not the triage screen) renders.
    const visibility = (await screen.findByPlaceholderText(
      "Select visibility",
    )) as HTMLInputElement;
    expect(visibility.value).toBe("Provider + requester + subject");

    // The resolved requester name is shown read-only.
    const requester = screen.getByLabelText("Requester") as HTMLInputElement;
    expect(requester.value).toBe("Rita Requester");
    expect(requester).toBeDisabled();

    await user.click(visibility);
    // The Template select's listbox is empty here, so the only options in the DOM are visibility's.
    const options = (await screen.findAllByRole("option", { hidden: true })).map(
      (o) => o.textContent,
    );
    expect(options).toEqual([
      "Provider + requester",
      "Provider + requester + subject",
      "Public",
    ]);
  });

  test("Save draft PUTs status DRAFT preserving the immutable ids", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT" && url === "/api/feedbacks/5") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, FEEDBACK));
    });
    const user = userEvent.setup();
    renderEditFeedback();

    const content = (await screen.findByLabelText("Content")) as HTMLTextAreaElement;
    await user.clear(content);
    await user.type(content, "Revised note");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=provided"));

    const put = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/feedbacks/5" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(put).toBeDefined();
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
      requesterId: null,
      subjectId: 8,
      providerId: 7,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: "Revised note",
    });
  });

  test("a 403 on save shows a permission error and stays on the editor", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT" && url === "/api/feedbacks/5") {
        return Promise.resolve(jsonResponse(403, { error: "forbidden", message: "no" }));
      }
      return Promise.resolve(jsonResponse(200, FEEDBACK));
    });
    const user = userEvent.setup();
    renderEditFeedback();

    await screen.findByLabelText("Content");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    expect(await screen.findByText(/don't have permission to edit this feedback/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull(); // no navigation on error
  });

  test("Save & send PUTs status SENT", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT" && url === "/api/feedbacks/5") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, FEEDBACK));
    });
    const user = userEvent.setup();
    renderEditFeedback();

    await screen.findByLabelText("Content");
    await user.click(screen.getByRole("button", { name: /save & send/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([url, init]) =>
          url === "/api/feedbacks/5" && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string).status).toBe("SENT");
    });
  });

  test("Cancel → Discard returns to the provided tab without saving", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    const user = userEvent.setup();
    renderEditFeedback();

    await screen.findByLabelText("Content");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=provided"));
    const put = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(put).toBeUndefined();
  });

  test("404 on load shows a not-found alert with a back link", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { error: "not_found", message: "missing" }));
    renderEditFeedback();

    expect(await screen.findByText(/feedback not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to feedback/i })).toHaveAttribute(
      "href",
      "/feedback?tab=provided",
    );
  });

  test("a REQUESTED feedback shows the decision screen, not the editor", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, REQUESTED_FEEDBACK));
    renderEditFeedback();

    await screen.findByRole("heading", { name: /feedback request/i });
    // No editor in this state.
    expect(screen.queryByLabelText("Content")).toBeNull();
    expect(screen.queryByRole("button", { name: /save & send/i })).toBeNull();
    // The three decision actions, with the resolved requester name.
    expect(screen.getByRole("button", { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Requester")).toHaveValue("Rita Requester");
  });

  test("Accept PUTs DRAFT and reloads in place as the editor", async () => {
    let accepted = false;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT" && url === "/api/feedbacks/5") {
        accepted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, accepted ? ACCEPTED_DRAFT : REQUESTED_FEEDBACK));
    });
    const user = userEvent.setup();
    renderEditFeedback();

    await screen.findByRole("heading", { name: /feedback request/i });
    await user.click(screen.getByRole("button", { name: /^accept$/i }));

    // The screen reloads in place into the editor — never navigates away.
    expect(await screen.findByLabelText("Content")).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();

    const put = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/feedbacks/5" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(JSON.parse((put![1] as RequestInit).body as string).status).toBe("DRAFT");
  });

  test("Reject → confirm → PUTs REJECTED and returns to the provided tab", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT" && url === "/api/feedbacks/5") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, REQUESTED_FEEDBACK));
    });
    const user = userEvent.setup();
    renderEditFeedback();

    await screen.findByRole("heading", { name: /feedback request/i });
    await user.click(screen.getByRole("button", { name: /^reject$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^reject$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=provided"));
    const put = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/feedbacks/5" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(JSON.parse((put![1] as RequestInit).body as string).status).toBe("REJECTED");
  });

  test("Close returns to the provided tab without saving", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, REQUESTED_FEEDBACK));
    const user = userEvent.setup();
    renderEditFeedback();

    await screen.findByRole("heading", { name: /feedback request/i });
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=provided"));
    const put = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(put).toBeUndefined();
  });
});
