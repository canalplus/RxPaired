import strHtml from "str-html";
import {
  ConfigState,
  DISABLE_PASSWORD,
  InspectorState,
  LogViewState,
  SERVER_URL,
  STATE_PROPS,
} from "../constants";
import createModules from "../create_modules";
import ObservableState, { UPDATE_TYPE } from "../observable_state";
import updateStateFromLog, {
  updateStatesFromLogGroup,
} from "../update_state_from_log";
import { displayError, generatePageUrl } from "../utils";
import {
  createClearStoredConfigButton,
  createDarkLightModeButton,
  createTimeRepresentationSwitch,
  isInitLog,
  parseAndGenerateInitLog,
} from "./utils";

/**
 * Some minor features are detected to be only present on chromium-based
 * browsers for now but are sadly neither polyfillable nor feature-detectable.
 *
 * I'm mainly talking here about ANSI escape code in the JavaScript console,
 * which fortunately is only a very small feature.
 *
 * It is with great sadness that I only enable it on Chromium-based browsers
 * this way.
 */
// eslint-disable-next-line
const isChromiumBasedBrowser = (window as any).chrome != null;

/**
 * Generate the HTML page linked to live debugging.
 * @param {string} password - The password currently used for server
 * interaction. Empty string for no password.
 * @param {string} tokenId - The current used token.
 * @param {Object} configState
 * @returns {Function} - Call this function to clean up all resources created
 * by this page. Should be called when the page is disposed.
 */
export default function generateLiveDebuggingPage(
  password: string,
  tokenId: string,
  configState: ObservableState<ConfigState>,
): () => void {
  /** Define sendInstruction` globally, to send JS instructions to the device. */
  (window as unknown as Record<string, unknown>).sendInstruction =
    sendInstruction;

  /** Stores the state of currently-inspected logs. */
  const logViewState = new ObservableState<LogViewState>();
  /** Store the state on which the inspector modules will depend. */
  const inspectorState = new ObservableState<InspectorState>();
  /**
   * WebSocket instance used to exchange with the debug server.
   * @type {WebSocket.WebSocket}
   */
  const currentSocket: WebSocket = startWebsocketConnection(password, tokenId);
  /**
   * `true` once an `ack` message has been received.
   * This indicates that the token request was valid.
   */
  let wasAckReceived = false;

  const initialHistory =
    logViewState.getCurrentState(STATE_PROPS.LOGS_HISTORY) ?? [];
  let nextLogId = initialHistory.reduce((acc, val) => Math.max(acc, val[1]), 0);

  const errorContainerElt = strHtml`<div/>`;
  const headerElt = createLiveDebuggerHeaderElement(
    tokenId,
    currentSocket,
    configState,
    logViewState,
    inspectorState,
  );
  const modulesContainerElt = strHtml`<div/>`;
  const liveDebuggingBodyElt = strHtml`<div>
    ${errorContainerElt}
    ${headerElt}
    ${modulesContainerElt}
  </div>`;
  document.body.appendChild(liveDebuggingBodyElt);

  logViewState.subscribe(STATE_PROPS.SELECTED_LOG_ID, () => {
    const logViewProps = logViewState.getCurrentState();
    const selectedLogId = logViewProps[STATE_PROPS.SELECTED_LOG_ID];
    const history = logViewProps[STATE_PROPS.LOGS_HISTORY] ?? [];
    const stateProps = inspectorState.getCurrentState();
    /* eslint-disable-next-line */
    (Object.keys(stateProps) as unknown as Array<keyof InspectorState>).forEach(
      (stateProp: keyof InspectorState) => {
        // TODO special separate ObservableState object for those?
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

  const disposeModules = createModules({
    containerElt: modulesContainerElt,
    context: "live-debugging",
    tokenId,
    logViewState,
    configState,
    inspectorState,
  });
  currentSocket.addEventListener("close", onWebSocketClose);
  currentSocket.addEventListener("error", onWebSocketError);
  currentSocket.addEventListener("message", onWebSocketMessage);

  return () => {
    currentSocket.removeEventListener("close", onWebSocketClose);
    currentSocket.removeEventListener("error", onWebSocketError);
    currentSocket.removeEventListener("message", onWebSocketMessage);
    currentSocket.close();
    disposeModules();
    inspectorState.dispose();
    delete (window as unknown as Record<string, unknown>).sendInstruction;
    document.body.removeChild(liveDebuggingBodyElt);
  };

  function onWebSocketClose() {
    if (!wasAckReceived) {
      displayError(
        errorContainerElt,
        "Unable to start WebSocket connection to RxPaired's server. " +
          "This may be linked to either an issue with your network connection, " +
          "a firewall policy, " +
          "an issue with the RxPaired server and/or " +
          "a wrong server password (on that last point, you may enter a " +
          'different one by clicking on the "Password" link).',
      );
    } else {
      displayError(
        errorContainerElt,
        "WebSocket connection closed unexpectedly.",
      );
    }
  }

  function onWebSocketError() {
    displayError(errorContainerElt, "WebSocket connection error.");
  }

  function onWebSocketMessage(event: MessageEvent) {
    if (event == null || event.data == null) {
      displayError(errorContainerElt, "No message received from WebSocket");
    }
    if (typeof event.data !== "string") {
      displayError(errorContainerElt, "Invalid message format received");
      return;
    }
    const hasSelectedLog =
      logViewState.getCurrentState(STATE_PROPS.SELECTED_LOG_ID) !== undefined;

    if (event.data === "ping") {
      currentSocket.send("pong");
      return;
    } else if (event.data === "ack") {
      wasAckReceived = true;
      return;
    }

    /* eslint-disable @typescript-eslint/restrict-template-expressions */
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    if (event.data[0] === "{") {
      try {
        const signal = JSON.parse(event.data);

        if (isInitLog(event.data)) {
          const { dateAtPageLoad, log } = parseAndGenerateInitLog(event.data);
          clearInspectorState(inspectorState, logViewState);
          let updates: Array<[string, number]> = [[log, nextLogId++]];
          if (signal.value?.history?.length > 0) {
            updates = updates.concat(
              (signal.value.history as string[]).map((str) => [
                str,
                nextLogId++,
              ]),
            );
          }
          logViewState.updateState(
            STATE_PROPS.LOGS_HISTORY,
            UPDATE_TYPE.PUSH,
            updates,
          );
          logViewState.updateState(
            STATE_PROPS.DATE_AT_PAGE_LOAD,
            UPDATE_TYPE.REPLACE,
            dateAtPageLoad ?? Date.now(),
          );

          if (!hasSelectedLog) {
            updateStatesFromLogGroup(inspectorState, updates);
          }
          inspectorState.commitUpdates();
          logViewState.commitUpdates();
        } else if (signal.type === "eval-result") {
          const { value } = signal;
          if (typeof value.id === "string") {
            const emphasizedId = emphasizeForConsole(value.id as string);
            console.log(
              `---> Result of instruction ${emphasizedId}: ${value.data}`,
            );
          }
        } else if (signal.type === "eval-error") {
          const { value } = signal;
          if (typeof value.id === "string") {
            let errorString =
              typeof value.error?.name === "string"
                ? value.error.name
                : "Unknown Error";
            if (typeof value.error.message === "string") {
              errorString += ": " + (value.error.message as string);
            }
            const emphasizedId = emphasizeForConsole(value.id as string);
            console.log(
              `---> Failure of instruction ${emphasizedId}: ${errorString}`,
            );
          }
        }
        /* eslint-enable @typescript-eslint/restrict-template-expressions */
        /* eslint-enable @typescript-eslint/no-unsafe-assignment */
        /* eslint-enable @typescript-eslint/no-unsafe-member-access */
      } catch (err) {
        console.error("Could not parse signalling message", err);
        displayError(
          errorContainerElt,
          "Invalid signaling message format received",
        );
        return;
      }
    } else {
      const newLog = event.data;
      logViewState.updateState(STATE_PROPS.LOGS_HISTORY, UPDATE_TYPE.PUSH, [
        [newLog, nextLogId++],
      ]);
      if (!hasSelectedLog) {
        updateStateFromLog(inspectorState, event.data, nextLogId - 1);
      }
      inspectorState.commitUpdates();
      logViewState.commitUpdates();
    }
  }

  function sendInstruction(instruction: string) {
    const id = String(Math.random().toString(36)).substring(2);
    currentSocket.send(
      JSON.stringify({
        type: "eval",
        value: {
          id,
          instruction,
        },
      }),
    );
    const emphasizedId = emphasizeForConsole(id);
    console.log(`<--- Instruction ${emphasizedId} sent`);
  }
}

/**
 * Returns an HTML element corresponding to the Live Debugger's header.
 * @param {string} tokenId
 * @param {WebSocket.WebSocket} currentSocket
 * @param {Object} configState
 * @param {Object} inspectorState
 * @returns {HTMLElement}
 */
function createLiveDebuggerHeaderElement(
  tokenId: string,
  currentSocket: WebSocket,
  configState: ObservableState<ConfigState>,
  logViewState: ObservableState<LogViewState>,
  inspectorState: ObservableState<InspectorState>,
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
        " > Live Debugging",
      ]}</span><span class="header-item token-header-value">${[
        strHtml`<span class="token-title-desc">Token: </span>`,
        strHtml`<span class="token-title-val">${tokenId}</span>`,
      ]}</span>
    </div>
    <div class="header-item page-controls">${[
      createTimeRepresentationSwitch(configState),
      createExportLogsButton(logViewState),
      createCloseConnectionButton(currentSocket),
      createClearAllButton(inspectorState, logViewState),
      createClearStoredConfigButton(configState),
      createDarkLightModeButton(configState),
    ]}</div>
  </div>`;
}

/**
 * Returns an HTML element corresponding to the closure of the current socket's
 * connection.
 * @param {WebSocket.WebSocket} currentSocket
 * @returns {HTMLElement}
 */
function createCloseConnectionButton(currentSocket: WebSocket): HTMLElement {
  const buttonElt =
    strHtml`<button>${"✋ Stop listening"}</button>` as HTMLButtonElement;
  buttonElt.onclick = function () {
    if (currentSocket !== null) {
      currentSocket.close();
    }
    buttonElt.disabled = true;
  };
  return buttonElt;
}

/**
 * @param {Object} logViewState
 * @returns {HTMLButtonElement}
 */
function createExportLogsButton(
  logViewState: ObservableState<LogViewState>,
): HTMLButtonElement {
  const buttonElt =
    strHtml`<button>${"💾 Export"}</button>` as HTMLButtonElement;
  buttonElt.onclick = function () {
    exportLogs(logViewState);
  };
  return buttonElt;
}

/**
 * @param {Object} inspectorState
 * @returns {HTMLButtonElement}
 */
function createClearAllButton(
  inspectorState: ObservableState<InspectorState>,
  logViewState: ObservableState<LogViewState>,
): HTMLButtonElement {
  const buttonElt =
    strHtml`<button>${"🧹 Clear all logs"}</button>` as HTMLButtonElement;
  buttonElt.onclick = function () {
    clearInspectorState(inspectorState, logViewState);
  };
  return buttonElt;
}

/**
 * @param {Object} inspectorState
 */
export function clearInspectorState(
  inspectorState: ObservableState<InspectorState>,
  logViewState: ObservableState<LogViewState>,
): void {
  {
    const stateProps = Object.keys(inspectorState.getCurrentState()) as Array<
      keyof InspectorState
    >;
    stateProps.forEach((prop) => {
      inspectorState.updateState(prop, UPDATE_TYPE.REPLACE, undefined);
    });
    inspectorState.commitUpdates();
  }
  {
    const logViewProps = Object.keys(logViewState.getCurrentState()) as Array<
      keyof LogViewState
    >;
    logViewProps.forEach((prop) => {
      logViewState.updateState(prop, UPDATE_TYPE.REPLACE, undefined);
    });
    logViewState.commitUpdates();
  }
}

/**
 * Download all logs in a txt file.
 * @param {Object} logViewState
 */
function exportLogs(logViewState: ObservableState<LogViewState>): void {
  const aElt = document.createElement("a");
  aElt.style.display = "none";
  document.body.appendChild(aElt);
  const logsHistory =
    logViewState.getCurrentState(STATE_PROPS.LOGS_HISTORY) ?? [];
  const logExport = logsHistory.map(([log, _ts]) => log).join("\n");
  const blob = new Blob([logExport], { type: "octet/stream" });
  const url = window.URL.createObjectURL(blob);
  aElt.href = url;
  aElt.download = "log-export-" + new Date().toISOString() + ".txt";
  aElt.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(aElt);
}

/**
 * Starts a websocket connection with the given token.
 * @param {string} password - The password currently used for server
 * interaction. Empty string for no password.
 * @param {string} tokenId - The current used token.
 * @returns {WebSocket.WebSocket}
 */
function startWebsocketConnection(
  password: string,
  tokenId: string,
): WebSocket {
  const wsUrl =
    password === ""
      ? `${SERVER_URL}${tokenId}`
      : `${SERVER_URL}${password}/${tokenId}`;
  const socket = new WebSocket(wsUrl);
  return socket;
}

/**
 * Add ANSI escape sequences to colorize the given text if supported on the
 * current browser (sadly this is not easily detectable, so the browsers where
 * this is happening is hardcoded for now).
 *
 * Keep the text in the default color on user agents which are not known to
 * support ANSI escape sequences.
 * @param {string} text
 */
function emphasizeForConsole(text: string): string {
  return isChromiumBasedBrowser ? `\u001b[32m${text}\u001b[0m` : text;
}
