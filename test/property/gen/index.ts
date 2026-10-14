// Every op's property generator (plan §10.3), imported explicitly. Written once in step 9 with
// stubs for the ops not implemented yet; the step 10 families edit only their own gen/<op>.ts.
import type { OpName } from "@/lib/ops/registry";
import type { OpGen } from "./_pick";
import acceptProposal from "./acceptProposal";
import addBlock from "./addBlock";
import addBriefLine from "./addBriefLine";
import addClosure from "./addClosure";
import addDependency from "./addDependency";
import addLink from "./addLink";
import addMember from "./addMember";
import addMoodItems from "./addMoodItems";
import addPerson from "./addPerson";
import addStep from "./addStep";
import addTask from "./addTask";
import addTimeOff from "./addTimeOff";
import addView from "./addView";
import archivePerson from "./archivePerson";
import archiveProject from "./archiveProject";
import arrangeMood from "./arrangeMood";
import assignTask from "./assignTask";
import clearMood from "./clearMood";
import createProject from "./createProject";
import deletePerson from "./deletePerson";
import deleteProject from "./deleteProject";
import deleteTemplate from "./deleteTemplate";
import discardProposal from "./discardProposal";
import duplicateProject from "./duplicateProject";
import editBriefLine from "./editBriefLine";
import linkPersonToMe from "./linkPersonToMe";
import markBriefSent from "./markBriefSent";
import moveTask from "./moveTask";
import pinStart from "./pinStart";
import proposeEstimates from "./proposeEstimates";
import proposeLeveling from "./proposeLeveling";
import proposePlan from "./proposePlan";
import proposeReassign from "./proposeReassign";
import proposeSubtasks from "./proposeSubtasks";
import rebalanceOrder from "./rebalanceOrder";
import removeBlock from "./removeBlock";
import removeBriefLine from "./removeBriefLine";
import removeClosure from "./removeClosure";
import removeDependency from "./removeDependency";
import removeLink from "./removeLink";
import removeMember from "./removeMember";
import removeMoodItem from "./removeMoodItem";
import removeStep from "./removeStep";
import removeTask from "./removeTask";
import removeTimeOff from "./removeTimeOff";
import removeView from "./removeView";
import reorderStep from "./reorderStep";
import resetBrief from "./resetBrief";
import resetBriefLine from "./resetBriefLine";
import restorePerson from "./restorePerson";
import restoreProject from "./restoreProject";
import saveTemplate from "./saveTemplate";
import setBriefSharing from "./setBriefSharing";
import setFocus from "./setFocus";
import setView from "./setView";
import setWorkspaceCalendar from "./setWorkspaceCalendar";
import unassignTask from "./unassignTask";
import unpinStart from "./unpinStart";
import updateBriefLine from "./updateBriefLine";
import updateMoodItem from "./updateMoodItem";
import updatePerson from "./updatePerson";
import updateProject from "./updateProject";
import updateStep from "./updateStep";
import updateTask from "./updateTask";
import updateTemplate from "./updateTemplate";
import updateWorkspace from "./updateWorkspace";

export const GENERATORS: Readonly<Record<OpName, OpGen>> = {
  updateWorkspace,
  setWorkspaceCalendar,
  addClosure,
  removeClosure,
  addPerson,
  updatePerson,
  archivePerson,
  restorePerson,
  deletePerson,
  linkPersonToMe,
  addTimeOff,
  removeTimeOff,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  createProject,
  duplicateProject,
  archiveProject,
  restoreProject,
  deleteProject,
  updateProject,
  addMember,
  removeMember,
  addLink,
  removeLink,
  addTask,
  updateTask,
  removeTask,
  moveTask,
  addDependency,
  removeDependency,
  pinStart,
  unpinStart,
  assignTask,
  unassignTask,
  addStep,
  updateStep,
  removeStep,
  reorderStep,
  proposeSubtasks,
  proposeReassign,
  proposeLeveling,
  proposeEstimates,
  proposePlan,
  acceptProposal,
  discardProposal,
  addView,
  removeView,
  setView,
  setFocus,
  addBlock,
  removeBlock,
  editBriefLine,
  resetBriefLine,
  addBriefLine,
  updateBriefLine,
  removeBriefLine,
  resetBrief,
  markBriefSent,
  setBriefSharing,
  addMoodItems,
  updateMoodItem,
  removeMoodItem,
  arrangeMood,
  clearMood,
  rebalanceOrder,
};
