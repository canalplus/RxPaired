import { appendFile } from "fs";
import { createServer, IncomingMessage } from "http";
import process from "process";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";
import ActiveTokensList, {
  TokenMetadata,
  TokenType,
} from "./active_tokens_list.js";
import logger from "./logger.js";
import parseOptions, { ParsedOptions } from "./option_parsing.js";
import PersistentTokensStorage from "./persistent_tokens_storage.js";
import createCheckers from "./safe_checks.js";
import { generatePassword } from "./utils.js";

/**
 * Regular expression to extract timestamp and date from the initial "Init" log
 * sent by devices.
 * The first number is the timestamp in milliseconds and the second the
 * corresponding date on the device at the time the timestamp was generated.
 */
const INIT_REGEX = /^Init v1 ([0-9]+(?:\.[0-9]+)?) ([0-9]+(?:\.[0-9]+)?)$/;

/**
 * A device can rely on HTTP POST when WebSockets are not available.
 *
 * In that situation, we need to infer when a token seems to not be used
 * anymore.
 * This value is sent to the amount of milliseconds from which we consider
 * a token as not linked to a device anymore when it was connected through
 * HTTP POST means and if it didn't send any message since.
 */
const TIMEOUT_HTTP_TOKEN = 30000;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  RxPairedServer(options).catch((err) => {
    console.error("Error while initializing RxPairedServer", err);
  });
}

export default async function RxPairedServer(options: ParsedOptions) {
  logger.setLogFile(options.logFile);

  const persistentTokensStorage = new PersistentTokensStorage();

  let activeTokensList: ActiveTokensList;
  if (options.persistentTokensFile !== null) {
    const stored = await persistentTokensStorage.initializeWithPath(
      options.persistentTokensFile,
    );
    activeTokensList = new ActiveTokensList(stored);
  } else {
    activeTokensList = new ActiveTokensList([]);
  }

  const deviceSocket = new WebSocketServer({ noServer: true });
  const htmlInspectorSocket =
    options.inspectorPort < 0
      ? null
      : new WebSocketServer({ port: options.inspectorPort });

  const server = createServer(function (req, response) {
    if (req.method === "POST") {
      let unparsedBody = "";
      const messages: string[] = [];
      const metadata = checkNewDeviceConnection(req);
      if (metadata === null) {
        return;
      }
      const { tokenId, logFileName, tokenMetadata } = metadata;
      writeLog("log", "Received authorized device HTTP connection", {
        address: req.socket.remoteAddress,
        tokenId,
      });

      const checkAliveIntervalId = setInterval(() => {
        if (tokenMetadata.device === null) {
          clearInterval(checkAliveIntervalId);
          return;
        }

        if (
          tokenMetadata.device.type === "http" &&
          performance.now() -
            tokenMetadata.device.value.lastConnectionTimestamp <
            TIMEOUT_HTTP_TOKEN
        ) {
          return;
        }

        if (
          tokenMetadata.inspectors.length === 0 &&
          tokenMetadata.tokenType !== TokenType.Persistent
        ) {
          removeTokenFromList(tokenMetadata.tokenId);
          clearInterval(checkAliveIntervalId);
        }
      }, 2000);

      tokenMetadata.device = {
        type: "http",
        value: {
          lastConnectionTimestamp: performance.now(),
          checkAliveIntervalId,
        },
      };
      req.on("data", function (data) {
        unparsedBody += data;
        while (true) {
          const indexOfNul = unparsedBody.indexOf("\0");
          if (indexOfNul === -1) {
            return;
          }
          messages.push(unparsedBody.substring(0, indexOfNul));
          unparsedBody = unparsedBody.substring(indexOfNul + 1);
        }
      });
      req.on("end", function () {
        if (unparsedBody.length > 0) {
          messages.push(unparsedBody);
          unparsedBody = "";
        }
        for (const message of messages) {
          onNewDeviceMessage(message, {
            tokenMetadata,
            request: req,
            logFileName,
          });
        }
        response.writeHead(200, {
          /* eslint-disable @typescript-eslint/naming-convention */
          "Content-Type": "text/html",
          "Access-Control-Allow-Origin": "*",
          /* eslint-enable @typescript-eslint/naming-convention */
        });
        response.end();
      });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    deviceSocket.handleUpgrade(request, socket, head, (ws) => {
      deviceSocket.emit("connection", ws, request);
    });
  });

  server.listen(options.devicePort);

  const checkers = createCheckers(activeTokensList, {
    deviceSocket,
    htmlInspectorSocket,
    maxTokenDuration: options.maxTokenDuration,
    inspectorMessageLimit: options.inspectorMessageLimit,
    deviceMessageLimit: options.deviceMessageLimit,
    wrongPasswordLimit: options.wrongPasswordLimit,
    inspectorConnectionLimit: options.inspectorConnectionLimit,
    deviceConnectionLimit: options.deviceConnectionLimit,
  });

  deviceSocket.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const connectionMetadata = checkNewDeviceConnection(req);
    if (connectionMetadata === null) {
      ws.close();
      return;
    }
    const { tokenId, logFileName, tokenMetadata } = connectionMetadata;
    checkers.checkNewDeviceLimit();

    writeLog("log", "Received authorized device WebSocket connection", {
      address: req.socket.remoteAddress,
      tokenId,
    });

    tokenMetadata.device = {
      type: "websocket",
      value: ws,
    };
    tokenMetadata.pingInterval = setInterval(() => {
      ws.send("ping");
    }, 10000);
    ws.send("ack");
    ws.on("message", (message) => {
      /* eslint-disable-next-line @typescript-eslint/no-base-to-string */
      const messageStr = message.toString();
      onNewDeviceMessage(messageStr, {
        tokenMetadata,
        request: req,
        logFileName,
      });
    });
    ws.on("close", () => {
      if (
        tokenMetadata.device === null ||
        tokenMetadata.device.type !== "websocket" ||
        tokenMetadata.device.value !== ws
      ) {
        return;
      }
      writeLog("log", "Device disconnected.", {
        address: req.socket.remoteAddress,
        tokenId,
      });
      if (tokenMetadata.pingInterval !== null) {
        clearInterval(tokenMetadata.pingInterval);
      }
      tokenMetadata.device = null;
      if (
        tokenMetadata.tokenType !== TokenType.Persistent &&
        tokenMetadata.inspectors.length === 0
      ) {
        removeTokenFromList(tokenId);
      }
    });
  });

  function removeTokenFromList(tokenId: string) {
    const indexOfToken = activeTokensList.findIndex(tokenId);
    if (indexOfToken === -1) {
      writeLog("warn", "Closing device's token not found", { tokenId });
      return;
    }
    writeLog("log", "Removing token", {
      tokenId,
      remaining: activeTokensList.size() - 1,
    });
    activeTokensList.removeIndex(indexOfToken);
  }

  if (htmlInspectorSocket !== null) {
    htmlInspectorSocket.on("connection", (ws, req) => {
      if (req.url === undefined) {
        ws.close();
        return;
      }
      const urlParts = parseInspectorUrl(req.url, options.password);
      const receivedPassword = urlParts.password ?? "";
      if (receivedPassword !== (options.password ?? "")) {
        writeLog(
          "warn",
          "Received inspector request with invalid password: " +
            receivedPassword,
          { address: req.socket.remoteAddress },
        );
        ws.close();
        checkers.checkBadPasswordLimit();
        return;
      }

      // Special token "list" request:
      // Regularly returns the list of currently active tokens
      if (urlParts.command === "list") {
        writeLog("log", "Received inspector request for list of tokens", {
          address: req.socket.remoteAddress,
        });
        const itv = setInterval(sendCurrentListOfTokens, 3000);
        sendCurrentListOfTokens();
        ws.onclose = () => {
          clearInterval(itv);
        };
        function sendCurrentListOfTokens() {
          checkers.forceExpirationCheck();
          const now = performance.now();
          ws.send(
            JSON.stringify({
              isNoTokenEnabled: !options.disableNoToken,
              tokenList: activeTokensList.getList().map((t) => {
                return {
                  tokenId: t.tokenId,
                  date: t.date,
                  timestamp: t.timestamp,
                  isPersistent: t.tokenType === TokenType.Persistent,
                  msUntilExpiration: Math.max(t.getExpirationDelay(now), 0),
                };
              }),
            }),
          );
        }
        return;
      }

      const tokenId = urlParts.tokenId;
      if (tokenId === undefined) {
        ws.close();
        return;
      }

      checkers.checkNewInspectorLimit();
      if (tokenId.length > 100) {
        writeLog(
          "warn",
          "Received inspector request with token too long: " +
            String(tokenId.length),
        );
        ws.close();
        return;
      } else if (!/[a-z0-9]+/.test(tokenId)) {
        writeLog("warn", "Received inspector request with invalid token.", {
          tokenId,
        });
        ws.close();
        return;
      }

      writeLog("log", "Inspector: Received authorized inspector connection.", {
        address: req.socket.remoteAddress,
        tokenId,
        command: urlParts.command,
      });

      const isPersistentTokenCreation = urlParts.command === "persist";

      let existingToken = activeTokensList.find(tokenId);
      if (existingToken === undefined) {
        writeLog("log", "Creating new token", {
          tokenId,
          remaining: activeTokensList.size() + 1,
        });
        existingToken = activeTokensList.create(
          isPersistentTokenCreation
            ? TokenType.Persistent
            : TokenType.FromInspector,
          tokenId,
          options.historySize,
          urlParts.expirationDelay ?? options.maxTokenDuration,
        );
      } else {
        if (isPersistentTokenCreation) {
          existingToken.tokenType = TokenType.Persistent;
        }
        if (urlParts.expirationDelay !== undefined) {
          existingToken.updateExpirationDelay(urlParts.expirationDelay);
        }
        writeLog("log", "Adding new inspector to token.", { tokenId });
      }

      if (isPersistentTokenCreation) {
        persistentTokensStorage.addToken(existingToken);
      }

      const pingInterval = setInterval(() => {
        ws.send("ping");
      }, 10000);
      existingToken.inspectors.push({
        webSocket: ws,
        pingInterval,
      });

      sendMessageToInspector("ack", ws, req, tokenId);

      const deviceInitData = existingToken.getDeviceInitData();
      if (deviceInitData !== null) {
        const { timestamp, dateMs } = deviceInitData;
        const { history, maxHistorySize } = existingToken.getCurrentHistory();
        const message = JSON.stringify({
          type: "Init",
          value: {
            timestamp,
            dateMs,
            history,
            maxHistorySize,
          },
        });
        sendMessageToInspector(message, ws, req, tokenId);
      }
      checkers.forceExpirationCheck();

      ws.on("message", (message) => {
        checkers.checkInspectorMessageLimit();
        /* eslint-disable-next-line @typescript-eslint/no-base-to-string */
        const messageStr = message.toString();

        if (messageStr === "pong") {
          return;
        }

        let messageObj;
        try {
          messageObj = JSON.parse(messageStr) as unknown;
        } catch (err) {
          writeLog("warn", "Could not parse message given by inspector.", {
            address: req.socket.remoteAddress,
            tokenId,
            message: messageStr.length < 200 ? messageStr : undefined,
          });
        }

        if (!isEvalMessage(messageObj)) {
          writeLog("warn", "Unknown message type received by inspector", {
            address: req.socket.remoteAddress,
            tokenId,
          });
          return;
        }
        if (existingToken === undefined || existingToken.device === null) {
          writeLog("warn", "Could not send eval message: no device connected", {
            address: req.socket.remoteAddress,
            tokenId,
          });
          ws.send(
            JSON.stringify({
              type: "eval-error",
              value: {
                error: { message: "Device not connected", name: "Error" },
                id: messageObj.value.id,
              },
            }),
          );
          return;
        } else if (existingToken.device.type !== "websocket") {
          writeLog(
            "warn",
            "Could not send eval message: device connected through HTTP POST",
            {
              address: req.socket.remoteAddress,
              tokenId,
            },
          );
          ws.send(
            JSON.stringify({
              type: "eval-error",
              value: {
                error: {
                  message: "Device connected through HTTP POST",
                  name: "Error",
                },
                id: messageObj.value.id,
              },
            }),
          );
          return;
        }

        writeLog("log", "Eval message received by inspector.", {
          address: req.socket.remoteAddress,
          tokenId,
        });

        try {
          existingToken.device.value.send(messageStr);
        } catch (err) {
          writeLog("warn", "Error while sending message to a device", {
            tokenId,
          });
        }
      });

      ws.on("close", () => {
        if (existingToken === undefined || tokenId === undefined) {
          return;
        }
        writeLog("log", "Inspector disconnected.", {
          address: req.socket.remoteAddress,
          tokenId,
        });
        const indexOfInspector = existingToken.inspectors.findIndex(
          (obj) => obj.webSocket === ws,
        );
        if (indexOfInspector === -1) {
          writeLog("warn", "Closing inspector not found.", { tokenId });
          return;
        }
        clearInterval(existingToken.inspectors[indexOfInspector].pingInterval);
        existingToken.inspectors.splice(indexOfInspector, 1);
        if (
          existingToken.tokenType !== TokenType.Persistent &&
          existingToken.inspectors.length === 0 &&
          existingToken.device === null
        ) {
          const indexOfToken = activeTokensList.findIndex(tokenId);
          if (indexOfToken === -1) {
            writeLog("warn", "Closing inspector's token not found.", {
              tokenId,
            });
            return;
          }
          writeLog("log", "Removing token.", {
            tokenId,
            remaining: activeTokensList.size() - 1,
          });
          activeTokensList.removeIndex(indexOfToken);
        }
      });
    });
    logger.log(
      `Emitting to web inspectors at ws://127.0.0.1:${options.inspectorPort}`,
    );
  }
  logger.log(
    `Listening for device logs at ws://127.0.0.1:${options.devicePort}`,
  );

  /**
   * Perform checks when a new connection (WebSocket or HTTP POST) is
   * established. If the connection is invalid (wrong password, token etc.)
   * return `null`.
   *
   * If the connection appears to be valid, return the metadata associated to
   * that new connection.
   *
   * If a device already maintained a WebSocket connection with the given token,
   * this function will close that connection.
   * That function might kill the server if `checkers` detect abnormal activity.
   *
   * @param req - The `IncomingMessage` object linked to the HTTP or WebSocket
   * request.
   * @returns - Metadata on the established connection or `null` if that
   * connection was invalid.
   */
  function checkNewDeviceConnection(req: IncomingMessage): null | {
    tokenId: string;
    tokenMetadata: TokenMetadata;
    logFileName: string;
  } {
    if (req.url === undefined) {
      return null;
    }
    let tokenId = req.url.substring(1);
    let existingToken: TokenMetadata;
    let existingTokenIndex: number;
    let logFileNameSuffix = tokenId;
    if (!options.disableNoToken && tokenId.startsWith("!notoken")) {
      if (options.password !== null) {
        const pw = tokenId.substring("!notoken/".length);
        if (pw !== options.password) {
          writeLog(
            "warn",
            "Received inspector request with invalid password: " + pw,
            { address: req.socket.remoteAddress },
          );
          checkers.checkBadPasswordLimit();
          return null;
        }
      }

      const address = req.socket.remoteAddress;
      if (address !== undefined && address !== "") {
        // Strip last part of address for fear of GDPR compliancy?
        const lastDotIdx = address.lastIndexOf(".");
        if (lastDotIdx > 0) {
          logFileNameSuffix = address.substring(0, lastDotIdx);
        } else {
          const lastColonIdx = address.lastIndexOf(":");
          if (lastColonIdx > 0) {
            logFileNameSuffix = address.substring(0, lastColonIdx);
          }
        }
      }
      tokenId = generatePassword();
      logFileNameSuffix += `-${tokenId}`;
      existingToken = activeTokensList.create(
        TokenType.FromDevice,
        tokenId,
        options.historySize,
        options.maxTokenDuration,
      );
      existingTokenIndex = activeTokensList.findIndex(tokenId);
    } else {
      existingTokenIndex = activeTokensList.findIndex(tokenId);
      if (existingTokenIndex === -1) {
        writeLog(
          "warn",
          "Received device request with invalid token.",
          // Avoid filling the logging storage with bad tokens
          { tokenId: tokenId.length > 100 ? undefined : tokenId },
        );
        return null;
      }
      const token = activeTokensList.getFromIndex(existingTokenIndex);
      if (token === undefined) {
        // should never happen
        return null;
      }
      existingToken = token;
    }
    if (existingToken.device !== null) {
      if (existingToken.device.type === "http") {
        clearInterval(existingToken.device.value.checkAliveIntervalId);
      }
      if (existingToken.device.type === "websocket") {
        writeLog(
          "warn",
          "A device was already connected with this token. " +
            "Closing previous token user.",
          { tokenId },
        );
        const device = existingToken.device;
        existingToken.device = null;
        device.value.close();
      }
    }
    const logFileName = getLogFileName(logFileNameSuffix);
    return {
      tokenId,
      tokenMetadata: existingToken,
      logFileName,
    };
  }

  /**
   * Actions taken when a new message is received from a device, regardless of
   * means (WebSocket or HTTP post).
   * @param message - The actual message received.
   * @param param0 - Metadata linked to the message and the device sending it.
   */
  function onNewDeviceMessage(
    message: string,
    {
      tokenMetadata,
      request,
      logFileName,
    }: {
      tokenMetadata: TokenMetadata;
      request: IncomingMessage;
      logFileName: string;
    },
  ) {
    checkers.checkDeviceMessageLimit();

    /** The log that is about to be written on the disk in the log file. */
    let storedMsg = "";

    /** The log that is about to be sent to the inspector. */
    let inspectorMsg = "";

    /** The log that is about to be added to the history.
     * History is sent once an inspector connect on an already started
     * session so it can have the logs before he actually connect.
     */
    let historyMsg = "";

    if (message.length > options.maxLogLength) {
      return;
    }
    if (message === "pong") {
      return;
    }
    if (message.startsWith("Init ")) {
      writeLog("log", "received Init message", {
        address: request.socket.remoteAddress,
        tokenId: tokenMetadata.tokenId,
      });
      const matches = message.match(INIT_REGEX);
      if (matches === null) {
        writeLog(
          "warn",
          "Error while trying to parse the `Init` initial message from " +
            "a device. Is it valid?",
          {
            address: request.socket.remoteAddress,
            tokenId: tokenMetadata.tokenId,
            message,
          },
        );
      } else {
        const timestamp = +matches[1];
        const dateMs = +matches[2];
        tokenMetadata.setDeviceInitData({ timestamp, dateMs });
        const { history, maxHistorySize } = tokenMetadata.getCurrentHistory();
        inspectorMsg = JSON.stringify({
          type: "Init",
          value: { timestamp, dateMs, history, maxHistorySize },
        });
        storedMsg = JSON.stringify({
          type: "Init",
          value: { timestamp, dateMs },
        });
      }
    } else if (message[0] === "{") {
      try {
        /* eslint-disable */ // In a try so anything goes :p
        const parsed = JSON.parse(message);
        if (parsed.type === "eval-result" || parsed.type === "eval-error") {
          inspectorMsg = message;
        }
      } catch (_) {
        // We don't care
      }
    } else {
      inspectorMsg = message;
      storedMsg = message;
      historyMsg = message;
    }
    if (historyMsg) {
      tokenMetadata.addLogToHistory(historyMsg);
    }
    if (storedMsg && options.shouldCreateLogFiles) {
      appendFile(logFileName, storedMsg + "\n", function () {
        // on finished. Do nothing for now.
      });
    }

    if (tokenMetadata.getDeviceInitData() === null) {
      return;
    }
    for (const inspector of tokenMetadata.inspectors) {
      sendMessageToInspector(
        inspectorMsg,
        inspector.webSocket,
        request,
        tokenMetadata.tokenId,
      );
    }
  }
}

function sendMessageToInspector(
  message: string,
  inspector: WebSocket.WebSocket,
  req: IncomingMessage,
  tokenId: string,
): void {
  try {
    inspector.send(message);
  } catch (err) {
    writeLog("warn", "Error while sending log to an inspector", {
      address: req.socket?.remoteAddress ?? undefined,
      tokenId,
    });
  }
}

function getLogFileName(tokenId: string): string {
  return "logs-" + new Date().toISOString() + "-" + tokenId + ".txt";
}

interface EvalMessage {
  type: "eval";
  value: {
    instruction: string;
    id: string;
  };
}

function isEvalMessage(msg: unknown): msg is EvalMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as EvalMessage).type === "eval" &&
    typeof (msg as EvalMessage).value === "object" &&
    (msg as EvalMessage).value !== null &&
    typeof (msg as EvalMessage).value.id === "string" &&
    typeof (msg as EvalMessage).value.instruction === "string"
  );
}

function writeLog(
  level: "log" | "warn",
  msg: string,
  infos:
    | {
        address?: string | undefined;
        command?: string | undefined;
        tokenId?: string | undefined;
        message?: string | undefined;
        remaining?: number;
      }
    | undefined = {},
): void {
  const args = [msg];
  if (infos.address !== undefined) {
    args.push(`address=${infos.address}`);
  }
  if (infos.tokenId !== undefined) {
    args.push(`token=${infos.tokenId}`);
  }
  if (infos.command !== undefined) {
    args.push(`command=${infos.command}`);
  }
  if (infos.message !== undefined) {
    args.push(`message=${infos.message}`);
  }
  if (infos.remaining !== undefined) {
    args.push(`remaining=${infos.remaining}`);
  }
  logger[level](...args);
}

function parseInspectorUrl(
  url: string,
  password: string | null,
): {
  password: string | undefined;
  command: string | undefined;
  tokenId: string | undefined;
  expirationDelay: number | undefined;
} {
  const parts = url.substring(1).split("/");
  let pass;
  let command;
  let tokenId;
  let expirationMsStr;
  if (password !== null) {
    pass = parts[0];
    if (parts.length >= 2 && parts[1].startsWith("!")) {
      command = parts[1].substring(1);
      tokenId = parts[2];
      expirationMsStr = parts[3];
    } else {
      command = undefined;
      tokenId = parts[1];
      expirationMsStr = parts[2];
    }
  } else {
    if (parts.length >= 1 && parts[0].startsWith("!")) {
      command = parts[0].substring(1);
      tokenId = parts[1];
      expirationMsStr = parts[2];
    } else {
      command = undefined;
      tokenId = parts[0];
      expirationMsStr = parts[1];
    }
  }
  let expirationDelay: number | undefined = +expirationMsStr;
  if (isNaN(expirationDelay)) {
    expirationDelay = undefined;
  }
  return {
    password: pass,
    tokenId,
    command,
    expirationDelay,
  };
}
