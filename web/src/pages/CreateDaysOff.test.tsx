import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { jsonResponse } from "../test/http";
import CreateDaysOff from "./CreateDaysOff";

type FetchMock = ReturnType<typeof vi.fn>;

const YEAR = 2099;
// Mon 2099-06-01 … the first week of June 2099 (2099-06-01 is a Monday).
const MONDAY = "2099-06-01";
const TUESDAY = "2099-06-02";

function budget(remaining: number, allowance: number | null = 20) {
  return {
    userId: 5, userName: "Me", userDeleted: false, year: YEAR,
    allowance, carriedOver: 0, reserved: 0, used: 0, remaining,
  };
}

function renderPage(entry = "/days-off/new") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/days-off/new" element={<CreateDaysOff />} />
            <Route path="/days-off" element={<div>LIST</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateDaysOff", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    remaining = 10,
    allowance = 20 as number | null,
    holidays = [] as { id: number; date: string; name: string }[],
    createStatus = 201,
    createBody = {} as unknown,
  } = {}) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(
          createStatus === 201
            ? jsonResponse(201, { id: 77 })
            : jsonResponse(createStatus, createBody),
        );
      }
      if (u.includes("/api/v1/public-holidays")) {
        return Promise.resolve(jsonResponse(200, { items: holidays }));
      }
      if (u.includes("/api/v1/days-off/budgets")) {
        // The managed view backs the on-behalf picker's preview: the caller's two reports.
        if (u.includes("view=managed")) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                { ...budget(remaining, allowance), userId: 9, userName: "Rita Report" },
                { ...budget(3, allowance), userId: 11, userName: "Zed Report" },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, { items: [budget(remaining, allowance)] }));
      }
      if (u.includes("/api/v1/teams/members")) {
        const row = (userId: number, name: string) => ({
          userId, name, email: `${name.replaceAll(" ", ".")}@x.test`, teamId: 1, teamName: "Team",
        });
        return Promise.resolve(
          jsonResponse(200, {
            items: [row(5, "Me"), row(9, "Rita Report"), row(11, "Zed Report")],
            page: 1, pageSize: 100, total: 3,
          }),
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

  // Native type="date" inputs are set with fireEvent.change (the CreateGoal idiom).
  async function pickRange(start: string, end: string) {
    fireEvent.change(screen.getByLabelText("From"), { target: { value: start } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: end } });
    await Promise.resolve();
  }

  test("previews the working-day cost with holidays skipped and the remaining budget", async () => {
    setupMocks({ remaining: 10, holidays: [{ id: 1, date: TUESDAY, name: "Holiday" }] });
    renderPage();

    await pickRange(MONDAY, "2099-06-05"); // Mon..Fri with a Tuesday holiday
    expect(await screen.findByText("This request costs 4 working day(s).")).toBeInTheDocument();
    expect(
      screen.getByText(`Remaining paid-days budget for ${YEAR}: 10.`),
    ).toBeInTheDocument();
  });

  test("the last-day half checkbox is disabled on a single-day request", async () => {
    setupMocks();
    renderPage();

    await pickRange(MONDAY, MONDAY);
    expect(screen.getByLabelText("Last day is a half day")).toBeDisabled();
    await userEvent.click(screen.getByLabelText("First day is a half day"));
    expect(await screen.findByText("This request costs 0.5 working day(s).")).toBeInTheDocument();

    await pickRange(MONDAY, TUESDAY);
    expect(screen.getByLabelText("Last day is a half day")).toBeEnabled();
  });

  test("an over-budget PAID request blocks submission with a red hint", async () => {
    setupMocks({ remaining: 1 });
    renderPage();

    await pickRange(MONDAY, "2099-06-04"); // 4 working days > 1 remaining
    expect(
      (await screen.findAllByText("The request does not fit your remaining paid-days budget."))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  });

  test("a weekend-only period warns and blocks", async () => {
    setupMocks();
    renderPage();
    await pickRange("2099-06-06", "2099-06-07"); // Sat..Sun
    expect(
      await screen.findByText("The period contains no working days — only weekends or public holidays."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  });

  test("submits, toasts, and navigates back to the requests tab", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    setupMocks();
    renderPage();

    await pickRange(MONDAY, TUESDAY);
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(screen.getByText("LIST")).toBeInTheDocument());
    const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      type: "PAID",
      startDate: MONDAY,
      endDate: TUESDAY,
      startHalf: false,
      endHalf: false,
    });
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Days-off request submitted" }),
    );
  });

  test("on-behalf mode offers the report picker (caller excluded) and gates the submit on a pick", async () => {
    setupMocks();
    renderPage("/days-off/new?onBehalf=1");

    expect(await screen.findByText("New days off")).toBeInTheDocument();
    // Valid dates alone don't unlock the auto-accepted submit — a report must be picked.
    await pickRange(MONDAY, TUESDAY);
    const submit = screen.getByRole("button", { name: "Submit auto-accepted" });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox", { name: "On behalf of" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toContain("Rita Report");
    expect(options).toContain("Zed Report");
    expect(options).not.toContain("Me");
    await userEvent.click(screen.getByRole("option", { name: "Rita Report" }));

    expect(submit).toBeEnabled();
    // The budget preview reads the PICKED report's managed-budget row.
    expect(
      await screen.findByText(`Remaining paid-days budget for ${YEAR}: 10.`),
    ).toBeInTheDocument();
  });

  test("on-behalf submit posts the picked userId, toasts, and returns to the team tab", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    showSpy.mockClear();
    setupMocks();
    renderPage("/days-off/new?onBehalf=1");

    await pickRange(MONDAY, TUESDAY);
    await userEvent.click(screen.getByRole("combobox", { name: "On behalf of" }));
    await userEvent.click(await screen.findByRole("option", { name: "Zed Report" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit auto-accepted" }));

    await waitFor(() => expect(screen.getByText("LIST")).toBeInTheDocument());
    const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      type: "PAID",
      startDate: MONDAY,
      endDate: TUESDAY,
      startHalf: false,
      endHalf: false,
      userId: 11,
    });
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Days off recorded and accepted" }),
    );
  });

  test("an overlap 409 (instance set) and a budget 409 read differently", async () => {
    setupMocks({ createStatus: 409, createBody: { instance: "/api/v1/days-off/3" } });
    renderPage();
    await pickRange(MONDAY, TUESDAY);
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(
      await screen.findByText("The period overlaps one of your pending or accepted requests."),
    ).toBeInTheDocument();

    setupMocks({ createStatus: 409, createBody: {} });
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(
      (await screen.findAllByText("The request does not fit your remaining paid-days budget."))
        .length,
    ).toBeGreaterThan(0);
  });
});
