import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, renderWithProviders, screen, waitFor } from "../test/render";
import FeedbackForm from "./FeedbackForm";
import { formatTimestamp } from "../utils/datetime";

// Swap the Lexical-based editor for a plain textarea (see mockMarkdownEditor); the real wrapper
// is covered by MarkdownEditor.test.tsx. Import inside the (hoisted) factory to avoid the
// top-level-variable restriction.
vi.mock("./MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseProps = {
  title: "Edit feedback",
  subjectDisplay: "Sam Subject",
  initialVisibility: "PROVIDER_SUBJECT" as const,
  initialContent: "",
  submitting: null,
  error: null as string | null,
  cancelTo: "/feedback",
  discardTitle: "Discard changes?",
  discardMessage: "Discard your changes?",
};

describe("FeedbackForm", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    // Default: a single-template picker list plus its full content on demand.
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (/^\/api\/v1\/templates\/\d+/.test(u)) {
        return Promise.resolve(jsonResponse(200, { id: 123, name: "Greeting", content: "Hello from template" }));
      }
      if (u.startsWith("/api/v1/templates")) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [{ id: 123, name: "Greeting", contentPreview: "Hello" }],
            page: 1,
            pageSize: 100,
            total: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the title and subject and calls onSubmit with DRAFT / SENT", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={onSubmit} />);

    expect(screen.getByRole("heading", { name: "Edit feedback" })).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("Sam Subject");

    // The editor is lazy-loaded, so wait for it to resolve before typing.
    await user.type(await screen.findByLabelText("Content"), "Nice work");
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    expect(onSubmit).toHaveBeenCalledWith("DRAFT", expect.objectContaining({ content: "Nice work" }));

    await user.click(screen.getByRole("button", { name: /save & send/i }));
    expect(onSubmit).toHaveBeenCalledWith("SENT", expect.objectContaining({ content: "Nice work" }));
  });

  test("shows the read-only Last modified field only when the prop is provided", () => {
    const ts = new Date(2026, 0, 5, 9, 7).getTime();
    const { unmount } = renderWithProviders(
      <FeedbackForm {...baseProps} onSubmit={() => {}} lastModified={ts} />,
    );
    expect(screen.getByLabelText("Last modified")).toHaveValue(formatTimestamp(ts));
    unmount();

    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} />);
    expect(screen.queryByLabelText("Last modified")).toBeNull();
  });

  test("with showTemplateInsert, fetches the template picker and gates Insert until a pick", async () => {
    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} showTemplateInsert />);

    // The picker prefetches templates (capped at the list endpoint's pageSize=100).
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url]) => String(url).startsWith("/api/v1/templates?") && String(url).includes("pageSize=100"),
        ),
      ).toBe(true);
    });
    // Insert is disabled until a template is chosen. (Driving the searchable Mantine
    // combobox selection isn't reliable under happy-dom — see CreateTeam.test.tsx — so
    // we assert the wiring/gating rather than the post-selection append.)
    expect(screen.getByRole("button", { name: /insert/i })).toBeDisabled();
  });

  test("without showTemplateInsert, no template picker is rendered or fetched", () => {
    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} />);
    expect(screen.queryByLabelText("Template")).toBeNull();
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).startsWith("/api/v1/templates")),
    ).toBe(false);
  });

  test("shows a read-only Requester field only when requesterDisplay is provided", () => {
    const { unmount } = renderWithProviders(
      <FeedbackForm {...baseProps} onSubmit={() => {}} requesterDisplay="Rita Requester" />,
    );
    const requester = screen.getByLabelText("Requester") as HTMLInputElement;
    expect(requester.value).toBe("Rita Requester");
    expect(requester).toBeDisabled();
    unmount();

    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} />);
    expect(screen.queryByLabelText("Requester")).toBeNull();
  });

  test("renders the error prop as an alert", () => {
    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} error="Something failed" />);
    expect(screen.getByText("Something failed")).toBeInTheDocument();
  });

  // Pick the only template ("Greeting") from the searchable picker, then click Insert.
  // happy-dom doesn't open Mantine comboboxes via userEvent pointer simulation, so use fireEvent.
  async function selectGreetingAndInsert(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(screen.getByPlaceholderText("Pick a template")).toBeEnabled());
    fireEvent.click(screen.getByPlaceholderText("Pick a template"));
    fireEvent.click(await screen.findByRole("option", { name: "Greeting", hidden: true }));
    await user.click(screen.getByRole("button", { name: /insert/i }));
  }

  test("inserts the selected template's content into an empty editor (no leading separator)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackForm {...baseProps} initialContent="" onSubmit={() => {}} showTemplateInsert />,
    );
    await selectGreetingAndInsert(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Content")).toHaveValue("Hello from template"),
    );
  });

  test("appends an inserted template after existing content with a blank-line separator", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackForm {...baseProps} initialContent="Existing" onSubmit={() => {}} showTemplateInsert />,
    );
    await selectGreetingAndInsert(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Content")).toHaveValue("Existing\n\nHello from template"),
    );
  });

  test("does not add a double separator when existing content already ends in a newline", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackForm {...baseProps} initialContent={"Existing\n"} onSubmit={() => {}} showTemplateInsert />,
    );
    await selectGreetingAndInsert(user);
    await waitFor(() =>
      expect(screen.getByLabelText("Content")).toHaveValue("Existing\nHello from template"),
    );
  });

  test("shows an error alert when the template content fails to load", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (/^\/api\/v1\/templates\/\d+/.test(u)) return Promise.resolve(jsonResponse(500, { error: "boom" }));
      if (u.startsWith("/api/v1/templates")) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [{ id: 123, name: "Greeting", contentPreview: "Hello" }],
            page: 1,
            pageSize: 100,
            total: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} showTemplateInsert />);
    await selectGreetingAndInsert(user);
    expect(
      await screen.findByText("Couldn't load that template. Please try again."),
    ).toBeInTheDocument();
  });

  test("shows a Delete button only when onDelete is provided", () => {
    const { rerender } = renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} />);
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    rerender(<FeedbackForm {...baseProps} onSubmit={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });

  test("disables every action button while a delete is in flight", () => {
    renderWithProviders(
      <FeedbackForm {...baseProps} onSubmit={() => {}} onDelete={() => {}} deleting />,
    );
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();
  });

  test("disables all action buttons while a DRAFT save is in flight", () => {
    renderWithProviders(<FeedbackForm {...baseProps} submitting="DRAFT" onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();
  });

  test("disables all action buttons while a SENT save is in flight", () => {
    renderWithProviders(<FeedbackForm {...baseProps} submitting="SENT" onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();
  });

  test("in edit mode (feedbackId set) shows Content and History tabs", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/events")) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              { id: 1, feedbackId: 5, userId: 10, userName: "Paula", timestamp: 1, type: "CREATED", params: { status: "DRAFT" } },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackForm {...baseProps} feedbackId={5} initialContent="hello" onSubmit={() => {}} />,
    );

    // Three tabs are present; Content is the default and shows the editor textarea.
    expect(screen.getByRole("tab", { name: "Content" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lifecycle" })).toBeInTheDocument();
    expect(screen.getByLabelText("Content", { selector: "textarea" })).toHaveValue("hello");

    // History tab reveals the audit timeline.
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("Feedback created as a draft.")).toBeInTheDocument();

    // Lifecycle tab reveals the state diagram.
    await user.click(screen.getByRole("tab", { name: "Lifecycle" }));
    expect(await screen.findByRole("img", { name: /lifecycle/i })).toBeInTheDocument();
  });

  test("Cancel opens the discard modal; Discard links to cancelTo and Keep editing closes it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeedbackForm {...baseProps} onSubmit={() => {}} />);

    // Closed initially.
    expect(screen.queryByText("Discard your changes?")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
    // Discard is a router link back to cancelTo (we assert the href rather than drive navigation).
    expect(screen.getByRole("link", { name: /discard/i })).toHaveAttribute("href", "/feedback");

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    await waitFor(() => expect(screen.queryByText("Discard your changes?")).toBeNull());
  });
});
