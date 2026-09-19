import strHtml from "str-html";
import {
  ConfigState,
  InspectorState,
  LogViewState,
  RuntimePerformanceSnapshot,
  STATE_PROPS,
} from "../constants";
import ObservableState, { UPDATE_TYPE } from "../observable_state";
import { convertDateToLocalISOString } from "../utils";

const MAX_ELEMENTS = 50;

export default function RuntimePerformanceHistoryModule({
  state,
  logView,
  configState,
}: {
  state: ObservableState<InspectorState>;
  logView: ObservableState<LogViewState>;
  configState: ObservableState<ConfigState>;
}) {
  const historyElt = strHtml`<div />`;
  const moduleBodyElt = strHtml`<div class="state-history-body module-body">
    ${historyElt}
  </div>`;

  const render = () => {
    historyElt.innerHTML = "";
    const snapshots = state.getCurrentState(STATE_PROPS.PERFORMANCE_SNAPSHOTS);
    if (snapshots === undefined || snapshots.length === 0) {
      displayNoInformation();
      return;
    }

    const tableElt = strHtml`<table>
      <tr>
        <th>Window end</th>
        <th>Video frames</th>
        <th>Long tasks</th>
        <th>Long frames</th>
        <th>Slow interactions</th>
        <th>Time Travel</th>
      </tr>
    </table>`;
    for (
      let i = snapshots.length - 1;
      i >= 0 && snapshots.length - i <= MAX_ELEMENTS;
      i--
    ) {
      const snapshot = snapshots[i];
      const focusButton = strHtml`<button>◎</button>`;
      focusButton.title = "Focus on the log which reported this window";
      focusButton.onclick = () => focusSnapshot(snapshot, logView);
      tableElt.appendChild(strHtml`<tr>
        <td>${formatTimestamp(snapshot.endTime, logView, configState)}</td>
        <td>${formatVideoFrames(snapshot)}</td>
        <td>${formatLongTasks(snapshot)}</td>
        <td>${formatLongFrames(snapshot)}</td>
        <td>${formatInteractions(snapshot)}</td>
        <td>${focusButton}</td>
      </tr>`);
    }
    historyElt.appendChild(tableElt);
    moduleBodyElt.classList.remove("empty");
  };

  const unsubscribeFns = [
    state.subscribe(STATE_PROPS.PERFORMANCE_SNAPSHOTS, render, true),
    configState.subscribe(STATE_PROPS.TIME_REPRESENTATION, render, true),
  ];
  return {
    body: moduleBodyElt,
    destroy() {
      unsubscribeFns.forEach((unsubscribe) => unsubscribe());
    },
  };

  function displayNoInformation() {
    historyElt.textContent = "No runtime performance snapshots";
    moduleBodyElt.classList.add("empty");
  }
}

function focusSnapshot(
  snapshot: RuntimePerformanceSnapshot,
  logView: ObservableState<LogViewState>,
): void {
  logView.updateState(
    STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
    UPDATE_TYPE.REPLACE,
    0,
  );
  logView.updateState(
    STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
    UPDATE_TYPE.REPLACE,
    snapshot.observedAt,
  );
  logView.updateState(
    STATE_PROPS.SELECTED_LOG_ID,
    UPDATE_TYPE.REPLACE,
    snapshot.logId,
  );
  logView.commitUpdates();
}

function formatTimestamp(
  timestamp: number,
  logView: ObservableState<LogViewState>,
  configState: ObservableState<ConfigState>,
): string {
  if (configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) === "date") {
    const dateAtPageLoad =
      logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
    return convertDateToLocalISOString(new Date(timestamp + dateAtPageLoad));
  }
  return timestamp.toFixed(2);
}

function formatLongTasks(snapshot: RuntimePerformanceSnapshot): string {
  if (
    snapshot.longTaskCount === null ||
    snapshot.longTaskDuration === null ||
    snapshot.longestLongTask === null
  ) {
    return "Unsupported";
  }
  return `${String(snapshot.longTaskCount)} · ${formatMs(
    snapshot.longTaskDuration,
  )} total · ${formatMs(snapshot.longestLongTask)} max`;
}

function formatVideoFrames(snapshot: RuntimePerformanceSnapshot): string {
  if (snapshot.videoElementCount === 0) {
    return "No video";
  } else if (
    snapshot.sampledVideoElementCount === null ||
    snapshot.totalVideoFrames === null ||
    snapshot.droppedVideoFrames === null
  ) {
    return "Unsupported";
  } else if (snapshot.sampledVideoElementCount === 0) {
    return "Baseline";
  }
  return `${String(snapshot.droppedVideoFrames)} dropped / ${String(
    snapshot.totalVideoFrames,
  )} total`;
}

function formatLongFrames(snapshot: RuntimePerformanceSnapshot): string {
  if (
    snapshot.longAnimationFrameCount === null ||
    snapshot.longAnimationFrameBlockingDuration === null ||
    snapshot.longestLongAnimationFrame === null
  ) {
    return "Unsupported";
  }
  return `${String(snapshot.longAnimationFrameCount)} · ${formatMs(
    snapshot.longAnimationFrameBlockingDuration,
  )} blocking · ${formatMs(snapshot.longestLongAnimationFrame)} max`;
}

function formatInteractions(snapshot: RuntimePerformanceSnapshot): string {
  if (
    snapshot.interactionCount === null ||
    snapshot.longestInteraction === null ||
    snapshot.longestInputDelay === null
  ) {
    return "Unsupported";
  }
  if (snapshot.interactionCount === 0) {
    return "0";
  }
  return `${String(snapshot.interactionCount)} · ${formatMs(
    snapshot.longestInteraction,
  )} max · ${formatMs(snapshot.longestInputDelay)} input delay`;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}
