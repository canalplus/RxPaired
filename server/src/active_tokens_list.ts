import { performance } from "perf_hooks";
import WebSocket from "ws";

export default class ActiveTokensList {
  /** List of token currently used. */
  private _tokensList: TokenMetadata[];

  constructor(initialList: TokenMetadata[]) {
    this._tokensList = initialList;
  }

  /**
   * Create a new token with a given ID and log history size.
   * @param {string} tokenType
   * @param {string} tokenId
   * @param {number} historySize
   * @param {number} expirationDelay - Delay, in milliseconds, after which the
   * token should be revokated.
   * This revokation is not handled by the `ActiveTokensList` class which only
   * acts as a metadata store.
   *
   * Set this value to `undefined` to not store any expiration alongside the
   * `TokenMetadata` created.
   * @returns {Object}
   */
  public create(
    tokenType: TokenType,
    tokenId: string,
    historySize: number,
    expirationDelay: number,
  ): TokenMetadata {
    const tokenMetadata = new TokenMetadata(
      tokenType,
      tokenId,
      historySize,
      expirationDelay,
    );
    this._tokensList.push(tokenMetadata);
    return tokenMetadata;
  }

  /**
   * Returns public information that can be accessed by inspectors about all
   * active tokens.
   * @returns {Array.<Object>}
   */
  public getList(): TokenMetadata[] {
    return this._tokensList;
  }

  /**
   * Retrieve an active token from its index number (which can be from `0` to
   * one minus the list's size that can be known by calling the `size` method).
   *
   * Returns `undefined` if there's no token at that index.
   * @param {number} idx
   * @returns {Object|undefined}
   */
  public getFromIndex(idx: number): TokenMetadata | undefined {
    return this._tokensList[idx];
  }

  /**
   * Removes an active token from its index number (which can be from `0` to
   * one minus the list's size that can be known by calling the `size` method).
   *
   * Returns `undefined` if there was no token at that index or the
   * corresponding `TokenMetadata` if there was.
   * @param {number} idx
   * @returns {Object|undefined}
   */
  public removeIndex(idx: number): TokenMetadata | undefined {
    return this._tokensList.splice(idx, 1)[0];
  }

  /**
   * Returns the number of currently active tokens in this `ActiveTokensList`.
   *
   * This value can then be used to infer all "indexes" that can be given to
   * methods such as `getFromIndex` or `removeIndex`.
   * @returns {number}
   */
  public size(): number {
    return this._tokensList.length;
  }

  /**
   * Get the index number of the first token stored which has the given
   * `tokenId`.
   * Returns `-1` if no token uses that id.
   * @param {string} tokenId
   * @returns {number}
   */
  public findIndex(tokenId: string): number {
    return this._tokensList.findIndex((t) => t.tokenId === tokenId);
  }

  /**
   * Get the `TokenMetadata` object of the first token stored which has the
   * given `tokenId`.
   * Returns `undefined` if no token uses that id.
   * @param {string} tokenId
   * @returns {Object|undefined}
   */
  public find(tokenId: string): TokenMetadata | undefined {
    return this._tokensList.find((t) => t.tokenId === tokenId);
  }
}

/** First metadata received when a device connects with a token. */
export interface DeviceInitData {
  /**
   * Monotically increasing timestamp at which this Initialization data was
   * generated on the device, in milliseconds.
   */
  timestamp: number;
  /**
   * Unix timestamp on the device when this Initialization data was generated,
   * in milliseconds.
   */
  dateMs: number;
}

/**
 * Log history stored with a `TokenMetadata`.
 */
export interface LogHistoryData {
  /** Logs from the most ancient to the newest. */
  history: string[];
  /** Maximum amount of logs that will be kept in this history. */
  maxHistorySize: number;
}

/**
 * For a given token ID, list store all inspectors and the potential device linked
 * to it.
 * @class TokenMetadata
 */
export class TokenMetadata {
  /**
   * ID identifying this token.
   * Used by inspectors and devices connecting through it.
   */
  public tokenId: string;

  /** Value of `performance.now()` at the time the TokenMetadata was created. */
  public timestamp: number;

  /** The type of token created (@see TokenType) */
  public tokenType: TokenType;

  /**
   * Value of `performance.now()` when the TokenMetadata should be removed.
   * If `undefined`, default rules apply.
   */
  private _expirationMs: number;

  /** Value of `date.now()` at the time the TokenMetadata was created. */
  public date: number;

  /**
   * Information on each web "inspector" (remote debugger) connected with this
   * token.
   */
  public inspectors: Array<{
    /** Corresponding WebSocket on which logs are sent. */
    webSocket: WebSocket.WebSocket;
    /**
     * Store Timer ID of the interval at which `"ping"` messages are sent to
     * ensure the connection isn't closed by some mechanism (for example a
     * server watcher closing down the connection when it seems to be unused).
     */
    pingInterval: ReturnType<typeof setInterval>;
  }>;

  /**
   * The device running with this token.
   * `null` if there's no device connected with it.
   *
   * There cannot be multiple devices connected with the same token.
   */
  public device: DeviceInfo | null;

  /**
   * Store Timer ID of the interval at which `"ping"` messages are sent to the
   * device to ensure the connection isn't closed by some mechanism (for example
   * a server watcher closing down the connection when it seems to be unused).
   */
  public pingInterval: ReturnType<typeof setInterval> | null;

  /**
   * Initialization data received when the device connected with this
   * token.
   */
  private _initData: DeviceInitData | null;

  /**
   * History of the most recent logs associated with this token.
   */
  private _history: LogHistoryData;

  /**
   * @param {string} tokenType
   * @param {string} tokenId - ID identifying the token
   * @param {number} historySize - Maximum number of logs kept in the log
   * history associated with this token.
   * @param {number} expirationDelay - Delay, in milliseconds, after which the
   * token should be revokated.
   * This revokation is not handled by the `TokenMetadata` class which only acts
   * as a metadata store.
   * @param {number|undefined} [originalDate] - If set, this is the original unix
   * timestamp at which this token was created.
   * Note that this may result on this token's `timestamp` property being set as
   * a negative value.
   */
  constructor(
    tokenType: TokenType,
    tokenId: string,
    historySize: number,
    expirationDelay: number,
    originalDate?: number | undefined,
  ) {
    this.tokenType = tokenType;
    this.tokenId = tokenId;
    if (originalDate === undefined) {
      this.timestamp = performance.now();
      this._expirationMs = this.timestamp + expirationDelay;
      this.date = Date.now();
    } else {
      const now = performance.now();
      this.date = originalDate;
      this.timestamp = originalDate - Date.now() + now;
      this._expirationMs = now + expirationDelay;
    }
    this.inspectors = [];
    this.device = null;
    this.pingInterval = null;
    this._initData = null;
    this._history = {
      history: [],
      maxHistorySize: historySize,
    };
  }

  public updateExpirationDelay(newDelay: number) {
    this._expirationMs = performance.now() + newDelay;
  }

  /**
   * Get the amount of milliseconds after which the token will be expired, from
   * the given `timeRef` if set (has to be relative to `performance.now()`) or
   * to `performance.now()` if unset.
   * @param {number|undefined} [timeRef]
   * @returns {number}
   */
  public getExpirationDelay(timeRef?: number | undefined): number {
    return this._expirationMs - (timeRef ?? performance.now());
  }

  /**
   * Update of reset the `DeviceInitData` associated with this `TokenMetadata`.
   * @param {Object|null} initData
   */
  public setDeviceInitData(initData: DeviceInitData | null): void {
    this._initData = initData;
    this._history.history = [];
  }

  /**
   * Get the `DeviceInitData` associated with this `TokenMetadata`.
   * Returns `null` if no `DeviceInitData` is associated.
   * @returns {Object|null}
   */
  public getDeviceInitData(): DeviceInitData | null {
    return this._initData;
  }

  /**
   * Add a new log to this token's log history.
   * Removes the most ancient log if the maximum history size is already
   * reached.
   * @param {string} log - The Log line to add to history
   */
  public addLogToHistory(log: string): void {
    if (this._history.maxHistorySize === 0) {
      return;
    }
    if (this._history.history.length >= this._history.maxHistorySize) {
      this._history.history.shift();
    }
    this._history.history.push(log);
  }

  /**
   * Returns the current log history associated with this token.
   * @returns {Object}
   */
  public getCurrentHistory(): { history: string[]; maxHistorySize: number } {
    return this._history;
  }
}

export enum TokenType {
  /**
   * Such tokens only are removed once their expiration date is reached, and may
   * be saved to disk if the right server options are set so it remains at
   * server reboot.
   */
  Persistent,
  /**
   * Such tokens have been created by an inspector page and will be removed
   * either when they expire **OR** when no inspector is listening to it
   * anymore.
   */
  FromInspector,
  /**
   * Such tokens have been created by a device's script and will be removed
   * either when they expire **OR** when no inspector is listening to it
   * anymore.
   */
  FromDevice,
}

export type DeviceInfo =
  /** The device linked to that token is maintaining a WebSocket connection. */
  | {
      type: "websocket";
      value: WebSocket.WebSocket;
    }
  /** The device linked to that token is sending logs through HTTP POST. */
  | {
      type: "http";
      value: {
        /**
         * Value of `performance.now()` the first time a device sent logs with
         * that token under the current session.
         */
        firstConnectionTimestamp: number;
        /**
         * Value of `performance.now()` the last time a device sent logs with
         * that token under the current session.
         */
        lastConnectionTimestamp: number;
        /**
         * Return value of the `setInterval` maintained to check that that
         * token seem still in usage.
         */
        checkAliveIntervalId: ReturnType<typeof setInterval>;
      };
    };
