import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import IntegrationClients from "./IntegrationClients";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

type FetchMock = ReturnType<typeof vi.fn>;

const CLIENTS = [
  {
    id: 1,
    name: "warehouse-sync",
    createdAt: 1700000000000,
    createdByName: "Ada Admin",
    lastUsedAt: 1700000100000,
    revoked: false,
    revokedAt: null,
  },
  {
    id: 2,
    name: "old-reporting",
    createdAt: 1600000000000,
    createdByName: "Ada Admin",
    lastUsedAt: null,
    revoked: true,
    revokedAt: 1650000000000,
  },
];

const CREATED = {
  client: {
    id: 3,
    name: "bi-export",
    createdAt: 1700000200000,
    createdByName: "Ada Admin",
    lastUsedAt: null,
    revoked: false,
    revokedAt: null,
  },
  apiKey: "lettuce_int_abcdefghij0123456789abcdefghij0123456789abc",
};

describe("IntegrationClients page", () => {
  let mockFetch: FetchMock;

  function setupMocks({ createStatus = 201 }: { createStatus?: number } = {}) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/revoke")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === "POST") {
        return Promise.resolve(
          createStatus === 201 ? jsonResponse(201, CREATED) : jsonResponse(createStatus, {}),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: CLIENTS }));
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

  test("non-admins are redirected away and nothing is fetched", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify([]));
    setupMocks();
    renderWithProviders(
      <>
        <IntegrationClients />
        <LocationProbe />
      </>,
      { route: "/integration-clients" },
    );

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("the list shows status badges, usage, and Revoke only on active clients", async () => {
    setupMocks();
    renderWithProviders(<IntegrationClients />);

    expect(await screen.findByText("warehouse-sync")).toBeInTheDocument();
    expect(screen.getByText("old-reporting")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText(/Never used/)).toBeInTheDocument();
    // Only the active client offers Revoke.
    expect(screen.getByLabelText("Revoke API key of warehouse-sync")).toBeInTheDocument();
    expect(screen.queryByLabelText("Revoke API key of old-reporting")).toBeNull();
  });

  test("creating a client reveals the key exactly once (no toast — the panel is the confirmation)", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    setupMocks();
    renderWithProviders(<IntegrationClients />);
    await screen.findByText("warehouse-sync");

    await userEvent.type(screen.getByLabelText("Client name"), "bi-export");
    await userEvent.click(screen.getByRole("button", { name: "Add client" }));

    expect(
      await screen.findByText('API key for "bi-export" — shown only once'),
    ).toBeInTheDocument();
    // Masked until the eye toggle is pressed; Copy always copies the real value.
    expect(screen.queryByText(CREATED.apiKey)).toBeNull();
    await userEvent.click(screen.getByLabelText("Show password"));
    expect(screen.getByText(CREATED.apiKey)).toBeInTheDocument();
    expect(showSpy).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/integration-clients",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("revoke asks for confirmation, fires the POST, and toasts", async () => {
    const showSpy = vi.spyOn(notifications, "show");
    setupMocks();
    renderWithProviders(<IntegrationClients />);
    await screen.findByText("warehouse-sync");

    await userEvent.click(screen.getByLabelText("Revoke API key of warehouse-sync"));
    expect(screen.getByText("Revoke this API key?")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/integration-clients/1/revoke",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "API key revoked" }));
  });

  test("a failed create surfaces the mapped error inline", async () => {
    setupMocks({ createStatus: 400 });
    renderWithProviders(<IntegrationClients />);
    await screen.findByText("warehouse-sync");

    await userEvent.type(screen.getByLabelText("Client name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Add client" }));
    expect(
      await screen.findByText(
        "The client name is invalid — it must be a non-empty single line of at most 100 characters.",
      ),
    ).toBeInTheDocument();
  });

  test("a second create remounts the panel masked (the reveal state must not carry over)", async () => {
    setupMocks();
    let call = 0;
    const second = {
      client: { ...CREATED.client, id: 4, name: "warehouse-2" },
      apiKey: "lettuce_int_secondsecondsecondsecondsecondsecond9876543",
    };
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && !url.endsWith("/revoke")) {
        call += 1;
        return Promise.resolve(jsonResponse(201, call === 1 ? CREATED : second));
      }
      return Promise.resolve(jsonResponse(200, { items: CLIENTS }));
    });
    renderWithProviders(<IntegrationClients />);
    await screen.findByText("warehouse-sync");

    await userEvent.type(screen.getByLabelText("Client name"), "bi-export");
    await userEvent.click(screen.getByRole("button", { name: "Add client" }));
    await screen.findByText('API key for "bi-export" — shown only once');
    await userEvent.click(screen.getByLabelText("Show password"));
    expect(screen.getByText(CREATED.apiKey)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Client name"), "warehouse-2");
    await userEvent.click(screen.getByRole("button", { name: "Add client" }));
    await screen.findByText('API key for "warehouse-2" — shown only once');
    // The panel remounted: key #2 is masked again, not exposed by key #1's reveal.
    expect(screen.queryByText(second.apiKey)).toBeNull();
  });

  test("revoking the just-created client also retires its one-time key panel", async () => {
    setupMocks();
    const fresh = { ...CREATED, client: { ...CREATED.client, id: 1, name: "warehouse-sync" } };
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/revoke")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === "POST") return Promise.resolve(jsonResponse(201, fresh));
      return Promise.resolve(jsonResponse(200, { items: CLIENTS }));
    });
    renderWithProviders(<IntegrationClients />);
    await screen.findByText("warehouse-sync");
    await userEvent.type(screen.getByLabelText("Client name"), "warehouse-sync");
    await userEvent.click(screen.getByRole("button", { name: "Add client" }));
    await screen.findByText(/shown only once/);

    await userEvent.click(screen.getByLabelText("Revoke API key of warehouse-sync"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByText(/shown only once/)).toBeNull());
  });

  test("an already-revoked conflict maps to its message", async () => {
    setupMocks();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/revoke")) {
        return Promise.resolve(jsonResponse(409, {}));
      }
      return Promise.resolve(jsonResponse(200, { items: CLIENTS }));
    });
    renderWithProviders(<IntegrationClients />);
    await screen.findByText("warehouse-sync");
    await userEvent.click(screen.getByLabelText("Revoke API key of warehouse-sync"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("This client is already revoked.")).toBeInTheDocument();
  });

  test("a failed list load surfaces the titled error alert", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, {})));
    renderWithProviders(<IntegrationClients />);
    expect(await screen.findByText("Failed to load the integration clients")).toBeInTheDocument();
  });
});
