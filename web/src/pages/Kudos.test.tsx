import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import Kudos from "./Kudos";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

type KudosRow = {
  id: number;
  requesterId: number | null;
  requesterName: string | null;
  requesterDeleted: boolean;
  subjectId: number;
  subjectName: string;
  subjectDeleted: boolean;
  providerId: number;
  providerName: string;
  providerDeleted: boolean;
  visibility: string;
  status: string;
  contentPreview: string;
  content: string;
  lastModified: number;
};

function row(id: number, over: Partial<KudosRow> = {}): KudosRow {
  return {
    id,
    requesterId: null,
    requesterName: null,
    requesterDeleted: false,
    subjectId: 30,
    subjectName: "Sam Subject",
    subjectDeleted: false,
    providerId: 20,
    providerName: "Paula Provider",
    providerDeleted: false,
    visibility: "PUBLIC",
    status: "SENT",
    contentPreview: `kudos content ${id}`,
    content: `kudos content ${id}`,
    lastModified: 1730000000000,
    ...over,
  };
}

// happy-dom has no layout, so the sentinel's IntersectionObserver never fires on its own —
// this manual stub lets the test push an "is intersecting" entry through Mantine's
// useIntersection. First of its kind in the repo (the Kudos wall is the first infinite scroll).
class MockIntersectionObserver {
  static readonly instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function fireIntersect() {
  const withTargets = MockIntersectionObserver.instances.filter((i) => i.observed.length > 0);
  expect(withTargets.length).toBeGreaterThan(0);
  act(() => {
    for (const observer of withTargets) {
      observer.callback(
        [{ isIntersecting: true, target: observer.observed[0] } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    }
  });
}

describe("Kudos wall", () => {
  let mockFetch: FetchMock;

  function renderPage() {
    return renderWithProviders(
      <Routes>
        <Route path="/kudos" element={<Kudos />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>,
      { route: "/kudos" },
    );
  }

  function setupMocks(pages: Record<number, { items: KudosRow[]; total: number }>) {
    mockFetch.mockImplementation((url: string) => {
      const parsed = new URL(String(url), "http://localhost");
      if (!parsed.pathname.startsWith("/api/v1/feedbacks")) {
        return Promise.resolve(jsonResponse(404, {}));
      }
      const page = Number(parsed.searchParams.get("page") ?? "1");
      const body = pages[page] ?? { items: [], total: 0 };
      return Promise.resolve(
        jsonResponse(200, { items: body.items, page, pageSize: 20, total: body.total }),
      );
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    MockIntersectionObserver.instances.length = 0;
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the timeline with provider → subject and the content, requesting the kudos view", async () => {
    setupMocks({ 1: { items: [row(1)], total: 1 } });
    renderPage();

    expect(await screen.findByText("Paula Provider")).toBeInTheDocument();
    expect(screen.getByText("Sam Subject")).toBeInTheDocument();
    expect(screen.getByText("kudos content 1")).toBeInTheDocument();
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("view=kudos");
    expect(url).toContain("sort=-lastModified");
    // A single full page → no next page, so no sentinel is observed.
    expect(screen.queryByTestId("kudos-sentinel")).toBeNull();
  });

  test("the current user renders as plain You instead of a chip", async () => {
    setupMocks({ 1: { items: [row(1, { subjectId: 7, subjectName: "Myself" })], total: 1 } });
    renderPage();

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Myself")).toBeNull();
  });

  test("content that fits is rendered markdown with no toggle — the card is not interactive", async () => {
    // happy-dom measures scrollHeight === clientHeight === 0, i.e. "nothing hidden".
    setupMocks({
      1: { items: [row(1, { content: "Great **markdown** kudos", contentPreview: "Great **markdown** kudos" })], total: 1 },
    });
    renderPage();

    // Rendered markdown even in the collapsed state: the bold run is its own element,
    // the raw source never shows.
    expect(await screen.findByText("markdown")).toBeInTheDocument();
    expect(screen.queryByText("Great **markdown** kudos")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });

  test("overflowing content gets the Show more/Show less toggle; markdown stays rendered", async () => {
    // Force "the clamp hides something": happy-dom has no layout, so stub the measurements.
    const scrollDesc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get: () => 200,
    });
    try {
      setupMocks({
        1: { items: [row(1, { content: "Long **markdown** kudos", contentPreview: "Long **markdown** kudos" })], total: 1 },
      });
      renderPage();

      const toggle = await screen.findByRole("button", { name: "Show more" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      // Collapsed is still the rendered markdown, only clamped.
      expect(screen.getByText("markdown")).toBeInTheDocument();
      expect(screen.queryByText("Long **markdown** kudos")).toBeNull();

      await userEvent.click(toggle);
      const collapse = await screen.findByRole("button", { name: "Show less" });
      expect(collapse).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("markdown")).toBeInTheDocument();

      await userEvent.click(collapse);
      expect(await screen.findByRole("button", { name: "Show more" })).toBeInTheDocument();
    } finally {
      if (scrollDesc) Object.defineProperty(Element.prototype, "scrollHeight", scrollDesc);
      else delete (Element.prototype as { scrollHeight?: unknown }).scrollHeight;
    }
  });

  test("scrolling to the sentinel loads the next page and appends it", async () => {
    setupMocks({
      1: { items: Array.from({ length: 20 }, (_, i) => row(i + 1)), total: 25 },
      2: { items: Array.from({ length: 5 }, (_, i) => row(21 + i)), total: 25 },
    });
    renderPage();

    expect(await screen.findByText("kudos content 1")).toBeInTheDocument();
    expect(screen.queryByText("kudos content 21")).toBeNull();
    expect(screen.getByTestId("kudos-sentinel")).toBeInTheDocument();

    fireIntersect();
    expect(await screen.findByText("kudos content 21")).toBeInTheDocument();
    // Page 1 stays mounted above the appended page…
    expect(screen.getByText("kudos content 1")).toBeInTheDocument();
    await waitFor(() => {
      const urls = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("page=2"))).toBe(true);
    });
    // …and with everything loaded the sentinel is gone.
    expect(screen.queryByTestId("kudos-sentinel")).toBeNull();
  });

  test("an empty wall shows the empty state", async () => {
    setupMocks({});
    renderPage();

    expect(
      await screen.findByText("No kudos yet — public feedback will appear here once it is sent."),
    ).toBeInTheDocument();
  });

  test("a load failure renders the titled error alert", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, { title: "boom" })));
    renderPage();

    expect(await screen.findByText("Failed to load kudos")).toBeInTheDocument();
  });

  test("a disabled FEEDBACKS feature redirects the page to /", () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["FEEDBACKS"]));
    try {
      setupMocks({});
      renderPage();
      expect(screen.getByText("HOME")).toBeInTheDocument();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });
});
