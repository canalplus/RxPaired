import { readFile, writeFile } from "fs";
import {
  DeviceInitData,
  LogHistoryData,
  TokenMetadata,
  TokenType,
} from "./active_tokens_list.js";
import logger from "./logger.js";

/**
 * Class handling the optional storage on-file of persistent tokens so they can
 * be retrieved when the server is restarted.
 *
 * @class PersistentTokensStorage
 */
export default class PersistentTokensStorage {
  /**
   * Persistent tokens retrieved from the file indicated by path.
   *
   * Empty array if no file has been read, if it does not exist or if no data
   * has been stored until now.
   */
  private _tokens: TokenMetadata[];

  /**
   * Path where the file storing the persistent tokens can be found.
   * `undefined` if not initialized.
   */
  private _path: string | undefined;

  /**
   * Create a new PersistentTokensStorage.
   */
  constructor() {
    this._tokens = [];
    this._path = undefined;
  }

  /**
   * Reads the persistent tokens file if it exists and resolve with the
   * resulting parsed persistent token information if it contains some.
   *
   * Resolve with an empty array if either of these conditions is untrue.
   *
   * @param {string} path - Path where the file which should be read and written
   * to is.
   * @returns {Promise.<Array.<Object>>} - Parsed persistent token information
   * found in the file at the communicated path.
   */
  public initializeWithPath(path: string): Promise<TokenMetadata[]> {
    this._tokens = [];
    this._path = path;
    return new Promise((res) => {
      readFile(path, null, (err, data) => {
        if (err !== null) {
          logger.log("No persistent file found: " + path);
          res([]);
          return;
        }
        logger.log("Persistent file found: " + path);
        try {
          const json = data.toString();
          const formatted = JSON.parse(json) as StoredTokenMetadata[];
          let isWellFormatted = true;
          if (Array.isArray(formatted)) {
            for (const item of formatted) {
              if (
                typeof item.date !== "number" ||
                typeof item.expirationDate !== "number" ||
                typeof item.tokenId !== "string" ||
                typeof item.initData !== "object" ||
                typeof item.history !== "object"
              ) {
                isWellFormatted = false;
                break;
              } else if (
                !Array.isArray(item.history.history) ||
                typeof item.history.maxHistorySize !== "number"
              ) {
                isWellFormatted = false;
                break;
              } else if (
                item.history.history.some((h) => typeof h !== "string")
              ) {
                isWellFormatted = false;
                break;
              } else if (item.initData !== null) {
                if (
                  typeof item.initData.dateMs !== "number" ||
                  typeof item.initData.timestamp !== "number" ||
                  (item.initData.version !== undefined &&
                    item.initData.version !== 2) ||
                  (item.initData.version === 2 &&
                    (item.initData.time !== "capture" ||
                      item.initData.offset !== "app-capture")) ||
                  (item.initData.version === undefined &&
                    (item.initData.time !== undefined ||
                      item.initData.offset !== undefined))
                ) {
                  isWellFormatted = false;
                  break;
                }
              }
            }
          }
          if (isWellFormatted) {
            const date = Date.now();
            this._tokens = formatted.reduce((acc: TokenMetadata[], f) => {
              if (f.expirationDate <= date) {
                console.log("FFOFE", f.expirationDate, date);
                return acc;
              }
              const md = new TokenMetadata(
                TokenType.Persistent,
                f.tokenId,
                f.history.maxHistorySize,
                f.expirationDate - date,
                f.date,
              );
              md.setDeviceInitData(f.initData);
              f.history.history.forEach((h) => {
                md.addLogToHistory(h);
              });
              acc.push(md);
              return acc;
            }, []);
          } else {
            logger.warn("Persistent tokens file not well formatted");
          }
        } catch (error) {
          /* eslint-disable */
          const errToStr: string =
            typeof (error as null | undefined | { message?: unknown })
              ?.message !== "string"
              ? "Unknown Error"
              : ((error as null | undefined | { message?: unknown })
                  ?.message as string);
          /* eslint-enable */
          logger.warn("Could not open persistent token file: " + errToStr);
        }
        if (this._tokens.length > 0) {
          logger.log(
            "Found stored persistent tokens: " + String(this._tokens.length),
          );
        }
        res(this._tokens);
      });
    });
  }

  /**
   * Push a new persistent token to the storage (if one is set), so it can be
   * retrieved even after the server restarts.
   * @param {Object} tokenMetadata
   */
  public addToken(tokenMetadata: TokenMetadata) {
    if (this._path === undefined) {
      return;
    }
    const now = performance.now();
    const date = Date.now();
    const tokens = this._tokens.filter((t) => {
      return (
        t.getExpirationDelay(now) > 0 && t.tokenId !== tokenMetadata.tokenId
      );
    });
    tokens.push(tokenMetadata);

    const toStore: StoredTokenMetadata[] = tokens.map((t) => {
      return {
        tokenId: t.tokenId,
        expirationDate: date + t.getExpirationDelay(now),
        date: t.date,
        initData: t.getDeviceInitData(),
        history: t.getCurrentHistory(),
      };
    });
    writeFile(this._path, JSON.stringify(toStore), null, (error) => {
      if (error !== null) {
        /* eslint-disable */
        const errToStr: string =
          typeof (error as null | undefined | { message?: unknown })
            ?.message !== "string"
            ? "Unknown Error"
            : ((error as null | undefined | { message?: unknown })
                ?.message as string);
        /* eslint-enable */
        logger.warn("Could not open persistent token file: " + errToStr);
      }
    });
  }
}

/** Information on persistent tokens as stored on disk */
export interface StoredTokenMetadata {
  /**
   * ID identifying this token.
   * Used by inspectors and devices connecting through it.
   */
  tokenId: string;

  /** Value of `date.now()` at the time the TokenMetadata was created. */
  expirationDate: number;

  /** Value of `date.now()` at which the token should be removed. */
  date: number;

  /**
   * Initialization data received when the device connected with this
   * token.
   */
  initData: DeviceInitData | null;

  /**
   * History of the most recent logs associated with this token.
   */
  history: LogHistoryData;
}
