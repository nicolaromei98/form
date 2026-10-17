/**
 * Every numeric cap of the v2 documents (plan §1.2, §3.9). The schemas, the invariants, the
 * reducers, the parser and the editors all read these, so a limit changes in one place.
 *
 * Text lengths count UTF-16 code units, like `z.string().max()`.
 */

/* ------------------------------------------------------------------
   Text lengths
   ------------------------------------------------------------------ */

/** Task titles (Q11) */
export const TASK_TITLE = 140;
/** Step titles: the same as tasks, so promoting a step to a task never truncates it */
export const STEP_TITLE = 140;
export const PROJECT_TITLE = 80;
export const PERSON_NAME = 40;
export const WORKSPACE_NAME = 60;
export const PERSON_ROLE = 40;
export const TEMPLATE_NAME = 60;
/** Client name and contact name */
export const CLIENT_NAME = 80;
export const PROJECT_GOAL = 200;
export const TASK_DESCRIPTION = 5000;
export const TAG = 32;
export const LINK_LABEL = 60;
export const URL_LENGTH = 2048;
export const EMAIL_LENGTH = 254;
/** Labels of time off and closures */
export const RANGE_LABEL = 60;
/** Moodboard note text, or a colour's name */
export const MOOD_TEXT = 400;
/** A brief line the user writes, and the text of a brief edit */
export const BRIEF_TEXT_MAX = 600;
/** The composed wording a brief edit replaced */
export const BRIEF_BASIS = 4000;
/** "<audience>:<sentence id>" */
export const BRIEF_EDIT_KEY = 160;
/** The "why" of a reassign or leveling move */
export const PROPOSAL_WHY = 200;
/** The command text stored with a commit */
export const COMMAND_TEXT = 500;
/** One caption part, and a rejection message */
export const CAPTION_PART = 140;
/** A whole caption, cut at a part boundary (plan §5.9) */
export const CAPTION_TEXT = 280;
/** The " · " parts a caption shows at most: one short line (caption policy rule 7) */
export const CAPTION_PARTS = 4;
/** A user id from the auth provider (Phase 2) */
export const USER_ID = 64;
export const TIMEZONE_LENGTH = 64;

/* ------------------------------------------------------------------
   Counts
   ------------------------------------------------------------------ */

export const TASKS_MAX = 500;
export const STEPS_MAX = 40;
export const DEPS_MAX = 50;
export const PEOPLE_MAX = 100;
export const MOOD_MAX = 200;
/** Items one addMoodItems op may carry */
export const MOOD_ADD_MAX = 24;
export const BRIEF_LINES_MAX = 80;
/** Sent-brief references kept on a project */
export const BRIEF_SENT_MAX = 200;
/** Tags on a task or a project */
export const TAGS_MAX = 20;
/** Links on a task or a project */
export const LINKS_MAX = 20;
export const MEMBERS_MAX = 100;
/** User templates in a workspace */
export const TEMPLATES_MAX = 50;
export const TEMPLATE_TASKS_MAX = 150;
export const CLOSURES_MAX = 200;
/** Time-off entries per person */
export const TIME_OFF_MAX = 100;
/** Entries in the workspace's project index */
export const PROJECTS_MAX = 500;
/** Every view kind at most once */
export const VIEWS_MAX = 6;
/** Items in a subtasks, reassign or plan proposal */
export const PROPOSAL_ITEMS_MAX = 12;
/** Moves in a leveling proposal and items in an estimates proposal */
export const PROPOSAL_BULK_MAX = 150;
/** Owners named in a view filter */
export const FILTER_OWNERS_MAX = 20;

/* ------------------------------------------------------------------
   Numbers
   ------------------------------------------------------------------ */

/** Working days at 100% allocation; also the longest shift a proposal may carry */
export const ESTIMATE_MAX_DAYS = 250;
export const CAPACITY_MAX_DAYS = 7;
/** One billion in the major unit */
export const CENTS_MAX = 100_000_000_000;
/** Tracker columns; null means automatic */
export const COLUMNS_MAX = 4;

/** Moodboard geometry bounds, in board-width units (rotation in degrees) */
export const MOOD_BOUNDS = {
  x: { min: 0, max: 1 },
  y: { min: 0, max: 20 },
  w: { min: 0.04, max: 1 },
  h: { min: 0.03, max: 3 },
  r: { min: -15, max: 15 },
} as const;

/**
 * Stored calendar dates (`IsoDate`) stay inside this window. It keeps every date a project can
 * plan, and it bounds the planning engine: the longest possible chain (500 tasks of 250 days at
 * 25% allocation) ends long before year 9999, the last year an `IsoDate` string can hold.
 */
export const DATE_MIN = "1970-01-01";
export const DATE_MAX = "2199-12-31";

/* ------------------------------------------------------------------
   Commits, documents and history
   ------------------------------------------------------------------ */

/** Non-system ops per command (plan §1.3) */
export const OPS_PER_COMMAND = 12;
/** Ops in one stored commit: the command's ops plus the runner's rebalanceOrder */
export const COMMIT_OPS_MAX = 13;
/** JSON byte length of one document */
export const DOC_BYTES_MAX = 1_000_000;
/** The runner appends rebalanceOrder when any order key is longer than this */
export const ORDER_KEY_REBALANCE = 48;
/** The longest order key a document may store */
export const ORDER_KEY_MAX = 64;
/** Undo entries kept per session */
export const HISTORY_LIMIT = 60;
