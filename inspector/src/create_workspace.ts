import {
  ConfigState,
  InspectorState,
  LogViewState,
  STATE_PROPS,
} from "./constants";
import {
  createButton,
  createCompositeElement,
  createElement,
} from "./dom-utils";
import createHowToUseContent from "./how_to_use";
import createLogView from "./log_view";
import modules, { ModuleInformation } from "./modules/index";
import ObservableState, { UPDATE_TYPE } from "./observable_state";
import {
  closeSvg,
  maximizeSvg,
  minimizeSvg,
  moveDownSvg,
  moveUpSvg,
} from "./svg";
import { getDefaultModuleOrder } from "./utils";

/**
 * Create the inspector workspace with a fixed log pane and movable modules.
 *
 * The module order and pane layout come from `configState`.
 *
 * Supplementary information is also necessary for both stylisation and module
 * configuration.
 * @param {Object} config
 * @returns {Function} - Call this function to clean up all resources
 * the workspace created. Should be called when the page is disposed.
 */
export default function createWorkspace({
  containerElt,
  context,
  tokenId,
  configState,
  logViewState,
  inspectorState,
}: {
  containerElt: HTMLElement;
  tokenId?: string | undefined;
  configState: ObservableState<ConfigState>;
  logViewState: ObservableState<LogViewState>;
  inspectorState: ObservableState<InspectorState>;
  context: "live-debugging" | "post-debugger";
}): () => void {
  let storedModulesOrder =
    configState.getCurrentState(STATE_PROPS.MODULES_ORDER) ?? [];
  if (storedModulesOrder.length === 0) {
    storedModulesOrder = getDefaultModuleOrder();
    configState.updateState(
      STATE_PROPS.MODULES_ORDER,
      UPDATE_TYPE.REPLACE,
      storedModulesOrder,
    );
    configState.commitUpdates();
  }

  const modulesInOrder = [];
  const leftModulesToIterateOn = modules.filter(({ contexts }) =>
    contexts.includes(context),
  );
  const activeModuleIds = leftModulesToIterateOn.map((m) => m.moduleId);
  for (const storedModuleId of storedModulesOrder) {
    const index = leftModulesToIterateOn.findIndex(
      ({ moduleId }) => moduleId === storedModuleId,
    );
    if (index !== -1) {
      modulesInOrder.push(leftModulesToIterateOn[index]);
      leftModulesToIterateOn.splice(index, 1);
    } else if (
      modules.find((m) => storedModuleId === m.moduleId) === undefined
    ) {
      console.warn(`Stored module id ${storedModuleId} does not exist anymore`);
    }
  }

  // Add all unfound modules at the end
  modulesInOrder.push(...leftModulesToIterateOn);

  const newOrder = modulesInOrder.map(({ moduleId }) => moduleId);
  if (
    storedModulesOrder.length !== newOrder.length ||
    storedModulesOrder.some((moduleId, index) => moduleId !== newOrder[index])
  ) {
    configState.updateState(
      STATE_PROPS.MODULES_ORDER,
      UPDATE_TYPE.REPLACE,
      newOrder,
    );
  }
  configState.commitUpdates();

  /** Callbacks to call on clean-up */
  const onDestroyCbs: Array<() => void> = [];

  const workspaceElt = createElement("div", {
    className: "inspector-workspace",
  });
  const logPaneElt = createElement("section", {
    className: "inspector-log-pane",
  });
  const modulesPaneElt = createElement("section", {
    className: "inspector-modules-pane",
  });
  const splitterElt = createElement("div", {
    className: "inspector-pane-splitter",
  });
  splitterElt.tabIndex = 0;
  splitterElt.setAttribute("role", "separator");
  splitterElt.setAttribute("aria-orientation", "vertical");
  splitterElt.setAttribute("aria-label", "Resize logs pane");
  splitterElt.setAttribute("aria-valuemin", "30");
  splitterElt.setAttribute("aria-valuemax", "70");
  const collapseButton = createButton({
    className: "module-btn btn-collapse-logs",
  });
  const logContent = createLogView({
    logView: logViewState,
    configState,
  });
  const logWrapper = createElement("div", { className: "module-wrapper" });
  const logTitle = createCompositeElement(
    "div",
    [
      createElement("span", {
        textContent: "Logs",
        className: "module-title-text",
      }),
      createCompositeElement("span", [collapseButton], {
        className: "module-title-buttons",
      }),
    ],
    { className: "module-title" },
  );
  logContent.body.classList.add("module-body");
  logWrapper.appendChild(logTitle);
  logWrapper.appendChild(logContent.body);
  logPaneElt.appendChild(logWrapper);
  onDestroyCbs.push(logContent.destroy);
  if (context === "live-debugging" && tokenId !== undefined) {
    const details = createElement("details", { className: "inspector-help" });
    details.appendChild(
      createElement("summary", {
        textContent: "How to connect and use this tool",
      }),
    );
    details.appendChild(createHowToUseContent(tokenId));
    containerElt.appendChild(details);
  }
  workspaceElt.appendChild(logPaneElt);
  workspaceElt.appendChild(modulesPaneElt);
  workspaceElt.appendChild(splitterElt);
  containerElt.appendChild(workspaceElt);
  const onPaneConfigChange = () => {
    const width = Math.max(
      30,
      Math.min(
        70,
        configState.getCurrentState(STATE_PROPS.LOG_PANE_WIDTH) ?? 50,
      ),
    );
    const collapsed =
      configState.getCurrentState(STATE_PROPS.LOG_PANE_COLLAPSED) ?? false;
    workspaceElt.style.setProperty("--log-pane-width", `${width}%`);
    workspaceElt.classList.toggle("logs-collapsed", collapsed);
    splitterElt.setAttribute("aria-valuenow", String(width));
    collapseButton.title = collapsed ? "Show logs" : "Hide logs";
    collapseButton.setAttribute("aria-label", collapseButton.title);
    collapseButton.innerHTML = collapsed ? maximizeSvg : minimizeSvg;
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
  };
  let isDragging = false;
  let draggedWidth = 50;
  const widthFromPointer = (clientX: number) => {
    const rect = workspaceElt.getBoundingClientRect();
    return Math.max(
      30,
      Math.min(70, Math.round(((clientX - rect.left) / rect.width) * 100)),
    );
  };
  splitterElt.onpointerdown = (event) => {
    if (event.button !== 0) {
      return;
    }
    isDragging = true;
    draggedWidth = widthFromPointer(event.clientX);
    splitterElt.setPointerCapture(event.pointerId);
    workspaceElt.style.setProperty("--log-pane-width", `${draggedWidth}%`);
    event.preventDefault();
  };
  splitterElt.onpointermove = (event) => {
    if (!isDragging) {
      return;
    }
    draggedWidth = widthFromPointer(event.clientX);
    workspaceElt.style.setProperty("--log-pane-width", `${draggedWidth}%`);
    splitterElt.setAttribute("aria-valuenow", String(draggedWidth));
  };
  splitterElt.onpointerup = (event) => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    splitterElt.releasePointerCapture(event.pointerId);
    configState.updateState(
      STATE_PROPS.LOG_PANE_WIDTH,
      UPDATE_TYPE.REPLACE,
      draggedWidth,
    );
    configState.commitUpdates();
  };
  splitterElt.onpointercancel = () => {
    isDragging = false;
    onPaneConfigChange();
  };
  splitterElt.onkeydown = (event) => {
    const delta =
      event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
    if (delta === 0) {
      return;
    }
    event.preventDefault();
    const width = Math.max(
      30,
      Math.min(
        70,
        (configState.getCurrentState(STATE_PROPS.LOG_PANE_WIDTH) ?? 50) + delta,
      ),
    );
    configState.updateState(
      STATE_PROPS.LOG_PANE_WIDTH,
      UPDATE_TYPE.REPLACE,
      width,
    );
    configState.commitUpdates();
  };
  collapseButton.onclick = () => {
    configState.updateState(
      STATE_PROPS.LOG_PANE_COLLAPSED,
      UPDATE_TYPE.REPLACE,
      !(configState.getCurrentState(STATE_PROPS.LOG_PANE_COLLAPSED) ?? false),
    );
    configState.commitUpdates();
  };
  onDestroyCbs.push(
    configState.subscribe(STATE_PROPS.LOG_PANE_WIDTH, onPaneConfigChange),
  );
  onDestroyCbs.push(
    configState.subscribe(STATE_PROPS.LOG_PANE_COLLAPSED, onPaneConfigChange),
  );
  onPaneConfigChange();
  for (const moduleInfo of modulesInOrder) {
    const moduleWrapperElt = createModule(moduleInfo);
    if (moduleWrapperElt !== null) {
      moduleWrapperElt.dataset.moduleId = moduleInfo.moduleId;
      modulesPaneElt.appendChild(moduleWrapperElt);
    }
  }
  const initialClosedModules =
    modulesPaneElt.getElementsByClassName("closed-modules")[0];
  if (initialClosedModules !== undefined) {
    modulesPaneElt.appendChild(initialClosedModules);
  }

  configState.subscribe(STATE_PROPS.MODULES_ORDER, onModulesOrderChange);
  onDestroyCbs.push(() =>
    configState.unsubscribe(STATE_PROPS.MODULES_ORDER, onModulesOrderChange),
  );

  /** clean-up */
  return () => {
    onDestroyCbs.slice().forEach((disposeFn) => disposeFn());

    containerElt.replaceChildren();
  };

  function onModulesOrderChange() {
    const newModuleIdOrder =
      configState
        .getCurrentState(STATE_PROPS.MODULES_ORDER)
        ?.filter((id) => activeModuleIds.includes(id)) ?? [];
    const existing = new Map<string, HTMLElement>();
    for (const child of Array.from(modulesPaneElt.children)) {
      const wrapper = child as HTMLElement;
      if (wrapper.dataset.moduleId !== undefined) {
        existing.set(wrapper.dataset.moduleId, wrapper);
      }
    }
    for (let index = 0; index < newModuleIdOrder.length; index++) {
      const moduleId = newModuleIdOrder[index];
      let wrapper = existing.get(moduleId);
      if (wrapper === undefined) {
        const moduleInfo = modules.find((m) => m.moduleId === moduleId);
        if (moduleInfo === undefined) {
          continue;
        }
        wrapper = createModule(moduleInfo) ?? undefined;
        if (wrapper === undefined) {
          continue;
        }
        wrapper.dataset.moduleId = moduleId;
      }
      if (modulesPaneElt.children[index] !== wrapper) {
        modulesPaneElt.insertBefore(
          wrapper,
          modulesPaneElt.children[index] ?? null,
        );
      }
      existing.delete(moduleId);
    }
    for (const wrapper of existing.values()) {
      wrapper.remove();
    }
    const closedModules =
      modulesPaneElt.getElementsByClassName("closed-modules")[0];
    if (closedModules !== undefined) {
      modulesPaneElt.appendChild(closedModules);
    }
  }

  function createModule(moduleInfo: ModuleInformation) {
    const moduleContext = {
      tokenId,
      state: inspectorState,
      logView: logViewState,
      configState,
    };
    const { moduleFn, moduleTitle, moduleId } = moduleInfo;
    const isClosed = (
      configState.getCurrentState(STATE_PROPS.CLOSED_MODULES) ?? []
    ).includes(moduleId);
    if (isClosed) {
      putModuleInClosedElements();
      return null;
    }
    const moduleRes = moduleFn(moduleContext);
    if (moduleRes === null) {
      return null;
    }
    const { body, destroy } = moduleRes;
    if (!(body instanceof HTMLElement)) {
      throw new Error("A module's body should be an HTMLElement");
    }

    const moduleWrapperElt = createElement("div", {
      className: "module-wrapper",
    });
    body.classList.add("module-body");
    const buttons = [];
    const moveDownButton = createButton({
      className: "module-btn btn-move-down-module",
      title: "Move the module one level down",
      onClick: moveModuleDown,
    });
    moveDownButton.innerHTML = moveDownSvg;
    buttons.push(moveDownButton);
    const moveUpButton = createButton({
      className: "module-btn btn-move-up-module",
      title: "Move the module one level up",
      onClick: moveModuleUp,
    });
    moveUpButton.innerHTML = moveUpSvg;
    buttons.push(moveUpButton);

    const minimizedButtonElt = createButton({
      className: "module-btn btn-min-max-module",
    });
    buttons.push(minimizedButtonElt);
    buttons.push(createClosingButton());
    const moduleTitleElt = createCompositeElement(
      "div",
      [
        createElement("span", {
          textContent: moduleTitle ?? "Unnamed module",
          className: "module-title-text",
        }),
        createCompositeElement("span", buttons, {
          className: "module-title-buttons",
        }),
      ],
      { className: "module-title" },
    );
    moduleWrapperElt.appendChild(moduleTitleElt);
    moduleWrapperElt.appendChild(body);

    let isModuleCurrentlyMinimized: boolean | undefined;
    configState.subscribe(STATE_PROPS.CLOSED_MODULES, onModuleClosing);
    configState.subscribe(
      STATE_PROPS.MINIMIZED_MODULES,
      onMinimizedModule,
      true,
    );
    configState.subscribe(STATE_PROPS.MODULES_ORDER, onModuleOrderChange, true);
    onDestroyCbs.push(disposeModule);

    return moduleWrapperElt;

    function onModuleOrderChange() {
      const moduleIdOrder = configState
        .getCurrentState(STATE_PROPS.MODULES_ORDER)
        ?.filter((id) => activeModuleIds.includes(id));
      moveUpButton.disabled = moduleId === moduleIdOrder?.[0];
      moveDownButton.disabled =
        moduleId === moduleIdOrder?.[moduleIdOrder.length - 1];
    }

    function onMinimizedModule() {
      const isMinimized = (
        configState.getCurrentState(STATE_PROPS.MINIMIZED_MODULES) ?? []
      ).includes(moduleId);
      if (isModuleCurrentlyMinimized === isMinimized) {
        return;
      }
      isModuleCurrentlyMinimized = isMinimized;
      if (isModuleCurrentlyMinimized) {
        body.style.display = "none";
        minimizedButtonElt.title = "Maximize this module";
        minimizedButtonElt.innerHTML = maximizeSvg;
        minimizedButtonElt.onclick = () => {
          removeModuleIdFromState(
            configState,
            moduleId,
            STATE_PROPS.MINIMIZED_MODULES,
          );
          configState.commitUpdates();
        };
      } else {
        body.style.display = "block";
        minimizedButtonElt.title = "Minimize this module";
        minimizedButtonElt.innerHTML = minimizeSvg;

        minimizedButtonElt.onclick = () => {
          addModuleIdToState(
            configState,
            moduleId,
            STATE_PROPS.MINIMIZED_MODULES,
          );
          configState.commitUpdates();
        };
      }
    }

    function onModuleClosing(
      _updateType: UPDATE_TYPE,
      value: string[] | undefined,
    ): void {
      if (value === undefined || !value.includes(moduleId)) {
        return;
      }
      disposeModule();

      const idxInOnDestroy = onDestroyCbs.indexOf(disposeModule);
      if (idxInOnDestroy !== -1) {
        onDestroyCbs.splice(idxInOnDestroy, 1);
      }

      const parent = moduleWrapperElt.parentElement;
      if (parent !== null) {
        parent.removeChild(moduleWrapperElt);
      }

      putModuleInClosedElements();
      configState.commitUpdates();
    }

    /**
     * Perform clean-up on module destruction.
     */
    function disposeModule(): void {
      configState.unsubscribe(STATE_PROPS.CLOSED_MODULES, onModuleClosing);
      configState.unsubscribe(STATE_PROPS.MINIMIZED_MODULES, onMinimizedModule);
      configState.unsubscribe(STATE_PROPS.MODULES_ORDER, onModuleOrderChange);
      if (typeof destroy === "function") {
        destroy();
      } else if (destroy !== undefined) {
        console.error(
          "Module: `destroy` should either be a function or undefined",
        );
      }
    }

    function moveModuleUp() {
      const modulesOrder =
        configState.getCurrentState(STATE_PROPS.MODULES_ORDER) ?? [];
      const indexOfModuleId = modulesOrder.indexOf(moduleId);
      if (indexOfModuleId <= 0) {
        return;
      }
      [modulesOrder[indexOfModuleId - 1], modulesOrder[indexOfModuleId]] = [
        modulesOrder[indexOfModuleId],
        modulesOrder[indexOfModuleId - 1],
      ];
      configState.updateState(
        STATE_PROPS.MODULES_ORDER,
        UPDATE_TYPE.REPLACE,
        modulesOrder,
      );
      configState.commitUpdates();
    }

    function moveModuleDown() {
      const modulesOrder =
        configState.getCurrentState(STATE_PROPS.MODULES_ORDER) ?? [];
      const indexOfModuleId = modulesOrder.indexOf(moduleId);
      if (indexOfModuleId < 0 || indexOfModuleId >= modulesOrder.length - 1) {
        return;
      }
      [modulesOrder[indexOfModuleId + 1], modulesOrder[indexOfModuleId]] = [
        modulesOrder[indexOfModuleId],
        modulesOrder[indexOfModuleId + 1],
      ];
      configState.updateState(
        STATE_PROPS.MODULES_ORDER,
        UPDATE_TYPE.REPLACE,
        modulesOrder,
      );
      configState.commitUpdates();
    }

    function createClosingButton() {
      const button = createButton({
        className: "module-btn btn-close-module",
        title: "Close this module",
        onClick() {
          addModuleIdToState(configState, moduleId, STATE_PROPS.CLOSED_MODULES);
          removeModuleIdFromState(
            configState,
            moduleId,
            STATE_PROPS.MODULES_ORDER,
          );
          configState.commitUpdates();
        },
      });
      button.innerHTML = closeSvg;
      return button;
    }

    function putModuleInClosedElements() {
      let closedElements =
        modulesPaneElt.getElementsByClassName("closed-modules")[0];
      if (closedElements === undefined) {
        closedElements = createCompositeElement(
          "div",
          [
            createElement("span", {
              textContent: "Closed modules (click to re-open)",
              className: "closed-modules-title",
            }),
          ],
          { className: "closed-modules" },
        );
        modulesPaneElt.appendChild(closedElements);
      }

      const closedModuleNameElt = createElement("span", {
        className: "closed-module-elt",
        textContent: moduleTitle,
      });

      const unsub = configState.subscribe(
        STATE_PROPS.CLOSED_MODULES,
        (updateType: string) => {
          if ((updateType as UPDATE_TYPE) === UPDATE_TYPE.PUSH) {
            return;
          }
          const closedModules =
            configState.getCurrentState(STATE_PROPS.CLOSED_MODULES) ?? [];
          if (closedModules.includes(moduleId)) {
            return;
          }
          reOpenClosedModule();
        },
      );
      onDestroyCbs.push(unsub);

      closedModuleNameElt.onclick = () => {
        removeModuleIdFromState(
          configState,
          moduleId,
          STATE_PROPS.CLOSED_MODULES,
        );
        reOpenClosedModule();
      };
      closedElements.appendChild(closedModuleNameElt);

      // Un-minimize module if it was
      removeModuleIdFromState(
        configState,
        moduleId,
        STATE_PROPS.MINIMIZED_MODULES,
      );
      removeModuleIdFromState(configState, moduleId, STATE_PROPS.MODULES_ORDER);
      configState.commitUpdates();

      function reOpenClosedModule() {
        unsub();
        const idxInOnDestroy = onDestroyCbs.indexOf(disposeModule);
        if (idxInOnDestroy !== -1) {
          onDestroyCbs.splice(idxInOnDestroy, 1);
        }
        if (closedModuleNameElt.parentElement !== null) {
          closedModuleNameElt.parentElement.removeChild(closedModuleNameElt);
        }
        const remainingClosedModules =
          modulesPaneElt.getElementsByClassName("closed-module-elt");
        if (
          remainingClosedModules.length === 0 &&
          closedElements.parentElement !== null
        ) {
          closedElements.parentElement.removeChild(closedElements);
        }
        addModuleIdToState(configState, moduleId, STATE_PROPS.MODULES_ORDER);
        configState.commitUpdates();
      }
    }
  }
}

/**
 * @param {Object} configState
 * @param {string} moduleId
 * @param {string} stateName
 */
function removeModuleIdFromState(
  configState: ObservableState<ConfigState>,
  moduleId: string,
  stateName:
    | STATE_PROPS.MODULES_ORDER
    | STATE_PROPS.CLOSED_MODULES
    | STATE_PROPS.MINIMIZED_MODULES,
) {
  const arr = configState.getCurrentState(stateName);
  if (arr === undefined) {
    return;
  }
  const indexOfModuleId = arr.indexOf(moduleId);
  if (indexOfModuleId !== -1) {
    arr.splice(indexOfModuleId, 1);
    configState.updateState(stateName, UPDATE_TYPE.REPLACE, arr);
  }
}

/**
 * @param {Object} configState
 * @param {string} moduleId
 * @param {string} stateName
 */
function addModuleIdToState(
  configState: ObservableState<ConfigState>,
  moduleId: string,
  stateName:
    | STATE_PROPS.MODULES_ORDER
    | STATE_PROPS.CLOSED_MODULES
    | STATE_PROPS.MINIMIZED_MODULES,
) {
  const arr = configState.getCurrentState(stateName) ?? [];
  if (!arr.includes(moduleId)) {
    arr.push(moduleId);
    configState.updateState(stateName, UPDATE_TYPE.REPLACE, arr);
  }
}
