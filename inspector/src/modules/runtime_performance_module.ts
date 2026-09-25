import strHtml from "str-html";
import {
  ConfigState,
  InspectorState,
  LogViewState,
  RuntimePerformanceSnapshot,
  STATE_PROPS,
} from "../constants";
import ObservableState from "../observable_state";
import { convertDateToLocalISOString } from "../utils";

export default function RuntimePerformanceModule({
  state,
  logView,
  configState,
}: {
  state: ObservableState<InspectorState>;
  logView: ObservableState<LogViewState>;
  configState: ObservableState<ConfigState>;
}) {
  const moduleBodyElt = strHtml`<div class="module-body" />`;

  const render = () => {
    moduleBodyElt.innerHTML = "";
    const snapshots =
      state.getCurrentState(STATE_PROPS.PERFORMANCE_SNAPSHOTS) ?? [];
    const snapshot = snapshots[snapshots.length - 1];
    if (snapshot === undefined) {
      moduleBodyElt.textContent = "No runtime performance information";
      return;
    }

    const duration = snapshot.endTime - snapshot.startTime;
    const tableElt = strHtml`<table>
      <tr>
        <th>Area</th>
        <th>Metric</th>
        <th>Value</th>
      </tr>
    </table>`;
    appendMetricGroup(tableElt, "Snapshot", [
      ["Measured at", formatTimestamp(snapshot.endTime, logView, configState)],
      ["Window duration", formatSeconds(duration)],
    ]);
    appendMetricGroup(tableElt, "Playback", [
      ["Video frames", getVideoFrameCount(snapshot)],
      ["Dropped video frames", getDroppedVideoFrames(snapshot)],
    ]);
    appendMetricGroup(tableElt, "Main thread", [
      ["Long tasks", supportedCount(snapshot.longTaskCount)],
      ["Time in long tasks", supportedDuration(snapshot.longTaskDuration)],
      [
        "Longest long task",
        supportedMaximum(snapshot.longTaskCount, snapshot.longestLongTask),
      ],
    ]);
    appendMetricGroup(tableElt, "Rendering", [
      [
        "Long animation frames",
        supportedCount(snapshot.longAnimationFrameCount),
      ],
      [
        "Time in long frames",
        supportedDuration(snapshot.longAnimationFrameDuration),
      ],
      [
        "Blocking duration",
        supportedDuration(snapshot.longAnimationFrameBlockingDuration),
      ],
      [
        "Longest long frame",
        supportedMaximum(
          snapshot.longAnimationFrameCount,
          snapshot.longestLongAnimationFrame,
        ),
      ],
    ]);
    appendMetricGroup(tableElt, "Interactions", [
      ["Slow interactions", supportedCount(snapshot.interactionCount)],
      ["Slowest interaction", getInteractionDuration(snapshot)],
      [
        "Longest input delay",
        supportedMaximum(snapshot.interactionCount, snapshot.longestInputDelay),
      ],
    ]);
    moduleBodyElt.appendChild(tableElt);
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

function appendMetricGroup(
  table: HTMLElement,
  area: string,
  rows: Array<[metric: string, value: string]>,
): void {
  rows.forEach(([metric, value], index) => {
    table.appendChild(strHtml`<tr>
      <td>${index === 0 ? area : ""}</td>
      <td>${metric}</td>
      <td>${value}</td>
    </tr>`);
  });
}

function supportedCount(count: number | null): string {
  return count === null ? "Unsupported" : String(count);
}

function getVideoFrameCount(snapshot: RuntimePerformanceSnapshot): string {
  const unavailable = getVideoQualityUnavailableReason(snapshot);
  return unavailable ?? String(snapshot.totalVideoFrames ?? 0);
}

function getDroppedVideoFrames(snapshot: RuntimePerformanceSnapshot): string {
  const unavailable = getVideoQualityUnavailableReason(snapshot);
  if (unavailable !== undefined) {
    return unavailable;
  }
  const totalVideoFrames = snapshot.totalVideoFrames ?? 0;
  const droppedVideoFrames = snapshot.droppedVideoFrames ?? 0;
  const percentage =
    totalVideoFrames === 0 ? 0 : (droppedVideoFrames / totalVideoFrames) * 100;
  return `${String(droppedVideoFrames)} (${percentage.toFixed(2)}%)`;
}

function getVideoQualityUnavailableReason(
  snapshot: RuntimePerformanceSnapshot,
): string | undefined {
  if (snapshot.videoElementCount === 0) {
    return "No video element";
  } else if (
    snapshot.sampledVideoElementCount === null ||
    snapshot.totalVideoFrames === null ||
    snapshot.droppedVideoFrames === null
  ) {
    return "Unsupported";
  } else if (snapshot.sampledVideoElementCount === 0) {
    return "Establishing baseline";
  }
  return undefined;
}

function supportedDuration(duration: number | null): string {
  return duration === null ? "Unsupported" : formatMs(duration);
}

function supportedMaximum(
  count: number | null,
  maximum: number | null,
): string {
  if (count === null || maximum === null) {
    return "Unsupported";
  }
  return count === 0 ? "None observed" : formatMs(maximum);
}

function getInteractionDuration(snapshot: RuntimePerformanceSnapshot): string {
  const duration = supportedMaximum(
    snapshot.interactionCount,
    snapshot.longestInteraction,
  );
  return snapshot.longestInteractionName === null ||
    snapshot.longestInteractionName === ""
    ? duration
    : `${duration} (${snapshot.longestInteractionName})`;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function formatSeconds(value: number): string {
  return `${(value / 1000).toFixed(1)} s`;
}
