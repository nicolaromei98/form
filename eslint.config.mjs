import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ---------------------------------------------------------------------------------------------
// Phase 1 purity and import boundaries (docs/PHASE-1-PLAN.md §2 and §10.1).
// Rules for directories that don't exist yet match no files and cost nothing. Tests are exempt:
// they may time code, use any fixture and reach across modules.
// ---------------------------------------------------------------------------------------------

const CODE = "{ts,tsx,mts,cts}";
const TESTS = ["**/__tests__/**", "**/*.test.{ts,tsx}"];
const MAX_DEPTH = 6;

// typescript-eslint's version of the core rule: same options, plus `allowTypeImports` per pattern.
const IMPORTS = "@typescript-eslint/no-restricted-imports";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An import of one of these `src/lib` paths through the alias, or through a relative path that names `lib/`. */
const libImport = (paths) => `(?:^@/|^\\.{1,2}/(?:.*/)?)lib/(?:${paths.join("|")})(?:/.*)?$`;

/** Packages that bring a UI, a store or the framework: never in pure code. */
const FRAMEWORK = {
  regex: "^(?:react|react-dom|zustand|gsap|@gsap/react|motion|next)(?:/.*)?$",
  message: "Pure modules don't import UI, store or framework code (plan §2).",
};
const NO_UI = { regex: "^@/(?:components|app)(?:/|$)", message: "lib never imports components or routes." };

/** What components may import from lib, values and types (plan §2; see form/boundaries/components) */
const COMPONENT_LIB = [
  "store/hooks",
  "planning/format",
  "motion",
  "assets",
  "useViewport",
  "useWidth",
  "domain/labels",
  "domain/limits",
  "domain/money",
  "domain/colours",
  "domain/dates",
];
/** Where components may take types only from (with everything under them) */
const COMPONENT_LIB_TYPES = ["store/actions", "domain"];
const COMPONENT_VALUES = `(?:${COMPONENT_LIB.map(escape).join("|")})`;
const COMPONENT_TYPES = `(?:${COMPONENT_LIB_TYPES.map(escape).join("|")})(?:/.*)?`;
const COMPONENT_NEVER = "(?:store/form|ops/reduce|ops/command|migrate(?:/.*)?|demo(?:/.*)?)";
const ONLY_HOOKS_IMPORT_FORM = "Only lib/store/hooks and lib/store/actions import the store (plan §2).";

/** Pure modules (plan §2): what each may import from the rest of `src/lib` besides itself. */
const PURE_MODULES = [
  { dir: "src/lib/domain", may: [] },
  { dir: "src/lib/planning", may: ["domain"] },
  { dir: "src/lib/ops", may: ["domain", "planning"] },
  { dir: "src/lib/compose", may: ["domain", "planning"] },
  { dir: "src/lib/migrate", may: ["domain", "ops/build"] },
  // The parser builds ops only through ops/build, but its result names the registry's types
  // (Op, LocalIntent, QueryNote, NoticeKey: plan §8.4), so type-only imports from ops are allowed.
  { dir: "src/lib/interpret/fast", may: ["domain", "ops/build", "planning"], typesFrom: ["ops"] },
];
/** Demo data and helpers that are pure as well (plan §2). */
const PURE_DEMO_FILES = ["src/lib/demo/sample.ts", "src/lib/demo/seed.ts", "src/lib/demo/library.ts"];
const PURE_FILES = [...PURE_MODULES.map((m) => `${m.dir}/**/*.${CODE}`), ...PURE_DEMO_FILES];

/** A pure module's alias imports: itself and the modules it may use, plus type-only imports where allowed. */
function pureBoundary({ dir, may, typesFrom = [] }) {
  const self = dir.replace(/^src\//, "");
  const path = (p) => (p.endsWith("/build") ? `${escape(p)}$` : `${escape(p)}(?:/.*)?$`);
  const values = [self, ...may.map((m) => `lib/${m}`)].map(path).join("|");
  const list = may.map((m) => `lib/${m}`).join(", ");
  return [
    FRAMEWORK,
    {
      regex: `^@/(?!(?:${[values, ...typesFrom.map((m) => path(`lib/${m}`))].join("|")}))`,
      message: may.length
        ? `${self} may import only ${list} from the rest of src (plan §2).`
        : `${self} imports nothing from the rest of src (plan §2).`,
    },
    // Value imports from a types-only module (type-only imports pass)
    ...typesFrom.map((m) => ({
      regex: `^@/(?!(?:${values}))${escape(`lib/${m}`)}(?:/.*)?$`,
      allowTypeImports: true,
      message: `${self} may take only types from lib/${m}; values come from ${list} (plan §2, §8.4).`,
    })),
  ];
}

/** In a file `depth` folders below a module root: a relative import that leaves the module. */
const relativeEscape = (depth, self) => ({
  regex: `^(?:\\.\\./){${depth + 1}}`,
  message: `Leave ${self} through an "@/lib/…" import, so the boundary rules can check it.`,
});

/**
 * One block per folder depth below `dir`, so relative imports can't step around the alias rules.
 * With `only`, a single block for those files (all directly in `dir`), named `label`.
 */
const moduleBlocks = (dir, patterns, only, label) => {
  const self = dir.replace(/^src\//, "");
  return Array.from({ length: only ? 1 : MAX_DEPTH + 1 }, (_, depth) => ({
    name: `form/boundaries/${self}/${only ? label : `depth-${depth}`}`,
    files: only ?? [`${dir}/${"*/".repeat(depth)}*.${CODE}`],
    ignores: TESTS,
    rules: { [IMPORTS]: ["error", { patterns: [...patterns, relativeEscape(depth, self)] }] },
  }));
};

const DETERMINISM =
  "Pure modules are deterministic: time comes from ctx.now or today, ids from the Minter in ctx (plan §1.2, §12.7).";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output
    "coverage/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/blob-report/**",
    "scripts/audit/.out/**",
    // Frozen v0 copies: never fixed or reformatted
    "test/legacy/v0/**",
    // Agent worktrees and local tooling state (each worktree is a full checkout of its own)
    ".claude/**",
    "e2e/.out/**",
  ]),

  // The audit harnesses include two CommonJS analysers.
  {
    name: "form/scripts-commonjs",
    files: ["scripts/**/*.{js,cjs}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  // Everywhere in src: only the store's hooks and actions import the Zustand store, and only the
  // store imports lib/demo (plan §2). Later blocks replace these options and repeat what applies.
  {
    name: "form/boundaries/src",
    files: [`src/**/*.${CODE}`],
    ignores: TESTS,
    rules: {
      [IMPORTS]: [
        "error",
        {
          patterns: [
            { regex: libImport(["store/form"]), message: ONLY_HOOKS_IMPORT_FORM },
            { regex: libImport(["demo"]), message: "Only the store imports lib/demo (plan §2)." },
          ],
        },
      ],
    },
  },
  {
    name: "form/boundaries/lib-root",
    files: [`src/lib/*.${CODE}`],
    ignores: TESTS,
    rules: {
      [IMPORTS]: [
        "error",
        {
          patterns: [
            NO_UI,
            { regex: "^(?:@/lib|\\.)/store/form$", message: ONLY_HOOKS_IMPORT_FORM },
            { regex: "^(?:@/lib|\\.)/demo(?:/.*)?$", message: "Only the store imports lib/demo (plan §2)." },
          ],
        },
      ],
    },
  },

  // Components and routes read data through lib/store/hooks and change it through the actions those
  // hooks hand out (plan §2, §10.1). The allow-list, enforced since step 18:
  //   - values and types: lib/store/hooks, planning/format, lib/motion, lib/assets, the viewport hooks
  //     (useViewport, useWidth), and the domain's display vocabulary: labels, limits (the caps an
  //     input enforces), money (formatMoney, which plan §8.2 names for CostTag), colours (the
  //     colour picker's normaliseHex) and dates (IsoDate arithmetic for the timeline's day grid);
  //   - types only: lib/store/actions and the rest of lib/domain (the schema types);
  //   - nothing else from lib: no store/form, ops (reduce, command, build …), planning beyond its
  //     formatters, compose, migrate, interpret, demo, or the domain's logic (views, ids, order,
  //     invariants, mood geometry), which reach components through hooks.
  // Relative imports into lib are refused too, so the alias rules always see the path.
  {
    name: "form/boundaries/components",
    files: [`src/components/**/*.${CODE}`, `src/app/**/*.${CODE}`],
    ignores: TESTS,
    rules: {
      [IMPORTS]: [
        "error",
        {
          patterns: [
            { regex: libImport(["store/form"]), message: "Components read the store through lib/store/hooks (plan §2)." },
            { regex: libImport(["ops/reduce", "ops/command"]), message: "Components change data through the actions useActions() hands out (plan §2)." },
            { regex: libImport(["migrate"]), message: "Components never import the migration (plan §2)." },
            { regex: libImport(["demo"]), message: "Components never import lib/demo; the store owns it (plan §2)." },
            {
              // Anything else in lib (the never-list above has its own messages)
              regex: `^@/lib/(?!${COMPONENT_VALUES}$)(?!${COMPONENT_TYPES}$)(?!${COMPONENT_NEVER}$)`,
              message: `Components import from lib only ${COMPONENT_LIB.join(", ")}, and types from ${COMPONENT_LIB_TYPES.join(", ")} (plan §2).`,
            },
            {
              regex: `^@/lib/(?!${COMPONENT_VALUES}$)${COMPONENT_TYPES}$`,
              allowTypeImports: true,
              message: `Components take only types from ${COMPONENT_LIB_TYPES.join(" and ")}; data and actions come through lib/store/hooks (plan §2).`,
            },
            { regex: "^(?:\\.\\./)+(?:.*/)?lib(?:/|$)", message: 'Import lib through "@/lib/…", so the boundary rules can check it.' },
          ],
        },
      ],
    },
  },

  // The store imports everything in lib, plus demo, but never components or routes; inside it,
  // only hooks and actions (and the store itself) import form.ts.
  ...moduleBlocks("src/lib/store", [NO_UI, { regex: "^(?:@/lib/store/|(?:\\.\\.?/)+)form$", message: ONLY_HOOKS_IMPORT_FORM }]),
  ...moduleBlocks("src/lib/store", [NO_UI], ["src/lib/store/{hooks,actions,form}.{ts,tsx}"], "form-importers"),

  // lib/demo serves the store: it never imports the store, components or routes. Its data and
  // helpers are pure, so they also never import framework code or demo/storage.
  ...moduleBlocks("src/lib/demo", [NO_UI, { regex: "^@/lib/store(?:/|$)", message: "lib/demo never imports the store (plan §2)." }]),
  ...moduleBlocks(
    "src/lib/demo",
    [
      FRAMEWORK,
      NO_UI,
      { regex: "^@/lib/store(?:/|$)", message: "lib/demo never imports the store (plan §2)." },
      { regex: "^(?:@/lib/demo/|\\./)storage$", message: "Pure demo data never imports demo/storage." },
    ],
    PURE_DEMO_FILES,
    "pure",
  ),

  // Pure modules: each imports only what plan §2 lists, and never leaves its folder through a
  // relative path.
  ...PURE_MODULES.flatMap((module) => moduleBlocks(module.dir, pureBoundary(module))),

  // Pure modules: no clock, randomness, locale, environment or I/O (plan §10.1, §12.7).
  {
    name: "form/purity",
    files: PURE_FILES,
    ignores: TESTS,
    rules: {
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: DETERMINISM }],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: `${DETERMINISM} Dates are IsoDate strings handled by domain/dates, never Date.` },
        { name: "performance", message: DETERMINISM },
        { name: "crypto", message: `${DETERMINISM} Commit ids are minted by the store.` },
        { name: "process", message: "Pure modules don't read the environment; pass options in." },
        { name: "globalThis", message: "Pure modules don't reach into the global object." },
        { name: "self", message: "Pure modules don't reach into the global object." },
        { name: "window", message: "Pure modules have no DOM." },
        { name: "document", message: "Pure modules have no DOM." },
        { name: "navigator", message: "Pure modules have no DOM." },
        { name: "localStorage", message: "Pure modules never touch storage; lib/demo/storage does." },
        { name: "sessionStorage", message: "Pure modules never touch storage." },
        { name: "indexedDB", message: "Pure modules never touch storage." },
        { name: "fetch", message: "Pure modules do no I/O." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // crypto.* itself is already caught as a restricted global
          selector: "MemberExpression[property.name=/^(?:randomUUID|getRandomValues)$/]:not([object.name='crypto'])",
          message: DETERMINISM,
        },
        {
          selector: "CallExpression[callee.property.name=/^toLocale/]",
          message: "Locale formatting depends on the host: use the fixed formatters (Intl with an explicit locale).",
        },
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: 'Compare text with a fixed Intl.Collator("en"), never the host locale.',
        },
        {
          selector: ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][arguments.length=0]",
          message: 'Give Intl an explicit locale ("en" or "en-US").',
        },
        {
          selector:
            ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][arguments.0.type='Identifier'][arguments.0.name='undefined']",
          message: 'Give Intl an explicit locale ("en" or "en-US").',
        },
      ],
    },
  },
]);
