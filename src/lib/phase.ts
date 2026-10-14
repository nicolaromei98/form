/**
 * The FORM v1 phase this code base is in. Registry exemptions carry an `until` phase, and the
 * completeness test fails any exemption whose `until` is at or below this value, so nothing
 * deferred is skipped silently once its phase arrives.
 */
export const FORM_PHASE = 1;
