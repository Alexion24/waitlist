# Waitlist project guide

## Product

- Keep this a simple, unbranded Russian-language launch waitlist. The landing page “Будьте в числе первых” asks for one email address and confirms signup on the page.
- Save each normalized email once. At launch, automatically send one email with the live URL to each subscriber. After launch, show the live link in place of the signup form.
- Keep development local. Deploy, connect a live sender, or send real email only when the user authorizes that action. The future deployment hook should invoke the existing launch command after the main site is available.

## Stack and boundaries

- Use Node.js 24+ and JavaScript ES modules. `app.js` serves the site and JSON API with `node:http`, stores data with `node:sqlite`, and handles the launch command.
- Keep the frontend in `public/` using plain HTML, CSS, and browser JavaScript. Preserve accessible labels, keyboard operation, and visible feedback for success and errors.
- Prefer built-in APIs and the existing dependency-free setup. Add a dependency only when it solves a concrete requirement the current stack cannot handle cleanly.
- Keep SQLite data, the local email outbox, and secrets out of source control. Use `WAITLIST_DATA_DIR` to isolate test data. Keep `RESEND_API_KEY` and `EMAIL_FROM` on the server and never log credentials or subscriber addresses.
- Preserve database-enforced deduplication and retry behavior. Mark a message sent only after the local file is saved or Resend accepts it. Keep the per-subscriber idempotency key stable across retries.

## JavaScript rules

- Never use unsafe shortcuts such as `eval`, `new Function`, inline event handlers, or `innerHTML` with untrusted data. Use DOM APIs such as `textContent` and validate URLs before assigning them to links.
- Use `const` by default and `let` for reassignment. Avoid `var`, implicit globals, loose equality, and unclear coercion. Use descriptive names and straightforward control flow.
- Validate input on the server even if the browser validates it. Bound request bodies and parameterize SQL. Treat input, stored URLs, and third-party responses as untrusted.
- Await asynchronous work, check HTTP status explicitly, and handle errors at the boundary that can report or recover from them. Never silently swallow failures that affect signup, persistence, or delivery.

## Working agreement

- Use `$karpathy-guidelines` for code tasks. Inspect narrowly, reuse existing code, make the smallest complete change, and verify the affected behavior with focused checks.
- When the user asks for planning only, outline the plan and ask only questions that affect the build. Wait for the user to ask for implementation before editing.
- Keep updates brief. During long-running commands, report only new information in one sentence.

## Local checks

- Start with `node app.js` and open `http://127.0.0.1:3000/`. For JS edits, run `node --check` on the changed JS files.
- To test signup or launch changes, use a fresh `WAITLIST_DATA_DIR` in both terminals and synthetic addresses. Check invalid email, duplicate signup, and confirmation in the browser when relevant.
- With Resend settings unset, run `node app.js launch https://example.com`. Verify one `.eml` per subscriber in the test outbox, a live link after reload, and zero new messages when the same command runs again. Mock the provider for delivery failure and retry checks.
