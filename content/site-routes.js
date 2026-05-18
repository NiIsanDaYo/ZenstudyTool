const ACTION_IFRAME_SRC_PATHS = Object.freeze([
  "/evaluation_tests/",
  "/evaluation_reports/",
  "/essay_tests/",
  "/essay_reports/",
  "/reports/",
]);

const ACTION_IFRAME_SELECTOR = ACTION_IFRAME_SRC_PATHS
  .map((path) => `iframe[src*="${path}"]`)
  .join(", ");

const PROOFREAD_FIELD_SELECTOR = "textarea:not([disabled]):not([readonly])";
const ANSWER_TEXTAREA_SELECTOR = "textarea:not([disabled]):not([readonly])";
