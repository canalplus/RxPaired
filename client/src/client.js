/*! ~~~ This script should be included through a `<script>` tag before all other `<script>` tags in your HTML page. ~~~ */
/*!
 * +-------------------------------------------------------------------------+
 * | Only if you copy-pasted that script, you may set the `__FORCED_TOKEN__` |
 * | variable below to the token you generated on the inspector.             |
 * |                                                                         |
 * | Example: `var __FORCED_TOKEN__ = "mytoken";`                            |
 * +-------------------------------------------------------------------------+
 */
const __FORCED_TOKEN__ = "";

/*!
 * +-------------------------------------------------------------------------+
 * | Only if you proxified RxPaired-server (for example because you used an  |
 * | HTTPS tunneling tool like localtunnel or ngrok), you can set the        |
 * | variable below to the URL of your new server.                           |
 * |                                                                         |
 * | Example: `var __FORCED_SERVER_URL__ = "https://abcdef.ngrok.app";`      |
 * +-------------------------------------------------------------------------+
 */
const __FORCED_SERVER_URL__ = "";
/*!
 *
 */

function init(currentScriptSrc, playerClass, silent) {
  /**
   * URL relied on to exchange with the RxPaired server when a WebSocket
   * connection is established.
   */
  let wsUrl = __RX_PAIRED_SERVER_URL__;
  if (__FORCED_SERVER_URL__ !== "") {
    if (/^https?:\/\//i.test(__FORCED_SERVER_URL__)) {
      wsUrl = "ws" + __FORCED_SERVER_URL__.substring(4);
    } else {
      wsUrl = __FORCED_SERVER_URL__;
    }
  }
  // Remove trailing slash
  if (wsUrl.length > 0 && wsUrl[wsUrl.length - 1] === "/") {
    wsUrl = wsUrl.substring(0, wsUrl.length - 1);
  }

  /** "Token" associated to this device's log. */
  let token = __FORCED_TOKEN__;
  if (token === "") {
    if (typeof _BUILD_TIME_TOKEN_VALUE_ === "string") {
      token = _BUILD_TIME_TOKEN_VALUE_;
    } else if (currentScriptSrc == null) {
      return;
    } else {
      const indexOfNumSign = currentScriptSrc.indexOf("#");
      if (indexOfNumSign === -1) {
        return;
      }
      token = currentScriptSrc.substring(indexOfNumSign + 1);
    }
  }

  /** To set to true if you also want to log when xhr are received / sent */
  const SHOULD_LOG_REQUESTS = true;

  /**
   * This script may fallback to HTTP POST if WebSockets are unavailable on the
   * current device.
   *
   * To avoid doing too many POST requests, we regroup multiple logs and send
   * them at once.
   * This `TARGET_POST_INTERVAL_MS` value is the amount of time in
   * milliseconds we will want to wait between requests.
   */
  const TARGET_POST_INTERVAL_MS = 2000;

  /**
   * Either set to `"WebSocket"` if we began exchanging messages through
   * WebSockets, to `"POST"`, if we began exchanging messages through HTTP POST
   * requests, or to `undefined` if we did not yet begin exchanging messages.
   */
  let currentMode;

  /** WebSocket connection used for debugging. */
  let socket;

  /** Unsent Log queue used before WebSocket initialization */
  const logQueue = [];

  /**
   * Maximum length a single log message can reach, longer logs will be
   * truncated.
   */
  const MAX_LOG_LENGTH = 2000;

  /** Method used to send log. */
  let sendLog = (log) => {
    /* Push to internal queue until initialization. */
    logQueue.push(log);
  };

  /**
   * Send specific Network-related log with the right format.
   * @param {string} log - The log message.
   */
  function sendNetworkLog(log) {
    const time = performance.now().toFixed(2);
    const logText = `${time} [Network] ${log}`;
    return sendLog(logText);
  }

  function processArg(arg) {
    let processed;
    switch (typeof arg) {
      case "function":
      case "symbol":
      case "bigint":
        processed = "";
        break;

      case "string":
      case "number":
      case "boolean":
      case "undefined":
        processed = arg;
        break;

      case "object":
        if (arg === null) {
          processed = "null";
        } else if (arg instanceof Error) {
          processed =
            "NAME: " +
            String(arg.name) +
            " ~ CODE: " +
            String(arg.code) +
            " ~ MESSAGE: " +
            String(arg.message);
        } else {
          processed = "{}";
        }
        break;
      default:
        processed = "";
        break;
    }
    if (typeof processed === "string" && processed.length > MAX_LOG_LENGTH) {
      return processed.substring(0, MAX_LOG_LENGTH - 1) + "…";
    }
    return processed;
  }

  const spyRemovers = ["log", "error", "info", "warn", "debug"].map((meth) => {
    const oldConsoleFn = console[meth];
    const namespace = `[${meth}]`;
    console[meth] = function (...args) {
      const argStr = args.map(processArg).join(" ");

      // The RxPlayer might already have set the timestamp + namespace format
      if (
        args.length >= 3 &&
        args[1] === namespace &&
        /^\d+\.\d+$/.test(args[0])
      ) {
        sendLog(argStr);
      } else {
        // Else, add it now
        const time = performance.now().toFixed(2);
        sendLog(`${time} ${namespace} ${argStr}`);
      }
      if (!Boolean(silent)) {
        return oldConsoleFn.apply(this, args);
      }
    };
    return function () {
      console[meth] = oldConsoleFn;
    };
  });

  if (typeof window === "object" && window !== null) {
    window.addEventListener("error", onGlobalError);
    spyRemovers.push(() => {
      window.removeEventListener("error", onGlobalError);
    });
    window.addEventListener("unhandledrejection", onGlobalError);
    spyRemovers.push(() => {
      window.removeEventListener("unhandledrejection", onGlobalError);
    });
  }

  if (SHOULD_LOG_REQUESTS) {
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      const method = arguments[0];
      const url = arguments[1];
      if (typeof method !== "string" || typeof url !== "string") {
        return originalXhrOpen.apply(this, arguments);
      }
      this.addEventListener("load", function () {
        sendNetworkLog(
          `Loaded ${method} XHR from: ${url} ` + `(status: ${this.status})`,
        );
      });
      this.addEventListener("error", function () {
        sendNetworkLog(`Errored ${method} XHR from: ${url}`);
      });
      this.abort = function () {
        sendNetworkLog(`Aborted ${method} XHR from: ${url}`);
        return XMLHttpRequest.prototype.abort.apply(this, arguments);
      };
      this.send = function () {
        sendNetworkLog(`Sending ${method} XHR to: ${url}`);
        return XMLHttpRequest.prototype.send.apply(this, arguments);
      };
      return originalXhrOpen.apply(this, arguments);
    };
    spyRemovers.push(function () {
      XMLHttpRequest.prototype.open = originalXhrOpen;
    });

    const originalFetch = window.fetch;
    window.fetch = function () {
      let url;
      let method;
      if (arguments[0] == null) {
        url = undefined;
      } else if (typeof arguments[0] === "string") {
        url = arguments[0];
      } else if (arguments[0] instanceof URL) {
        url = arguments[0].href;
      } else if (typeof arguments[0].url === "string") {
        url = arguments[0].url;
      } else {
        try {
          url = arguments[0].toString();
        } catch (_) {}
      }
      if (arguments[0] == null) {
        method = "GET";
      } else if (typeof arguments[0].method === "string") {
        method = arguments[0].method;
      } else if (
        arguments[1] != null &&
        typeof arguments[1].method === "string"
      ) {
        method = arguments[1].method;
      } else {
        method = "GET";
      }
      sendNetworkLog(`Sending ${method} fetch to: ${url}`);
      const realFetch = originalFetch.apply(this, arguments);
      return realFetch.then(
        (res) => {
          sendNetworkLog(
            `Loaded ${method} fetch from: ${url} ` + `(status: ${res.status})`,
          );
          return res;
        },
        (err) => {
          sendNetworkLog(`Errored/Aborted ${method} fetch from: ${url}`);
          throw err;
        },
      );
    };
    spyRemovers.push(function () {
      window.fetch = originalFetch;
    });
  }

  sendLog("Init v1 " + performance.now() + " " + Date.now());

  const TextDecoder =
    typeof window !== "object"
      ? null
      : typeof window.TextDecoder !== "function"
        ? null
        : window.TextDecoder;
  const escape = window.escape;

  /**
   * Function to trigger when there's a global uncaught error, such as on window.
   * @param {*} err
   */
  function onGlobalError(err) {
    if (err && err.error) {
      formatAndSendLog("UncaughtError", processArg(err.error));
    } else if (err && err.reason) {
      formatAndSendLog("UncaughtError", processArg(err.reason));
    } else {
      formatAndSendLog("UncaughtError", processArg(err));
    }
  }

  /**
   * Send log with the given namespace and log message in the right format for
   * the RxPaired server.
   * @param {string} namespace
   * @param {string} log
   */
  function formatAndSendLog(namespace, log) {
    const time = performance.now().toFixed(2);
    sendLog(`${time} [${namespace}] ${log}`);
  }

  /**
   * Creates a string from the given Uint8Array containing utf-8 code units.
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  function utf8ToStr(data) {
    if (TextDecoder !== null) {
      try {
        // TextDecoder use UTF-8 by default
        const decoder = new TextDecoder();
        return decoder.decode(data);
      } catch (e) {}
    }

    let uint8 = data;

    // If present, strip off the UTF-8 BOM.
    if (uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
      uint8 = uint8.subarray(3);
    }

    // We're basically doing strToUtf8 in reverse.
    // You can look at that other function for the whole story.

    // Generate string containing escaped UTF-8 code units
    const utf8Str = stringFromCharCodes(uint8);

    let escaped;
    if (typeof escape === "function") {
      // Transform UTF-8 escape sequence into percent-encoded escape sequences.
      escaped = escape(utf8Str);
    } else {
      // Let's implement a simple escape function
      // http://ecma-international.org/ecma-262/9.0/#sec-escape-string
      const nonEscapedChar = /[A-Za-z0-9*_+-./]/;
      escaped = "";
      for (let i = 0; i < utf8Str.length; i++) {
        if (nonEscapedChar.test(utf8Str[i])) {
          escaped += utf8Str[i];
        } else {
          const charCode = utf8Str.charCodeAt(i);
          escaped +=
            charCode >= 256
              ? "%u" + intToHex(charCode, 4)
              : "%" + intToHex(charCode, 2);
        }
      }
    }

    // Decode the percent-encoded UTF-8 string into the proper JS string.
    // Example: "g#%E3%82%AC" -> "g#€"
    return decodeURIComponent(escaped);
  }

  /**
   * Creates a new string from the given array of char codes.
   * @param {Uint8Array} args
   * @returns {string}
   */
  function stringFromCharCodes(args) {
    const max = 16000;
    let ret = "";
    for (let i = 0; i < args.length; i += max) {
      const subArray = args.subarray(i, i + max);

      // NOTE: ugly I know, but TS is problematic here (you can try)
      ret += String.fromCharCode.apply(null, subArray);
    }
    return ret;
  }

  /**
   * Transform an integer into an hexadecimal string of the given length, padded
   * to the left with `0` if needed.
   * @example
   * ```
   * intToHex(5, 4); // => "0005"
   * intToHex(5, 2); // => "05"
   * intToHex(10, 1); // => "a"
   * intToHex(268, 3); // => "10c"
   * intToHex(4584, 6) // => "0011e8"
   * intToHex(123456, 4); // => "1e240" (we do nothing when going over 4 chars)
   * ```
   * @param {number} num
   * @param {number} size
   * @returns {string}
   */
  function intToHex(num, size) {
    const toStr = num.toString(16);
    return toStr.length >= size
      ? toStr
      : new Array(size - toStr.length + 1).join("0") + toStr;
  }

  function decycle(obj) {
    const encounteredRefs = new WeakMap();
    return (function recursivelyDecycle(value, path) {
      if (
        typeof value !== "object" ||
        value === null ||
        value instanceof Boolean ||
        value instanceof Date ||
        value instanceof Number ||
        value instanceof RegExp ||
        value instanceof String
      ) {
        const old_path = encounteredRefs.get(value);
        if (old_path !== undefined) {
          return { $cycle: old_path };
        }
        encounteredRefs.set(value, path);
        let newVal;
        if (Array.isArray(value)) {
          newVal = [];
          value.forEach(function (element, i) {
            newVal[i] = recursivelyDecycle(element, path + "[" + i + "]");
          });
        } else {
          newVal = {};
          Object.keys(value).forEach(function (name) {
            newVal[name] = recursivelyDecycle(
              value[name],
              path + "[" + JSON.stringify(name) + "]",
            );
          });
        }
        return newVal;
      } else if (typeof value === "bigint") {
        return "$BigInt(" + obj.toString() + ")";
      } else {
        return value;
      }
    })(obj, "$");
  }

  function safeJsonStringify(val) {
    try {
      return JSON.stringify(val);
    } catch (err) {
      try {
        return JSON.stringify(decycle(val));
      } catch (err2) {
        const message =
          err2 != null && typeof err2.message === "string"
            ? err2.message
            : "undefined error";
        // Should not happen, but still...
        console.error("---- Could not stringify object: " + message + " ----");
        return "{}";
      }
    }
  }

  setTimeout(() => {
    if (currentMode === undefined) {
      // Still not in WebSocket nor HTTP POST mode -> begin fallbacking to HTTP
      // POST
      fallbackToPostRequests();
    }
  }, 10000);

  try {
    socket = new WebSocket(wsUrl + "/" + token);
  } catch (_) {}

  if (socket === undefined) {
    fallbackToPostRequests();
    return;
  }

  socket.addEventListener("open", function () {
    currentMode = "WebSocket";
    sendLog = (log) => socket.send(log);
    for (const log of logQueue) {
      sendLog(log);
    }
    logQueue.length = 0;
  });

  socket.addEventListener("error", fallbackToPostRequests);
  socket.addEventListener("close", () => {
    if (currentMode === undefined) {
      // Closing socket before beginning message exchanges, fallback
      fallbackToPostRequests();
    }
  });

  socket.addEventListener("message", function (event) {
    if (event == null || event.data == null) {
      console.error("RxPaired: No message received from WebSocket");
      return;
    }

    let formattedObj;
    try {
      let messageStr;
      if (typeof event.data === "string") {
        messageStr = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        messageStr = utf8ToStr(new Uint8Array(event.data));
      } else {
        throw new Error("Unknown format");
      }
      if (messageStr === "ping") {
        socket.send("pong");
        return;
      } else if (messageStr === "ack") {
        return;
      }
      formattedObj = JSON.parse(messageStr);
    } catch (formattingError) {
      console.error(
        "Unrecognized message format received from WebSocket: " +
          "not an UTF-8-encoded JSON",
      );
      return;
    }

    if (formattedObj.type === "eval") {
      if (
        typeof formattedObj.value !== "object" ||
        formattedObj.value === null ||
        typeof formattedObj.value.instruction !== "string" ||
        typeof formattedObj.value.id !== "string"
      ) {
        console.error("RxPaired: Evaluation value in the wrong format");
        return;
      }
      let val;
      let instructionId = formattedObj.value.id;
      try {
        // Contrary to popular belief eval is the best and surest function ever
        val = evaluate(formattedObj.value.instruction);
        // handle the case where instruction is async
        if (typeof window.Promise === "function" && val instanceof Promise) {
          val
            .then((value) => {
              sendSuccessToSocket(value, socket, instructionId);
            })
            .catch((err) => {
              sendErrorToSocket(err, socket, instructionId);
            });
        } else {
          sendSuccessToSocket(val, socket, instructionId);
        }
      } catch (err) {
        sendErrorToSocket(err, socket, instructionId);
      }
    }
  });

  function sendErrorToSocket(err, socket, instructionId) {
    const errorMessage =
      typeof err?.message === "string" ? err.message : undefined;
    const errorName = typeof err?.name === "string" ? err.name : undefined;
    socket.send(
      safeJsonStringify({
        type: "eval-error",
        value: {
          error: { message: errorMessage, name: errorName },
          id: instructionId,
        },
      }),
    );
  }

  function sendSuccessToSocket(val, socket, instructionId) {
    socket.send(
      safeJsonStringify({
        type: "eval-result",
        value: {
          data: processEvalReturn(val),
          id: instructionId,
        },
      }),
    );
  }

  function processEvalReturn(val) {
    let processed;
    switch (typeof val) {
      case "function":
      case "symbol":
      case "bigint":
        processed = val.toString();
        break;

      case "string":
        processed = JSON.stringify(val);
        break;
      case "number":
      case "boolean":
      case "undefined":
        processed = val;
        break;

      case "object":
        try {
          processed = safeJsonStringify(val);
        } catch (_) {}
        break;
      default:
        processed = "";
        break;
    }
    if (typeof processed === "string" && processed.length > MAX_LOG_LENGTH) {
      return processed.substring(0, MAX_LOG_LENGTH - 1) + "…";
    }
    return processed;
  }

  /**
   * Fallback from the default WebSocket-based message exchange protocol, to the
   * HTTP POST one.
   * Don't do anything if we already fallbacked.
   */
  function fallbackToPostRequests() {
    if (currentMode === "POST") {
      // We already fallbacked, exit
      return;
    }
    currentMode = "POST";

    /**
     * Fallback HTTP URL relied on to exchange with the RxPaired server when
     * WebSockets are not available.
     */
    let fallbackHttpUrl;
    if (/^wss?:\/\//i.test(wsUrl)) {
      fallbackHttpUrl = "http" + wsUrl.substring(2);
    } else {
      fallbackHttpUrl = wsUrl;
    }

    /** Set to `true` when an HTTP POST request can be sent to send logs */
    let canSendPostRequest = true;

    /**
     * If we fallbacked to HTTP POST instead of a WebSocket, this value is the
     * result of a `performance.now` call at the time the last HTTP POST was
     * performed.
     */
    let lastHttpPostTimestamp = 0;

    /**
     * If we fallbacked to HTTP POST instead of a WebSocket, this value is set
     * to the timeout id (as returned by `setTimeout`) which will trigger an HTTP
     * POST. Set to `null` if no such timeout is set right now.
     */
    let postponedPostTimeout = null;

    /**
     * JSON-escaped strings for all logs that should be sent in the
     * next POST request.
     */
    let nextBody = [];

    try {
      socket?.close();
    } catch (_) {}

    // Empty the current log queue that hasn't yet been processed
    if (logQueue.length > 0) {
      for (const log of logQueue) {
        nextBody.push(JSON.stringify(log));
      }
    }
    logQueue.length = 0;

    sendLog = (log) => {
      nextBody.push(JSON.stringify(log));
      scheduleNextPostRequest();
    };

    scheduleNextPostRequest();

    /**
     * Send stored logs if the last request was judged to be enough time ago,
     * else, await some time before doing so.
     *
     * This function may be called multiple times without risks of conflicts.
     */
    function scheduleNextPostRequest() {
      const now = performance.now();
      if (now - lastHttpPostTimestamp >= TARGET_POST_INTERVAL_MS) {
        sendLogsWhenReady();
      } else {
        if (postponedPostTimeout !== null) {
          clearTimeout(postponedPostTimeout);
          postponedPostTimeout = null;
        }
        postponedPostTimeout = setTimeout(
          sendLogsWhenReady,
          TARGET_POST_INTERVAL_MS,
        );
      }
    }

    /**
     * Send awaiting logs if the last POST request succeeded.
     */
    function sendLogsWhenReady() {
      if (postponedPostTimeout !== null) {
        clearTimeout(postponedPostTimeout);
        postponedPostTimeout = null;
      }
      if (!canSendPostRequest) {
        postponedPostTimeout = setTimeout(
          sendLogsWhenReady,
          TARGET_POST_INTERVAL_MS,
        );
        return;
      }

      const data = "[" + nextBody.join(",") + "]";
      nextBody.length = 0;
      lastHttpPostTimestamp = performance.now();
      // As a poor man's request ordering algorithm, we only send POST one at a time
      canSendPostRequest = false;
      const xhr = new XMLHttpRequest();
      xhr.onload = function () {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          // When HTTP POSTing in !notoken mode, we're supposed to
          // update the token for subsequent requests with the response
          if (token === "!notoken" || token.substring(0, 9) === "!notoken/") {
            token = xhr.response;
          }
          canSendPostRequest = true;
        } else {
          // TODO: retry after exponential backoff?
          abort();
        }
      };
      // TODO: retry after exponential backoff?
      xhr.onerror = abort;
      xhr.ontimeout = abort;
      xhr.open("POST", fallbackHttpUrl + "/" + token);
      xhr.send(data);
    }
  }

  /**
   * Remove mocked functions and free taken resources.
   */
  function abort() {
    logQueue.length = 0;
    sendLog = () => {};
    spyRemovers.forEach((cb) => cb());
    spyRemovers.length = 0;
  }

  window.__RX_PLAYER_DEBUG_MODE__ = true;
  if (playerClass) {
    // Try to force the RxPlayer to redefine its console function.
    // May break at any time.
    playerClass.LogLevel = "DEBUG";
    playerClass.LogFormat = "full";
  }
}

function evaluate(obj) {
  return Function(`"use strict"; ${obj}`)();
}

if (document.currentScript !== null) {
  // Regular JavaScript script included in the page. Run it directly.
  init(document.currentScript.src, null);
} else {
  // Imported as an ES6 module.

  // We sadly cannot call `export` without breaking non-ES6 module cases, so we
  // define an ugly-named (to avoid potential conflicts) function in the global
  // scope instead.
  //
  // The importing script will then have to call it, communicating the module's
  // own URL in argument as an `url` property and the RxPlayer instance as a
  // `playerClass` property inside that function's unique object parameter.
  //
  // If the RxPlayer isn't imported yet, `playerClass` can be set to `null`.
  window.__RX_INSPECTOR_RUN__ = function run({ url, playerClass, silent }) {
    init(url, playerClass, silent);
  };
}
