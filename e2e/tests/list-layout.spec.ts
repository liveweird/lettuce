import type { APIRequestContext, APIResponse, Locator, Page } from "@playwright/test";
import { apiToken, authHeader } from "./api";
import {
  ADMIN,
  expect,
  login,
  MANAGER_AAA,
  openFilters,
  switchLanguage,
  test,
  uniqueText,
} from "./helpers";

type CreatedUser = {
  id: number;
  name: string;
  email: string;
  password: string;
};

const VIEWPORTS = [1440, 1280, 1024, 390] as const;
const REPRESENTATIVE_TRANSLATED_VIEWPORTS = [1280, 390] as const;

async function expectApiOk(response: APIResponse, operation: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(`${operation} failed (${response.status()}): ${await response.text()}`);
  }
}

async function createUser(
  request: APIRequestContext,
  adminToken: string,
  data: Omit<CreatedUser, "id"> & { uniqueId?: string },
): Promise<CreatedUser> {
  const response = await request.post("/api/v1/users", {
    headers: authHeader(adminToken),
    data,
  });
  await expectApiOk(response, `create user ${data.email}`);
  const { id } = (await response.json()) as { id: number };
  return { id, name: data.name, email: data.email, password: data.password };
}

async function createFeedback(
  request: APIRequestContext,
  token: string,
  data: {
    requesterId?: number;
    subjectId: number;
    additionalSubjectIds?: number[];
    providerId: number;
    visibility: "PROVIDER_SUBJECT" | "PROVIDER_REQUESTER_SUBJECT" | "PUBLIC";
    status: "REQUESTED" | "DRAFT" | "SENT";
    content?: string;
    requesterMessage?: string;
    expiresOn?: string;
  },
): Promise<number> {
  const response = await request.post("/api/v1/feedbacks", {
    headers: authHeader(token),
    data,
  });
  await expectApiOk(response, `create ${data.status.toLowerCase()} feedback`);
  return ((await response.json()) as { id: number }).id;
}

async function expectPageContained(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      })),
    )
    .toMatchObject({ viewport: page.viewportSize()!.width, content: page.viewportSize()!.width });
}

async function expectHorizontallyInViewport(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    return box != null && viewport != null && box.x >= 0 && box.x + box.width <= viewport.width + 0.5;
  }).toBe(true);
}

async function expectTextUnclipped(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(element);
        const textBounds = text.getBoundingClientRect();
        return {
          horizontalScrollFits: element.scrollWidth <= element.clientWidth + 1,
          verticalScrollFits: element.scrollHeight <= element.clientHeight + 1,
          textFitsHorizontally:
            textBounds.left >= bounds.left - 1 && textBounds.right <= bounds.right + 1,
          textFitsVertically:
            textBounds.top >= bounds.top - 1 && textBounds.bottom <= bounds.bottom + 1,
        };
      }),
    )
    .toEqual({
      horizontalScrollFits: true,
      verticalScrollFits: true,
      textFitsHorizontally: true,
      textFitsVertically: true,
    });
}

async function expectAllRowActionsInViewport(page: Page, table: Locator): Promise<void> {
  const actions = table.locator("tbody td:last-child a, tbody td:last-child button");
  const actionCount = await actions.count();
  expect(actionCount).toBeGreaterThan(0);
  for (let index = 0; index < actionCount; index += 1) {
    await expectHorizontallyInViewport(page, actions.nth(index));
  }
}

async function setViewport(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 1000 });
  await expectPageContained(page);
}

test("list rows stay contained and usable across desktop and mobile widths", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const stamp = uniqueText("layout");
  const password = `e2e-layout-${stamp}`;
  const nameOfLength = (prefix: string, length: number, fill: string) =>
    `${prefix}${stamp}`.padEnd(length, fill).slice(0, length);
  const adminToken = await apiToken(request, ADMIN);
  const users: CreatedUser[] = [];
  const recipients: CreatedUser[] = [];
  let teamId: number | undefined;
  let viewerToken: string | undefined;
  let receivedProviderToken: string | undefined;
  let receivedId: number | undefined;
  let groupId: number | undefined;
  let draftId: number | undefined;
  let requestedId: number | undefined;

  try {
    const viewer = await createUser(request, adminToken, {
      name: nameOfLength("E2ELayoutViewer", 46, "V"),
      email: `e2e-layout-viewer-${stamp}@lettuce.local`,
      password,
    });
    users.push(viewer);
    const requester = await createUser(request, adminToken, {
      name: nameOfLength("AleksandraMariaKonstantynopolitanska", 50, "R"),
      email: `e2e-layout-requester-${stamp}@lettuce.local`,
      password,
    });
    users.push(requester);
    const receivedProvider = await createUser(request, adminToken, {
      name: nameOfLength("E2ELayoutReceivedProvider", 50, "P"),
      email: `e2e-layout-received-provider-${stamp}@lettuce.local`,
      password,
    });
    users.push(receivedProvider);
    for (const suffix of ["Alpha", "Beta", "Gamma"] as const) {
      const user = await createUser(request, adminToken, {
        name: nameOfLength(`E2ELayoutRecipient${suffix}`, 50, suffix[0]),
        email: `e2e-layout-${suffix.toLowerCase()}-${stamp}-${"mail".repeat(14)}@lettuce.local`,
        password,
        uniqueId: nameOfLength(`LAYOUT-${suffix}-`, 50, suffix[0].toUpperCase()),
      });
      recipients.push(user);
      users.push(user);
    }

    const teamName = nameOfLength("E2E-Layout-Team-", 99, "T");
    const teamResponse = await request.post("/api/v1/teams", {
      headers: authHeader(adminToken),
      data: { name: teamName, managerId: requester.id, memberIds: [viewer.id] },
    });
    await expectApiOk(teamResponse, "create long-name team");
    teamId = ((await teamResponse.json()) as { id: number }).id;

    const requesterToken = await apiToken(request, requester.email, password);
    viewerToken = await apiToken(request, viewer.email, password);
    receivedProviderToken = await apiToken(request, receivedProvider.email, password);
    const receivedContent = `E2E received responsive preview ${stamp} ${"content ".repeat(12)}`;
    const groupContent = `E2E multiparty responsive preview ${stamp} ${"content ".repeat(12)}`;
    const draftContent = `E2E draft responsive preview ${stamp}`;
    const expiresOn = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    receivedId = await createFeedback(request, requesterToken, {
      requesterId: requester.id,
      subjectId: viewer.id,
      providerId: receivedProvider.id,
      visibility: "PROVIDER_REQUESTER_SUBJECT",
      status: "SENT",
      content: receivedContent,
      requesterMessage: `E2E long requester message ${stamp}`,
    });
    groupId = await createFeedback(request, viewerToken, {
      subjectId: recipients[0].id,
      additionalSubjectIds: [recipients[1].id, recipients[2].id],
      providerId: viewer.id,
      visibility: "PUBLIC",
      status: "SENT",
      content: groupContent,
    });
    draftId = await createFeedback(request, viewerToken, {
      subjectId: receivedProvider.id,
      providerId: viewer.id,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: draftContent,
    });
    requestedId = await createFeedback(request, requesterToken, {
      requesterId: requester.id,
      subjectId: recipients[0].id,
      providerId: viewer.id,
      visibility: "PROVIDER_REQUESTER_SUBJECT",
      status: "REQUESTED",
      requesterMessage: `E2E deadline request ${stamp}`,
      expiresOn,
    });

    await login(page, viewer.email, password);

    await page.goto("/feedback?tab=received");
    let table = page.getByRole("table");
    const receivedRow = table.getByRole("row").filter({ hasText: receivedContent });
    await expect(receivedRow).toBeVisible();
    for (const width of VIEWPORTS) {
      await setViewport(page, width);
      await expect(receivedRow.getByText(requester.name, { exact: true })).toBeVisible();
      await expect(receivedRow.getByText(receivedProvider.name, { exact: true })).toBeVisible();
      await expect(receivedRow.getByText(receivedContent, { exact: true })).toBeVisible();
      const receivedVisibilityPill = receivedRow.locator(
        '[title="Provider + requester + subject"]',
      );
      await expect(receivedVisibilityPill).toBeVisible();
      await expect(receivedVisibilityPill).toHaveText("P+R+S");
      await expectAllRowActionsInViewport(page, table);
    }

    const receivedView = receivedRow.getByRole("link", {
      name: `View feedback from ${receivedProvider.name}`,
    });
    await expectHorizontallyInViewport(page, receivedView);
    await receivedView.click();
    await expect(page).toHaveURL(new RegExp(`/feedback/${receivedId}/view`));
    await expect(page.getByText(receivedContent)).toBeVisible();

    await page.goto("/feedback?tab=provided");
    table = page.getByRole("table");
    const groupRow = table.getByRole("row").filter({ hasText: groupContent });
    const draftRow = table.getByRole("row").filter({ hasText: draftContent });
    const requestedRow = table.getByRole("row").filter({ hasText: requester.name });
    const groupView = groupRow.getByRole("link", {
      name: `View feedback for ${recipients.map((recipient) => recipient.name).join(", ")}`,
      exact: true,
    });
    const draftEdit = draftRow.getByRole("link", {
      name: `Edit feedback for ${receivedProvider.name}`,
      exact: true,
    });
    const requestedEdit = requestedRow.getByRole("link", {
      name: `Edit feedback for ${recipients[0].name}`,
      exact: true,
    });
    await expect(groupRow).toBeVisible();
    await expect(draftRow).toBeVisible();
    await expect(requestedRow).toBeVisible();
    await expect(groupView).toHaveAttribute("href", new RegExp(`/feedback/${groupId}/view`));
    await expect(draftEdit).toHaveAttribute("href", new RegExp(`/feedback/${draftId}/edit`));
    await expect(requestedEdit).toHaveAttribute("href", new RegExp(`/feedback/${requestedId}/edit`));
    for (const width of VIEWPORTS) {
      await setViewport(page, width);
      await expect(groupRow.getByText(groupContent, { exact: true })).toBeVisible();
      for (const recipient of recipients) {
        await expect(groupRow.getByText(recipient.name, { exact: true })).toBeVisible();
      }
      await expect(groupRow.getByText("Public", { exact: true })).toBeVisible();
      await expect(draftRow.getByText("Draft", { exact: true })).toBeVisible();
      await expect(requestedRow.getByText("Requested", { exact: true })).toBeVisible();
      await expect(requestedRow.getByText(/^Expires /)).toBeVisible();
      await expectHorizontallyInViewport(page, groupView);
      await expectHorizontallyInViewport(page, draftEdit);
      await expectHorizontallyInViewport(page, requestedEdit);
      await expectAllRowActionsInViewport(page, table);
    }

    const sortResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/feedbacks") &&
        response.url().includes("sort=lastModified") &&
        response.ok(),
    );
    await table.getByRole("button", { name: "Last modified", exact: true }).click();
    await sortResponse;
    await expect(groupRow).toBeVisible();

    await page.goto(
      `/users/${requester.id}/feedbacks?name=${encodeURIComponent(requester.name)}&from=users`,
    );
    await setViewport(page, 390);
    const receivedDirection = page.getByRole("tab", {
      name: `From ${requester.name} to you`,
    });
    const providedDirection = page.getByRole("tab", {
      name: `From you to ${requester.name}`,
    });
    await expectHorizontallyInViewport(page, receivedDirection);
    await expectHorizontallyInViewport(page, providedDirection);
    await expectTextUnclipped(receivedDirection);
    await expectTextUnclipped(providedDirection);
    await providedDirection.click();
    await expect(page).toHaveURL(/tab=provided/);
    await expectHorizontallyInViewport(page, receivedDirection);
    await expectHorizontallyInViewport(page, providedDirection);
    await expectTextUnclipped(receivedDirection);
    await expectTextUnclipped(providedDirection);
    await expectPageContained(page);

    await switchLanguage(page, "Polski");
    for (const [tab, rowText] of [
      ["received", receivedContent],
      ["provided", groupContent],
    ] as const) {
      await page.goto(`/feedback?tab=${tab}`);
      table = page.getByRole("table");
      const row = table.getByRole("row").filter({ hasText: rowText });
      await expect(row).toBeVisible();
      for (const width of REPRESENTATIVE_TRANSLATED_VIEWPORTS) {
        await setViewport(page, width);
        await expect(row.getByText(rowText, { exact: true })).toBeVisible();
        await expectAllRowActionsInViewport(page, table);
      }
      if (tab === "received") {
        const plVisibilityPill = row.locator('[title="Wystawiający + proszący + podmiot"]');
        await expect(plVisibilityPill).toBeVisible();
        await expect(plVisibilityPill).toHaveText("W+Pr+Po");
      } else {
        await expect(row.getByText("Publiczna", { exact: true })).toBeVisible();
        const deadlineRow = table.getByRole("row").filter({ hasText: requester.name });
        await expect(deadlineRow.getByText("Poproszono", { exact: true })).toBeVisible();
        await expect(deadlineRow.getByText(/^Wygasa /)).toBeVisible();
      }
    }

    await switchLanguage(page, "English");
    await page.goto("/users");
    await setViewport(page, 1440);
    await openFilters(page);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/users") &&
          response.url().includes("name=") &&
          response.ok(),
      ),
      page.getByLabel("Name", { exact: true }).fill(recipients[0].name),
    ]);
    table = page.getByRole("table");
    const userRow = table.getByRole("row").filter({ hasText: recipients[0].email });
    const teamsLink = userRow.getByRole("link", {
      name: `Teams for ${recipients[0].name}`,
      exact: true,
    });
    await expect(userRow).toBeVisible();
    for (const width of VIEWPORTS) {
      await setViewport(page, width);
      await expect(userRow.getByText(recipients[0].name, { exact: true })).toBeVisible();
      await expect(userRow.getByText(recipients[0].email, { exact: true })).toBeVisible();
      await expect(userRow.getByLabel("Unique ID")).toHaveText(/LAYOUT-Alpha-/);
      await expectHorizontallyInViewport(page, teamsLink);
      await expectAllRowActionsInViewport(page, table);
    }
    const feedbackMenu = userRow.getByRole("button", {
      name: `Feedback actions for ${recipients[0].name}`,
    });
    await expectHorizontallyInViewport(page, feedbackMenu);
    await feedbackMenu.click();
    await expect(
      page.getByRole("menuitem", { name: `Feedbacks with ${recipients[0].name}` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/teams");
    await setViewport(page, 1440);
    await openFilters(page);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/teams") &&
          response.url().includes("name=") &&
          response.ok(),
      ),
      page.getByLabel("Name", { exact: true }).fill(teamName),
    ]);
    table = page.getByRole("table");
    const teamRow = table.getByRole("row").filter({ hasText: teamName });
    const teamDetails = teamRow.getByRole("link", { name: `Team details for ${teamName}` });
    await expect(teamRow).toBeVisible();
    for (const width of VIEWPORTS) {
      await setViewport(page, width);
      await expect(teamRow.getByText(teamName, { exact: true })).toBeVisible();
      await expect(teamRow.getByText(requester.name, { exact: true })).toBeVisible();
      await expectHorizontallyInViewport(page, teamDetails);
    }

    await page.goto("/days-off?tab=calendar");
    await setViewport(page, 390);
    const calendar = page.getByRole("table", { name: "Team days-off calendar" });
    await expect(calendar).toBeVisible();
    const scrollState = await calendar.evaluate((element) => {
      let parent = element.parentElement;
      while (parent && parent.scrollWidth <= parent.clientWidth) parent = parent.parentElement;
      if (!parent) return null;
      const overflowX = getComputedStyle(parent).overflowX;
      const initial = parent.scrollLeft;
      parent.scrollLeft = parent.scrollWidth;
      return {
        overflowX,
        initial,
        after: parent.scrollLeft,
        clientWidth: parent.clientWidth,
        scrollWidth: parent.scrollWidth,
      };
    });
    expect(scrollState).not.toBeNull();
    expect(scrollState!.overflowX).toMatch(/auto|scroll/);
    expect(scrollState!.scrollWidth).toBeGreaterThan(scrollState!.clientWidth);
    expect(scrollState!.after).toBeGreaterThan(scrollState!.initial);
    await expectPageContained(page);
  } finally {
    const cleanup = async (response: Promise<APIResponse>, operation: string) => {
      const resolved = await response;
      if (!resolved.ok() && resolved.status() !== 404) {
        throw new Error(`${operation} failed (${resolved.status()}): ${await resolved.text()}`);
      }
    };
    if (requestedId != null && viewerToken != null) {
      await cleanup(
        request.post(`/api/v1/feedbacks/${requestedId}/reject`, { headers: authHeader(viewerToken) }),
        "reject layout request",
      );
    }
    if (draftId != null && viewerToken != null) {
      await cleanup(
        request.delete(`/api/v1/feedbacks/${draftId}`, { headers: authHeader(viewerToken) }),
        "delete layout draft",
      );
    }
    if (groupId != null && viewerToken != null) {
      await cleanup(
        request.post(`/api/v1/feedbacks/${groupId}/withdraw`, { headers: authHeader(viewerToken) }),
        "withdraw layout group feedback",
      );
    }
    if (receivedId != null && receivedProviderToken != null) {
      await cleanup(
        request.post(`/api/v1/feedbacks/${receivedId}/withdraw`, {
          headers: authHeader(receivedProviderToken),
        }),
        "withdraw layout received feedback",
      );
    }
    if (teamId != null) {
      await cleanup(
        request.delete(`/api/v1/teams/${teamId}`, { headers: authHeader(adminToken) }),
        "delete layout team",
      );
    }
    for (const user of users.reverse()) {
      await cleanup(
        request.delete(`/api/v1/users/${user.id}`, { headers: authHeader(adminToken) }),
        `delete layout user ${user.email}`,
      );
    }
  }
});

test("Team's performance table fits a 1280px laptop and still shows its rating numbers", async ({
  page,
  request,
}) => {
  // Manager AAA has a subordinate (Manager AAA's Team's-performance tab, seeded) — the rotated
  // rating headers (v3.11.1) are what let the 12-column matrix fit the default 900px minimum at
  // this width in both languages, instead of needing the pre-v3.11.1 wider override.
  //
  // This file OWNS the rated review it measures (v3.25.1): the demo seed ships none, and the
  // reviews other specs create are deleted at the end of their own runs — so without seeding,
  // the "no rating pill is clipped" assertion below would have nothing to measure and would
  // pass vacuously on a fresh stack. A throwaway subordinate in a throwaway team keeps it off
  // every other spec's state; both are removed afterwards.
  const adminToken = await apiToken(request, ADMIN);
  const stamp = Date.now();
  const password = "Layout-Rev-1234";
  // Display names carry only a short suffix (v4.3.1): a 13-digit stamp is an unbreakable token
  // that inflated the Team/member columns past anything a real org name does, so the fit
  // assertion measured the fixture rather than the table. The email keeps the full stamp.
  const shortStamp = String(stamp).slice(-5);
  const reviewee = await createUser(request, adminToken, {
    name: `E2E Rated ${shortStamp}`,
    email: `e2e-rated-${stamp}@lettuce.local`,
    password,
  });
  const managerId = await request
    .get(`/api/v1/users?email=${encodeURIComponent(MANAGER_AAA)}`, { headers: authHeader(adminToken) })
    .then(async (r) => {
      await expectApiOk(r, "find Manager AAA");
      return ((await r.json()) as { items: { id: number }[] }).items[0].id;
    });
  const teamResponse = await request.post("/api/v1/teams", {
    headers: authHeader(adminToken),
    data: { name: `E2E-Rated-${shortStamp}`, managerId, memberIds: [reviewee.id] },
  });
  await expectApiOk(teamResponse, "create the rated-review team");
  const ratedTeamId = ((await teamResponse.json()) as { id: number }).id;

  const managerToken = await apiToken(request, MANAGER_AAA);
  const periodsResponse = await request.get("/api/v1/review-periods", { headers: authHeader(managerToken) });
  await expectApiOk(periodsResponse, "list review periods");
  const periods = ((await periodsResponse.json()) as {
    items: { id: number; startMonth: string; endMonth: string }[];
  }).items;
  // The dashboard opens on the CURRENT period (an admin may pre-append future ones, and the
  // server refuses a review for a period that has not started), so the review must sit there.
  const nowMonth = new Date().toISOString().slice(0, 7);
  let periodId = periods.find((p) => p.startMonth <= nowMonth && nowMonth <= p.endMonth)?.id;
  if (periodId == null) {
    // A fresh stack has no timeline at all: append one that contains today, the way the
    // performance-reviews tutorial spec does.
    const created = await request.post("/api/v1/review-periods", {
      headers: authHeader(adminToken),
      data: { startMonth: nowMonth, endMonth: nowMonth },
    });
    await expectApiOk(created, "create a review period");
    periodId = ((await created.json()) as { id: number }).id;
  }
  const reviewResponse = await request.post("/api/v1/performance-reviews", {
    headers: authHeader(managerToken),
    data: { subordinateId: reviewee.id, periodId },
  });
  await expectApiOk(reviewResponse, "create the rated review");
  const reviewId = ((await reviewResponse.json()) as { id: number }).id;
  try {
    // Complete and submitted (v4.3.1): "Calibration" / "Kalibracja" is the longest single-word
    // status, the one the squeezed Status column used to split mid-word.
    const complete = (rating: number) => ({ rating, summary: "Layout check." });
    const rated = await request.put(`/api/v1/performance-reviews/${reviewId}`, {
      headers: authHeader(managerToken),
      data: {
        attitude: complete(5),
        delivery: complete(4),
        skills: complete(6),
        aptitude: complete(3),
        overall: complete(5),
      },
    });
    await expectApiOk(rated, "rate the review");
    const submitted = await request.post(`/api/v1/performance-reviews/${reviewId}/submit`, {
      headers: authHeader(managerToken),
    });
    await expectApiOk(submitted, "submit the review for calibration");

    await login(page, MANAGER_AAA);
    await page.setViewportSize({ width: 1280, height: 900 });

    async function expectTableFitsAndSorts(
      overallLabel: string,
      scrollHintText: RegExp,
      calibrationLabel: string,
    ): Promise<void> {
      await page.goto("/performance?tab=managed");
      const overallHeader = page.getByRole("button", { name: overallLabel, exact: true });
      await expect(overallHeader).toBeVisible();

      const region = page.getByRole("region");
      await expect(region).toBeVisible();
      await expect
        .poll(() => region.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
        .toBe(true);
      await expect(page.getByText(scrollHintText)).not.toBeVisible();

      // …and fitting must never be paid for with the CONTENT (v3.25.1): the rating pills used to
      // shrink inside those squeezed columns until Mantine's `overflow: hidden` badge label ate
      // the digit, leaving an empty coloured box. A clipped label is invisible to a DOM
      // assertion, so measure: every rating pill renders its whole number.
      const measured = await page.evaluate(() =>
        [...document.querySelectorAll("main table tbody [data-atomic] .mantine-Badge-label")].map((el) => ({
          text: (el.textContent || "").trim(),
          clientWidth: (el as HTMLElement).clientWidth,
          scrollWidth: (el as HTMLElement).scrollWidth,
        })),
      );
      // The seeded review guarantees a rated row, so an empty measurement means the selector (or
      // the page) broke — never that "nothing was clipped".
      expect(measured.length, "rating pills measured").toBeGreaterThanOrEqual(5);
      expect(
        measured.filter((m) => m.scrollWidth > m.clientWidth + 1),
        "rating pills whose digit is clipped",
      ).toEqual([]);

      // …nor with a WORD (v4.3.1): the Status column collapsed below its pill's longest word —
      // Mantine's `overflow: hidden` label contributed no min-content — and `break-word` split
      // "Publish|ed" / "Calibrat|ion" over two lines. Measure each word of every status pill
      // (StatusPill's `data-status-pill` — team badges are free text and may still break): a word
      // whose text range yields more than one line box was split.
      const statusWords = await page.evaluate(() =>
        [...document.querySelectorAll("main table tbody [data-status-pill] .mantine-Badge-label")].flatMap((label) => {
          const node = [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
          if (!node) return [];
          const text = node.textContent || "";
          const words: { word: string; lines: number }[] = [];
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            words.push({ word: match[0], lines: range.getClientRects().length });
          }
          return words;
        }),
      );
      expect(statusWords.map((w) => w.word), "the seeded review's status pill is measured").toContain(calibrationLabel);
      expect(
        statusWords.filter((w) => w.lines > 1),
        "status-pill words split over two lines",
      ).toEqual([]);

      // Sorting still works with the rotated header — the click toggles the field with no error.
      await overallHeader.click();
      await expect(overallHeader).toBeVisible();
    }

    await expectTableFitsAndSorts("Overall", /^Scroll horizontally to see all columns\.$/, "Calibration");

    // The language is server-synced (PUT /users/{id}/language) on a SHARED seed account, so
    // the revert must survive a failed Polish assertion — otherwise the residue strands
    // Manager AAA in Polish for every later form login on the long-lived e2e volume.
    await switchLanguage(page, "Polski");
    try {
      await expectTableFitsAndSorts("Ogólna", /^Przewiń w poziomie, aby zobaczyć wszystkie kolumny\.$/, "Kalibracja");
    } finally {
      await switchLanguage(page, "English");
    }
  } finally {
    // This file's own state goes back out whichever pass failed — the review first (revert the
    // calibration: only a DRAFT is deletable; a no-op 409 if the submit never happened), then the
    // team; the throwaway user rides the suite's residue sweep like every other spec's.
    await request.post(`/api/v1/performance-reviews/${reviewId}/revert`, { headers: authHeader(managerToken) });
    await request.delete(`/api/v1/performance-reviews/${reviewId}`, { headers: authHeader(managerToken) });
    await request.delete(`/api/v1/teams/${ratedTeamId}`, { headers: authHeader(adminToken) });
  }
});

test("dashboard subordinate card keeps the last-review dot and period on one line at 1440px", async ({
  page,
  request,
}) => {
  // A card-review layout fix (v4.x): the "Last review" row used to pair the period text with a
  // full status pill, which together outgrow the card's ~189px value column at 1440px (more in
  // Polish) and wrap the period onto its own line. The status now rides a colour dot instead,
  // and the row is forced onto one line — this file owns a throwaway subordinate + team + DRAFT
  // review for Manager AAA (the "Team's performance…" test's precedent above), removed at the end.
  const adminToken = await apiToken(request, ADMIN);
  const stamp = Date.now();
  const password = "Layout-Rev-1234";
  const reviewee = await createUser(request, adminToken, {
    name: `E2E Dot ${stamp}`,
    email: `e2e-dot-${stamp}@lettuce.local`,
    password,
  });
  const managerId = await request
    .get(`/api/v1/users?email=${encodeURIComponent(MANAGER_AAA)}`, { headers: authHeader(adminToken) })
    .then(async (r) => {
      await expectApiOk(r, "find Manager AAA");
      return ((await r.json()) as { items: { id: number }[] }).items[0].id;
    });
  const teamResponse = await request.post("/api/v1/teams", {
    headers: authHeader(adminToken),
    data: { name: `E2E-Dot-${stamp}`, managerId, memberIds: [reviewee.id] },
  });
  await expectApiOk(teamResponse, "create the dot-layout team");
  const dotTeamId = ((await teamResponse.json()) as { id: number }).id;

  const managerToken = await apiToken(request, MANAGER_AAA);
  const periodsResponse = await request.get("/api/v1/review-periods", { headers: authHeader(managerToken) });
  await expectApiOk(periodsResponse, "list review periods");
  const periods = ((await periodsResponse.json()) as {
    items: { id: number; startMonth: string; endMonth: string }[];
  }).items;
  const nowMonth = new Date().toISOString().slice(0, 7);
  let periodId = periods.find((p) => p.startMonth <= nowMonth && nowMonth <= p.endMonth)?.id;
  if (periodId == null) {
    const created = await request.post("/api/v1/review-periods", {
      headers: authHeader(adminToken),
      data: { startMonth: nowMonth, endMonth: nowMonth },
    });
    await expectApiOk(created, "create a review period");
    periodId = ((await created.json()) as { id: number }).id;
  }
  // A CALIBRATION review: its pill ("Calibration") is one of the two long ones that used to push
  // the row onto a second line at this width — a "Draft" pill fitted beside the period even in
  // the old layout, so a DRAFT fixture would pass on the very bug this guards.
  const reviewResponse = await request.post("/api/v1/performance-reviews", {
    headers: authHeader(managerToken),
    data: { subordinateId: reviewee.id, periodId },
  });
  await expectApiOk(reviewResponse, "create the review");
  const reviewId = ((await reviewResponse.json()) as { id: number }).id;
  const complete = (rating: number) => ({ rating, summary: "Layout check." });
  const filled = await request.put(`/api/v1/performance-reviews/${reviewId}`, {
    headers: authHeader(managerToken),
    data: {
      attitude: complete(5),
      delivery: complete(4),
      skills: complete(6),
      aptitude: complete(3),
      overall: complete(5),
    },
  });
  await expectApiOk(filled, "complete the review");
  const submitted = await request.post(`/api/v1/performance-reviews/${reviewId}/submit`, {
    headers: authHeader(managerToken),
  });
  await expectApiOk(submitted, "submit the review for calibration");

  await login(page, MANAGER_AAA);
  await page.setViewportSize({ width: 1440, height: 1000 });
  try {
    await page.goto("/?tab=subordinates");
    // Scope to THIS spec's card — Manager AAA's other reports carry a "Last review" row too.
    const card = page
      .locator("div")
      .filter({ has: page.getByText(reviewee.name, { exact: true }) })
      .filter({ has: page.getByText("Last review", { exact: true }) })
      .last();
    const label = card.getByText("Last review", { exact: true });
    await expect(label).toBeVisible();

    // The row's value cell: the colour dot (aria-hidden) beside the period text. The period is
    // located by its TEXT, never by position: under the old layout it was the first child and a
    // status pill (itself holding an aria-hidden dot) the second, so a positional pick would
    // measure the pill's own dot against the pill and pass on the very bug this guards.
    const valueGroup = label.locator("xpath=following-sibling::*[1]");
    const dot = valueGroup.locator('[aria-hidden="true"]').first();
    const period = valueGroup.getByText(/\d{4}/).first();
    await expect(dot).toBeVisible();
    await expect(period).toBeVisible();
    const dotBox = await dot.boundingBox();
    const periodBox = await period.boundingBox();
    if (dotBox == null || periodBox == null) throw new Error("last-review dot/period not measurable");
    const dotCenter = dotBox.y + dotBox.height / 2;
    const periodCenter = periodBox.y + periodBox.height / 2;
    expect(Math.abs(dotCenter - periodCenter)).toBeLessThanOrEqual(2);
  } finally {
    // Only a DRAFT is deletable: revert the calibration first.
    await request.post(`/api/v1/performance-reviews/${reviewId}/revert`, { headers: authHeader(managerToken) });
    await request.delete(`/api/v1/performance-reviews/${reviewId}`, { headers: authHeader(managerToken) });
    await request.delete(`/api/v1/teams/${dotTeamId}`, { headers: authHeader(adminToken) });
  }
});
