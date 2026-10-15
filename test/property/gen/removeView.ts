// Property generator for removeView: usually one of the project's own views (removed, or refused
// with last_view when it is the only one), sometimes any kind (a missing view is a no-op).
import { ViewKind } from "@/lib/domain/schema/primitives";
import { activeProject, type OpGen, pick } from "./_pick";

const gen: OpGen = (s, state) => {
  const views = activeProject(state)?.views ?? [];
  const own = views.length > 0 && s.picks[1] % 4 !== 0;
  return { op: "removeView", view: own ? pick(views, s.picks[0]) : pick(ViewKind.options, s.picks[0]) };
};

export default gen;
