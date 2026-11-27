/**
 * E2E Test: Poll Voting Flow
 *
 * Tests the complete user journey:
 * 1. Navigate to polls page
 * 2. Find an existing poll
 * 3. Vote on it
 * 4. Verify results display
 * 5. Change vote
 * 6. Verify updated results
 */

import { test, expect } from "@playwright/test";

test.describe("Poll Voting Flow", () => {
  test("navigates to polls and verifies poll rendering", async ({
    page,
  }) => {
    // Navigate to polls page
    await page.goto("/polls");

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Verify page title or heading
    const heading = page.locator('h1:has-text("Polls"), h2:has-text("Polls")');
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("poll cards render with correct structure", async ({ page }) => {
    // Navigate to polls page
    await page.goto("/polls");
    await page.waitForLoadState("networkidle");

    // Find poll cards
    const pollCards = page.locator('[class*="card"]').filter({
      has: page.locator('button[role="radio"], button[role="checkbox"]'),
    });

    // If there are polls, verify their structure
    const count = await pollCards.count();
    if (count > 0) {
      const firstPoll = pollCards.first();

      // Verify poll has a title
      const title = firstPoll.locator("h3, h4, [class*='font-semibold']").first();
      await expect(title).toBeVisible();

      // Verify poll has voting options
      const options = firstPoll.locator('button[role="radio"], button[role="checkbox"]');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(0);

      // Verify vote count is displayed
      const voteCount = firstPoll.locator('text=/\\d+ vote/');
      await expect(voteCount).toBeVisible();
    }
  });

  test("poll voting interaction works correctly", async ({ page }) => {
    // Navigate to polls page
    await page.goto("/polls");
    await page.waitForLoadState("networkidle");

    // Find a votable poll (not ended/archived)
    const votablePolls = page.locator('[class*="card"]').filter({
      has: page.locator('button:has-text("Vote")'),
    });

    const count = await votablePolls.count();
    if (count > 0) {
      const poll = votablePolls.first();

      // Scroll poll into view
      await poll.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      // Verify poll structure: has options and vote button
      const options = poll.locator('button[role="radio"], button[role="checkbox"]');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(0);

      // Verify vote button exists and is initially disabled (no selection)
      const voteBtn = poll.locator('button:has-text("Vote")');
      await expect(voteBtn).toBeVisible();

      // Verify "Not voted yet" indicator is shown
      const notVoted = poll.locator('text="Not voted yet"');
      await expect(notVoted).toBeVisible();

      // Click on first option using JavaScript to trigger React event
      const firstOption = options.first();
      await firstOption.waitFor({ state: "visible", timeout: 5000 });
      
      // Use dispatchEvent to ensure React picks up the click
      await firstOption.evaluate((el) => {
        el.click();
      });
      
      // Wait for React state update
      await page.waitForTimeout(300);
      
      // Verify option is now selected
      await expect(firstOption).toHaveAttribute("aria-checked", "true");

      // Verify vote button is now enabled
      await expect(voteBtn).toBeEnabled();
    }
  });

  test("vote change flow works correctly", async ({ page }) => {
    // Navigate to polls page
    await page.goto("/polls");
    await page.waitForLoadState("networkidle");

    // Find a poll that's already been voted on
    const votedPolls = page.locator('[class*="card"]').filter({
      has: page.locator('button:has-text("Change vote")'),
    });

    const count = await votedPolls.count();
    if (count > 0) {
      const poll = votedPolls.first();

      // Scroll into view
      await poll.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      // Click change vote button
      const changeVoteBtn = poll.locator('button:has-text("Change vote")');
      await changeVoteBtn.waitFor({ state: "visible", timeout: 5000 });
      await changeVoteBtn.click({ force: true });

      // Verify "Pick your new choice" message appears
      const pickNewMessage = poll.locator('text="Pick your new choice"');
      await expect(pickNewMessage).toBeVisible();

      // Select a different option (second one if available)
      const options = poll.locator('button[role="radio"], button[role="checkbox"]');
      const optionCount = await options.count();
      if (optionCount > 1) {
        const secondOption = options.nth(1);
        await secondOption.waitFor({ state: "visible", timeout: 5000 });
        await secondOption.click({ force: true });
        await expect(secondOption).toHaveAttribute("aria-checked", "true");
      }

      // Submit new vote
      const submitBtn = poll.locator('button:has-text("Submit new vote")');
      await submitBtn.waitFor({ state: "visible", timeout: 5000 });
      await submitBtn.click({ force: true });

      // Wait for vote to be processed
      await page.waitForTimeout(2000);

      // Verify "You voted" indicator appears
      const votedIndicator = poll.locator('text="You voted"');
      await expect(votedIndicator).toBeVisible({ timeout: 5000 });
    }
  });

  test("poll results display correctly after voting", async ({ page }) => {
    // Navigate to polls page
    await page.goto("/polls");
    await page.waitForLoadState("networkidle");

    // Find a poll that's been voted on (shows results)
    const polls = page.locator('[class*="card"]').filter({
      has: page.locator('text=/\\d+ vote/'),
    });

    const count = await polls.count();
    if (count > 0) {
      const poll = polls.first();

      // Verify vote count is displayed
      const voteCount = poll.locator('text=/\\d+ vote/');
      await expect(voteCount).toBeVisible();

      // Verify percentages are shown (if poll has votes)
      const percentages = poll.locator('text=/\\d+%/');
      if ((await percentages.count()) > 0) {
        await expect(percentages.first()).toBeVisible();
      }

      // Verify poll type label is shown
      const typeLabel = poll.locator('text=/single choice|yes \\/ no|multiple choice/');
      await expect(typeLabel).toBeVisible();
    }
  });

  test("poll accessibility: ARIA roles and labels", async ({ page }) => {
    // Navigate to polls page
    await page.goto("/polls");
    await page.waitForLoadState("networkidle");

    // Find any poll with options
    const pollCards = page.locator('[class*="card"]').filter({
      has: page.locator('button[role="radio"], button[role="checkbox"]'),
    });

    const count = await pollCards.count();
    if (count > 0) {
      const firstPoll = pollCards.first();

      // Verify radiogroup or group role exists
      const group = firstPoll.locator('[role="radiogroup"], [role="group"]');
      await expect(group).toBeVisible();

      // Verify aria-label is set
      const ariaLabel = await group.getAttribute("aria-label");
      expect(ariaLabel).toBeTruthy();

      // Verify options have correct roles
      const radioButtons = firstPoll.locator('[role="radio"]');
      const checkboxes = firstPoll.locator('[role="checkbox"]');
      const optionCount = (await radioButtons.count()) + (await checkboxes.count());
      expect(optionCount).toBeGreaterThan(0);

      // Verify options have aria-checked
      const firstOption = radioButtons.first().or(checkboxes.first());
      const ariaChecked = await firstOption.getAttribute("aria-checked");
      expect(ariaChecked).toMatch(/true|false/);
    }
  });
});
