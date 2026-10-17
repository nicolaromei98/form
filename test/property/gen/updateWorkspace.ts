// Property generator for updateWorkspace: every setting in turn, with the current value about one
// time in two (a no-op) and invalid values now and then (an unknown time zone, a lowercase
// currency, a three-letter preset, an empty or untrimmed name).
import { type OpGen, pick, titleFrom } from "./_pick";

const FIELDS = ["name", "timezone", "defaultCurrency", "holidayPreset", "improveFormOptIn"] as const;
const ZONES = ["Europe/Rome", "Pacific/Auckland", "America/New_York", "Mars/Olympus"];
const CURRENCIES = ["EUR", "USD", "GBP", "eur"];
const PRESETS = ["IT", null, "GB", "ITA"];

const gen: OpGen = (s, state) => {
  const ws = state.workspace;
  const field = pick(FIELDS, s.picks[1]);
  const same = s.flags[1];
  let value: unknown;
  switch (field) {
    case "name":
      value = same ? ws.name : titleFrom(s, 60);
      break;
    case "timezone":
      value = same ? ws.timezone : pick(ZONES, s.picks[2]);
      break;
    case "defaultCurrency":
      value = same ? ws.defaultCurrency : pick(CURRENCIES, s.picks[2]);
      break;
    case "holidayPreset":
      value = same ? ws.holidayPreset : pick(PRESETS, s.picks[2]);
      break;
    case "improveFormOptIn":
      value = same ? ws.improveFormOptIn : s.flags[2];
      break;
  }
  return { op: "updateWorkspace", field, value };
};

export default gen;
