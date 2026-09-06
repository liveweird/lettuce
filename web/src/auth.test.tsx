import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { RequireAuth } from "./auth";
import { persistSession } from "./api/session";

const SESSION_SYNC_KEY = "lettuce.auth.sessionSync";

function StatefulPrivatePage() {
  const [value, setValue] = useState("");
  return <input aria-label="private draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

describe("authenticated session boundary", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("a direct cross-tab identity switch remounts authenticated component state", async () => {
    persistSession({
      token: "a-access",
      expiresAt: 1,
      refreshToken: "a-refresh",
      refreshExpiresAt: 2,
      roles: [],
      userId: 7,
      disabledFeatures: [],
      language: "en",
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route index element={<StatefulPrivatePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("private draft"), "user A draft");
    const oldMarker = localStorage.getItem(SESSION_SYNC_KEY);

    localStorage.setItem("lettuce.auth.token", "b-access");
    localStorage.setItem("lettuce.auth.refreshToken", "b-refresh");
    localStorage.setItem("lettuce.auth.userId", "8");
    const newMarker = JSON.stringify({ boundaryId: "user-b", revision: "user-b:1" });
    localStorage.setItem(SESSION_SYNC_KEY, newMarker);
    act(() => {
      // Simulate a delayed older refresh event: the handler must inspect the latest stored
      // marker (user B), not this stale event payload.
      window.dispatchEvent(new StorageEvent("storage", {
        key: SESSION_SYNC_KEY,
        oldValue: oldMarker,
        newValue: JSON.stringify({ boundaryId: "user-a", revision: "stale-refresh" }),
        storageArea: localStorage,
      }));
    });

    expect(screen.getByLabelText("private draft")).toHaveValue("");

    await user.type(screen.getByLabelText("private draft"), "user B draft");
    act(() => {
      // A credential event from the same completed transaction may be delivered after its
      // marker. It must not create a second, false boundary.
      window.dispatchEvent(new StorageEvent("storage", {
        key: "lettuce.auth.token",
        oldValue: "a-access",
        newValue: "b-access",
        storageArea: localStorage,
      }));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByLabelText("private draft")).toHaveValue("user B draft");
  });

  test("a cross-tab localStorage.clear signs out a marker-less legacy session", () => {
    localStorage.setItem("lettuce.auth.token", "legacy-access");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/login" element={<p>Signed out</p>} />
          <Route element={<RequireAuth />}>
            <Route index element={<StatefulPrivatePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    });

    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });
});
