import { InspectorState } from "./constants";
import LogProcessors, { StateUpdate } from "./log_processors";
import ObservableState, { UPDATE_TYPE } from "./observable_state";

/**
 * Function called when a new log is received, so it can update the
 * `ObservableState` accordingly, which will have the effect of updating the
 * modules relying on those updated states.
 * @param {Object} state
 * @param {string} newLog
 * @param {number} newLogId
 */
export default function updateStateFromLog(
  state: ObservableState<InspectorState>,
  newLog: string,
  newLogId: number,
): void {
  const timestamp = parseFloat(newLog);
  const cleanedLog = removeLogPrefix(newLog);
  for (const proc of LogProcessors) {
    if (proc.filter(cleanedLog)) {
      const updateRes = proc.processor(cleanedLog, newLogId, timestamp);
      for (const update of updateRes) {
        state.updateState(
          update.property,
          update.updateType,
          update.updateValue,
        );
      }
    }
  }
}

/**
 * Function called when several logs are received at once.
 * It can be seen as an optimized `updateStateFromLog` function when a high
 * number of logs are encountered.
 * @param {Object} state
 * @param {string} logs
 */
export function updateStatesFromLogGroup(
  state: ObservableState<InspectorState>,
  logs: Array<[string, number]>,
): void {
  const pendingUpdates: Array<StateUpdate<keyof InspectorState>> = [];

  /**
   * All state property that already have been set (and thus don't need to
   * be anymore, as we're parsing logs from the newest to the oldest here).
   */
  const updatedStates = new Set<keyof InspectorState>();

  /**
   * All LogProcessors that may still offer state updates.
   * To infer this information, the LogProcessor's `updatedProps` property is
   * compared to the `updatedStates` constant.
   * If there's no left property that the `LogProcessor` might change, it is
   * removed.
   */
  const remainingChecks = LogProcessors.slice();

  for (let i = logs.length - 1; i >= 0; i--) {
    if (remainingChecks.length === 0) {
      break;
    }
    const currLog = logs[i];
    const cleanedLog = removeLogPrefix(currLog[0]);
    const timestamp = parseFloat(currLog[0]);
    for (let checkIdx = 0; checkIdx < remainingChecks.length; checkIdx++) {
      const currCheck = remainingChecks[checkIdx];
      if (currCheck.filter(cleanedLog)) {
        const updates = currCheck.processor(cleanedLog, currLog[1], timestamp);
        for (const update of updates) {
          if (!updatedStates.has(update.property)) {
            pendingUpdates.push(update);
            if (update.updateType === UPDATE_TYPE.REPLACE) {
              updatedStates.add(update.property);
            }
          }
        }
        for (
          let innerCheckIdx = 0;
          innerCheckIdx < remainingChecks.length;
          innerCheckIdx++
        ) {
          const innerCheck = remainingChecks[innerCheckIdx];
          if (innerCheck.updatedProps.every((u) => updatedStates.has(u))) {
            remainingChecks.splice(innerCheckIdx, 1);
          }
        }
      }
    }
  }

  const reversedUpdates = pendingUpdates.reverse();
  for (const update of reversedUpdates) {
    state.updateState(update.property, update.updateType, update.updateValue);
  }
}

/**
 * Removes log prefix in format "123.456 [LEVEL] " from the start of a string
 * More performant than regex for this specific pattern
 * @param {string} str - Input string
 * @returns {string} - String with prefix removed, or original if no match
 */
function removeLogPrefix(str: string): string {
  let i = 0;
  const len = str.length;

  // Skip digits before decimal point
  while (i < len && str[i] >= "0" && str[i] <= "9") {
    i++;
  }

  // Must have at least one digit and then either a decimal point or a space
  if (i === 0 || i >= len || (str[i] !== "." && str[i] !== " ")) {
    return str;
  }

  if (str[i] === ".") {
    i++; // Skip decimal point

    // Skip digits after decimal point
    const decimalStart = i;
    while (i < len && str[i] >= "0" && str[i] <= "9") {
      i++;
    }

    // Must have at least one digit after decimal and then a space
    if (i === decimalStart || i >= len || str[i] !== " ") {
      return str;
    }
  }

  i++; // Skip space

  // Must have opening bracket
  if (i >= len || str[i] !== "[") {
    return str;
  }

  i++; // Skip opening bracket

  // Skip word characters (letters, digits, underscore)
  const levelStart = i;
  while (
    i < len &&
    ((str[i] >= "a" && str[i] <= "z") ||
      (str[i] >= "A" && str[i] <= "Z") ||
      (str[i] >= "0" && str[i] <= "9") ||
      str[i] === "_")
  ) {
    i++;
  }

  // Must have at least one word character, closing bracket, and space
  if (i === levelStart || i >= len || str[i] !== "]") {
    return str;
  }

  i++; // Skip closing bracket

  if (i >= len || str[i] !== " ") {
    return str;
  }

  i++; // Skip final space

  // Return substring after the prefix
  return str.substring(i);
}
