import {
  test,
  expect,
  login,
  contentEditor,
  typeContent,
  pickSelectOption,
  gotoUserRow,
  uniqueText,
  ADMIN,
} from "./helpers";

// Template CRUD (ADMIN-only writes) plus the one place templates are consumed: the "Insert"
// picker in the feedback editor. Uses a throwaway template; templates.name is freed on
// soft-delete (partial unique index), so repeated runs never collide anyway.
test("admin creates, edits, views, inserts, and deletes a template", async ({ page }) => {
  const name = uniqueText("E2E-Template");
  const renamed = `${name}-renamed`;
  const content = uniqueText("E2E template body");
  await login(page, ADMIN);

  // Create.
  await page.goto("/templates/new");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await typeContent(page, content);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/templates") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  const id: number = (await created.json()).id;

  // It lists (filtered by its unique name) with a content preview.
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  await expect(page.getByText(content).first()).toBeVisible();

  // Rename via edit.
  await page.goto(`/templates/${id}/edit`);
  await page.getByRole("textbox", { name: "Name" }).fill(renamed);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/templates/${id}`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);

  // The read-only view renders the renamed template and its content.
  await page.goto(`/templates/${id}/view`);
  await expect(page.getByLabel("Name")).toHaveValue(renamed);
  await expect(page.getByText(content)).toBeVisible();

  // Insert into a feedback draft: the editor's Template picker pulls the content in.
  await gotoUserRow(page, "AAA One");
  await page.getByRole("link", { name: "Provide feedback for AAA One" }).click();
  await pickSelectOption(page, "Template", renamed);
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(contentEditor(page)).toContainText(content);
  await page.getByRole("button", { name: "Cancel" }).click();
  // "Discard" is a Button with component={RouterLink} → it exposes the link role, not button.
  await page.getByRole("dialog").getByRole("link", { name: "Discard" }).click();

  // Delete from the filtered list.
  await page.goto("/templates");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  await page.getByRole("button", { name: `Delete ${renamed}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/templates/${id}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(page.getByText("No templates")).toBeVisible();
});
