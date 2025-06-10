import strHtml from "str-html";
import {
  ConfigState,
  DEFAULT_MAX_DISPLAYED_LOG_ELEMENTS,
  LogViewState,
  STATE_PROPS,
} from "../constants";
import ObservableState, { UPDATE_TYPE } from "../observable_state";
import { isInitLog, parseAndGenerateInitLog } from "../pages/utils";
import { convertDateToLocalISOString } from "../utils";
import { ModuleObject, ModuleFunctionArguments } from "./index";

const LOADING_LOGS_MSG = "Loading logs...";
const NO_LOG_SELECTED_MSG =
  "No log selected (click on a log to time-travel to it).";
const LOG_SELECTED_MSG = "A log has been time-travelled to.";
const timeRegex = /^(\d+(?:.)?(?:\d+)?) (.*)$/s;

const MAX_LOGS_TO_PUSH_AT_ONCE = 2000;
const BULK_LOGS_DISPLAY_TIMEOUT = 75;

/**
 * @param {Object} args
 */
export default function LogModule({
  logView,
  configState,
}: ModuleFunctionArguments): ModuleObject {
  /**
   * A filter function allowing to filter only wanted logs.
   * `null` if no filter is active.
   */
  const filterObject: {
    minTimeStamp: number;
    maxTimeStamp: number;
    textFilter: null | {
      text: string;
      caseSensitive: boolean;
      regex: boolean;
    };
    textToExclude: string;
  } = {
    minTimeStamp: 0,
    maxTimeStamp: Infinity,
    textFilter: null,
    textToExclude: "",
  };

  let maxNbDisplayedLogs = DEFAULT_MAX_DISPLAYED_LOG_ELEMENTS;

  /**
   * Log element's header which is going to show various information on what is
   * happening and if a log is selected.
   */
  const logHeaderElt = strHtml`<div class="log-header"/>`;
  logHeaderElt.style.borderBottom = "1px dashed #878787";
  logHeaderElt.style.lineHeight = "1.3em";
  displayNoLogHeader();

  /** Wrapper elements which will contain log messages. */
  const logBodyElt = strHtml`<div class="log-body module-body"/>`;

  /**
   * Parent element of the individual log messages.
   * It should be the unique child of `logBodyElt`, it is written that way so it
   * may easily be removed and appended at will from the DOM when it is in the
   * process of being heavily updated to improve performances.
   */
  const logContainerElt = strHtml`<div class="log-container module-body"/>`;

  /**
   * If set, a `setTimeout` has been called to process logs by groups to prevent
   * the page from being noticeably unresponsive.
   *
   * Should be set to `undefined` if no timeout is pending.
   */
  let timeoutInterval: number | undefined;

  /**
   * HTML element currently selected.
   * `null` if none is currently selected.
   */
  let selectedElt: HTMLElement | null = null;

  /** If `true`, inputted search string are case sensitive. */
  let areSearchCaseSensitive = false;

  /** If `true`, inputted search string are Regular Expression. */
  let areSearchRegex = false;

  /** Callbacks that will be called when the module is destroyed. */
  const onDestroyFns: Array<() => void> = [];

  const minimumTimeInputElt = createMinimumTimestampInputElement(logView);
  const minimumDateInputElt = createMinimumDateInputElement(logView);
  const maximumTimeInputElt = createMaximumTimestampInputElement(logView);
  const maximumDateInputElt = createMaximumDateInputElement(logView);

  const toggleTimeRepresentation = () => {
    if (
      configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) === "date"
    ) {
      minimumTimeInputElt.style.display = "none";
      maximumTimeInputElt.style.display = "none";
      minimumDateInputElt.style.display = "unset";
      maximumDateInputElt.style.display = "unset";
    } else {
      minimumTimeInputElt.style.display = "unset";
      maximumTimeInputElt.style.display = "unset";
      minimumDateInputElt.style.display = "none";
      maximumDateInputElt.style.display = "none";
    }
    onLogsHistoryChange(
      UPDATE_TYPE.REPLACE,
      logView.getCurrentState(STATE_PROPS.LOGS_HISTORY),
      true,
    );
  };
  onDestroyFns.push(
    configState.subscribe(
      STATE_PROPS.TIME_REPRESENTATION,
      toggleTimeRepresentation,
      true,
    ),
  );

  const maximumNbLogsInputElt = strHtml`<input
    type="input"
    class="log-time-range"
    value=${maxNbDisplayedLogs}
  />` as HTMLInputElement;
  maximumNbLogsInputElt.oninput = onMaximumNbLogsInputChange;
  maximumNbLogsInputElt.onchange = onMaximumNbLogsInputChange;

  /** Text input element for only showing a sub-time-range of the logs. */
  const timeRangeInputElt = strHtml`<div class="log-wrapper">
    <span style="display: flex; flex-direction: column; align-items: center">
      Min. timestamp
      <span>${[
        minimumTimeInputElt,
        minimumDateInputElt,
        createMinimumTimestampButtonElements(logView, onDestroyFns),
      ]}
      </span>
    </span>
    <span style="display: flex; flex-direction: column; align-items: center">
      Max. timestamp (empty for no limit)
      <span>${[
        maximumTimeInputElt,
        maximumDateInputElt,
        createMaximumTimestampButtonElements(logView, onDestroyFns),
      ]}
      </span>
    </span>
    <span style="display: flex; flex-direction: column; align-items: center">
      Max. displayed logs
      <span>${maximumNbLogsInputElt}</span>
    </span>
  </div>` as HTMLInputElement;
  timeRangeInputElt.style.fontSize = "0.9em";
  timeRangeInputElt.style.display = "flex";
  timeRangeInputElt.style.marginTop = "10px";
  timeRangeInputElt.style.overflow = "hidden";
  timeRangeInputElt.style.justifyContent = "space-between";

  /** Wrapper elements allowing to filter logs. */
  const filterFlexElt = strHtml`<div class="log-wrapper"/>`;
  filterFlexElt.style.display = "flex";
  filterFlexElt.style.margin = "5px 0px";
  filterFlexElt.style.gap = "4px";

  const caseSensitiveBtn = createFilterButtonElement(
    "Aa",
    "Enable case sensitivity",
    "Disable case sensitivity",
    () => {
      areSearchCaseSensitive = true;
      refreshFilters();
    },
    () => {
      areSearchCaseSensitive = false;
      refreshFilters();
    },
    configState,
    onDestroyFns,
  );

  const regexFilterButton = createFilterButtonElement(
    ".*",
    "Enable RegExp mode",
    "Disable RegExp mode",
    () => {
      areSearchRegex = true;
      refreshFilters();
    },
    () => {
      areSearchRegex = false;
      refreshFilters();
    },
    configState,
    onDestroyFns,
  );

  /** Text input element for filtering logs. */
  const logFilterInputElt = strHtml`<input
    type="input"
    placeholder="Filter logs based on text"
    class="log-filter"
  />` as HTMLInputElement;
  logFilterInputElt.style.width = "100%";
  logFilterInputElt.oninput = refreshFilters;
  logFilterInputElt.onchange = refreshFilters;

  const logExcludeFilterInputElt = strHtml`<input
  type="input"
  placeholder="Exclude logs based on text, e.g. [info] XHR"
  class="log-filter"
/>` as HTMLInputElement;
  logExcludeFilterInputElt.oninput = refreshFilters;
  logExcludeFilterInputElt.onchange = refreshFilters;

  filterFlexElt.appendChild(caseSensitiveBtn);
  filterFlexElt.appendChild(regexFilterButton);
  filterFlexElt.appendChild(logFilterInputElt);

  const allFiltersElt = strHtml`<div>
    <div style="border-bottom: 1px dotted;">Filters</div>
  </div>`;
  allFiltersElt.style.padding = "8px";
  allFiltersElt.style.marginTop = "5px";
  allFiltersElt.style.display = "flex";
  allFiltersElt.style.flexDirection = "column";
  onDestroyFns.push(
    configState.subscribe(
      STATE_PROPS.CSS_MODE,
      () => {
        allFiltersElt.style.backgroundColor =
          configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark"
            ? "#333"
            : "#f2f2f2";
      },
      true,
    ),
  );
  allFiltersElt.appendChild(timeRangeInputElt);
  allFiltersElt.appendChild(filterFlexElt);
  allFiltersElt.appendChild(logExcludeFilterInputElt);

  onDestroyFns.push(
    logView.subscribe(STATE_PROPS.LOGS_HISTORY, onLogsHistoryChange, true),
  );
  onDestroyFns.push(
    logView.subscribe(STATE_PROPS.SELECTED_LOG_ID, onSelectedLogChange, true),
  );
  onDestroyFns.push(
    logView.subscribe(
      STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
      onMinimumTimestampChange,
      true,
    ),
  );
  onDestroyFns.push(
    logView.subscribe(
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      onMaximumTimestampChange,
      true,
    ),
  );
  onDestroyFns.push(
    logView.subscribe(
      STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
      onMinimumDateChange,
      true,
    ),
  );
  onDestroyFns.push(
    logView.subscribe(STATE_PROPS.DATE_AT_PAGE_LOAD, onMinimumDateChange, true),
  );
  onDestroyFns.push(
    logView.subscribe(
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      onMaximumDateChange,
      true,
    ),
  );
  onDestroyFns.push(
    logView.subscribe(STATE_PROPS.DATE_AT_PAGE_LOAD, onMaximumDateChange, true),
  );
  refreshFilters();

  logBodyElt.appendChild(logContainerElt);

  return {
    body: strHtml`<div>${[logHeaderElt, allFiltersElt, logBodyElt]}</div>`,
    clear() {
      clearLogs();
    },
    destroy() {
      clearTimeout(timeoutInterval);
      timeoutInterval = undefined;
      onDestroyFns.forEach((cb) => cb());
      if (logView.getCurrentState(STATE_PROPS.SELECTED_LOG_ID) !== undefined) {
        logView.updateState(
          STATE_PROPS.SELECTED_LOG_ID,
          UPDATE_TYPE.REPLACE,
          undefined,
        );
        logView.commitUpdates();
      }
    },
  };

  /** Display header for when no logs are yet received. */
  function displayNoLogHeader() {
    logHeaderElt.textContent = "No log.";
    logHeaderElt.classList.remove("important-bg");
  }

  /** Display header for when logs are being loaded. */
  function displayLoadingHeader() {
    logHeaderElt.textContent = LOADING_LOGS_MSG;
    logHeaderElt.classList.add("important-bg");
  }

  /** Display header for when not loading and no log is currently selected. */
  function displayNoLogSelectedHeader() {
    logHeaderElt.textContent = NO_LOG_SELECTED_MSG;
    logHeaderElt.classList.remove("important-bg");
  }

  /** Display header for when a log is currently selected. */
  function displayLogSelectedHeader() {
    logHeaderElt.innerHTML = "";
    const selectedEltInScreen = getSelectedElement();
    const text = strHtml`<span>${LOG_SELECTED_MSG}</span>`;
    text.style.marginLeft = "5px";
    logHeaderElt.appendChild(text);
    const unselectSpan = strHtml`<span class="emphasized">${[
      "Click on the log again or here to unselect",
    ]}</span>`;
    unselectSpan.onclick = function () {
      logView.updateState(
        STATE_PROPS.SELECTED_LOG_ID,
        UPDATE_TYPE.REPLACE,
        undefined,
      );
      logView.commitUpdates();
      if (selectedElt !== null) {
        selectedElt.classList.remove("focused-bg");
        selectedElt = null;
      }
    };
    unselectSpan.style.cursor = "pointer";
    unselectSpan.style.marginLeft = "5px";
    logHeaderElt.appendChild(strHtml`<br>`);
    logHeaderElt.appendChild(unselectSpan);

    const selectedLogId = logView.getCurrentState(STATE_PROPS.SELECTED_LOG_ID);
    if (selectedLogId !== undefined) {
      const logs = logView.getCurrentState(STATE_PROPS.LOGS_HISTORY);
      const log = logs?.find((l) => l[1] === selectedLogId);
      if (log !== undefined) {
        const match = log[0].match(timeRegex);
        if (match !== null) {
          const timestamp = Number(match[1]);
          let displayedTimestamp: number | string = timestamp;
          if (
            configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) ===
            "date"
          ) {
            const dateAtPageLoad =
              logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
            const dateNum = Number(match[1]) + dateAtPageLoad;
            displayedTimestamp = convertDateToLocalISOString(new Date(dateNum));
          }
          const goToMinimumTimeSpan = strHtml`<span class="emphasized">Minimum time</span>`;
          const goToMaximumTimeSpan = strHtml`<span class="emphasized">Maximum time</span>`;
          const dateNavigationSpan = strHtml`<span>${[
            `Set date (${displayedTimestamp}) as: `,
            goToMinimumTimeSpan,
            " / ",
            goToMaximumTimeSpan,
          ]}</span>`;
          goToMinimumTimeSpan.style.cursor = "pointer";
          goToMaximumTimeSpan.style.cursor = "pointer";
          dateNavigationSpan.style.marginLeft = "5px";
          goToMinimumTimeSpan.onclick = () => {
            logView.updateState(
              STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
              UPDATE_TYPE.REPLACE,
              timestamp,
            );
            logView.commitUpdates();
          };
          goToMaximumTimeSpan.onclick = () => {
            logView.updateState(
              STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
              UPDATE_TYPE.REPLACE,
              timestamp,
            );
            logView.commitUpdates();
          };
          logHeaderElt.appendChild(strHtml`<br>`);
          logHeaderElt.appendChild(dateNavigationSpan);
        }
      }
    }

    if (selectedEltInScreen !== null) {
      const scrollIntoViewSpan = strHtml`<span class="emphasized">Scroll into view</span>`;
      scrollIntoViewSpan.style.cursor = "pointer";
      scrollIntoViewSpan.style.marginLeft = "5px";
      logHeaderElt.appendChild(strHtml`<br>`);
      logHeaderElt.appendChild(scrollIntoViewSpan);
      scrollIntoViewSpan.onclick = function () {
        focusSelectedIntoView();
      };
    }
    logHeaderElt.classList.add("important-bg");
  }

  /**
   * Returns a string describing the current header shown.
   * @returns {string}
   */
  function getHeaderType(): "loading" | "no-log" | "no-selected" | "selected" {
    const textContent = logHeaderElt.textContent;
    if (textContent === null) {
      return "no-log";
    }
    if (textContent.startsWith(LOADING_LOGS_MSG)) {
      return "loading";
    } else if (textContent.startsWith(NO_LOG_SELECTED_MSG)) {
      return "no-selected";
    } else if (textContent.startsWith(LOG_SELECTED_MSG)) {
      return "selected";
    }
    return "no-log";
  }

  /**
   * Callback triggered when the global history of logs changes.
   * @param {string} updateType
   * @param {Array.<string>|undefined} values
   * @param {boolean} [keepScrollPosition] - If `true`, the current scroll
   * position in term of percentage will be kept as is.
   */
  function onLogsHistoryChange(
    updateType: UPDATE_TYPE | "initial",
    values: Array<[string, number]> | undefined,
    keepScrollPosition?: boolean,
  ) {
    let scrollPercent: number | undefined;
    if (keepScrollPosition === true && !isLogBodyScrolledToBottom()) {
      scrollPercent =
        logBodyElt.scrollTop /
        (logBodyElt.scrollHeight - logBodyElt.clientHeight);
    }
    if (values === undefined) {
      if (timeoutInterval !== undefined) {
        clearTimeout(timeoutInterval);
        timeoutInterval = undefined;
      }
      clearLogs();
      return;
    }

    /** Set to `true` when we're re-initializing all logs displayed. */
    let isResetting = false;

    if (updateType === UPDATE_TYPE.REPLACE || updateType === "initial") {
      isResetting = true;
      if (timeoutInterval !== undefined) {
        clearTimeout(timeoutInterval);
        timeoutInterval = undefined;
      }
      clearLogs();
    }

    let filtered;
    if (
      filterObject.minTimeStamp === 0 &&
      filterObject.maxTimeStamp === Infinity &&
      filterObject.textFilter === null &&
      filterObject.textToExclude === ""
    ) {
      filtered = values.slice();
    } else {
      const filter = createFilterFunction();
      filtered = values.filter(([str]) => filter(str));
    }
    displayNewLogs(filtered, isResetting, scrollPercent);
  }

  /**
   * Callback called when the index of the selected log changes.
   * This Callback is also mainly here to better handle conflicts between multiple
   * concurrent LogModules.
   */
  function onSelectedLogChange() {
    const hasLogSelected =
      logView.getCurrentState(STATE_PROPS.SELECTED_LOG_ID) !== undefined;
    const headerType = getHeaderType();
    if (!hasLogSelected && logContainerElt.childNodes.length === 0) {
      if (headerType !== "no-log") {
        displayNoLogHeader();
      }
      return;
    }

    if (hasLogSelected) {
      displayLogSelectedHeader();
    } else if (timeoutInterval !== undefined) {
      if (headerType !== "loading") {
        displayLoadingHeader();
      }
    } else if (headerType !== "no-selected") {
      displayNoLogSelectedHeader();
    }
  }

  /**
   * Display logs given in arguments in the log container.
   * @param {Array.<number|string>} newLogs - Logs that are not yet displayed
   * as a tuple of:
   *   1. The log message
   *   2. The log idx in the message in the LOGS_HISTORY array.
   * @param {boolean} isResetting - To set to `true` if you're currently
   * re-initializing all displayed logs. This will browse logs starting from the
   * last element to the first one and append each one in this reverse order at
   * the start of the log container. It might moreover do so in multiple
   * time-separated chunks.
   * Doing this will hugely improve UI responsiveness (due to its potentially
   * time-divided nature) and the rendering aspect when a lot of logs is added
   * (as focus is usually set on the last logs which would there have been added
   * at the beginning of the call) but can only worker when re-initializing
   * logs. This can e.g. be set when setting a filter or when post-debugging.
   * @param {number|undefined} scrollPercent - If set, the percentage scroll
   * position (`0` being at the very top and `1` being at the very bottom) the
   * scroll position should be maintained at.
   */
  function displayNewLogs(
    newLogs: Array<[string, number]>,
    isResetting: boolean,
    scrollPercent: number | undefined,
  ): void {
    if (isResetting && timeoutInterval !== undefined) {
      clearTimeout(timeoutInterval);
      timeoutInterval = undefined;
    }

    window.requestAnimationFrame(() => {
      const wasScrolledToBottom = isLogBodyScrolledToBottom();
      let logsToDisplay =
        newLogs.length > maxNbDisplayedLogs
          ? newLogs.slice(maxNbDisplayedLogs)
          : newLogs;
      if (isResetting && logsToDisplay.length > MAX_LOGS_TO_PUSH_AT_ONCE) {
        const nextIterationLogs = logsToDisplay.slice(
          0,
          logsToDisplay.length - MAX_LOGS_TO_PUSH_AT_ONCE,
        );
        if (nextIterationLogs.length > 0) {
          displayLoadingHeader();
          timeoutInterval = setTimeout(() => {
            timeoutInterval = undefined;
            displayNewLogs(nextIterationLogs, isResetting, scrollPercent);
          }, BULK_LOGS_DISPLAY_TIMEOUT);
        }
        logsToDisplay = logsToDisplay.slice(
          logsToDisplay.length - MAX_LOGS_TO_PUSH_AT_ONCE,
        );
      }

      if (logsToDisplay.length >= 10) {
        // Deattach parent of where the logs will be added before adding such logs
        // in a loop as this seems to improve performance on most browsers.
        logBodyElt.innerHTML = "";
      }

      const selectedLogId = logView.getCurrentState(
        STATE_PROPS.SELECTED_LOG_ID,
      );
      for (let logIdx = 0; logIdx < logsToDisplay.length; logIdx++) {
        const actualLogIdx = isResetting
          ? logsToDisplay.length - (logIdx + 1)
          : logIdx;
        const log = logsToDisplay[actualLogIdx];
        const logElt = createLogElement(log[0], logView, configState);
        if (log[1] === selectedLogId) {
          if (selectedElt !== null) {
            selectedElt.classList.remove("focused-bg");
          }
          logElt.classList.add("focused-bg");
          selectedElt = logElt;
        }
        logElt.dataset.logId = String(log[1]);
        logElt.onclick = toggleCurrentElementSelection;
        if (logContainerElt.children.length >= maxNbDisplayedLogs) {
          if (timeoutInterval !== undefined) {
            clearTimeout(timeoutInterval);
            timeoutInterval = undefined;
          }
          if (isResetting) {
            break;
          } else {
            logContainerElt.removeChild(logContainerElt.children[0]);
          }
        }
        if (isResetting) {
          logContainerElt.prepend(logElt);
        } else {
          logContainerElt.appendChild(logElt);
        }
      }

      if (logContainerElt.parentElement !== logBodyElt) {
        logBodyElt.appendChild(logContainerElt);
      }

      if (timeoutInterval === undefined) {
        const headerType = getHeaderType();
        if (selectedElt === null && logContainerElt.childNodes.length === 0) {
          if (headerType !== "no-log") {
            displayNoLogHeader();
          }
        } else if (selectedElt === null) {
          if (headerType !== "no-selected") {
            displayNoLogSelectedHeader();
          }
        } else {
          displayLogSelectedHeader();
        }
      }

      if (scrollPercent !== undefined) {
        logBodyElt.scrollTop =
          (logBodyElt.scrollHeight - logBodyElt.clientHeight) * scrollPercent;
      } else if (wasScrolledToBottom) {
        logBodyElt.scrollTop = logBodyElt.scrollHeight;
      }
    });
  }

  function getSelectedElement(): HTMLElement | null {
    const focused = logBodyElt.getElementsByClassName("focused-bg")[0];
    return focused !== undefined &&
      focused instanceof HTMLElement &&
      focused.parentElement !== null
      ? focused
      : null;
  }

  function focusSelectedIntoView() {
    const focused = getSelectedElement();
    if (focused !== null && focused.parentElement !== null) {
      logBodyElt.scrollTop =
        focused.offsetTop - focused.parentElement.offsetTop;
    }
  }

  function isLogBodyScrolledToBottom(): boolean {
    const hasVerticalScrollbar =
      logBodyElt.scrollHeight > logBodyElt.clientHeight;
    return (
      !hasVerticalScrollbar ||
      logBodyElt.scrollHeight - logBodyElt.clientHeight <=
        logBodyElt.scrollTop + 5
    );
  }

  /**
   * Select/unselect the currently clicked log element.
   */
  function toggleCurrentElementSelection(evt: MouseEvent): void {
    const logElt = evt.target;
    if (logElt === null || !(logElt instanceof HTMLElement)) {
      console.error("No element selected");
      return;
    }
    const currentLogId = +String(logElt.dataset?.logId);
    if (isNaN(currentLogId)) {
      console.error("The element selected had a bad log id");
      return;
    }
    if (selectedElt !== null) {
      selectedElt.classList.remove("focused-bg");
      selectedElt = null;
    }
    const selectedLogId = logView.getCurrentState(STATE_PROPS.SELECTED_LOG_ID);
    if (selectedLogId === currentLogId) {
      logView.updateState(
        STATE_PROPS.SELECTED_LOG_ID,
        UPDATE_TYPE.REPLACE,
        undefined,
      );
      logView.commitUpdates();
      return;
    }

    logView.updateState(
      STATE_PROPS.SELECTED_LOG_ID,
      UPDATE_TYPE.REPLACE,
      currentLogId,
    );
    selectedElt = logElt;

    logElt.classList.add("focused-bg");
    logView.commitUpdates();
  }

  /**
   * Reapply filters on what is currently in `logFilterInputElt.value`.
   */
  function refreshFilters() {
    const minRange =
      logView.getCurrentState(STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED) ?? 0;
    const maxRange =
      logView.getCurrentState(STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED) ??
      Infinity;
    const text = logFilterInputElt.value ?? "";
    const excludeText = logExcludeFilterInputElt.value ?? "";
    if (
      filterObject.minTimeStamp === minRange &&
      filterObject.maxTimeStamp === maxRange &&
      (text.length === 0
        ? filterObject.textFilter === null
        : filterObject.textFilter?.text === text &&
          filterObject.textFilter.caseSensitive === areSearchCaseSensitive &&
          filterObject.textFilter.regex === areSearchRegex) &&
      excludeText === filterObject.textToExclude
    ) {
      return; // Nothing changed
    }
    filterObject.minTimeStamp = minRange;
    filterObject.maxTimeStamp = maxRange;
    filterObject.textToExclude = excludeText;
    if (text === "") {
      filterObject.textFilter = null;
    } else {
      filterObject.textFilter = {
        text,
        caseSensitive: areSearchCaseSensitive,
        regex: areSearchRegex,
      };
    }
    onLogsHistoryChange(
      "initial",
      logView.getCurrentState(STATE_PROPS.LOGS_HISTORY) ?? [],
      true,
    );
  }

  function createFilterFunction(): (input: string) => boolean {
    let checkLogDate: (input: string) => boolean;
    if (filterObject.minTimeStamp === 0) {
      if (filterObject.maxTimeStamp === Infinity) {
        checkLogDate = () => true;
      } else {
        checkLogDate = (input: string) =>
          filterObject.maxTimeStamp >= parseFloat(input);
      }
    } else if (filterObject.maxTimeStamp === Infinity) {
      checkLogDate = (input: string) =>
        filterObject.minTimeStamp <= parseFloat(input);
    } else {
      checkLogDate = (input: string) => {
        const timestamp = parseFloat(input);
        return (
          filterObject.minTimeStamp <= timestamp &&
          filterObject.maxTimeStamp >= timestamp
        );
      };
    }
    let checkTextFilter: (input: string) => boolean;
    if (filterObject.textFilter !== null) {
      const text = filterObject.textFilter.text;
      if (filterObject.textFilter.regex) {
        const flags = filterObject.textFilter.caseSensitive ? undefined : "i";
        const reg = new RegExp(text, flags);
        checkTextFilter = (input: string) => reg.test(input);
      } else if (filterObject.textFilter.caseSensitive) {
        checkTextFilter = (input: string) => input.includes(text);
      } else {
        const toLower = text.toLowerCase();
        checkTextFilter = (input: string) =>
          input.toLowerCase().includes(toLower);
      }
    } else {
      checkTextFilter = (_input: string) => true;
    }

    let checkTextExclude: (input: string) => boolean;
    if (filterObject.textToExclude === "") {
      checkTextExclude = (_input: string) => true;
    } else {
      const textToExclude = filterObject.textToExclude;
      const splitted = textToExclude.trim().split(/\s+/);
      checkTextExclude = (input: string) => {
        const doesNotIncludeForbiddenText = (str: string) =>
          !input.includes(str);
        return splitted.every(doesNotIncludeForbiddenText);
      };
    }
    return (input: string) => {
      return (
        checkLogDate(input) && checkTextFilter(input) && checkTextExclude(input)
      );
    };
  }

  function onMaximumNbLogsInputChange() {
    let newMax =
      maximumNbLogsInputElt.value === ""
        ? DEFAULT_MAX_DISPLAYED_LOG_ELEMENTS
        : +maximumNbLogsInputElt.value;
    if (isNaN(newMax)) {
      newMax = DEFAULT_MAX_DISPLAYED_LOG_ELEMENTS;
    }
    if (newMax === maxNbDisplayedLogs) {
      return;
    }
    maxNbDisplayedLogs = newMax;
    onLogsHistoryChange(
      "initial",
      logView.getCurrentState(STATE_PROPS.LOGS_HISTORY) ?? [],
      true,
    );
  }

  /**
   * Clear all logs currently displayed or pending to be displayed, without
   * modifying the complete log history.
   */
  function clearLogs() {
    clearTimeout(timeoutInterval);
    timeoutInterval = undefined;
    logContainerElt.innerHTML = "";
    logBodyElt.innerHTML = "";
    if (getHeaderType() !== "no-log") {
      displayNoLogHeader();
    }
  }

  function onMinimumTimestampChange() {
    const newMin =
      logView.getCurrentState(STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED) ?? 0;
    // minimumTimeMinusButtonElt.disabled = newMin === 0;
    // minimumTimeResetButtonElt.disabled = newMin === 0;
    const newMinText = String(newMin);
    minimumTimeInputElt.value = newMinText;
    refreshFilters();
  }

  function onMaximumTimestampChange() {
    const newMax =
      logView.getCurrentState(STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED) ??
      Infinity;
    const newMaxText = newMax === Infinity ? "" : String(newMax);
    maximumTimeInputElt.value = newMaxText;
    refreshFilters();
  }

  function onMinimumDateChange() {
    const newMin =
      logView.getCurrentState(STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED) ?? 0;
    const lastDateAtLoad =
      logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
    const minDateInMs = lastDateAtLoad + newMin;
    const value = convertDateToLocalISOString(new Date(minDateInMs));
    minimumDateInputElt.value = value;
    refreshFilters();
  }

  function onMaximumDateChange() {
    const newMax =
      logView.getCurrentState(STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED) ??
      Infinity;
    const lastDateAtLoad =
      logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
    const maxDateInMs = lastDateAtLoad + newMax;
    let value: string;
    if (maxDateInMs === Infinity) {
      value = "";
    } else {
      value = convertDateToLocalISOString(new Date(maxDateInMs));
    }
    maximumDateInputElt.value = value;
    refreshFilters();
  }
}

/**
 * Create a button element that will be displayed alongside the filter bar.
 * @param {string} innerText - The text to display inside the button
 * @param {string} titleDisabled - The title (e.g. in tooltip) that will be
 * shown when the button is not enabled.
 * @param {string} titleEnabled - The title (e.g. in tooltip) that will be
 * shown when the button is enabled.
 * @param {Function} onEnabled - The function that should be called when the
 * button is enabled.
 * @param {Function} onEnabled - The function that should be called when the
 * feature behind the button is enabled.
 * @param {Function} onDisabled - The function that should be called when the
 * feature behind the button is disabled.
 * @param {Object} configState - Object reporting the current page config's
 * state.
 * @param {Array.<Function>} cleanUpFns - Will push function(s) allowing to
 * unregister the listeners registered by this function.
 * @returns {Array} Returns the HTMLElement for the button.
 */
function createFilterButtonElement(
  innerText: string,
  titleDisabled: string,
  titleEnabled: string,
  onEnabled: () => void,
  onDisabled: () => void,
  configState: ObservableState<ConfigState>,
  cleanUpFns: Array<() => void>,
): HTMLElement {
  let isDisabled = true;
  let isDarkMode = configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
  cleanUpFns.push(
    configState.subscribe(STATE_PROPS.CSS_MODE, () => {
      isDarkMode = configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
      if (isDisabled) {
        setEnabledFilterButtonStyle(buttonElt, isDarkMode);
      } else {
        setNonEnabledFilterButtonStyle(buttonElt, isDarkMode);
      }
    }),
  );
  const buttonElt = strHtml`<button class="log-filter-button">${innerText}</button>`;
  buttonElt.onclick = () => {
    if (isDisabled) {
      isDisabled = false;
      setNonEnabledFilterButtonStyle(buttonElt, isDarkMode);
      buttonElt.title = titleEnabled;
      onEnabled();
    } else {
      isDisabled = true;
      buttonElt.title = titleDisabled;
      setEnabledFilterButtonStyle(buttonElt, isDarkMode);
      buttonElt.style.color = isDarkMode ? "#ffffff" : "#000000";
      onDisabled();
    }
  };

  buttonElt.title = titleDisabled;
  buttonElt.style.cursor = "pointer";
  buttonElt.style.fontWeight = "bold";
  buttonElt.style.fontSize = "11px";
  buttonElt.style.minWidth = "24px";
  buttonElt.style.padding = "0px 0px";
  buttonElt.style.border = "1px solid";
  buttonElt.style.borderRadius = "4px";
  buttonElt.style.backgroundColor = "transparent";
  setEnabledFilterButtonStyle(buttonElt, isDarkMode);
  return buttonElt;
}

function setNonEnabledFilterButtonStyle(
  buttonElt: HTMLElement,
  isDarkMode: boolean,
) {
  buttonElt.style.color = isDarkMode ? "#d3ffcf" : "#990033";
  buttonElt.style.borderColor = isDarkMode ? "#d3ffcf" : "#990033";
}

function setEnabledFilterButtonStyle(
  buttonElt: HTMLElement,
  isDarkMode: boolean,
) {
  buttonElt.style.color = isDarkMode ? "#ffffff" : "#000000";
  buttonElt.style.borderColor = isDarkMode ? "#767676" : "#767676";
}

/**
 * @param {string} logTxt
 * @returns {HTMLElement}
 */
export function createLogElement(
  logTxt: string,
  logView: ObservableState<LogViewState>,
  configState: ObservableState<ConfigState>,
): HTMLElement {
  let namespace;
  let formattedMsg;

  let logToProcess = logTxt;
  if (isInitLog(logTxt)) {
    logToProcess = parseAndGenerateInitLog(logTxt).log;
  }
  if (configState.getCurrentState(STATE_PROPS.TIME_REPRESENTATION) === "date") {
    const match = logToProcess.match(timeRegex);
    if (match !== null) {
      const dateAtPageLoad =
        logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
      const timestamp = Number(match[1]) + dateAtPageLoad;
      const dateStr = convertDateToLocalISOString(new Date(timestamp));
      formattedMsg = dateStr + " " + match[2];
    } else {
      formattedMsg = logToProcess;
    }
  } else {
    formattedMsg = logToProcess;
  }
  const indexOfNamespaceStart = formattedMsg.indexOf("[");
  if (indexOfNamespaceStart >= 0) {
    const indexOfNamespaceEnd = formattedMsg.indexOf("]");
    if (indexOfNamespaceEnd > 0) {
      namespace = formattedMsg.substring(
        indexOfNamespaceStart + 1,
        indexOfNamespaceEnd,
      );
      formattedMsg = formattedMsg.replace(
        /\n/g,
        "\n" + " ".repeat(indexOfNamespaceEnd + 2),
      );
    }
  }
  const className =
    namespace !== undefined
      ? "log-line log-" + namespace.toLowerCase()
      : "log-line log-unknown";
  return strHtml`<pre class=${className}>${formattedMsg}</pre>`;
}

function createMinimumTimestampButtonElements(
  logView: ObservableState<LogViewState>,
  cleanUpFns: Array<() => void>,
): HTMLButtonElement[] {
  return [
    createTSMinusButton(
      logView,
      STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
      0,
      cleanUpFns,
    ),
    createTSPlusButton(
      logView,
      STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
      0,
      cleanUpFns,
    ),
    createTSResetButton(logView, STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED, 0),
  ];
}

function createMaximumTimestampButtonElements(
  logView: ObservableState<LogViewState>,
  cleanUpFns: Array<() => void>,
): HTMLButtonElement[] {
  return [
    createTSMinusButton(
      logView,
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      Infinity,
      cleanUpFns,
    ),
    createTSPlusButton(
      logView,
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      Infinity,
      cleanUpFns,
    ),
    createTSResetButton(
      logView,
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      Infinity,
    ),
  ];
}

/**
 * @param {Object} logView
 * @param {string} linkedState - The actual property the minus button is
 * linked to.
 * @param {number} defaultValue
 * @param {Array.<Function>} cleanUpFns - Will push function(s) allowing to
 * unregister the listeners registered by this function.
 * @returns {HTMLButtonElement}
 */
function createTSMinusButton(
  logView: ObservableState<LogViewState>,
  linkedState:
    | STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED
    | STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
  defaultValue: number,
  cleanUpFns: Array<() => void>,
): HTMLButtonElement {
  const minusButtonElt =
    strHtml`<button title="Remove 1 second">-</button>` as HTMLButtonElement;
  minusButtonElt.style.border = "none";
  minusButtonElt.style.backgroundColor = "transparent";
  minusButtonElt.style.cursor = "pointer";
  minusButtonElt.style.fontWeight = "bold";
  minusButtonElt.onclick = function () {
    const current = logView.getCurrentState(linkedState) ?? defaultValue;
    if (current === Infinity || current === 0) {
      return;
    }
    logView.updateState(
      linkedState,
      UPDATE_TYPE.REPLACE,
      Math.max(current - 1000, 0),
    );
    logView.commitUpdates();
  };

  cleanUpFns.push(
    logView.subscribe(
      linkedState,
      () => {
        const newVal = logView.getCurrentState(linkedState) ?? defaultValue;
        if (newVal === Infinity || newVal === 0) {
          minusButtonElt.disabled = true;
          minusButtonElt.style.cursor = "default";
        } else {
          minusButtonElt.disabled = false;
          minusButtonElt.style.cursor = "pointer";
        }
      },
      true,
    ),
  );
  return minusButtonElt;
}

/**
 * @param {Object} logView
 * @param {string} linkedState - The actual property the minus button is
 * linked to.
 * @param {number} defaultValue
 * @param {Array.<Function>} cleanUpFns - Will push function(s) allowing to
 * unregister the listeners registered by this function.
 * @returns {HTMLButtonElement}
 */
function createTSPlusButton(
  logView: ObservableState<LogViewState>,
  linkedState:
    | STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED
    | STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
  defaultValue: number,
  cleanUpFns: Array<() => void>,
): HTMLButtonElement {
  const plusButtonElt =
    strHtml`<button title="Add 1 second">+</button>` as HTMLButtonElement;
  plusButtonElt.style.border = "none";
  plusButtonElt.style.backgroundColor = "transparent";
  plusButtonElt.style.cursor = "pointer";
  plusButtonElt.style.fontWeight = "bold";
  plusButtonElt.onclick = function () {
    const current = logView.getCurrentState(linkedState) ?? defaultValue;
    if (current === Infinity) {
      return;
    }
    logView.updateState(linkedState, UPDATE_TYPE.REPLACE, current + 1000);
    logView.commitUpdates();
  };
  cleanUpFns.push(
    logView.subscribe(
      linkedState,
      () => {
        const newVal = logView.getCurrentState(linkedState) ?? defaultValue;
        if (newVal === Infinity) {
          plusButtonElt.disabled = true;
          plusButtonElt.style.cursor = "default";
        } else {
          plusButtonElt.disabled = false;
          plusButtonElt.style.cursor = "pointer";
        }
      },
      true,
    ),
  );
  return plusButtonElt;
}

/**
 * @param {Object} logView
 * @param {string} linkedState - The actual property the minus button is
 * linked to.
 * @param {number} defaultValue
 * @returns {HTMLButtonElement}
 */
function createTSResetButton(
  logView: ObservableState<LogViewState>,
  linkedState:
    | STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED
    | STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
  defaultValue: number,
): HTMLButtonElement {
  const resetButtonElt =
    strHtml`<button title="Reset to default value">↺</button>` as HTMLButtonElement;
  resetButtonElt.style.border = "none";
  resetButtonElt.style.backgroundColor = "transparent";
  resetButtonElt.style.cursor = "pointer";
  resetButtonElt.style.fontWeight = "bold";
  resetButtonElt.onclick = function () {
    const current = logView.getCurrentState(linkedState) ?? 0;
    if (current === defaultValue || current === undefined) {
      return;
    }
    logView.updateState(linkedState, UPDATE_TYPE.REPLACE, undefined);
    logView.commitUpdates();
  };
  return resetButtonElt;
}

function createMinimumDateInputElement(
  logView: ObservableState<LogViewState>,
): HTMLInputElement {
  const dateAtLoad = logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD);
  const minTimeStamp = logView.getCurrentState(
    STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
  );
  const minDateInMs = (dateAtLoad ?? 0) + (minTimeStamp ?? 0);
  const value = convertDateToLocalISOString(new Date(minDateInMs));
  const element = strHtml`<input
  type="datetime-local"
  id="meeting-time"
  name="meeting-time"
  value="${value}"
  step="0.1"
  />` as HTMLInputElement;

  function onMinimumTimeInputChange(): void {
    const dateInStr: string = element.value;
    const dateInMs = new Date(dateInStr).getTime();
    const lastDateAtLoad = logView.getCurrentState(
      STATE_PROPS.DATE_AT_PAGE_LOAD,
    );

    logView.updateState(
      STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
      UPDATE_TYPE.REPLACE,
      dateInMs - (lastDateAtLoad ?? 0),
    );
    logView.commitUpdates();
  }
  // element.oninput = onMinimumTimeInputChange;
  element.onchange = onMinimumTimeInputChange;
  return element;
}

function createMaximumDateInputElement(
  logView: ObservableState<LogViewState>,
): HTMLInputElement {
  const lastDateAtLoad =
    logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD) ?? 0;
  const maxTimeStamp =
    logView.getCurrentState(STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED) ??
    Infinity;
  const maxDateInMs = lastDateAtLoad + maxTimeStamp;
  let value: string;
  if (maxDateInMs === Infinity) {
    value = "";
  } else {
    value = convertDateToLocalISOString(new Date(maxDateInMs));
  }
  const element = strHtml`<input
  type="datetime-local"
  id="meeting-time"
  name="meeting-time"
  value="${value}"
  step="0.1"
  />` as HTMLInputElement;

  function onMaximumTimeInputChange(): void {
    const dateInStr: string = element.value;
    let dateInMs: number;
    if (dateInStr === "") {
      dateInMs = Infinity;
    } else {
      dateInMs = new Date(dateInStr).getTime();
    }
    const dateAtLoad = logView.getCurrentState(STATE_PROPS.DATE_AT_PAGE_LOAD);

    logView.updateState(
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      UPDATE_TYPE.REPLACE,
      dateInMs - (dateAtLoad ?? 0),
    );
    logView.commitUpdates();
  }
  element.onchange = onMaximumTimeInputChange;
  return element;
}

function createMinimumTimestampInputElement(
  logView: ObservableState<LogViewState>,
): HTMLInputElement {
  const minimumTimeInputElt = strHtml`<input
    type="input"
    placeholder="0"
    value="${
      logView.getCurrentState(STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED) ?? 0
    }"
    class="log-time-range"
  />` as HTMLInputElement;
  minimumTimeInputElt.oninput = onMinimumTimeInputChange;
  minimumTimeInputElt.onchange = onMinimumTimeInputChange;
  return minimumTimeInputElt;

  function onMinimumTimeInputChange() {
    let minRange: number = +minimumTimeInputElt.value;
    if (isNaN(minRange) || minRange <= 0) {
      minRange = 0;
    }
    if (
      minRange ===
      logView.getCurrentState(STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED)
    ) {
      return;
    }
    logView.updateState(
      STATE_PROPS.LOG_MIN_TIMESTAMP_DISPLAYED,
      UPDATE_TYPE.REPLACE,
      minRange,
    );
    logView.commitUpdates();
  }
}

function createMaximumTimestampInputElement(
  logView: ObservableState<LogViewState>,
): HTMLInputElement {
  const maxTs =
    logView.getCurrentState(STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED) ??
    Infinity;
  const maximumTimeInputElt = strHtml`<input
    type="input"
    class="log-time-range"
    value=${maxTs === Infinity ? "" : String(maxTs)}
  />` as HTMLInputElement;
  maximumTimeInputElt.oninput = onMaximumTimeInputChange;
  maximumTimeInputElt.onchange = onMaximumTimeInputChange;

  return maximumTimeInputElt;

  function onMaximumTimeInputChange() {
    let maxRange: number =
      maximumTimeInputElt.value === "" ? Infinity : +maximumTimeInputElt.value;
    if (isNaN(maxRange)) {
      maxRange = Infinity;
    }
    if (
      maxRange ===
      logView.getCurrentState(STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED)
    ) {
      return;
    }
    logView.updateState(
      STATE_PROPS.LOG_MAX_TIMESTAMP_DISPLAYED,
      UPDATE_TYPE.REPLACE,
      maxRange,
    );
    logView.commitUpdates();
  }
}
