/**
 * Different types of updates that can be performed on a single state property.
 * It is advised to always communicate the more restrictive compatible type  for
 * an update (e.g. `PUSH` instead of `REPLACE` when the value is an array where
 * the update are just new elements at the end of this array) for performance
 * reasons.
 */
export enum UPDATE_TYPE {
  /**
   * The state property in question is an array and the update just pushed new
   * elements at the end of this array.
   * The value generally accompanying this updateType should be an array
   * containing just the new elements pushed at the end of the state property.
   */
  PUSH = "push",
  /**
   * The update completely replaced the previous state property's value if one
   * (or set it if this is a new property).
   * The value generally accompanying this updateType should be the new state
   * property's value.
   */
  REPLACE = "replace",
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface
interface Empty {}

/**
 * Type for state listeners, which listen to any of the `ObservableState`'s
 * properties.
 * @param {string} updateType - The type of update that was just performed.
 * @param {*} value - The value which which the state was updated.
 * Note: for `UPDATE_TYPE.PUSH`, those are only the newly pushed elements.
 */
export type StateListenerFunction<
  TStateObject extends Empty,
  K extends keyof TStateObject,
> = (updateType: UPDATE_TYPE, value: TStateObject[K]) => void;

/**
 * Class allowing to update a global state and to register callbacks to when
 * one of its property changes.
 *
 * @class ObservableState
 */
export default class ObservableState<TStateObject extends Empty> {
  /** Value for the current state object. */
  private _currentState: {
    [K in keyof TStateObject]?: TStateObject[K] | undefined;
  };

  /** All registered listeners for each of the state's property. */
  private _callbacks: {
    [K in keyof TStateObject]?: Array<StateListenerFunction<TStateObject, K>>;
  };

  /**
   * Updates that not have been "commited" yet (see `commitUpdates`).
   */
  private _pendingUpdates: {
    [K in keyof TStateObject]?: {
      updateType: UPDATE_TYPE;
      value: TStateObject[K];
    };
  };

  /**
   * Create a new `ObservableState` instance.
   */
  constructor() {
    this._currentState = {};
    this._callbacks = {};
    this._pendingUpdates = {};
  }

  /**
   * Get the current value stored for the given state property.
   * Returns `undefined` if the state property does not exist.
   * @param {string|undefined} [stateName] - The name of the wanted state
   * property.
   * If not set or set to `undefined`, this method will return all properties
   * as an object (whose keys are the property names and values their values).
   * @returns {*} - Current value of the state property or `undefined` if it
   * does not exist.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-shadow */
  public getCurrentState<K extends keyof TStateObject>(): {
    [K in keyof TStateObject]?: TStateObject[K] | undefined;
  };
  public getCurrentState<K extends keyof TStateObject>(
    stateName: K,
  ): TStateObject[K];
  public getCurrentState<K extends keyof TStateObject>(
    stateName?: K,
  ):
    | TStateObject[K]
    | { [K in keyof TStateObject]?: TStateObject[K] | undefined }
    | undefined {
    /* eslint-enable @typescript-eslint/no-shadow */
    /* eslint-enable @typescript-eslint/no-unused-vars */
    if (stateName === undefined) {
      return { ...this._currentState };
    } else {
      return this._currentState[stateName];
    }
  }

  /**
   * Update one of the state property of the `ObservableState`.
   *
   * This method should be the only way used to update a state property.
   *
   * Note that updating the state property through `updateState` will not
   * trigger the callback registered through `subscribe` directly.
   * Those callbacks are only called once the `commitUpdates` method is called.
   * Doing this allows to group multiple synchronous state updates before doing
   * those calls.
   *
   * @param {string} stateName - The name of the state property to update.
   * @param {string} updateType - The update type (@see UPDATE_TYPE). This is
   * a string which will classify the type of update you're making to the state
   * property.
   * Doing this instead of always replacing completely the value of a state
   * property allows to unlock optimizations.
   * @param {*} value - The value of the update performed, according to the
   * `updateType` argument.
   */
  public updateState<K extends keyof TStateObject>(
    stateName: K,
    updateType: UPDATE_TYPE,
    value: TStateObject[K],
  ): void {
    const prevUpdate = this._pendingUpdates[stateName];
    if (prevUpdate === undefined) {
      (this._pendingUpdates[stateName] as {
        updateType: UPDATE_TYPE;
        value: TStateObject[K];
      }) = { updateType, value };
    } else if (updateType !== UPDATE_TYPE.PUSH) {
      (this._pendingUpdates[stateName] as {
        updateType: UPDATE_TYPE;
        value: TStateObject[K];
      }) = { updateType, value };
    } else {
      let allValues;
      if (Array.isArray(prevUpdate.value)) {
        /* eslint-disable @typescript-eslint/no-unsafe-assignment */
        /* eslint-disable @typescript-eslint/no-explicit-any */
        allValues = [...prevUpdate.value, ...(value as any)];
        /* eslint-enable @typescript-eslint/no-explicit-any */
        /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      } else {
        allValues = value;
      }
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (this._pendingUpdates[stateName] as any) = {
        /* eslint-enable @typescript-eslint/no-explicit-any */
        updateType: UPDATE_TYPE.PUSH,
        value: allValues,
      };
    }

    if (updateType === UPDATE_TYPE.REPLACE) {
      this._currentState[stateName] = value;
    } else if (updateType === UPDATE_TYPE.PUSH) {
      if (!Array.isArray(value)) {
        return;
      }
      if (this._currentState[stateName] === undefined) {
        this._currentState[stateName] = value;
      } else if (!Array.isArray(this._currentState[stateName])) {
        return;
      } else {
        const prevValue = this._currentState[stateName];
        if (!Array.isArray(prevValue)) {
          this._currentState[stateName] = value;
        } else {
          /* eslint-disable @typescript-eslint/no-unsafe-argument */
          /* eslint-disable @typescript-eslint/no-explicit-any */
          (prevValue as any[]).push(...(value as any));
          /* eslint-enable @typescript-eslint/no-explicit-any */
          /* eslint-enable @typescript-eslint/no-unsafe-argument */
        }
      }
    } else {
      console.error("Unknown state updateType", updateType);
    }
  }

  /**
   * Call callbacks registered for all state property updated (though the
   * `updateState` method) since the last `commitUpdates` call.
   */
  public commitUpdates(): void {
    const currUpdates = this._pendingUpdates;
    this._pendingUpdates = {};
    const allkeys = Object.keys(currUpdates) as Array<keyof TStateObject>;
    allkeys.forEach((stateName: keyof TStateObject) => {
      if (this._callbacks[stateName] === undefined) {
        return;
      }
      /* eslint-disable @typescript-eslint/no-explicit-any */
      /* eslint-disable @typescript-eslint/no-unsafe-assignment */
      const { updateType, value } = currUpdates[stateName] as any;
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      (this._callbacks[stateName] as any[]).slice().forEach((cb) => {
        if (!(this._callbacks[stateName] as any[]).includes(cb)) {
          /* eslint-enable @typescript-eslint/no-explicit-any */
          return;
        }
        try {
          /* eslint-disable @typescript-eslint/no-unsafe-call */
          cb(updateType, value);
          /* eslint-enable @typescript-eslint/no-unsafe-call */
        } catch (err) {
          console.warn("Subscription threw an error", err);
        }
      });
    });
  }

  /**
   * Subscribe a new callback for when the state property described by
   * `stateName` has been updated _AND_ `commitUpdates` has been called.
   *
   * You can unsubscribe this callback at any time, either by:
   *   - Calling the function returned here
   *   - Calling `unsubscribe` with the same `stateName` and `cb` arguments.
   *
   * @param {string} stateName - The state property you wish to listen to
   * updates to.
   * @param {Function} cb - Callback that will be called once the state property
   * has been updated and `commitUpdates` has been called.
   * This callback takes the following arguments:
   *   1. updateType (`string`): The update type of the state property update,
   *      @see UPDATE_TYPE
   *      Note that it can also be set to `"initial"` for the first `cb` call
   *      if, and only if, the `includeCurrent` argument has been set to `true`.
   *   2. value (`*`): The value accompanying this update type.
   *      Note that if `updateType` is set to `"initial"`, this will be the
   *      current value of the state property.
   * @param {boolean|undefined} [includeCurrent=false] - If set to `true`, `cb`
   * will be synchronously called with as arguments:
   *   1. An `"initial"` updateType argument. This is an otherwise inexistant
   *   update type, just used for this situation.
   *   2. The current value of the state property.
   * @returns {Function} - Function allowing to easily unsubscribe this
   * callback. You can either call this function or the `unsubscribe` method,
   * depending on what's more convenient for you.
   */
  public subscribe<P extends keyof TStateObject>(
    stateName: P,
    cb: (updateType: UPDATE_TYPE | "initial", value: TStateObject[P]) => void,
    includeCurrent: true,
  ): () => void;
  public subscribe<P extends keyof TStateObject>(
    stateName: P,
    cb: StateListenerFunction<TStateObject, P>,
  ): () => void;
  public subscribe<P extends keyof TStateObject>(
    stateName: P,
    cb: (
      /* eslint-disable @typescript-eslint/no-explicit-any */
      updateType: any,
      /* eslint-enable @typescript-eslint/no-explicit-any */
      value: TStateObject[P],
    ) => void,
    includeCurrent?: true,
  ): () => void {
    let currentCbs = this._callbacks[stateName];
    if (currentCbs === undefined) {
      currentCbs = [];
      this._callbacks[stateName] = currentCbs;
    }
    currentCbs.push(cb);
    if (includeCurrent === true) {
      try {
        cb("initial", this._currentState[stateName] as TStateObject[P]);
      } catch (err) {
        console.warn("Subscription threw an error", err);
      }
    }
    return () => {
      this.unsubscribe(stateName, cb);
    };
  }

  /**
   * Unsubscribe a callback subscribed through the subscribe method.
   * @param {string} stateName - The state property which was subscribed to.
   * @param {Function} cb - The callback given on the corresponding `subscribe`
   * call.
   */
  public unsubscribe<P extends keyof TStateObject>(
    stateName: P,
    cb:
      | ((updateType: UPDATE_TYPE | "initial", value: TStateObject[P]) => void)
      | ((updateType: UPDATE_TYPE, value: TStateObject[P]) => void),
  ): void {
    const cbs = this._callbacks[stateName];
    if (cbs === undefined) {
      console.error("Unsubscribing inexistant subscription.");
      return;
    }
    let initialCheck = true;
    while (true) {
      const indexOf = cbs.indexOf(cb);
      if (indexOf === -1) {
        if (initialCheck) {
          console.error("Unsubscribing inexistant subscription.");
        }
        return;
      }
      cbs.splice(indexOf, 1);
      if (cbs.length === 0) {
        delete this._callbacks[stateName];
        return;
      }
      initialCheck = false;
    }
  }

  /**
   * Free all resources used by this `ObservableState` instance.
   */
  public dispose(): void {
    this._currentState = {};
    this._pendingUpdates = {};
    this._callbacks = {};
  }
}
