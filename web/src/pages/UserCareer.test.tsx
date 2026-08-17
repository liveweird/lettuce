import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse } from "../test/http";
import UserCareer from "./UserCareer";

type FetchMock = ReturnType<typeof vi.fn>;

const ENTRY = (id: number, value: string) => ({ id, values: { en: value } });

// Chronological, the server order; the page renders newest first.
const POSITIONS = [
  {
    id: 1,
    startDate: "2019-02-01",
    endDate: "2021-06-14",
    careerPath: ENTRY(11, "Engineer"),
    careerSpecialization: ENTRY(21, "Backend"),
    seniorityLevel: ENTRY(31, "Junior"),
    createdAt: 1_600_000_000_000,
    lastModified: 1_600_000_000_000,
  },
  {
    id: 2,
    startDate: "2021-06-15",
    endDate: null,
    careerPath: ENTRY(12, "Senior Engineer"),
    careerSpecialization: ENTRY(21, "Backend"),
    seniorityLevel: ENTRY(32, "Senior"),
    createdAt: 1_700_000_000_000,
    lastModified: 1_700_000_000_000,
  },
];

function renderPage(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/users/:userId/career" element={<UserCareer />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserCareer", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    positions = POSITIONS,
    mutationStatus = 204,
    postStatus = 201,
  }: { positions?: typeof POSITIONS; mutationStatus?: number; postStatus?: number } = {}) {
    mockFetch.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.startsWith("/api/v1/dictionaries/")) {
        const slug = url.split("/").pop()!;
        const items =
          slug === "career-paths"
            ? [ENTRY(11, "Engineer"), ENTRY(12, "Senior Engineer")]
            : slug === "career-specializations"
              ? [ENTRY(21, "Backend")]
              : [ENTRY(31, "Junior"), ENTRY(32, "Senior")];
        return Promise.resolve(jsonResponse(200, { items }));
      }
      if (method === "GET" && url.includes("/career-positions")) {
        return Promise.resolve(jsonResponse(200, { items: positions }));
      }
      if (method === "POST") {
        return Promise.resolve(
          postStatus === 201
            ? jsonResponse(201, positions[positions.length - 1] ?? POSITIONS[1])
            : jsonResponse(postStatus, { title: "err", detail: "err" }),
        );
      }
      if (method === "PUT" || method === "DELETE") {
        return Promise.resolve(
          mutationStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(mutationStatus, { title: "err", detail: "err" }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "5");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("read-only view: newest first, the open position marked Current, no editor", async () => {
    setupMocks();
    renderPage("/users/9/career?name=Riley%20Report&from=managers");

    expect(
      await screen.findByRole("heading", { name: "Career progression — Riley Report" }),
    ).toBeInTheDocument();
    // Newest first: the current (open-ended) position leads with its badge and "Since" range.
    const current = await screen.findByText("Current");
    expect(current).toBeInTheDocument();
    expect(screen.getByText(/^Since /)).toBeInTheDocument();
    const items = screen.getAllByText(/Engineer$/);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // The manager origin is a read-only one: no editor, no per-row actions.
    expect(screen.queryByText("Start a new position")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit the position started 2019-02-01")).not.toBeInTheDocument();
  });

  test("a bare URL (the notification deep link) renders read-only with the fallback title", async () => {
    setupMocks();
    renderPage("/users/9/career");
    expect(
      await screen.findByRole("heading", { name: "Career progression — user #9" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Start a new position")).not.toBeInTheDocument();
  });

  test("empty history shows the empty state", async () => {
    setupMocks({ positions: [] });
    renderPage("/users/9/career?name=R&from=managers");
    expect(await screen.findByText("No positions recorded yet.")).toBeInTheDocument();
  });

  test("the add form prefills from the current position; a date + one change POSTs the full triple", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage("/users/9/career?name=Riley%20Report&from=subordinates");

    expect(await screen.findByText("Start a new position")).toBeInTheDocument();
    // Prefill (v2.15.1): the three pickers start from the CURRENT position's values. The
    // keyed form REMOUNTS when the positions load, so re-query the node inside the wait.
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/^Career path/, { selector: "input" }) as HTMLInputElement).value,
      ).toBe("Senior Engineer"),
    );
    const pathInput = screen.getByLabelText(/^Career path/, { selector: "input" }) as HTMLInputElement;
    expect((screen.getByLabelText(/^Seniority level/, { selector: "input" }) as HTMLInputElement).value).toBe(
      "Senior",
    );
    // No date yet — the submit waits for it despite the prefilled triple.
    const submit = screen.getByRole("button", { name: "Start position" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: "2024-03-01" } });
    // A promotion is a delta: change just the path, keep the prefilled rest.
    fireEvent.click(pathInput);
    await user.click(await screen.findByRole("option", { name: "Engineer" }));
    await user.click(submit);

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
      expect(post).toBeDefined();
      expect(String(post![0])).toBe("/api/v1/users/9/career-positions");
      const body = JSON.parse((post![1] as { body: string }).body);
      expect(body).toEqual({
        startDate: "2024-03-01",
        careerPathId: 11,
        careerSpecializationId: 21,
        seniorityLevelId: 32,
      });
    });
  });

  test("with no positions yet the form starts blank and needs the date AND all three fields", async () => {
    setupMocks({ positions: [] });
    const user = userEvent.setup();
    renderPage("/users/9/career?name=R&from=subordinates");
    const submit = await screen.findByRole("button", { name: "Start position" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: "2024-03-01" } });
    expect(submit).toBeDisabled(); // all three fields are required (v2.15.1), none set yet
    const pathInput = screen.getByLabelText(/^Career path/, { selector: "input" });
    await waitFor(() => expect(pathInput).not.toBeDisabled());
    fireEvent.click(pathInput);
    await user.click(await screen.findByRole("option", { name: "Engineer" }));
    expect(submit).toBeDisabled(); // one of three is still not enough
  });

  test("editing a row pre-fills the form and PUTs the correction", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage("/users/9/career?name=Riley%20Report&from=subordinates");

    await user.click(await screen.findByLabelText("Edit the position started 2019-02-01"));
    expect(screen.getByText("Correct the position")).toBeInTheDocument();
    const dateInput = screen.getByLabelText(/^Start date/) as HTMLInputElement;
    expect(dateInput.value).toBe("2019-02-01");

    fireEvent.change(dateInput, { target: { value: "2019-05-01" } });
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
      expect(put).toBeDefined();
      expect(String(put![0])).toBe("/api/v1/users/9/career-positions/1");
      const body = JSON.parse((put![1] as { body: string }).body);
      expect(body).toEqual({
        startDate: "2019-05-01",
        careerPathId: 11,
        careerSpecializationId: 21,
        seniorityLevelId: 31,
      });
    });
  });

  test("deleting a row goes through the confirm modal", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage("/users/9/career?name=Riley%20Report&from=subordinates");

    await user.click(await screen.findByLabelText("Delete the position started 2019-02-01"));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Remove the position")).toBeInTheDocument();
    await user.click(within(modal).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      const del = mockFetch.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === "DELETE",
      );
      expect(del).toBeDefined();
      expect(String(del![0])).toBe("/api/v1/users/9/career-positions/1");
    });
  });

  test("a 409 on create surfaces the conflict error inline", async () => {
    setupMocks({ postStatus: 409 });
    const user = userEvent.setup();
    renderPage("/users/9/career?name=R&from=subordinates");

    // The triple prefills from the current position (re-query: the keyed form remounts when
    // the positions load); a date plus one changed field makes it submittable (v2.15.2 — an
    // unchanged triple is not a step, see the dedicated case below).
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/^Career path/, { selector: "input" }) as HTMLInputElement).value,
      ).toBe("Senior Engineer"),
    );
    fireEvent.change(screen.getByLabelText(/^Start date/), {
      target: { value: "2020-01-01" },
    });
    fireEvent.click(screen.getByLabelText(/^Career path/, { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Engineer" }));
    await user.click(screen.getByRole("button", { name: "Start position" }));

    expect(
      await screen.findByText(
        "The position conflicts with its neighbors: the start date must keep the order, and the values must not repeat a neighboring position.",
      ),
    ).toBeInTheDocument();
  });

  test("an unchanged triple is not a new position: submit stays disabled with the explanatory note", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage("/users/9/career?name=R&from=subordinates");

    await waitFor(() =>
      expect(
        (screen.getByLabelText(/^Career path/, { selector: "input" }) as HTMLInputElement).value,
      ).toBe("Senior Engineer"),
    );
    // Even with a date, the prefilled (= current) triple keeps the submit disabled and the
    // note explains why (the server's adjacent-sameness 409, v2.15.2, mirrored client-side).
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: "2024-03-01" } });
    expect(screen.getByRole("button", { name: "Start position" })).toBeDisabled();
    expect(
      screen.getByText(
        "This repeats the current position exactly — change at least one of the three fields.",
      ),
    ).toBeInTheDocument();

    // One changed field clears the note and enables the submit.
    fireEvent.click(screen.getByLabelText(/^Career path/, { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Engineer" }));
    expect(
      screen.queryByText(
        "This repeats the current position exactly — change at least one of the three fields.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start position" })).toBeEnabled();
  });

  test("a correction may not make the position identical to its neighbor", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage("/users/9/career?name=R&from=subordinates");

    // Edit the CURRENT position (12|21|32); its predecessor is 11|21|31.
    await user.click(await screen.findByLabelText("Edit the position started 2021-06-15"));
    expect(screen.getByText("Correct the position")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Career path/, { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Engineer" }));
    fireEvent.click(screen.getByLabelText(/^Seniority level/, { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Junior" }));

    expect(
      screen.getByText(
        "This would make the position identical to a neighboring one — corrections must keep every step distinct.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });
});
