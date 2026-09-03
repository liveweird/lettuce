import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import DaysOffCorrections from "./DaysOffCorrections";
import type { DaysOffCorrection } from "../api/daysoff";

type FetchMock = ReturnType<typeof vi.fn>;

const CORRECTION: DaysOffCorrection = {
  id: 11,
  userId: 9,
  authorId: 3,
  authorName: "Mona Manager",
  authorDeleted: false,
  poolTypeId: 1,
  poolName: "Paid days off",
  year: 2026,
  operation: "ADD",
  days: 4.5,
  comment: "Overtime compensation",
  createdAt: 1_754_000_000_000,
  lastModified: 1_754_000_000_000,
};

describe("DaysOffCorrections", () => {
  let mockFetch: FetchMock;

  function setupMocks(items: DaysOffCorrection[] = [CORRECTION]) {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return Promise.resolve(jsonResponse(201, { ...CORRECTION, id: 12 }));
      if (method === "PUT" || method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, { items }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("read-only viewers see the rows but no editing affordances", async () => {
    setupMocks();
    renderWithProviders(<DaysOffCorrections userId={9} defaultYear={2026} canManage={false} />);

    expect(await screen.findByText("Overtime compensation")).toBeInTheDocument();
    expect(screen.getByText("+4.5")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText(/^Mona Manager · /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add correction" })).toBeNull();
    expect(screen.queryByLabelText("Edit the correction for 2026")).toBeNull();
    expect(screen.queryByLabelText("Delete the correction for 2026")).toBeNull();
  });

  test("a SUBTRACT row renders with the minus sign", async () => {
    setupMocks([{ ...CORRECTION, operation: "SUBTRACT", days: 1.5 }]);
    renderWithProviders(<DaysOffCorrections userId={9} defaultYear={2026} canManage={false} />);
    expect(await screen.findByText("−1.5")).toBeInTheDocument();
  });

  test("a manager adds a correction (form gated on amount + comment)", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    setupMocks([]);
    renderWithProviders(<DaysOffCorrections userId={9} defaultYear={2026} canManage />);

    expect(await screen.findByText("No corrections yet.")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add correction" });
    expect(add).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Days"), "3");
    expect(add).toBeDisabled(); // still no comment
    await userEvent.type(screen.getByLabelText("Comment"), "Weekend release on-call");
    expect(add).toBeEnabled();
    await userEvent.click(add);

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
      expect(post?.[0]).toBe("/api/v1/days-off/corrections");
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        userId: 9,
        year: 2026,
        operation: "ADD",
        days: 3,
        comment: "Weekend release on-call",
      });
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Correction added" }));
  });

  test("edit prefills the form and PUTs to the row", async () => {
    setupMocks();
    renderWithProviders(<DaysOffCorrections userId={9} defaultYear={2026} canManage />);

    await userEvent.click(await screen.findByLabelText("Edit the correction for 2026"));
    expect(screen.getByText("Edit correction")).toBeInTheDocument();
    expect(screen.getByLabelText("Comment")).toHaveValue("Overtime compensation");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/corrections/11",
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });

  test("delete asks for confirmation and soft-deletes", async () => {
    setupMocks();
    renderWithProviders(<DaysOffCorrections userId={9} defaultYear={2026} canManage />);

    await userEvent.click(await screen.findByLabelText("Delete the correction for 2026"));
    expect(screen.getByText("Delete this correction?")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/corrections/11",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  test("with several pools the add form carries a Pool select and posts the picked kind (v3.2.0)", async () => {
    setupMocks();
    renderWithProviders(
      <DaysOffCorrections
        userId={9}
        defaultYear={2026}
        canManage
        pools={[{ id: 1, name: "Paid days off" }, { id: 7, name: "Study leave" }]}
      />,
    );

    // The row names its pool once the person holds more than one; the add form pre-selects
    // the default pool and the manager picks the extra one (v3.2.1 — the production path).
    expect(await screen.findByText("Paid days off")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Pool" })).toHaveValue("Paid days off");
    await userEvent.click(screen.getByRole("combobox", { name: "Pool" }));
    await userEvent.click(await screen.findByRole("option", { name: "Study leave" }));
    await userEvent.type(screen.getByLabelText("Days"), "2");
    await userEvent.type(screen.getByLabelText("Comment"), "Course days");
    await userEvent.click(screen.getByRole("button", { name: "Add correction" }));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        userId: 9, year: 2026, operation: "ADD", days: 2, comment: "Course days", poolTypeId: 7,
      });
    });
  });

  test("editing shows the correction's pool read-only — an archived pool's name included (v3.2.1)", async () => {
    setupMocks([{ ...CORRECTION, poolTypeId: 9, poolName: "Retired pool" }]);
    renderWithProviders(
      <DaysOffCorrections
        userId={9}
        defaultYear={2026}
        canManage
        pools={[{ id: 1, name: "Paid days off" }, { id: 7, name: "Study leave" }]}
      />,
    );
    await userEvent.click(await screen.findByLabelText("Edit the correction for 2026"));
    // No Select while editing (the pool is create-only) — the stored pool's name instead.
    expect(screen.queryByRole("combobox", { name: "Pool" })).toBeNull();
    expect(screen.getByText("Retired pool", { selector: "p" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).not.toHaveProperty("poolTypeId");
    });
  });

  test("a single-pool person's rows carry no pool label (v3.2.1)", async () => {
    setupMocks();
    renderWithProviders(<DaysOffCorrections userId={9} defaultYear={2026} canManage={false} />);
    expect(await screen.findByText("Overtime compensation")).toBeInTheDocument();
    expect(screen.queryByText("Paid days off")).toBeNull();
  });
});
