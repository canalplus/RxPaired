import { InspectorState } from "./constants";
import { parseLogPrefixTime } from "./log_prefix";
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
  const timestamp = parseLogPrefixTime(newLog)?.timestamp ?? NaN;
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
    const timestamp = parseLogPrefixTime(currLog[0])?.timestamp ?? NaN;
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
 * Removes the timestamp (including any app offset) and namespace from a log.
 * @param {string} str - Input string
 * @returns {string} - String with prefix removed, or original if no match
 */
function removeLogPrefix(str: string): string {
  const prefix = parseLogPrefixTime(str);
  if (prefix === null) {
    return str;
  }
  const match = prefix.message.match(/^\[[A-Za-z0-9_]+\] (.*)$/s);
  return match === null ? str : match[1];
}
