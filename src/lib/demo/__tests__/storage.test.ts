// The /demo save (plan §7.3, §10.2): the first-load migration from every v0 fixture gives a valid
// envelope and never writes the v0 keys (storage spy); a saved envelope reads back as it was; an
// unreadable form.demo.v2 is copied aside and never wiped; saving compacts deleted projects.
import { describe, expect, it } from "vitest";
import { seededMinter } from "@/lib/domain/ids";
import { checkProject, checkWorkspace } from "@/lib/domain/invariants/check";
import { DEMO_BACKUP_KEY, DEMO_STORAGE_KEY, DemoEnvelopeSchema } from "@/lib/domain/schema/demo";
import type { ProjectId } from "@/lib/domain/schema/ids";
import { backUp, envelopeOf, freshEnvelope, loadDemo, readDemoEnvelope, saveDemo } from "@/lib/demo/storage";
import { MANIFEST, spyStorage, storageOf, V0_BACKUP_KEY, V0_KEY } from "@/lib/migrate/__tests__/support";
import { FIXTURE_NOW } from "../../../../test/fixtures/v2/build";

const options = () => ({ now: FIXTURE_NOW, timezone: "Europe/Rome", mint: seededMinter(17) });

/** Every write a spy saw, by key */
const writes = (calls: { method: string; args: unknown[] }[]) => calls.filter((c) => c.method !== "getItem" && c.method !== "key" && c.method !== "length");

describe("first load from a v0 save", () => {
  it.each(MANIFEST.map((e) => [e.name, e] as const))("%s gives a valid envelope and never writes the v0 keys", (_name, entry) => {
    const initial = storageOf(entry);
    const storage = spyStorage(initial);
    const loaded = loadDemo(storage, options());
    expect(loaded.kind).toBe("migrated");
    expect(loaded.writable).toBe(true);

    const e = loaded.envelope;
    expect(DemoEnvelopeSchema.safeParse(e).success).toBe(true);
    expect(checkWorkspace(e.workspace)).toEqual([]);
    for (const p of Object.values(e.projects)) expect(checkProject(p)).toEqual([]);
    expect(e.migratedFrom).toBe(loaded.report!.source === "main" ? "v0-main" : "v0-backup");
    expect(e.changes).toBe(loaded.report!.changes);
    expect(e.notices.weekendsPending).toBe(loaded.report!.notices.includes("weekendsNow"));
    if (e.activeProjectId !== null) {
      expect(Object.keys(e.projects)).toEqual([e.activeProjectId]);
      expect(e.workspace.projects[e.activeProjectId]).toMatchObject({ archivedAt: null, deletedAt: null });
      expect(e.projects[e.activeProjectId].views).toContain(e.lastView);
    } else expect(e.projects).toEqual({});

    // Only the envelope was written, once; the v0 keys hold exactly what they held
    expect(writes(storage.calls)).toEqual([{ method: "setItem", args: [DEMO_STORAGE_KEY, JSON.stringify(e)] }]);
    for (const key of [V0_KEY, V0_BACKUP_KEY]) expect(storage.values.get(key)).toBe(initial[key]);

    // The next load reads the saved envelope: same ids, no second migration
    const again = loadDemo(storage, { ...options(), mint: seededMinter(99) });
    expect(again.kind).toBe("saved");
    expect(again.envelope).toEqual(e);
  });

  it("migrates the demo template with the weekends notice pending and the sample team", () => {
    const entry = MANIFEST.find((m) => m.name === "docTracker")!;
    const loaded = loadDemo(spyStorage(storageOf(entry)), options());
    const e = loaded.envelope;
    expect(e.notices.weekendsPending).toBe(true);
    const project = e.projects[e.activeProjectId!];
    expect(project.memberIds).toEqual(["per_demomarta", "per_demosara", "per_demoluca"]);
    expect(Object.values(e.workspace.people).map((p) => [p.name, p.capacityDaysPerWeek])).toEqual([
      ["Marta", 2],
      ["Sara", 4],
      ["Luca", 5],
    ]);
    expect(e.workspace.timezone).toBe("Europe/Rome");
  });

  it("keeps the legacy image keys as asset aliases", () => {
    const entry = MANIFEST.find((m) => m.name === "moodImage")!;
    const e = loadDemo(spyStorage(storageOf(entry)), options()).envelope;
    expect(Object.values(e.assetAliases)).toEqual(["img-fixture1"]);
    const project = e.projects[e.activeProjectId!];
    const image = Object.values(project.moodboard.items).find((m) => m.kind === "image")!;
    expect(e.assetAliases[image.assetId!]).toBe("img-fixture1");
  });
});

describe("loading", () => {
  it("starts fresh, and writes nothing, with no save of either version", () => {
    const storage = spyStorage({});
    const loaded = loadDemo(storage, options());
    expect(loaded.kind).toBe("fresh");
    expect(loaded.envelope).toEqual(freshEnvelope(FIXTURE_NOW, "Europe/Rome"));
    expect(writes(storage.calls)).toEqual([]);
  });

  it("prefers the v2 save over the v0 keys", () => {
    const saved = freshEnvelope(FIXTURE_NOW, "Europe/Rome");
    const entry = MANIFEST.find((m) => m.name === "docDemo")!;
    const storage = spyStorage({ ...storageOf(entry), [DEMO_STORAGE_KEY]: JSON.stringify(saved) });
    const loaded = loadDemo(storage, options());
    expect(loaded.kind).toBe("saved");
    expect(loaded.envelope).toEqual(saved);
  });

  it("without storage, starts fresh and never writes", () => {
    const loaded = loadDemo(null, options());
    expect(loaded.kind).toBe("fresh");
    expect(loaded.writable).toBe(false);
  });

  it("reads blocked storage as empty", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadDemo(blocked, options()).kind).toBe("fresh");
  });

  it("opens the latest live project when the saved active one is gone", () => {
    const entry = MANIFEST.find((m) => m.name === "docDemo")!;
    const e = loadDemo(spyStorage(storageOf(entry)), options()).envelope;
    const text = JSON.stringify({ ...e, activeProjectId: "prj_0000000000000000" });
    expect(readDemoEnvelope(text).activeProjectId).toBe(e.activeProjectId);
  });
});

describe("an unreadable form.demo.v2", () => {
  const valid = () => {
    const entry = MANIFEST.find((m) => m.name === "docDemo")!;
    return loadDemo(spyStorage(storageOf(entry)), options()).envelope;
  };
  const broken: [string, () => string][] = [
    ["not JSON", () => '{"schemaVersion":2,"workspace":'],
    ["not an envelope", () => "[]"],
    ["off its schema", () => JSON.stringify({ ...valid(), changes: -1 })],
    [
      "breaking an invariant",
      () => {
        const e = valid();
        const project = e.projects[e.activeProjectId!];
        const [first] = Object.values(project.tasks);
        // A Done task at 40%
        const tasks = { ...project.tasks, [first.id]: { ...first, status: "done", progress: 40 } };
        return JSON.stringify({ ...e, projects: { [project.id]: { ...project, tasks } } });
      },
    ],
    [
      "filed under another id",
      () => {
        const e = valid();
        return JSON.stringify({ ...e, projects: { prj_0000000000000000: e.projects[e.activeProjectId!] } });
      },
    ],
  ];

  it.each(broken)("is copied to the backup, never wiped (%s)", (_name, make) => {
    const text = make();
    const storage = spyStorage({ [DEMO_STORAGE_KEY]: text, [V0_KEY]: "untouched" });
    const loaded = loadDemo(storage, options());
    expect(loaded.kind).toBe("recovered");
    expect(loaded.backupKey).toBe(DEMO_BACKUP_KEY);
    expect(loaded.writable).toBe(true);
    expect(loaded.problem).toBeTruthy();
    expect(loaded.envelope).toEqual(freshEnvelope(FIXTURE_NOW, "Europe/Rome"));
    expect(storage.values.get(DEMO_BACKUP_KEY)).toBe(text);
    // Loading wrote the copy only: the original is still there until the first save
    expect(writes(storage.calls)).toEqual([{ method: "setItem", args: [DEMO_BACKUP_KEY, text] }]);
    expect(storage.values.get(DEMO_STORAGE_KEY)).toBe(text);
    expect(storage.values.get(V0_KEY)).toBe("untouched");
  });

  it("never overwrites an older copy", () => {
    const storage = spyStorage({ [DEMO_STORAGE_KEY]: "second", [DEMO_BACKUP_KEY]: "first" });
    expect(loadDemo(storage, options()).backupKey).toBe(`${DEMO_BACKUP_KEY}.2`);
    expect(storage.values.get(DEMO_BACKUP_KEY)).toBe("first");
    expect(storage.values.get(`${DEMO_BACKUP_KEY}.2`)).toBe("second");
    // The same text again is already kept
    expect(backUp(storage, "first")).toBe(DEMO_BACKUP_KEY);
  });

  it("is left in place, and the demo can't save, when no copy can be made", () => {
    const values = new Map([[DEMO_STORAGE_KEY, "not json"]]);
    const full = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const loaded = loadDemo(full, options());
    expect(loaded.kind).toBe("recovered");
    expect(loaded.backupKey).toBeNull();
    expect(loaded.writable).toBe(false);
    expect(values.get(DEMO_STORAGE_KEY)).toBe("not json");
  });
});

describe("saving", () => {
  it("compacts deleted projects and their index entries", () => {
    const entry = MANIFEST.find((m) => m.name === "docDemo")!;
    const e = loadDemo(spyStorage(storageOf(entry)), options()).envelope;
    const id = e.activeProjectId!;
    const workspace = { ...e.workspace, projects: { ...e.workspace.projects, [id]: { ...e.workspace.projects[id], deletedAt: FIXTURE_NOW } } };
    const out = envelopeOf({ ...e, workspace, lastView: "cards" });
    expect(out.projects).toEqual({});
    expect(out.workspace.projects).toEqual({});
    expect(out.activeProjectId).toBeNull();
    expect(out.lastView).toBeNull();
    expect(DemoEnvelopeSchema.safeParse(out).success).toBe(true);
  });

  it("keeps archived projects", () => {
    const entry = MANIFEST.find((m) => m.name === "docDemo")!;
    const e = loadDemo(spyStorage(storageOf(entry)), options()).envelope;
    const id = e.activeProjectId! as ProjectId;
    const workspace = { ...e.workspace, projects: { [id]: { ...e.workspace.projects[id], archivedAt: FIXTURE_NOW } } };
    expect(Object.keys(envelopeOf({ ...e, workspace }).projects)).toEqual([id]);
  });

  it("writes only form.demo.v2, and reports a refusal", () => {
    const storage = spyStorage({});
    const e = freshEnvelope(FIXTURE_NOW, "Europe/Rome");
    expect(saveDemo(storage, e)).toBe(true);
    expect(writes(storage.calls)).toEqual([{ method: "setItem", args: [DEMO_STORAGE_KEY, JSON.stringify(e)] }]);
    expect(
      saveDemo(
        {
          setItem: () => {
            throw new Error("QuotaExceededError");
          },
        },
        e,
      ),
    ).toBe(false);
  });
});
