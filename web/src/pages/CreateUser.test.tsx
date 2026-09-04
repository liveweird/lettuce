import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateUser from "./CreateUser";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const PASSWORD_RE = /^[A-Za-z0-9_-]{16}$/;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderCreateUser() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/users/new"]}>
          <Routes>
            <Route path="/users/new" element={<CreateUser />} />
            <Route path="/users" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/name/i), "Alice");
  await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
}

// URL-routed mock: the page fetches the three dictionaries on mount, so sequential
// mockResolvedValueOnce chains would be consumed by the wrong request.
function mockApi(
  postStatus: number,
  postBody?: unknown,
  dictionaries: Record<string, { id: number; valueEn: string; valuePl: string }[]> = {},
): ReturnType<typeof vi.fn> {
  const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
  mockFetch.mockImplementation((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url.startsWith("/api/v1/dictionaries/")) {
      const slug = url.split("/").pop()!;
      return Promise.resolve(jsonResponse(200, { items: dictionaries[slug] ?? [] }));
    }
    if (method === "POST") {
      return Promise.resolve(
        postBody === undefined
          ? new Response("{}", { status: postStatus, headers: { "Content-Type": "application/json" } })
          : jsonResponse(postStatus, postBody),
      );
    }
    return Promise.resolve(jsonResponse(500, {}));
  });
  return mockFetch;
}

function postBodyOf(mockFetch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const postCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
  expect(postCall).toBeDefined();
  return JSON.parse((postCall![1] as { body: string }).body);
}

const CREATED_USER = {
  id: 42,
  name: "Alice",
  email: "alice@example.com",
  roles: [] as string[],
  careerPath: null,
  careerSpecialization: null,
  seniorityLevel: null,
};

describe("CreateUser page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  });

  test("posts a generated password and reveals it once in the confirmation modal", async () => {
    const mockFetch = mockApi(201, CREATED_USER);

    const user = userEvent.setup();
    renderCreateUser();

    // No password inputs on the form anymore.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // The confirmation modal shows the exact password that was POSTed.
    expect(await screen.findByText("User created")).toBeInTheDocument();
    const body = postBodyOf(mockFetch);
    // Unset career fields are OMITTED — no extra keys on the wire.
    expect(body).toEqual({
      name: "Alice",
      email: "alice@example.com",
      language: "en",
      password: expect.stringMatching(PASSWORD_RE),
      roles: [],
      sendEmail: false,
    });
    const password = body.password as string;
    // Masked by default (shoulder-surfing protection); the eye toggle reveals it.
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(screen.getByText("*".repeat(password.length))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(screen.getByText(password)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy password/i })).toBeInTheDocument();
    // Still on the form route until the admin closes the confirmation.
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("closing the confirmation navigates away and the password is gone for good", async () => {
    const mockFetch = mockApi(201, CREATED_USER);

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("User created");
    const password = postBodyOf(mockFetch).password as string;

    await user.click(screen.getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users"));
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
  });

  test("copy button copies the generated password to the clipboard", async () => {
    const mockFetch = mockApi(201, CREATED_USER);
    // userEvent.setup() installs a working clipboard stub; read it back after copying.
    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("User created");

    await user.click(screen.getByRole("button", { name: /copy password/i }));

    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
    const password = postBodyOf(mockFetch).password as string;
    await expect(window.navigator.clipboard.readText()).resolves.toBe(password);
  });

  test("onboarding-email link opens a pre-filled mailto draft", async () => {
    const mockFetch = mockApi(201, CREATED_USER);

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("User created");
    const password = postBodyOf(mockFetch).password as string;

    const link = screen.getByRole("link", { name: /compose onboarding email/i });
    const href = link.getAttribute("href")!;
    // RFC 6068: the "@" must stay literal or mail clients leave the To: field empty.
    expect(href).toMatch(/^mailto:alice@example\.com\?/);

    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Your Lettuce account is ready");
    const body = params.get("body")!;
    expect(body).toContain("Hi Alice,");
    expect(body).toContain(`Sign in at ${window.location.origin}`);
    expect(body).toContain(password);
    // RFC 6068: mailto bodies use CRLF line breaks.
    expect(body).toContain("\r\n");
  });

  test("the email checkbox posts sendEmail and the modal confirms delivery", async () => {
    const mockFetch = mockApi(201, { ...CREATED_USER, emailSent: true });

    const user = userEvent.setup();
    renderCreateUser();
    await fillValidForm(user);
    await user.click(screen.getByLabelText(/email the credentials/i));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await screen.findByText("User created");
    expect(postBodyOf(mockFetch).sendEmail).toBe(true);
    expect(screen.getByText(/credentials have been emailed to alice@example.com/i)).toBeInTheDocument();
  });

  test("a failed delivery shows the warning but keeps the account flow intact", async () => {
    mockApi(201, { ...CREATED_USER, emailSent: false });

    const user = userEvent.setup();
    renderCreateUser();
    await fillValidForm(user);
    await user.click(screen.getByLabelText(/email the credentials/i));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await screen.findByText("User created");
    expect(screen.getByText(/email could not be delivered/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy password/i })).toBeInTheDocument();
  });

  test("503 with the email option shows the mail-unavailable message", async () => {
    mockApi(503);

    const user = userEvent.setup();
    renderCreateUser();
    await fillValidForm(user);
    await user.click(screen.getByLabelText(/email the credentials/i));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/cannot send email/i)).toBeInTheDocument();
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
  });

  test("409 surfaces an email-field error and keeps the user on the form", async () => {
    mockApi(409, { error: "conflict", message: "Resource already exists" });

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/email already in use/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
  });

  test("a filled unique id is POSTed trimmed; empty is omitted", async () => {
    const mockFetch = mockApi(201, CREATED_USER);

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.type(screen.getByLabelText("Unique ID"), " EMP-42 ");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText("User created")).toBeInTheDocument();
    expect(postBodyOf(mockFetch).uniqueId).toBe("EMP-42");
    // The default (untouched) field never puts the key on the wire — the "posts a
    // generated password" test's exact-body assertion pins the omitted case.
  });

  test("a 409 naming the unique id attributes the error to the Unique ID field", async () => {
    mockApi(409, { detail: "Unique id already in use" });

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.type(screen.getByLabelText("Unique ID"), "EMP-taken");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/unique id already in use/i)).toBeInTheDocument();
    expect(screen.queryByText(/email already in use/i)).not.toBeInTheDocument();
    expect(screen.queryByText("User created")).not.toBeInTheDocument();
  });

  test("other API errors surface a banner", async () => {
    mockApi(500);

    const user = userEvent.setup();
    renderCreateUser();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/create failed \(500\)/i)).toBeInTheDocument();
  });

  test("client-side validation blocks empty submission", async () => {
    const mockFetch = mockApi(201, CREATED_USER);

    const user = userEvent.setup();
    renderCreateUser();

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/name must be 1–50 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    const postCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(postCall).toBeUndefined();
  });

  test("Cancel leaves a clean form at once and asks before discarding typed input (v3.5.0)", async () => {
    mockApi(201, CREATED_USER);
    const user = userEvent.setup();
    renderCreateUser();

    await user.type(screen.getByLabelText(/^name/i), "Alice");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Discard changes?");
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear name/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(await screen.findByTestId("probe")).toHaveTextContent("/users");
  });

  test("non-admin is redirected to /users", async () => {
    localStorage.setItem(ROLE_KEY, "[]");

    renderCreateUser();

    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(screen.queryByRole("heading", { name: /new user/i })).not.toBeInTheDocument();
  });
});
