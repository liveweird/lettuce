import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import DaysOffPoolTypes from "./DaysOffPoolTypes";

type FetchMock = ReturnType<typeof vi.fn>;

const KINDS = [
  { id: 1, name: "Paid days off", carriesOver: true, isDefault: true },
  { id: 7, name: "Study leave", carriesOver: false, isDefault: false },
];

describe("DaysOffPoolTypes page", () => {
  let mockFetch: FetchMock;

  function setupMocks({ createStatus = 201 }: { createStatus?: number } = {}) {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(
          createStatus === 201
            ? jsonResponse(201, { id: 9, name: "Maternal leave", carriesOver: false, isDefault: false })
            : jsonResponse(createStatus, {}),
        );
      }
      if (method === "PUT" || method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(200, { items: KINDS }));
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

  test("non-admins get the read-only registry: the default badge and carry-over cue, no controls", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify([]));
    setupMocks();
    renderWithProviders(<DaysOffPoolTypes />);

    expect(await screen.findByText("Paid days off")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Study leave")).toBeInTheDocument();
    expect(screen.getByText("resets yearly")).toBeInTheDocument();
    expect(screen.getByText("carries over")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add pool kind" })).toBeNull();
    expect(screen.queryByLabelText(/Archive the/)).toBeNull();
  });

  test("an admin adds a kind with its carry-over flag; a duplicate name reads as such", async () => {
    setupMocks();
    renderWithProviders(<DaysOffPoolTypes />);

    await screen.findByText("Study leave");
    await userEvent.type(screen.getByLabelText("Pool name"), "  Maternal leave ");
    await userEvent.click(screen.getByLabelText("Unused days carry over to the next year"));
    await userEvent.click(screen.getByRole("button", { name: "Add pool kind" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/pool-types",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Maternal leave", carriesOver: false }),
        }),
      );
    });

    setupMocks({ createStatus: 409 });
    await userEvent.type(screen.getByLabelText("Pool name"), "Study leave");
    await userEvent.click(screen.getByRole("button", { name: "Add pool kind" }));
    expect(await screen.findByText("A pool kind with that name already exists.")).toBeInTheDocument();
  });

  test("the edit modal renames and re-flags a kind; the default kind is editable but never archivable", async () => {
    setupMocks();
    renderWithProviders(<DaysOffPoolTypes />);

    await screen.findByText("Study leave");
    // The default kind has no archive control; the extra kind does.
    expect(screen.queryByLabelText("Archive the Paid days off pool kind")).toBeNull();
    expect(screen.getByLabelText("Archive the Study leave pool kind")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Edit the Study leave pool kind"));
    const dialog = await screen.findByRole("dialog");
    // withAsterisk joins the * into the accessible name — prefix-match (the house gotcha).
    const name = within(dialog).getByLabelText(/^Pool name/);
    expect(name).toHaveValue("Study leave");
    await userEvent.clear(name);
    await userEvent.type(name, "Learning leave");
    await userEvent.click(within(dialog).getByLabelText("Unused days carry over to the next year"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/pool-types/7",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "Learning leave", carriesOver: true }),
        }),
      );
    });
    expect(dialog).not.toBeInTheDocument();
  });

  test("archiving asks for confirmation, then DELETEs the kind", async () => {
    setupMocks();
    renderWithProviders(<DaysOffPoolTypes />);

    await userEvent.click(await screen.findByLabelText("Archive the Study leave pool kind"));
    expect(await screen.findByText("Archive this pool kind?")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/pool-types/7",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  test("the DAYS_OFF flag hides the page", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["DAYS_OFF"]));
    setupMocks();
    renderWithProviders(<DaysOffPoolTypes />);
    await waitFor(() => expect(screen.queryByText("Paid-leave pools")).toBeNull());
  });
});
