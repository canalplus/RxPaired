#!/usr/bin/env node

import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_HISTORY_SIZE,
  DEFAULT_MAX_TOKEN_DURATION,
  DEFAULT_MAX_LOG_LENGTH,
  DEFAULT_WRONG_PASSWORD_LIMIT,
  DEFAULT_DEVICE_CONNECTION_LIMIT,
  DEFAULT_INSPECTOR_CONNECTION_LIMIT,
  DEFAULT_DEVICE_MESSAGE_LIMIT,
  DEFAULT_INSPECTOR_MESSAGE_LIMIT,
  DEFAULT_LOG_FILE_PATH,
} from "./server/build/constants.js";
import RxPairedServer from "./server/build/main.js";
import buildClient from "./client/build.mjs";
import buildInspector from "./inspector/build.mjs";
import startStaticHttpServer from "./utils/static_http_server.mjs";

const DEFAULT_STATIC_SERVER_PORT = 8695;

const currentDirName = getCurrentDirectoryName();

const { argv } = process;
if (argv.includes("-h") || argv.includes("--help")) {
  displayHelp();
  process.exit(0);
}

let password = null;
let noInspector = false;
let port;
let staticPort;

for (let i = 2; i < argv.length; i++) {
  const arg = argv[i].trim();
  switch (arg) {
    case "--port":
      i++;
      port = checkIntArg(arg, argv[i]);
      break;
    case "--static-port":
      i++;
      staticPort = checkIntArg(arg, argv[i]);
      break;
    case "--no-inspector":
      noInspector = true;
      break;
    case "--password":
      i++;
      if (argv[i] === undefined) {
        console.error(`Missing password argument for "--password" option.`);
        process.exit(1);
      } else if (!/^[A-Za-z0-9]+$/.test(argv[i])) {
        console.error(
          `Invalid password argument for "--password" option. ` +
            `Must be only alphanumeric characters, got "${argv[i]}"`,
        );
        process.exit(1);
      }
      password = argv[i];
      break;

    default:
      console.error(`Unknown option: "${arg}"`);
      process.exit(1);
  }
}

startRxPaired({ password, port, noInspector, staticPort });

export default function startRxPaired({
  password,
  staticPort,
  port,
  noInspector,
} = {}) {
  const noPassword = typeof password !== "string" || password.length === 0;
  const serverOpts = {
    port: port ?? DEFAULT_SERVER_PORT,
    shouldCreateLogFiles: true,
    password: noPassword ? null : password,
    historySize: DEFAULT_HISTORY_SIZE,
    maxTokenDuration: DEFAULT_MAX_TOKEN_DURATION,
    maxLogLength: DEFAULT_MAX_LOG_LENGTH,
    wrongPasswordLimit: DEFAULT_WRONG_PASSWORD_LIMIT,
    inspectorConnectionLimit: DEFAULT_INSPECTOR_CONNECTION_LIMIT,
    deviceConnectionLimit: DEFAULT_DEVICE_CONNECTION_LIMIT,
    deviceMessageLimit: DEFAULT_DEVICE_MESSAGE_LIMIT,
    inspectorMessageLimit: DEFAULT_INSPECTOR_MESSAGE_LIMIT,
    persistentTokensFile: null,
    logFile: DEFAULT_LOG_FILE_PATH,
    disableNoToken: false,
  };

  const staticServerPort = staticPort ?? DEFAULT_STATIC_SERVER_PORT;
  const serverUrl = `ws://127.0.0.1:${serverOpts.port}`;
  const deviceScriptUrl = `http://127.0.0.1:${staticServerPort}/client.js`;

  let tokenValue = null;
  if (noInspector) {
    if (password !== null) {
      tokenValue = `!notoken/${password}`;
    } else {
      tokenValue = "!notoken";
    }
  }

  console.log("Starting RxPaired...");
  Promise.race([
    RxPairedServer(serverOpts).catch((err) => {
      console.error(
        `\x1b[31m[${getHumanReadableHours()}]\x1b[0m Server build failed:`,
        err,
      );
      process.exit(1);
    }),

    noInspector
      ? Promise.resolve()
      : buildInspector({
          minify: true,
          watch: false,
          plugins: [],
          deviceScriptUrl,
          serverUrl,
          noPassword,
        }).catch((err) => {
          console.error(
            `\x1b[31m[${getHumanReadableHours()}]\x1b[0m Inspector build failed:`,
            err,
          );
          process.exit(1);
        }),

    buildClient({
      minify: true,
      watch: false,
      plugins: [],
      serverUrl,
      tokenValue,
    }).catch((err) => {
      console.error(
        `\x1b[31m[${getHumanReadableHours()}]\x1b[0m Client build failed:`,
        err,
      );
      process.exit(1);
    }),
  ])
    .then(() => {
      if (staticServerPort <= 0) {
        return;
      }
      const servedFiles = {
        "index.html": {
          path: path.join(currentDirName, "inspector", "index.html"),
          contentType: "text/html; charset=UTF-8",
        },

        // Yes, an empty string is actually a valid key!
        "": {
          path: path.join(currentDirName, "inspector", "index.html"),
          contentType: "text/html; charset=UTF-8",
        },

        "inspector.js": {
          path: path.join(currentDirName, "inspector", "inspector.js"),
          contentType: "application/javascript; charset=UTF-8",
        },

        "client.js": {
          path: path.join(currentDirName, "client", "client.js"),
          contentType: "application/javascript; charset=UTF-8",
        },
      };

      return startStaticHttpServer(servedFiles, staticServerPort, true);
    })
    .then(() => {
      console.log("");
      console.log("RxPaired started with success!");
      const clientPath = path.join(currentDirName, "client/client.js");
      if (staticServerPort > 0) {
        if (noInspector) {
          console.log(
            `You may load the client script at http://127.0.0.1:${staticServerPort}/client.js or find it in \`${clientPath}\`.`,
          );
        } else {
          console.log(
            `To start the inspector, go to http://127.0.0.1:${staticServerPort}/`,
          );
        }
      } else {
        if (!noInspector) {
          const inspectorPath = path.join(
            currentDirName,
            "inspector/index.html",
          );
          console.log(
            `An inspector build has been generated in \`${inspectorPath}\` and a client script in \`${clientPath}\``,
          );
        } else {
          console.log(
            `A client script has been generated in \`${clientPath}\`, you can now run that script in your device.`,
          );
        }
      }
    });
}

/**
 * Returns the path to the directory where the current script is found.
 * @returns {String}
 */
function getCurrentDirectoryName() {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Display through `console.log` an helping message relative to how to run this
 * script.
 */
function displayHelp() {
  console.log(
    /* eslint-disable indent */
    `Usage: rx-paired [options]
Options:

  -h, --help                     Display this help

  --password <alphanumeric>      Optional password used by the server.
                                 Ignore for no password.

  --port <port>                  Port used for WebSocket communications.
                                 Defaults to ${DEFAULT_SERVER_PORT}.

  --static-port <port>           Port used to deliver the inspector HTTP page and the
                                 device's script.
                                 Defaults to ${DEFAULT_STATIC_SERVER_PORT}.
                                 You may set it to "-1" to disable the static server.

  --no-inspector                 If this option is present, we won't build and serve the
                                 inspector page nor rely on it for "token" creation.
                                 In effect, RxPaired will mostly act as a log server and
                                 create local files as new clients connect to it.`,
    /* eslint-enable indent */
  );
}

function checkIntArg(arg, val) {
  const toInt = val === undefined ? NaN : Number(val);
  if (isNaN(toInt)) {
    if (val === undefined || val.startsWith("-")) {
      console.error(`Missing argument for "${arg}" option.`);
    } else {
      console.error(
        `Invalid "${arg}" argument. Expected a number, ` + `ot "${val}".`,
      );
    }
    process.exit(1);
  } else if (toInt % 1 !== 0) {
    console.error(
      `Invalid "${arg}" argument. Expected an integer, ` + `got "${val}".`,
    );
    process.exit(1);
  }
  return toInt;
}
