import strHtml from "str-html";
import { ConfigState, STATE_PROPS } from "../constants";
import ObservableState, { UPDATE_TYPE } from "../observable_state";
import { getDefaultModuleOrder } from "../utils";

/**
 * Returns an HTML element corresponding to the light/dark mode button.
 * @param {Object} configState
 * @returns {HTMLButtonElement}
 */
export function createDarkLightModeButton(
  configState: ObservableState<ConfigState>,
): HTMLButtonElement {
  const buttonElt =
    strHtml`<button class="btn-dark-light-mode" />` as HTMLButtonElement;
  let isDark: boolean;
  configState.subscribe(
    STATE_PROPS.CSS_MODE,
    () => {
      isDark = configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
      if (isDark) {
        document.body.classList.replace("light", "dark");
        buttonElt.textContent = "☼ Light mode";
      } else {
        document.body.classList.replace("dark", "light");
        buttonElt.textContent = "🌘 Dark mode";
      }
    },
    true,
  );
  buttonElt.onclick = function () {
    configState.updateState(
      STATE_PROPS.CSS_MODE,
      UPDATE_TYPE.REPLACE,
      isDark ? "light" : "dark",
    );
    configState.commitUpdates();
  };
  return buttonElt;
}

/**
 * @param {Object} configState
 * @returns {HTMLElement}
 */
export function createClearStoredConfigButton(
  configState: ObservableState<ConfigState>,
): HTMLElement {
  const buttonElt = document.createElement("button");
  buttonElt.textContent = "🧹 Clear page config";
  buttonElt.onclick = function () {
    // TODO "clear" `updateType` and clearing all but module-related config?
    configState.updateState(
      STATE_PROPS.CLOSED_MODULES,
      UPDATE_TYPE.REPLACE,
      [],
    );
    configState.updateState(
      STATE_PROPS.MINIMIZED_MODULES,
      UPDATE_TYPE.REPLACE,
      [],
    );
    configState.updateState(
      STATE_PROPS.LOG_PANE_WIDTH,
      UPDATE_TYPE.REPLACE,
      50,
    );
    configState.updateState(
      STATE_PROPS.LOG_PANE_COLLAPSED,
      UPDATE_TYPE.REPLACE,
      false,
    );
    configState.updateState(
      STATE_PROPS.MODULES_ORDER,
      UPDATE_TYPE.REPLACE,
      getDefaultModuleOrder(),
    );
    configState.commitUpdates();
  };
  configState.subscribe(STATE_PROPS.CLOSED_MODULES, check);
  configState.subscribe(STATE_PROPS.MODULES_ORDER, check);
  configState.subscribe(STATE_PROPS.MINIMIZED_MODULES, check);
  configState.subscribe(STATE_PROPS.LOG_PANE_WIDTH, check);
  configState.subscribe(STATE_PROPS.LOG_PANE_COLLAPSED, check);
  check();

  function check() {
    const closedModules =
      configState.getCurrentState(STATE_PROPS.CLOSED_MODULES) ?? [];
    const minimizedModules =
      configState.getCurrentState(STATE_PROPS.MINIMIZED_MODULES) ?? [];
    const logPaneWidth =
      configState.getCurrentState(STATE_PROPS.LOG_PANE_WIDTH) ?? 50;
    const logPaneCollapsed =
      configState.getCurrentState(STATE_PROPS.LOG_PANE_COLLAPSED) ?? false;
    const modulesOrder =
      configState.getCurrentState(STATE_PROPS.MODULES_ORDER) ?? [];
    const defaultModuleOrder = getDefaultModuleOrder();
    const hasDefaultModuleOrder =
      modulesOrder.length === defaultModuleOrder.length &&
      modulesOrder.every(
        (moduleId: string, index: number) =>
          moduleId === defaultModuleOrder[index],
      );
    buttonElt.disabled =
      closedModules.length === 0 &&
      minimizedModules.length === 0 &&
      logPaneWidth === 50 &&
      !logPaneCollapsed &&
      hasDefaultModuleOrder;
  }
  return buttonElt;
}

export function createTimeRepresentationSwitch(
  configState: ObservableState<ConfigState>,
): HTMLElement {
  const isTimestamp =
    configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) ===
    "timestamp";
  const timeLabel = "Current time unit: 🕒 Time";
  const dateLabel = "Current time unit: 🗓️ Date";
  const label = strHtml`<label for="timeRepresentation"></label>`;
  const span = strHtml`<span></span>`;
  span.innerText = isTimestamp ? timeLabel : dateLabel;
  const checkbox = strHtml`<input
    type="checkbox"
    name="timeRepresentation"
    id="timeRepresentation"
  />` as HTMLInputElement;
  checkbox.checked = isTimestamp;
  function onChange(): void {
    span.innerText = checkbox.checked ? timeLabel : dateLabel;
    configState.updateState(
      STATE_PROPS.TIME_REPRESENTATION,
      UPDATE_TYPE.REPLACE,
      checkbox.checked ? "timestamp" : "date",
    );
    configState.commitUpdates();
  }
  checkbox.onchange = onChange;
  label.appendChild(span);
  label.appendChild(checkbox);
  return label;
}

export function isInitLog(log: string): boolean {
  if (log.startsWith("{")) {
    /* eslint-disable @typescript-eslint/restrict-template-expressions */
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    try {
      const signal = JSON.parse(log);
      return signal.type === "Init";
    } catch {
      /* eslint-enable @typescript-eslint/restrict-template-expressions */
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */
      return false;
    }
  }
  return false;
}

export function parseAndGenerateInitLog(log: string): {
  log: string;
  dateAtPageLoad: number;
} {
  const defaultLog = {
    log: "",
    dateAtPageLoad: 0,
  };
  try {
    /* eslint-disable @typescript-eslint/restrict-template-expressions */
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    const signal = JSON.parse(log);
    if (signal.type === "Init") {
      const initTimestamp = signal.value?.timestamp;
      const dateMs = signal.value?.dateMs;

      if (typeof initTimestamp === "number" && typeof dateMs === "number") {
        return {
          log: `${initTimestamp.toFixed(2)} [Init] Local-Date:${dateMs}`,
          dateAtPageLoad: dateMs - initTimestamp,
        };
      }
    }
    return defaultLog;
  } catch {
    /* eslint-enable @typescript-eslint/restrict-template-expressions */
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    /* eslint-enable @typescript-eslint/no-unsafe-member-access */
    return defaultLog;
  }
}

/** Remove history from a live Init signal before storing or exporting it. */
export function minimalInitLog(log: string): string {
  try {
    const signal: unknown = JSON.parse(log);
    if (
      typeof signal === "object" &&
      signal !== null &&
      "type" in signal &&
      signal.type === "Init" &&
      "value" in signal &&
      typeof signal.value === "object" &&
      signal.value !== null &&
      "timestamp" in signal.value &&
      "dateMs" in signal.value
    ) {
      const value = signal.value as Record<string, unknown>;
      const initValue: Record<string, unknown> = {
        timestamp: value.timestamp,
        dateMs: value.dateMs,
      };
      for (const key of ["version", "time", "offset"] as const) {
        if (key in value) {
          initValue[key] = value[key];
        }
      }
      return JSON.stringify({ type: "Init", value: initValue });
    }
  } catch {
    // Keep unrecognized lines unchanged.
  }
  return log;
}
