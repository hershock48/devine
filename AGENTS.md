# Working in this repo as an agent

Two agents work in the Glazed Web repos: Claude (Claude Code sessions) and Codex (GPT). Kevin owns every decision. This file is the shared convention. The rules themselves live in the glaze kit in the `glazedweb` repo, which sits beside this one at `../glazedweb`.

## Read first, every session

1. `../glazedweb/glaze.md`, then `../glazedweb/glaze/standards.md`. They govern copy and code in every hershock48 repo. No em dashes anywhere. American spelling. Write like a person: the tells are listed in standards.md.
2. `../glazedweb/glaze/handoff.md`. The inbox between the two agents. Read every entry since your last session before touching anything. Write an entry when you hand off, dispute, or finish something the other agent depends on.
3. `../glazedweb/glaze/backlog.md`. The one backlog. Every item has an owner. Only the owner changes an item's status. The other agent reviews.
4. `../glazedweb/glaze/catalog/` before building any tool, harness, form flow, checkout, auth scheme, admin surface or asset pipeline. Add the row in the same commit that builds one.

## Lanes

- **Codex owns** the ledger authority and studio dashboard, shared components and their client copies, workrooms and owner controls, kitchen, printer and payment code, account economics.
- **Claude owns** pitches, proposals, letters, client-facing copy, prospecting and the send pipeline, the studio site's copy and brand.
- **Kevin owns** prices, agreements, anything a client sees before it is sent, and every merge to main.

Work outside your lane only through a handoff entry the owner has answered.

## Branches and identity

- New branches are `codex/<topic>` or `claude/<topic>`. Never commit to main.
- Codex ends every commit message with `Co-Authored-By: Codex <noreply@openai.com>`. Claude ends with its own Claude trailer. Kevin's hand commits carry neither. That is how the three are told apart.
- Nothing merges to main without the other agent's review recorded on the pull request. Reviews are logged with `node ../glazedweb/glaze/scripts/score.mjs add`, which is the studio's record of which model gets what right.
- Git author identity is the GitHub noreply address. `kevin@glazedweb.com` blocks Vercel deploys of private repos.

## Working tree etiquette

- A dirty working tree belongs to whoever is mid-task. Never stash, reset, checkout, or clean it. Commit only your own paths.
- Pull before push. Rebase or squash only an unpushed branch of your own; the component manifests pin commit SHAs and a rewritten SHA breaks every pin.
- Keep the reasoning comments. Do not minify code or strip file headers. Every glaze script carries a usage header at the top.
- The commit message names every behavior change in the diff, including cookie flags, rate limits, TLS and anything a client could notice.
- Assert before you write. A scripted edit to a doctrine file is checked by reading the result, not by trusting the regex.

## Disputes

Put the objection and the evidence in handoff.md. A failing test or a measured number settles it. Two rounds, then both positions go to Kevin with a recommendation. No silent override in either direction.

## Facts

Facts live in one place; point at them, never copy them. Prices and payment status come from `../glazedweb/lib/customOrders.js` on main, which Kevin edits. The ledger authority question (dashboard snapshot versus registry) is open in handoff.md; until it is settled, the registry is the price of record and the dashboard is the record of events.
