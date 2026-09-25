---
description: "Pick the most valuable docs/TODO.md items and implement each on its own branch off main, with a commit after every logical step — designed to run unattended."
agent: agent
argument-hint: "(optional) how many items to pick, default 3"
---

# Work on TODO

Autonomous pass over [docs/TODO.md](../../docs/TODO.md). Use this when the user wants unattended
progress on the backlog ("work on todo", "go through the TODO list", ...). Nobody is watching —
prefer stopping and reporting over guessing on anything ambiguous.

## 0. Preconditions

- Check `git status --short`:
  - empty: continue;
  - `docs/TODO.md` itself has uncommitted changes: commit it on `main` on its own
    (`git commit -m "..." -- docs/TODO.md`) before anything else, instead of stashing it — it's the
    reference list every branch is created from and removes its bullet from; stashing it would
    hide the user's latest edits from that list for the whole run and only bring them back at the
    very end, after every branch already picked and removed bullets against the stale version;
  - a handful of small, unrelated edits and/or untracked files besides `docs/TODO.md` (a few files,
    small diffs, nothing that reads like an in-progress feature): set them aside with
    `git stash push -u -m "work-on-todo: autostash before autonomous run" -- <paths, excluding
    docs/TODO.md>` and continue — restore it in step 3, once every selected item is done or
    abandoned and `main` is checked out again;
  - anything larger (many files, a big diff, clear unfinished feature work): stop and report —
    do not stash or discard it.
- `git fetch`, then compare local `main` to `origin/main`. If they've diverged, stop and report —
  do not merge or rebase automatically.
- Read all of [docs/TODO.md](../../docs/TODO.md) and [docs/DECISIONS.md](../../docs/DECISIONS.md)
  before picking anything (a bullet can only be "settled behavior" if `DECISIONS.md` doesn't
  already cover it).

## 1. Select the items (3 unless the argument says otherwise)

Pick unchecked (`- [ ]`) bullets that are:

- **actionable without the user** — skip anything phrased as an open question, a pure
  measurement, or that explicitly needs an "arbitrage" (e.g. the `deck.gl` removal bullet);
- **bounded** — one bullet, not a cross-cutting rewrite;
- **high value** — prefer a reproducible bug with user-visible impact (crash, wrong data, broken
  interaction) over a "piste à explorer" with no proposed fix; a clear cleanup bullet is fine if
  the bug supply runs short;
- **independent from each other**, so the branches can't conflict.

Post the chosen bullets (one line each, quoting the TODO text) with a one-line reason, then start
work without waiting for approval — this command is meant to run while the user is away.

## 2. For each selected item, in order

1. `git switch main` (let it fail loudly rather than forcing past an error).
2. `git switch -c todo/<short-kebab-slug>`.
3. Investigate before writing code: reproduce the bug when it's reproducible (use the
   `verify-in-browser` skill for anything rendering/pipeline/worker related instead of assuming),
   read the surrounding code, re-check `docs/DECISIONS.md` before touching a settled choice.
4. Implement in small logical steps. After each one (e.g. "fix the guard", "add the regression
   test", "update the doc"), stage exactly the files that step touched — never `git add -A` — and
   commit with an English message describing that step.
5. Before the branch's final commit:
   - run the validation gates — `npx tsc -b && npm run lint:test && npm run test:run && npm run build`
     — and fix failures before moving on;
   - **delete the addressed bullet from `docs/TODO.md` entirely** — the whole entry, including its
     continuation lines. Do **not** just tick it to `- [x]`: a checked box left in the file is
     wrong, the TODO only lists work still to do and the history lives in git. If the fix only
     covers part of the bullet, rewrite the bullet so it describes what remains, still as `- [ ]`;
   - update whichever doc the copilot-instructions topic table maps to the area touched;
   - if the fix has a mobile-facing counterpart (see "Mobile is half the app" in the repo
     instructions), address it in the same branch;
   - if something new surfaces but is left aside, append a fresh `- [ ] ...` bullet to
     `docs/TODO.md` in the same pass instead of only mentioning it in the report.
6. Commit the `docs/TODO.md` (and other doc) update as its own commit. Before committing, check
   `git diff -- docs/TODO.md`: the addressed bullet must show as removed lines, never as a
   `- [ ]` → `- [x]` change.
7. Leave the branch checked out locally with all its commits — do **not** push, open a PR, or
   merge into `main`.
8. If the item turns out bigger than expected mid-way, abandon it: `git switch main`,
   `git branch -D todo/<slug>`, note why in the final report, and move to the next candidate bullet
   instead of the next planned one.
9. `git switch main` before starting the next item.

## 3. Restore the autostash, if any

Once every selected item is done or abandoned and `main` is checked out, if step 0 stashed
anything, run `git stash pop`. If it conflicts, stop and report rather than resolving it
yourself — it's the user's own uncommitted work.

## 4. Report

Per item: branch name, one line per commit, whether the validation gates passed, whether it was
verified in the browser (when applicable), and anything abandoned and why. Flag anything that
needs the user's judgment call (ambiguous fix, a gate that couldn't be made green, a design choice
found mid-way) instead of silently deciding it.

Never push a branch or open a pull request from this command — that stays a manual, confirmed
action once the user is back.
