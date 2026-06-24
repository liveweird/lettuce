import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../test/render";
import FeedbackForm from "./FeedbackForm";
import { formatTimestamp } from "../utils/datetime";

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
      if (/^\/api\/templates\/\d+/.test(u)) {
        return Promise.resolve(jsonResponse(200, { id: 123, name: "Greeting", content: "Hello from template" }));
      }
      if (u.startsWith("/api/templates")) {
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

    await user.type(screen.getByLabelText("Content"), "Nice work");
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
          ([url]) => String(url).startsWith("/api/templates?") && String(url).includes("pageSize=100"),
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
      mockFetch.mock.calls.some(([url]) => String(url).startsWith("/api/templates")),
    ).toBe(false);
  });
});
