import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import SharePeoplePicker from "./SharePeoplePicker";

const user = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `u${id}@x.test`,
  roles: [],
  deactivated: false,
  disabledFeatures: [],
  teams: [],
  ...extra,
});

const POOL = [
  user(7, "Me Caller"),
  user(11, "Ann Active"),
  user(12, "Ben Bystander"),
  user(14, "Dee Deactivated", { deactivated: true }),
  user(15, "Ed Eligible"),
];

function Harness({ excluded = [], maxValues, label }: { excluded?: number[]; maxValues?: number; label?: string }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <SharePeoplePicker
      value={value}
      onChange={setValue}
      excludedIds={new Set(excluded)}
      maxValues={maxValues}
      label={label}
    />
  );
}

describe("SharePeoplePicker", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", "[]");
    localStorage.setItem("lettuce.auth.userId", "7");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { items: POOL, page: 1, pageSize: 100, total: POOL.length }))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("offers everyone except the caller, deactivated accounts and the excluded ids", async () => {
    const userEv = userEvent.setup();
    renderWithProviders(<Harness excluded={[11]} />);
    await userEv.click(screen.getByRole("combobox", { name: "Share with" }));

    expect(await screen.findByRole("option", { name: /Ben Bystander/, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ed Eligible/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Me Caller/, hidden: true })).toBeNull();
    expect(screen.queryByRole("option", { name: /Dee Deactivated/, hidden: true })).toBeNull();
    expect(screen.queryByRole("option", { name: /Ann Active/, hidden: true })).toBeNull();
  });

  test("a custom label replaces the default and maxValues caps the selection", async () => {
    const userEv = userEvent.setup();
    renderWithProviders(<Harness maxValues={1} label="Recipients" />);
    await userEv.click(screen.getByRole("combobox", { name: "Recipients" }));

    await userEv.click(await screen.findByRole("option", { name: /Ben Bystander/, hidden: true }));
    expect(screen.getByRole("button", { name: /Ben Bystander/ })).toBeInTheDocument();
    // At the cap a further pick does nothing.
    await userEv.click(screen.getByRole("option", { name: /Ed Eligible/, hidden: true }));
    expect(screen.queryByRole("button", { name: /Ed Eligible/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Ben Bystander/ })).toBeInTheDocument();
  });
});
