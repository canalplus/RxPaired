import { ConfigState, MODULE_CONFIG_LS_ITEM, STATE_PROPS } from "./constants";
import ObservableState, { UPDATE_TYPE } from "./observable_state";
import generateLiveDebuggingPage from "./pages/live_debugging";
import generatePasswordPage from "./pages/password";
import generatePostDebuggerPage from "./pages/post-debugger";
import generateTokenPage from "./pages/token";
import { displayError, getPageInfo, isTokenValid } from "./utils";

let currentPageCleanUp: (() => void) | undefined | void;

const configState = new ObservableState<ConfigState>();
configState.subscribe(STATE_PROPS.CSS_MODE, () => {
  if (configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark") {
    document.body.classList.replace("light", "dark");
  } else {
    document.body.classList.replace("dark", "light");
  }
});

initializeGlobalConfig();
function initializeGlobalConfig() {
  let currentModuleConfig: ConfigState = {};
  const storedModulesInfo = localStorage.getItem(MODULE_CONFIG_LS_ITEM);
  if (typeof storedModulesInfo === "string") {
    try {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      currentModuleConfig = JSON.parse(storedModulesInfo);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    } catch (err) {
      console.error("Could not parse previous stored module config", err);
    }
  }

  let currentMode = configState.getCurrentState(STATE_PROPS.CSS_MODE);
  if (currentMode === undefined) {
    currentMode =
      localStorage.getItem(STATE_PROPS.CSS_MODE) === "dark" ? "dark" : "light";
  }

  configState.updateState(
    STATE_PROPS.CSS_MODE,
    UPDATE_TYPE.REPLACE,
    currentMode,
  );
  configState.updateState(
    STATE_PROPS.CLOSED_MODULES,
    UPDATE_TYPE.REPLACE,
    currentModuleConfig[STATE_PROPS.CLOSED_MODULES] ?? [],
  );
  configState.updateState(
    STATE_PROPS.WIDTH_RATIOS,
    UPDATE_TYPE.REPLACE,
    currentModuleConfig[STATE_PROPS.WIDTH_RATIOS] ?? {},
  );
  configState.updateState(
    STATE_PROPS.MINIMIZED_MODULES,
    UPDATE_TYPE.REPLACE,
    currentModuleConfig[STATE_PROPS.MINIMIZED_MODULES] ?? [],
  );
  configState.updateState(
    STATE_PROPS.MODULES_ORDER,
    UPDATE_TYPE.REPLACE,
    currentModuleConfig[STATE_PROPS.MODULES_ORDER] ?? [],
  );
  configState.updateState(
    STATE_PROPS.TIME_REPRESENTATION,
    UPDATE_TYPE.REPLACE,
    currentModuleConfig[STATE_PROPS.TIME_REPRESENTATION] ?? "timestamp",
  );
  configState.commitUpdates();
  configState.subscribe(STATE_PROPS.CSS_MODE, () => {
    const isDark = configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
    localStorage.setItem(STATE_PROPS.CSS_MODE, isDark ? "dark" : "light");
  });
  configState.subscribe(STATE_PROPS.CLOSED_MODULES, () => {
    const closedModules =
      configState.getCurrentState(STATE_PROPS.CLOSED_MODULES) ?? [];
    currentModuleConfig[STATE_PROPS.CLOSED_MODULES] = closedModules;
    localStorage.setItem(
      MODULE_CONFIG_LS_ITEM,
      JSON.stringify(currentModuleConfig),
    );
  });
  configState.subscribe(STATE_PROPS.WIDTH_RATIOS, () => {
    const closedModules =
      configState.getCurrentState(STATE_PROPS.WIDTH_RATIOS) ?? {};
    currentModuleConfig[STATE_PROPS.WIDTH_RATIOS] = closedModules;
    localStorage.setItem(
      MODULE_CONFIG_LS_ITEM,
      JSON.stringify(currentModuleConfig),
    );
  });
  configState.subscribe(STATE_PROPS.MINIMIZED_MODULES, () => {
    const closedModules =
      configState.getCurrentState(STATE_PROPS.MINIMIZED_MODULES) ?? [];
    currentModuleConfig[STATE_PROPS.MINIMIZED_MODULES] = closedModules;
    localStorage.setItem(
      MODULE_CONFIG_LS_ITEM,
      JSON.stringify(currentModuleConfig),
    );
  });
  configState.subscribe(STATE_PROPS.MODULES_ORDER, () => {
    const closedModules =
      configState.getCurrentState(STATE_PROPS.MODULES_ORDER) ?? [];
    currentModuleConfig[STATE_PROPS.MODULES_ORDER] = closedModules;
    localStorage.setItem(
      MODULE_CONFIG_LS_ITEM,
      JSON.stringify(currentModuleConfig),
    );
  });
  configState.subscribe(STATE_PROPS.TIME_REPRESENTATION, () => {
    const timeRepresentation =
      configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) ??
      "timestamp";
    currentModuleConfig[STATE_PROPS.TIME_REPRESENTATION] = timeRepresentation;
    localStorage.setItem(
      MODULE_CONFIG_LS_ITEM,
      JSON.stringify(currentModuleConfig),
    );
  });
}

export default function route() {
  if (currentPageCleanUp !== undefined) {
    currentPageCleanUp();
    currentPageCleanUp = undefined;
  }

  const pageInfo = getPageInfo();
  if (pageInfo.forcePassReset) {
    localStorage.removeItem("passv1");
    currentPageCleanUp = generatePasswordPage();
    return;
  }
  const password = localStorage.getItem("passv1");
  if (password === null) {
    currentPageCleanUp = generatePasswordPage();
  } else if (pageInfo.isPostDebugger) {
    currentPageCleanUp = generatePostDebuggerPage(configState);
  } else if (pageInfo.tokenId === null) {
    currentPageCleanUp = generateTokenPage(password);
  } else {
    if (!isTokenValid(pageInfo.tokenId)) {
      const error = new Error(
        "Error: A token must only contain alphanumeric characters",
      );
      const errorDiv = document.createElement("div");
      displayError(errorDiv, error, true);
      document.body.appendChild(errorDiv);
      const tokenPageCleanUp = generateTokenPage(password);
      currentPageCleanUp = () => {
        document.body.removeChild(errorDiv);
        tokenPageCleanUp();
      };
    } else {
      currentPageCleanUp = generateLiveDebuggingPage(
        password,
        pageInfo.tokenId,
        configState,
      );
    }
  }
}
