# v0 → v2 migration snapshots

One file per v0 fixture in `test/fixtures/v0` (plan §10.6): the whole `migrateV0` result (people, project, id map, local view and report) in demo mode, with `seededMinter(14)` and `now = 2026-10-14T09:00:00Z`, joining the fixtures' empty demo workspace.

`src/lib/migrate/__tests__/fixtures.test.ts` compares them with `toMatchFileSnapshot`; `migrate.test.ts` asserts the report lines case by case. Don't edit them by hand: after a reviewed change to the migration, run `npx vitest run --project unit src/lib/migrate -u` and review the diff.
