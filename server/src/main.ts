import { appendFile } from "fs";
import { createServer, IncomingMessage } from "http";
import process from "process";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";
import ActiveTokensList, {
  DeviceInfo,
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

  const server = createServer(function (req, response) {
    if (req.method === "POST") {
      let body = "";
      const metadata = checkNewDeviceConnection(req);
      if (metadata === null) {
        response.writeHead(403, {
          /* eslint-disable @typescript-eslint/naming-convention */
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
          /* eslint-enable @typescript-eslint/naming-convention */
        });
        response.end();
        return;
      }
      const { tokenId, tokenMetadata } = metadata;
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

      const now = performance.now();
      let initialConnectionDate: Date;
      if (tokenMetadata.device?.type === "http") {
        initialConnectionDate =
          tokenMetadata.device.value.initialConnectionDate;
      } else {
        initialConnectionDate = new Date();
      }
      const deviceInfo: DeviceInfo = {
        type: "http",
        value: {
          initialConnectionDate,
          lastConnectionTimestamp: now,
          checkAliveIntervalId,
        },
      };
      tokenMetadata.device = deviceInfo;
      const logFileName = getLogFileName(tokenMetadata.tokenId, deviceInfo);

      req.on("data", function (data) {
        body += data;
      });
      req.on("end", function () {
        let messages: string[];
        try {
          messages = JSON.parse(body) as string[];
          if (!Array.isArray(messages)) {
            throw new Error("Body sent through HTTP POST should be an array");
          }
        } catch (err) {
          writeLog(
            "warn",
            "Received HTTP POST with invalid body: " +
              (err instanceof Error ? err.toString() : "Unknown Error"),
            { address: req.socket.remoteAddress },
          );
          response.writeHead(400, {
            /* eslint-disable @typescript-eslint/naming-convention */
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
            /* eslint-enable @typescript-eslint/naming-convention */
          });
          response.end();
          return;
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
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
          /* eslint-enable @typescript-eslint/naming-convention */
        });
        response.end(tokenId);
      });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    deviceSocket.handleUpgrade(request, socket, head, (ws) => {
      deviceSocket.emit("connection", ws, request);
    });
  });

  server.listen(options.port);

  const checkers = createCheckers(activeTokensList, {
    deviceSocket,
    maxTokenDuration: options.maxTokenDuration,
    inspectorMessageLimit: options.inspectorMessageLimit,
    deviceMessageLimit: options.deviceMessageLimit,
    wrongPasswordLimit: options.wrongPasswordLimit,
    inspectorConnectionLimit: options.inspectorConnectionLimit,
    deviceConnectionLimit: options.deviceConnectionLimit,
  });

  deviceSocket.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (req.url !== undefined && req.url.startsWith("/!inspector/")) {
      const subUrl = req.url.substring("/!inspector".length);
      onInspectorConnection(ws, req, subUrl);
      return;
    }
    const connectionMetadata = checkNewDeviceConnection(req);
    if (connectionMetadata === null) {
      ws.close();
      return;
    }
    const { tokenId, tokenMetadata } = connectionMetadata;
    checkers.checkNewDeviceLimit();

    writeLog("log", "Received authorized device WebSocket connection", {
      address: req.socket.remoteAddress,
      tokenId,
    });

    const deviceInfo: DeviceInfo = {
      type: "websocket",
      value: ws,
    };
    tokenMetadata.device = deviceInfo;
    const logFileName = getLogFileName(tokenMetadata.tokenId, deviceInfo);
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

  function onInspectorConnection(
    ws: WebSocket,
    req: IncomingMessage,
    url: string,
  ) {
    const urlParts = parseInspectorUrl(url, options.password);
    const receivedPassword = urlParts.password ?? "";
    if (receivedPassword !== (options.password ?? "")) {
      writeLog(
        "warn",
        "Received inspector request with invalid password: " + receivedPassword,
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
    } else if (!/[A-Za-z0-9]+/.test(tokenId)) {
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

      const players = existingToken.getRegisteredPlayers();
      for (const player of players) {
        sendMessageToInspector(
          JSON.stringify({
            type: "register-player",
            value: {
              playerId: player.playerId,
              commands: player.commands,
            },
          }),
          ws,
          req,
          tokenId,
        );
      }
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

      if (!isEvalMessage(messageObj) && !isCommandMessage(messageObj)) {
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
        if (isEvalMessage(messageObj)) {
          ws.send(
            JSON.stringify({
              type: "eval-error",
              value: {
                error: { message: "Device not connected", name: "Error" },
                id: messageObj.value.id,
              },
            }),
          );
        }
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
        if (isEvalMessage(messageObj)) {
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
        }
        return;
      }

      writeLog("log", "Eval or command message received by inspector.", {
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
  }

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
  logger.log(`Listening at ws://127.0.0.1:${options.port}`);

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
  } {
    if (req.url === undefined) {
      return null;
    }
    let tokenId = req.url.substring(1);
    let existingToken: TokenMetadata;
    let existingTokenIndex: number;
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

      tokenId = generatePassword();
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
    return {
      tokenId,
      tokenMetadata: existingToken,
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
    let storedMsg: string | undefined;

    /** The log that is about to be sent to the inspector. */
    let inspectorMsg: string | undefined;

    /** The log that is about to be added to the history.
     * History is sent once an inspector connect on an already started
     * session so it can have the logs before he actually connect.
     */
    let historyMsg: string | undefined;

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
        tokenMetadata.clearPlayers();
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

        if (parsed.type === "register-player") {
          processPlayerRegistrationMessage(parsed);
        } else if (parsed.type === "unregister-player") {
          processPlayerUnregistrationMessage(parsed);
        } else if (
          parsed.type === "eval-result" ||
          parsed.type === "eval-error"
        ) {
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
    if (historyMsg !== undefined) {
      tokenMetadata.addLogToHistory(historyMsg);
    }
    if (storedMsg !== undefined && options.shouldCreateLogFiles) {
      appendFile(logFileName, storedMsg + "\n", function () {
        // on finished. Do nothing for now.
      });
    }

    if (
      tokenMetadata.getDeviceInitData() !== null &&
      inspectorMsg !== undefined
    ) {
      for (const inspector of tokenMetadata.inspectors) {
        sendMessageToInspector(
          inspectorMsg,
          inspector.webSocket,
          request,
          tokenMetadata.tokenId,
        );
      }
    }

    return;

    function processPlayerRegistrationMessage(
      msg: PlayerRegistrationMessage,
    ): void {
      const playerId = msg.value.playerId;
      let commands = msg.value.commands;
      if (
        typeof playerId !== "string" ||
        !Array.isArray(commands) ||
        commands.some((k) => typeof k !== "string")
      ) {
        writeLog(
          "warn",
          'Error while trying to parse a "player-register" message from ' +
            "a device. Is it valid?",
          {
            address: request.socket.remoteAddress,
            tokenId: tokenMetadata.tokenId,
            message,
          },
        );
        return;
      }
      writeLog("log", `Register player "${playerId}"`, {
        address: request.socket.remoteAddress,
        tokenId: tokenMetadata.tokenId,
      });
      const playerObj = { playerId, commands };
      tokenMetadata.registerPlayer(playerObj);
      inspectorMsg = JSON.stringify({
        type: "register-player",
        value: playerObj,
      });
      storedMsg = JSON.stringify({
        type: "register-player",
        value: playerObj,
      });
    }

    function processPlayerUnregistrationMessage(
      msg: PlayerUnregistrationMessage,
    ): void {
      const playerId = msg.value.playerId;
      if (typeof playerId !== "string") {
        writeLog(
          "warn",
          'Error while trying to parse a "player-unregister" message from ' +
            "a device. Is it valid?",
          {
            address: request.socket.remoteAddress,
            tokenId: tokenMetadata.tokenId,
            message,
          },
        );
        return;
      }
      tokenMetadata.unregisterPlayer(playerId);
      inspectorMsg = JSON.stringify({
        type: "unregister-player",
        value: { playerId },
      });
      storedMsg = JSON.stringify({
        type: "unregister-player",
        value: { playerId },
      });
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

/**
 * Type for an `"eval"` message as might be sent by the inspector to execute
 * various instructions.
 */
interface EvalMessage {
  /** Discriminant. */
  type: "eval";
  value: {
    /** The code to execute on the device. */
    instruction: string;
    /** Identifier allowing to identify the response associated to that request. */
    id: string;
  };
}

/**
 * Type for a `"command"` message as might be sent by the inspector to control
 * a player.
 */
interface CommandMessage {
  /** Discriminant. */
  type: "command";
  value: {
    /** The command to call. */
    command: string;
    /** Identifier for the player on which the command should be called.. */
    playerId: string;
    /** Optional arguments for that command */
    args: string[];
  };
}

/**
 * Returns `true` if the given message data received from the inspector is
 * considered an `"eval"` message.
 * @param {*} msg - Message data received from the inspector.
 * @returns {Boolean} - `true` if the message is an `"eval"` message.
 */
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

/**
 * Returns `true` if the given message data received from the inspector is
 * considered an `"command"` message.
 * @param {*} msg - Message data received from the inspector.
 * @returns {Boolean} - `true` if the message is an `"command"` message.
 */
function isCommandMessage(msg: unknown): msg is CommandMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as CommandMessage).type === "command" &&
    typeof (msg as CommandMessage).value === "object" &&
    (msg as CommandMessage).value !== null &&
    typeof (msg as CommandMessage).value.playerId === "string" &&
    typeof (msg as CommandMessage).value.command === "string" &&
    Array.isArray((msg as CommandMessage).value.args) &&
    (msg as CommandMessage).value.args.every((a) => typeof a === "string")
  );
}

/**
 * Log both on the console and on the log file if set.
 * @param {string} level - Severity level for the log.
 * @param {string} msg - Message to log.
 * @param {Object} [infos={}] - Supplementary context for that log.
 */
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

/**
 * Construct filename for the logs associated to the given request and token.
 * @param tokenId - Token id linked to that request
 * @param deviceInfo - Information on the way the device is connected
 * @returns - The filename where logs from that device should be stored.
 */
function getLogFileName(tokenId: string, deviceInfo: DeviceInfo): string {
  // Devices connected through the HTTP POST mechanisms perform multiple
  // requests where the log file should be shared.
  const initialConnectionDate =
    deviceInfo.type === "http"
      ? deviceInfo.value.initialConnectionDate
      : undefined;

  return (
    "logs-" +
    (initialConnectionDate ?? new Date()).toISOString() +
    "-" +
    tokenId +
    ".txt"
  );
}

/**
 * Message as received by the device and sent to the inspector for `Player
 * registration` messages.
 */
interface PlayerRegistrationMessage {
  /** Identify that this is a "Player registration" message. */
  type: "register-player";
  value: {
    /** Unique identifier for that player under the corresponding connection. */
    playerId: string;
    /** Commands available on that player. */
    commands: string[];
  };
}

/**
 * Message as received by the device and sent to the inspector for `Player
 * de-registration` messages.
 */
interface PlayerUnregistrationMessage {
  /** Identify that this is a "Player de-registration" message. */
  type: "unregister-player";
  value: {
    /** Unique identifier for that player under the corresponding connection. */
    playerId: string;
  };
}
