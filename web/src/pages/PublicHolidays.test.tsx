import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import PublicHolidays from "./PublicHolidays";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

type FetchMock = ReturnType<typeof vi.fn>;

const HOLIDAYS = [
  { id: 1, date: "2026-01-06", name: "Epiphany" },
  { id: 2, date: "2026-05-01", name: "Labour Day" },
];

describe("PublicHolidays page", () => {
  let mockFetch: FetchMock;

  function setupMocks({ createStatus = 201 }: { createStatus?: number } = {}) {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(
          createStatus === 201
            ? jsonResponse(201, { id: 9, date: "2026-11-11", name: "Independence Day" })
            : jsonResponse(createStatus, {}),
        );
      }
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(200, { items: HOLIDAYS }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("non-admins get the read-only list: no add form, no delete", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify([]));
    setupMocks();
    renderWithProviders(<PublicHolidays />);

    expect(await screen.findByText("Epiphany")).toBeInTheDocument();
    expect(screen.getByText("Labour Day")).toBeInTheDocument();
    // The heading carries the data-tour anchor for the Config → Public holidays step.
    expect(screen.getByRole("heading", { name: "Public holidays" })).toHaveAttribute(
      "data-tour",
      "config-public-holidays",
    );
    expect(
      screen.getByText(
        "On these dates everyone is off and nothing is deducted from paid-days budgets. The list is maintained by administrators.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add holiday" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete the holiday/ })).toBeNull();
  });

  test("an admin adds a holiday and gets a toast", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    setupMocks();
    renderWithProviders(<PublicHolidays />);
    await screen.findByText("Epiphany");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-11" } });
    await userEvent.type(screen.getByLabelText("Name"), "Independence Day");
    await userEvent.click(screen.getByRole("button", { name: "Add holiday" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/public-holidays",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Public holiday added" }),
    );
  });

  test("a duplicate date maps the 409 to its message", async () => {
    setupMocks({ createStatus: 409 });
    renderWithProviders(<PublicHolidays />);
    await screen.findByText("Epiphany");

    await userEvent.type(screen.getByLabelText("Name"), "Clash");
    await userEvent.click(screen.getByRole("button", { name: "Add holiday" }));
    expect(await screen.findByText("A holiday already exists on this date.")).toBeInTheDocument();
  });

  test("delete asks for confirmation and fires the DELETE", async () => {
    setupMocks();
    renderWithProviders(<PublicHolidays />);
    await screen.findByText("Epiphany");

    await userEvent.click(screen.getByLabelText("Delete the holiday Epiphany"));
    expect(screen.getByText("Delete this holiday?")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/public-holidays/1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  test("a disabled DAYS_OFF feature redirects the page to / (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["DAYS_OFF"]));
    try {
      setupMocks();
      renderWithProviders(
        <>
          <PublicHolidays />
          <LocationProbe />
        </>,
        { route: "/public-holidays" },
      );

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
      expect(screen.queryByText("Epiphany")).toBeNull();
      expect(screen.queryByRole("button", { name: "Add holiday" })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });
});
