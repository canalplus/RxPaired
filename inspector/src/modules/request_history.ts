import strHtml from "str-html";
import {
  ConfigState,
  InspectorState,
  LogViewState,
  RequestInformation,
  STATE_PROPS,
} from "../constants";
import ObservableState, { UPDATE_TYPE } from "../observable_state";
import { convertDateToLocalISOString } from "../utils";
import { ModuleFunction } from ".";

const MAX_REQ_ELEMENTS = 50;

export default function generateRequestHistoryModule(
  mediaType: "audio" | "video" | "text",
): ModuleFunction {
  return function RequestInformationModule({
    state,
    logView,
    configState,
  }: {
    state: ObservableState<InspectorState>;
    logView: ObservableState<LogViewState>;
    configState: ObservableState<ConfigState>;
  }) {
    const requestDataElt = strHtml`<div>No request information</div>`;
    const moduleBodyElt = strHtml`<div class="request-history-body module-body">
      ${requestDataElt}
    </div>`;
    const stateProp =
      mediaType === "audio"
        ? STATE_PROPS.AUDIO_REQUEST_HISTORY
        : mediaType === "video"
          ? STATE_PROPS.VIDEO_REQUEST_HISTORY
          : STATE_PROPS.TEXT_REQUEST_HISTORY;

    let pendingRequestInfo: {
      element: HTMLElement;
      timestamp: number;
    } | null = null;

    const unsubscribeLogHistory = logView.subscribe(
      STATE_PROPS.LOGS_HISTORY,
      updatePendingTimeElt,
    );
    const unsubscribeSelected = logView.subscribe(
      STATE_PROPS.SELECTED_LOG_ID,
      updatePendingTimeElt,
    );

    const renderRequestHistory = () => {
      requestDataElt.innerHTML = "";
      pendingRequestInfo = null;

      // TODO more optimized: rely on push
      const requestInfo = state.getCurrentState(stateProp);

      if (requestInfo === undefined) {
        displayNoRequestInformation();
        return;
      }
      let canStillReceivePending = true;
      const tableElt = strHtml`<table>
      <tr>
        <th>Log TS</th>
        <th>Req. status</th>
        <th>Req. duration (ms)</th>
        <th>Period id</th>
        <th>Representation id</th>
        <th>Seg. start (s)</th>
        <th>Seg. duration (s)</th>
      </tr>
    </table>`;
      for (let i = requestInfo?.length - 1; i >= 0; i--) {
        const req = requestInfo[i];

        let innerText: string;
        if (
          configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) ===
          "date"
        ) {
          const dateAtPageLoad =
            logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
          innerText = convertDateToLocalISOString(
            new Date(req.timestamp + dateAtPageLoad),
          );
        } else {
          innerText = `${req.timestamp}`;
        }
        const timestampElt = strHtml`<td>${innerText}</td>`;
        timestampElt.style.cursor = "pointer";
        timestampElt.style.textDecoration = "underline";
        timestampElt.onclick = () => {
          logView.updateState(
            STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
            UPDATE_TYPE.REPLACE,
            0,
          );
          logView.updateState(
            STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
            UPDATE_TYPE.REPLACE,
            req.timestamp,
          );
          logView.commitUpdates();
        };

        if (canStillReceivePending && req.eventType === "start") {
          pendingRequestInfo = {
            element: strHtml`<td> - </td>`,
            timestamp: req.timestamp,
          };
          updatePendingTimeElt();
          const newElt = strHtml`<tr>
          ${timestampElt}
          <td>pending</td>
          ${pendingRequestInfo.element}
          <td>${req.periodId}</td>
          <td>${req.representationId}</td>
          <td>
            ${req.segmentStart === -1 ? "init" : req.segmentStart.toFixed(2)}
          </td>
          <td>
            ${req.segmentDuration === -1 ? "-" : req.segmentDuration.toFixed(2)}
          </td>
        </tr>`;
          tableElt.appendChild(newElt);
          canStillReceivePending = false;
        } else if (req.eventType !== "start") {
          canStillReceivePending = false;
          if (req.eventType === "aborted") {
            // There's a small issue in the RxPlayer where init segments might
            // be aborted synchronously before their success is anounced. This
            // should have no effect on playback however.
            // TODO fix it in the RxPlayer
            let shouldIgnore = false;
            for (let j = i + 1; j < requestInfo.length; j++) {
              const reqNext = requestInfo[j];
              if (isRequestingSameSegment(reqNext, req)) {
                if (reqNext.eventType === "success") {
                  shouldIgnore = true;
                }
                break;
              }
            }
            if (shouldIgnore) {
              continue;
            }
          }
          for (let j = i - 1; j >= 0; j--) {
            const reqBase = requestInfo[j];
            if (
              isRequestingSameSegment(reqBase, req) &&
              reqBase.eventType === "start"
            ) {
              tableElt.appendChild(
                strHtml`<tr>
                ${timestampElt}
                <td>${req.eventType}</td>
                <td>
                  ${(req.timestamp - reqBase.timestamp).toFixed(2)}
                </td>
                <td>${req.periodId}</td>
                <td>${req.representationId}</td>
                <td>
                  ${req.segmentStart === -1 ? "init" : req.segmentStart}
                </td>
                <td>
                  ${req.segmentDuration === -1 ? "-" : req.segmentDuration}
                </td>
              </tr>`,
              );
              if (tableElt.childNodes.length >= MAX_REQ_ELEMENTS - 1) {
                requestDataElt.appendChild(tableElt);
                moduleBodyElt.classList.remove("empty");
                return;
              }
              break;
            }
          }
        }
      }
      if (tableElt.childNodes.length === 1) {
        displayNoRequestInformation();
        return;
      }
      requestDataElt.appendChild(tableElt);
      moduleBodyElt.classList.remove("empty");
    };
    const unsubscribeHistory = state.subscribe(
      stateProp,
      renderRequestHistory,
      true,
    );

    const unsubscribeTimeRepresentation = configState.subscribe(
      STATE_PROPS.TIME_REPRESENTATION,
      renderRequestHistory,
      true,
    );
    return {
      body: moduleBodyElt,
      destroy() {
        unsubscribeLogHistory();
        unsubscribeSelected();
        unsubscribeHistory();
        unsubscribeTimeRepresentation();
      },
    };

    function displayNoRequestInformation() {
      requestDataElt.textContent = "No request information";
      moduleBodyElt.classList.add("empty");
    }

    function updatePendingTimeElt() {
      if (pendingRequestInfo === null) {
        return;
      }
      let lastKnownTimestamp: number | undefined;
      const logs = logView.getCurrentState(STATE_PROPS.LOGS_HISTORY) ?? [];
      const selectedLogId = logView.getCurrentState(
        STATE_PROPS.SELECTED_LOG_ID,
      );
      if (selectedLogId === undefined) {
        if (logs.length > 0) {
          lastKnownTimestamp = parseFloat(logs[logs.length - 1][0]);
        }
      } else {
        const selectedLogElt = logs.find(([_msg, id]) => id === selectedLogId);
        if (selectedLogElt !== undefined) {
          lastKnownTimestamp = parseFloat(selectedLogElt[0]);
        }
      }
      if (typeof lastKnownTimestamp === "number" && isNaN(lastKnownTimestamp)) {
        lastKnownTimestamp = undefined;
      }
      pendingRequestInfo.element.textContent =
        lastKnownTimestamp === undefined
          ? " - "
          : `+${(lastKnownTimestamp - pendingRequestInfo.timestamp).toFixed(2)}ms`;
    }
  };
}

function isRequestingSameSegment(
  req1: RequestInformation,
  req2: RequestInformation,
) {
  return (
    req1.periodId === req2.periodId &&
    req1.adaptationId === req2.adaptationId &&
    req1.representationId === req2.representationId &&
    req1.segmentStart === req2.segmentStart &&
    req1.segmentDuration === req2.segmentDuration
  );
}
