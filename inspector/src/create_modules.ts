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
import modules, { ModuleInformation } from "./modules/index";
import ObservableState, { UPDATE_TYPE } from "./observable_state";
import {
  closeSvg,
  fullWidthSvg,
  halfWidthSvg,
  maximizeSvg,
  minimizeSvg,
  moveDownSvg,
  moveUpSvg,
} from "./svg";
import { getDefaultModuleOrder } from "./utils";

/**
 * The entry point for the creation of the whole "module system" (the small
 * blocks looking like various windows).
 *
 * Will create and insert the various modules, found inside `configState`, in
 * the given `containerElt`.
 *
 * Supplementary information is also necessary for both stylisation and module
 * configuration.
 * @param {Object} config
 * @returns {Function} - Call this function to clean up all resources
 * `createModules` have created. Should be called when the page is disposed.
 */
export default function createModules({
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

  let someModuleWasMissing = false;
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
      someModuleWasMissing = true;
    }
  }

  // Add all unfound modules at the end
  modulesInOrder.push(...leftModulesToIterateOn);

  if (someModuleWasMissing || leftModulesToIterateOn.length > 0) {
    const newOrder = modulesInOrder.map(({ moduleId }) => moduleId);
    configState.updateState(
      STATE_PROPS.MODULES_ORDER,
      UPDATE_TYPE.REPLACE,
      newOrder,
    );
  }
  configState.commitUpdates();

  /** Callbacks to call on clean-up */
  const onDestroyCbs: Array<() => void> = [];

  const resizeObserver = new ResizeObserver(() =>
    reSyncModulesPlacement(containerElt),
  );
  onDestroyCbs.push(() => resizeObserver.disconnect());
  for (const moduleInfo of modulesInOrder) {
    const moduleWrapperElt = createModule(moduleInfo);
    if (moduleWrapperElt !== null) {
      moduleWrapperElt.dataset.moduleId = moduleInfo.moduleId;
      containerElt.appendChild(moduleWrapperElt);
      resizeObserver.observe(moduleWrapperElt);
    }
  }
  reSyncModulesPlacement(containerElt);

  configState.subscribe(STATE_PROPS.MODULES_ORDER, onModulesOrderChange);
  onDestroyCbs.push(() =>
    configState.unsubscribe(STATE_PROPS.MODULES_ORDER, onModulesOrderChange),
  );

  /** clean-up */
  return () => {
    onDestroyCbs.slice().forEach((disposeFn) => disposeFn());

    const moduleWrapperElts =
      containerElt.getElementsByClassName("module-wrapper");
    for (let i = moduleWrapperElts.length - 1; i >= 0; i--) {
      const moduleWrapperElt = moduleWrapperElts[i];
      const parent = moduleWrapperElt.parentElement;
      if (parent !== null) {
        parent.removeChild(moduleWrapperElt);
      }
    }

    const closedModulesElt =
      containerElt.getElementsByClassName("closed-modules");
    for (let i = closedModulesElt.length - 1; i >= 0; i--) {
      const moduleWrapperElt = closedModulesElt[i];
      const parent = moduleWrapperElt.parentElement;
      if (parent !== null) {
        parent.removeChild(moduleWrapperElt);
      }
    }
  };

  function onModulesOrderChange() {
    let moduleWrapperElts =
      containerElt.getElementsByClassName("module-wrapper");
    const newModuleIdOrder =
      configState
        .getCurrentState(STATE_PROPS.MODULES_ORDER)
        ?.filter((id) => activeModuleIds.includes(id)) ?? [];

    let modWrapIdx;
    for (modWrapIdx = 0; modWrapIdx < moduleWrapperElts.length; modWrapIdx++) {
      // TODO better check than the `as`
      const moduleWrapperElt = moduleWrapperElts[modWrapIdx] as HTMLElement;
      const moduleId = moduleWrapperElt.dataset.moduleId;
      if (moduleId === undefined) {
        console.error("An element has an unknown module id");
        return;
      } else if (!newModuleIdOrder.includes(moduleId)) {
        containerElt.removeChild(moduleWrapperElt);
        resizeObserver.unobserve(moduleWrapperElt);
        moduleWrapperElts =
          containerElt.getElementsByClassName("module-wrapper");
        modWrapIdx--;
      } else if (modWrapIdx >= newModuleIdOrder.length) {
        console.error("There should not be more modules than the wanted ones");
        return;
      } else {
        const expectedModuleId = newModuleIdOrder[modWrapIdx];
        if (expectedModuleId !== moduleId) {
          let expectedElement;
          for (
            let innerIdx = 0;
            innerIdx < moduleWrapperElts.length;
            innerIdx++
          ) {
            // TODO better check than the `as`
            const elt = moduleWrapperElts[innerIdx] as HTMLElement;
            if (elt.dataset.moduleId === expectedModuleId) {
              expectedElement = elt;
            }
          }
          if (expectedElement === undefined) {
            const moduleInfo = modules.find(
              ({ moduleId: modId }) => modId === expectedModuleId,
            );
            if (moduleInfo === undefined) {
              console.error(`Module "${expectedModuleId}" unfound`);
              return;
            } else {
              const newWrapperElt = createModule(moduleInfo);
              if (newWrapperElt !== null) {
                newWrapperElt.dataset.moduleId = moduleInfo.moduleId;
                containerElt.insertBefore(
                  newWrapperElt,
                  moduleWrapperElts[modWrapIdx],
                );
                resizeObserver.observe(newWrapperElt);
                moduleWrapperElts =
                  containerElt.getElementsByClassName("module-wrapper");
              }
            }
          } else {
            containerElt.insertBefore(
              expectedElement,
              moduleWrapperElts[modWrapIdx],
            );
            resizeObserver.observe(expectedElement);
            moduleWrapperElts =
              containerElt.getElementsByClassName("module-wrapper");
          }
        }
      }
    }

    for (
      let newModIdx = modWrapIdx;
      newModIdx < newModuleIdOrder.length;
      newModIdx++
    ) {
      const moduleId = newModuleIdOrder[newModIdx];
      const moduleInfo = modules.find(
        ({ moduleId: modId }) => modId === moduleId,
      );
      if (moduleInfo === undefined) {
        console.error(`Module "${moduleId}" unfound`);
        return;
      } else {
        const newWrapperElt = createModule(moduleInfo);
        if (newWrapperElt !== null) {
          newWrapperElt.dataset.moduleId = moduleInfo.moduleId;
          containerElt.appendChild(newWrapperElt);
          resizeObserver.observe(newWrapperElt);
          moduleWrapperElts =
            containerElt.getElementsByClassName("module-wrapper");
        }
      }
    }
    reSyncModulesPlacement(containerElt);
  }

  function createModule(moduleInfo: ModuleInformation) {
    const moduleContext = {
      tokenId,
      state: inspectorState,
      logView: logViewState,
      configState,
    };
    const { moduleFn, moduleTitle, moduleId, isClosable } = moduleInfo;
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
    const { body, clear, destroy } = moduleRes;
    if (!(body instanceof HTMLElement)) {
      throw new Error("A module's body should be an HTMLElement");
    }

    const moduleWrapperElt = createElement("div", {
      className: "module-wrapper",
    });
    body.classList.add("module-body");
    const buttons = [];
    const resizeWidthButtonElt = createButton({
      className: "module-btn btn-width-resize",
    });
    buttons.push(resizeWidthButtonElt);
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

    if (typeof clear === "function") {
      const clearButton = createButton({
        className: "module-btn btn-clear-module",
        textContent: "🚫",
        title: "Clear content of this module",
        onClick: clear,
      });
      buttons.push(clearButton);
    }
    const minimizedButtonElt = createButton({
      className: "module-btn btn-min-max-module",
    });
    buttons.push(minimizedButtonElt);
    if (isClosable) {
      buttons.push(createClosingButton());
    }
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

    let currentDisplayedWidthRatio: number | undefined;
    let isModuleCurrentlyMinimized: boolean | undefined;
    configState.subscribe(STATE_PROPS.CLOSED_MODULES, onModuleClosing);
    configState.subscribe(
      STATE_PROPS.MINIMIZED_MODULES,
      onMinimizedModule,
      true,
    );
    configState.subscribe(STATE_PROPS.WIDTH_RATIOS, onWidthRatioChange, true);
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

    function onWidthRatioChange() {
      const widthRatios = configState.getCurrentState(STATE_PROPS.WIDTH_RATIOS);
      const newWidthRatio =
        widthRatios?.[moduleId] ??
        (moduleInfo.isHalfWidthByDefault ? 2 : 1) ??
        1;

      if (newWidthRatio === currentDisplayedWidthRatio) {
        return;
      }

      currentDisplayedWidthRatio = newWidthRatio;
      if (currentDisplayedWidthRatio === 2) {
        moduleWrapperElt.style.width = "calc(50% - 12px)";
        moduleWrapperElt.dataset.isHalfWidth = "true";
        resizeWidthButtonElt.innerHTML = fullWidthSvg;
        resizeWidthButtonElt.title = "Take full width";
        resizeWidthButtonElt.onclick = () => {
          const lastWidthRatios = configState.getCurrentState(
            STATE_PROPS.WIDTH_RATIOS,
          );
          if (lastWidthRatios !== undefined) {
            lastWidthRatios[moduleId] = 1;
          }
          configState.updateState(
            STATE_PROPS.WIDTH_RATIOS,
            UPDATE_TYPE.REPLACE,
            lastWidthRatios,
          );
          configState.commitUpdates();
        };
      } else {
        moduleWrapperElt.style.width = "calc(100% - 12px)";
        moduleWrapperElt.dataset.isHalfWidth = "false";
        resizeWidthButtonElt.innerHTML = halfWidthSvg;
        resizeWidthButtonElt.title = "Take half width";
        resizeWidthButtonElt.onclick = () => {
          const lastWidthRatios = configState.getCurrentState(
            STATE_PROPS.WIDTH_RATIOS,
          );
          if (lastWidthRatios !== undefined) {
            lastWidthRatios[moduleId] = 2;
          }
          configState.updateState(
            STATE_PROPS.WIDTH_RATIOS,
            UPDATE_TYPE.REPLACE,
            lastWidthRatios,
          );
          configState.commitUpdates();
        };
      }
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
      configState.unsubscribe(STATE_PROPS.WIDTH_RATIOS, onWidthRatioChange);
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
      const skippedModuleIds = modulesOrder.filter(
        (id) => !activeModuleIds.includes(id),
      );

      let prevIndex = indexOfModuleId - 1;
      if (indexOfModuleId === -1) {
        modulesOrder.push(moduleId);
      } else {
        while (true) {
          if (prevIndex < 0) {
            return;
          } else if (skippedModuleIds.includes(modulesOrder[prevIndex])) {
            prevIndex--;
          } else {
            modulesOrder[indexOfModuleId] = modulesOrder[prevIndex];
            modulesOrder[prevIndex] = moduleId;
            break;
          }
        }
      }
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
      const skippedModuleIds = modulesOrder.filter(
        (id) => !activeModuleIds.includes(id),
      );

      let nextModule = indexOfModuleId + 1;
      if (indexOfModuleId === -1) {
        modulesOrder.push(moduleId);
      } else {
        while (true) {
          if (nextModule > modulesOrder.length) {
            return;
          } else if (skippedModuleIds.includes(modulesOrder[nextModule])) {
            nextModule++;
          } else {
            modulesOrder[indexOfModuleId] = modulesOrder[nextModule];
            modulesOrder[nextModule] = moduleId;
            break;
          }
        }
      }
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
      let closedElements = document.getElementsByClassName("closed-modules")[0];
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
        containerElt.appendChild(closedElements);
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
          containerElt.getElementsByClassName("closed-module-elt");
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
 * By default new modules are placed through simple rules: if a current
 * half-width module at the bottom left is lower than the half-width module at
 * the bottom right, the next half-width module goes to the right, else, it goes
 * to the left.
 * Full-width module do not have this considerations, we could say they are
 * always added to the left.
 *
 * This logic is actually completely handled by CSS, so this is nice, efficient
 * and usually battle-tested.
 *
 * However, under this logic and my current understanding of CSS (which is not
 * high, I'll admit), modules added to the left are not positionned relative to
 * the previous left one to the left, but relative to the bottom of the lowest
 * previous module, which here is the right one.
 *
 * This might give the following aspect:
 * ```
 * +----------+ +----------+
 * | Module 1 | |  Bigger  |
 * +----------+ |  Module  |
 *              |    2     |
 *              +----------+
 *  +----------+
 *  | Module 3 |
 *  +----------+
 * ```
 *
 * Where it could be more logical to have the following aspect instead:
 * ```
 * +----------+ +----------+
 * | Module 1 | |  Bigger  |
 * +----------+ |  Module  |
 * +----------+ |    2     |
 * | Module 3 | +----------+
 * +----------+
 * ```
 *
 * Though this also mean this (which may or may not be logical, depending on
 * you):
 * ```
 * +----------+ +----------+
 * | Module 1 | |          |
 * +----------+ |   HUGE   |
 * +----------+ |  Module  |
 * | Module 3 | |    2     |
 * +----------+ |          |
 *              +----------+
 * ```
 *
 * Here instead of:
 * ```
 * +----------+ +----------+
 * | Module 1 | |          |
 * +----------+ |   HUGE   |
 *              |  Module  |
 *              |    2     |
 *              |          |
 *              +----------+
 *  +----------+
 *  | Module 3 |
 *  +----------+
 * ```
 *
 * This function tries to do just that by uglily playing with the margin-top
 * CSS attribute of the modules.
 *
 * It should be noted however that:
 *
 *   1. I'm very bad at CSS, so this solution may be over-engineered and bad.
 *
 *   2. There's a risk of an infinite updating loop if updating the margin-top
 *      is done to a wrong value, or if it has a side-effect elsewhere that
 *      change the vertical distance between modules to another unexpected
 *      value.
 *      I know it, yet I'm lucky to have never encountered an issue yet, but I
 *      didn't want to spend the effort of writing guards here.
 *
 *   3. The new aspect actually makes the up/down re-arranging of modules much
 *      more confusing than before.
 *
 *      We should probably change that logic. Dragging and dropping modules
 *      for placement would be cool, but it looks like a lot of work.
 *
 * @param {HTMLElement} containerElt - The HTMLElement on which all modules are
 * added.
 */
function reSyncModulesPlacement(containerElt: HTMLElement) {
  const moduleWrapperElts =
    containerElt.getElementsByClassName("module-wrapper");
  let prevHalfWidthModuleIdx: number | null = null;
  for (let i = 0; i < moduleWrapperElts.length; i++) {
    const elt = moduleWrapperElts[i] as HTMLElement;
    if (elt.nodeType === Node.ELEMENT_NODE) {
      elt.style.marginTop = "";
      if (elt.dataset.isHalfWidth !== "true") {
        prevHalfWidthModuleIdx = null;
      } else if (prevHalfWidthModuleIdx === null) {
        prevHalfWidthModuleIdx = i;
      } else {
        const placementCurr = elt.getBoundingClientRect();
        const placementPrev = (
          moduleWrapperElts[prevHalfWidthModuleIdx] as HTMLElement
        ).getBoundingClientRect();

        if (placementPrev.left === placementCurr.left) {
          const diff = placementCurr.top - placementPrev.bottom;
          if (diff > 15) {
            elt.style.marginTop = `-${diff - 15}px`;
          } else {
            elt.style.marginTop = "";
          }
          prevHalfWidthModuleIdx = i;
        }
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
