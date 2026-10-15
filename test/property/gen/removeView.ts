// Property generator for removeView: usually one of the project's own views (removed, or refused
// with last_view when it is the only one), sometimes a view it lacks (a no-op) or any kind.
import { ViewKind } from "@/lib/domain/schema/primitives";
import { activeProject, type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state) => {
  const views = activeProject(state)?.views ?? [];
  const missing = ViewKind.options.filter((v) => !views.includes(v));
  const variant = s.picks[1] % 4;
  if (variant === 0 && missing.length > 0) return { op: "removeView", view: pick(missing, s.picks[0]) };
  return { op: "removeView", view: views.length > 0 && variant !== 1 ? pick(views, s.picks[0]) : pick(ViewKind.options, s.picks[0]) };
};

export default gen;
