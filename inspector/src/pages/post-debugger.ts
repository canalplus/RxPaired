import strHtml from "str-html";
import {
  ConfigState,
  DISABLE_PASSWORD,
  InspectorState,
  LogViewState,
  STATE_PROPS,
} from "../constants";
import createWorkspace from "../create_workspace";
import ObservableState, { UPDATE_TYPE } from "../observable_state";
import { updateStatesFromLogGroup } from "../update_state_from_log";
import { generatePageUrl } from "../utils";
import { clearInspectorState } from "./live_debugging";
import {
  createClearStoredConfigButton,
  createDarkLightModeButton,
  createTimeRepresentationSwitch,
  isInitLog,
  parseAndGenerateInitLog,
} from "./utils";

const START_LOG_LINE_REGEXP = /^[0-9]+\.[0-9]{2} \[/;

/**
 * @param {Object} configState
 * @returns {Function} - Call this function to clean up all resources created
 * by this page. Should be called when the page is disposed.
 */
export default function generatePostDebuggerPage(
  configState: ObservableState<ConfigState>,
): () => void {
  const inspectorState = new ObservableState<InspectorState>();
  const logViewState = new ObservableState<LogViewState>();
  const modulesContainerElt = strHtml`<div/>`;
  const bodyElement = strHtml`<div>
    ${createPostDebuggerHeaderElement(configState)}
    <div class="page-input-block">
      <span>Log file to import: </span>
      ${createImportFileButton(inspectorState, logViewState)}
    </div>
    ${modulesContainerElt}
  </div>`;
  document.body.appendChild(bodyElement);

  logViewState.subscribe(STATE_PROPS.SELECTED_LOG_ID, () => {
    const logViewProps = logViewState.getCurrentState();
    const selectedLogId = logViewProps[STATE_PROPS.SELECTED_LOG_ID];
    const history = logViewProps[STATE_PROPS.LOGS_HISTORY] ?? [];
    const stateProps = inspectorState.getCurrentState();
    /* eslint-disable-next-line */
    (Object.keys(stateProps) as unknown as Array<keyof InspectorState>).forEach(
      (stateProp: keyof InspectorState) => {
        inspectorState.updateState(stateProp, UPDATE_TYPE.REPLACE, undefined);
      },
    );
    if (selectedLogId === undefined) {
      updateStatesFromLogGroup(inspectorState, history);
      inspectorState.commitUpdates();
      return;
    } else {
      const selectedLogIdx = history.findIndex(
        ([_msg, id]) => id === selectedLogId,
      );
      if (selectedLogIdx < 0) {
        updateStatesFromLogGroup(inspectorState, history);
        inspectorState.commitUpdates();
      } else {
        const consideredLogs = history.slice(0, selectedLogIdx + 1);
        updateStatesFromLogGroup(inspectorState, consideredLogs);
        inspectorState.commitUpdates();
      }
    }
  });

  const disposeWorkspace = createWorkspace({
    containerElt: modulesContainerElt,
    context: "post-debugger",
    configState,
    logViewState,
    inspectorState,
  });

  return () => {
    disposeWorkspace();
    inspectorState.dispose();
    document.body.removeChild(bodyElement);
  };
}

function createImportFileButton(
  inspectorState: ObservableState<InspectorState>,
  logViewState: ObservableState<LogViewState>,
): HTMLInputElement {
  const fileInputEl =
    strHtml`<input name="file" type="file">` as HTMLInputElement;
  fileInputEl.addEventListener("change", onFileSelection, false);
  return fileInputEl;

  /**
   * @param {Event} evt
   */
  function onFileSelection(evt: Event) {
    const { target } = evt;
    if (target === null || !(target instanceof HTMLInputElement)) {
      return;
    }
    const files = target.files; // FileList object
    if (files === null || files.length === 0) {
      return;
    }

    const file = files[0];
    const reader = new FileReader();

    reader.onload = (loadEvt: Event) => {
      const { target: loadTarget } = loadEvt;
      if (loadTarget === null || !(loadTarget instanceof FileReader)) {
        return;
      }
      if (typeof loadTarget.result !== "string") {
        return;
      }
      clearInspectorState(inspectorState, logViewState);
      const dataStr = loadTarget.result;
      const logs: Array<[string, number]> = [];
      let dateAtPageLoad;
      let remaininStrConsidered = dataStr;
      let id = 0;
      while (remaininStrConsidered.length > 0) {
        let indexOfEnd: number;
        let offset = 0;
        let indexOfBrk = remaininStrConsidered.indexOf("\n");
        while (indexOfBrk >= 0) {
          const strAfterBrk = remaininStrConsidered.substring(
            indexOfBrk + 1 + offset,
          );
          const nextCharCode = strAfterBrk.charCodeAt(0);
          if (
            !isNaN(nextCharCode) &&
            nextCharCode >= 48 &&
            nextCharCode <= 57
          ) {
            if (START_LOG_LINE_REGEXP.test(strAfterBrk)) {
              break;
            }
          }
          offset += indexOfBrk + 1;
          indexOfBrk = strAfterBrk.indexOf("\n");
        }
        if (indexOfBrk === -1) {
          indexOfEnd = remaininStrConsidered.length;
        } else {
          indexOfEnd = indexOfBrk + offset;
        }
        const logLine = remaininStrConsidered.substring(0, indexOfEnd);

        if (isInitLog(logLine)) {
          dateAtPageLoad = parseAndGenerateInitLog(logLine).dateAtPageLoad;
        }
        logs.push([logLine, id++]);
        remaininStrConsidered = remaininStrConsidered.substring(indexOfEnd + 1);
      }

      logViewState.updateState(
        STATE_PROPS.LOGS_HISTORY,
        UPDATE_TYPE.REPLACE,
        logs,
      );

      logViewState.updateState(
        STATE_PROPS.DATE_AT_PAGE_LOAD,
        UPDATE_TYPE.REPLACE,
        dateAtPageLoad ?? Date.now(),
      );

      updateStatesFromLogGroup(inspectorState, logs);
      inspectorState.commitUpdates();
      logViewState.commitUpdates();
    };

    reader.readAsText(file);
    return;
  }
}

/**
 * Returns an HTML element corresponding to the Live Debugger's header.
 * @param {Object} configState
 * @returns {HTMLElement}
 */
function createPostDebuggerHeaderElement(
  configState: ObservableState<ConfigState>,
): HTMLElement {
  return strHtml`<div class="header">
    <div class="token-title">
      <span class="header-item page-title">${[
        DISABLE_PASSWORD
          ? null
          : [
              strHtml`<a href=${generatePageUrl({
                tokenId: null,
                forcePassReset: true,
                isPostDebugger: false,
              })}>Password</a>`,
              " > ",
            ],
        strHtml`<a href=${generatePageUrl({
          tokenId: null,
          forcePassReset: false,
          isPostDebugger: false,
        })}>Token</a>`,
        " > Post-Debugger",
      ]}</span>
    </div>
    <div class="header-item page-controls">${[
      createTimeRepresentationSwitch(configState),
      createClearStoredConfigButton(configState),
      createDarkLightModeButton(configState),
    ]}</div>
  </div>`;
}
