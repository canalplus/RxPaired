import {
  DEFAULT_INSPECTOR_PORT,
  DEFAULT_DEVICE_PORT,
  DEFAULT_HISTORY_SIZE,
  DEFAULT_MAX_TOKEN_DURATION,
  DEFAULT_MAX_LOG_LENGTH,
  DEFAULT_WRONG_PASSWORD_LIMIT,
  DEFAULT_DEVICE_CONNECTION_LIMIT,
  DEFAULT_INSPECTOR_CONNECTION_LIMIT,
  DEFAULT_DEVICE_MESSAGE_LIMIT,
  DEFAULT_INSPECTOR_MESSAGE_LIMIT,
  DEFAULT_LOG_FILE_PATH,
} from "./constants.js";
import { generatePassword } from "./utils.js";

export interface ParsedOptions {
  inspectorPort: number;
  devicePort: number;
  shouldCreateLogFiles: boolean;
  password: string | null;
  historySize: number;
  maxTokenDuration: number;
  maxLogLength: number;
  wrongPasswordLimit: number;
  inspectorConnectionLimit: number;
  deviceConnectionLimit: number;
  deviceMessageLimit: number;
  inspectorMessageLimit: number;
  persistentTokensFile: string | null;
  logFile: string | null;
  disableNoToken: boolean;
}

const optionsDescription = [
  {
    shortForm: "cp",
    longForm: "inspector-port",
    argumentDescription: "port",
    description:
      "Port used for inspector-to-server communication.\n" +
      "To set to `-1` to disable (in which case you may want " +
      'to rely on "no-token" mode).\n' +
      `Defaults to ${DEFAULT_INSPECTOR_PORT}.`,
    outputVar: "inspectorPort",
  },
  {
    shortForm: "dp",
    longForm: "device-port",
    argumentDescription: "port",
    description:
      "Port used for device-to-server communication.\n" +
      `Defaults to ${DEFAULT_DEVICE_PORT}.`,
    outputVar: "devicePort",
  },
  {
    shortForm: "f",
    longForm: "create-log-files",
    argumentDescription: null,
    description:
      "If set, a log file will also be written for each token and for each day\n" +
      "(server time) this token is used, in the current directory.",
    outputVar: "shouldCreateLogFiles",
  },
  {
    shortForm: null,
    longForm: "force-password",
    argumentDescription: "password",
    description:
      "Force the password to be a given string" +
      " (must be alphanumeric, case-sentive)",
    outputVar: "password",
  },
  {
    shortForm: null,
    longForm: "no-password",
    argumentDescription: null,
    description: "Disable the usage of a password.",
    outputVar: "password",
  },
  {
    shortForm: null,
    longForm: "history-size",
    argumentDescription: "size",
    description:
      "Number of logs kept in memory for each token in case of web inspectors\n(re-)" +
      "connecting after the device already emitted logs.\n" +
      `${DEFAULT_HISTORY_SIZE} by default.`,
    outputVar: "historySize",
  },
  {
    shortForm: null,
    longForm: "max-token-duration",
    argumentDescription: "duration",
    description:
      "Maximum number of seconds a new token is created for, in seconds.\n" +
      `Defaults to ${DEFAULT_MAX_TOKEN_DURATION}.`,
    outputVar: "maxTokenDuration",
  },
  {
    shortForm: null,
    longForm: "max-log-length",
    argumentDescription: "length",
    description:
      "Maximum length a log can have, in terms of UTF-16 code points.\n" +
      "Longer logs will be skipped.\n" +
      `${DEFAULT_MAX_LOG_LENGTH} by default.`,
    outputVar: "maxLogLength",
  },
  {
    shortForm: null,
    longForm: "wrong-password-limit",
    argumentDescription: "number",
    description:
      "Maximum authorized number of bad passwords received in 24 hours.\n" +
      "Exceeding that limit will stop the server.\n" +
      `Defaults to ${DEFAULT_WRONG_PASSWORD_LIMIT}.`,
    outputVar: "wrongPasswordLimit",
  },
  {
    shortForm: null,
    longForm: "inspector-connection-limit",
    argumentDescription: "number",
    description:
      "Maximum authorized number of web inspector connection per 24 hours.\n" +
      "Exceeding that limit will stop the server.\n" +
      `Defaults to ${DEFAULT_INSPECTOR_CONNECTION_LIMIT}.`,
    outputVar: "inspectorConnectionLimit",
  },
  {
    shortForm: null,
    longForm: "device-connection-limit",
    argumentDescription: "number",
    description:
      "Maximum authorized number of device connection per 24 hours.\n" +
      "Exceeding that limit will stop the server.\n" +
      `Defaults to ${DEFAULT_DEVICE_CONNECTION_LIMIT}.`,
    outputVar: "deviceConnectionLimit",
  },
  {
    shortForm: null,
    longForm: "device-message-limit",
    argumentDescription: "number",
    description:
      "Maximum authorized number of message any device (e.g. logs) can send " +
      "per 24 hours.\n" +
      "Exceeding that limit will stop the server.\n" +
      `Defaults to ${DEFAULT_DEVICE_MESSAGE_LIMIT}.`,
    outputVar: "deviceMessageLimit",
  },
  {
    shortForm: null,
    longForm: "inspector-message-limit",
    argumentDescription: "number",
    description:
      "Maximum authorized number of message any web inspector can send per 24 " +
      "hours.\n" +
      "Exceeding that limit will stop the server. " +
      `Defaults to ${DEFAULT_INSPECTOR_MESSAGE_LIMIT}.`,
    outputVar: "inspectorMessageLimit",
  },
  {
    shortForm: null,
    longForm: "persistent-tokens-storage",
    argumentDescription: "path",
    description:
      "If set, the RxPaired-server will store information on persistent " +
      "tokens on disk\n" +
      "(at the given path) so they can be retrieved if the server reboots.",
    outputVar: "persistentTokensFile",
  },
  {
    shortForm: null,
    longForm: "log-file",
    argumentDescription: "path",
    description:
      "If set a log file will be created at this path, containing the server's logs.",
    outputVar: "logFile",
  },
  {
    shortForm: null,
    longForm: "disable-no-token",
    argumentDescription: null,
    description:
      'Disable "no-token" mode, where devices can send logs without having ' +
      "to create\n" +
      'a "token" first through the inspector. ',
    outputVar: "disableNoToken",
  },
] as const;

export default function parseOptions(args: string[]): ParsedOptions {
  if (args.includes("-h") || args.includes("--help")) {
    displayHelp();
    process.exit(0);
  }

  let shouldGeneratePassword = true;
  const parsed: ParsedOptions = {
    inspectorPort: DEFAULT_INSPECTOR_PORT,
    devicePort: DEFAULT_DEVICE_PORT,
    shouldCreateLogFiles: false,
    password: null,
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i].trim();
    let foundOpt = false;
    for (const opt of optionsDescription) {
      if (
        (opt.shortForm !== null && arg === `-${opt.shortForm}`) ||
        arg === `--${opt.longForm}`
      ) {
        foundOpt = true;
        switch (opt.longForm) {
          case "inspector-port":
          case "device-port":
          case "history-size":
          case "max-token-duration":
          case "max-log-length":
          case "wrong-password-limit":
          case "inspector-connection-limit":
          case "device-connection-limit":
          case "inspector-message-limit":
          case "device-message-limit":
            i++;
            parsed[opt.outputVar] = checkIntArg(arg, args[i]);
            break;

          case "create-log-files":
          case "disable-no-token":
            parsed[opt.outputVar] = true;
            break;

          case "persistent-tokens-storage":
          case "log-file":
            i++;
            if (args[i] === undefined) {
              console.error(`Missing argument for "${arg}" option.`);
              process.exit(1);
            }
            parsed[opt.outputVar] = args[i];
            break;

          case "force-password":
            i++;
            if (args[i] === undefined) {
              console.error(
                `Missing password argument for "--force-password" option.`,
              );
              process.exit(1);
            } else if (!/^[A-Za-z0-9]+$/.test(args[i])) {
              console.error(
                `Invalid password argument for "--force-password" option. ` +
                  `Must be only alphanumeric characters, got "${args[i]}"`,
              );
              process.exit(1);
            } else if (!shouldGeneratePassword) {
              console.error(`Both setting and disabling a password. Exiting`);
              process.exit(1);
            }
            parsed[opt.outputVar] = args[i];
            shouldGeneratePassword = false;
            break;

          case "no-password":
            if (parsed[opt.outputVar] !== null) {
              console.error(`Both setting and disabling a password. Exiting`);
              process.exit(1);
            }
            parsed[opt.outputVar] = null;
            shouldGeneratePassword = false;
            break;

          default:
            console.error(`Unhandled option: "${arg}"`);
            process.exit(1);
        }
        break;
      }
    }
    if (!foundOpt) {
      console.error(`Unknown option: "${arg}"`);
      process.exit(1);
    }
  }

  if (shouldGeneratePassword) {
    parsed.password = generatePassword();
    console.log("Generated password:", parsed.password);
  }

  return parsed;

  function checkIntArg(arg: string, val: string | undefined): number {
    const toInt = val === undefined ? NaN : Number(val);
    if (isNaN(toInt)) {
      if (val === undefined || val.startsWith("-")) {
        console.error(`Missing argument for "${arg}" option.`);
      } else {
        console.error(
          `Invalid "${arg}" argument. Expected a number, ` + `got "${val}".`,
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
}

/**
 * Display through `console.log` an helping message relative to how to run this
 * script.
 */
function displayHelp() {
  let maxLenOptsName = 0;
  const lines = ["Usage: node RxPaired-inspector.mjs [options]", "Options:"];
  const SPACES_AFTER_OPTIONS = 3;

  const fullOptions = [
    ...optionsDescription,
    {
      shortForm: "h",
      longForm: "help",
      description: "Display this help information",
      argumentDescription: null,
    },
  ];
  for (const option of fullOptions) {
    let str = "";
    if (option.shortForm !== null) {
      str = `-${option.shortForm}`;
      if (option.longForm) {
        str += `, --${option.longForm}`;
      }
    } else {
      str = `--${option.longForm}`;
    }

    if (option.argumentDescription !== null) {
      str += ` <${option.argumentDescription}>`;
    }
    maxLenOptsName = Math.max(maxLenOptsName, str.length);
    lines.push(str);
  }

  let currentLineIdx = 2;
  for (const option of fullOptions) {
    const prevLine = lines[currentLineIdx];
    const nbOfSpaces = maxLenOptsName - prevLine.length + SPACES_AFTER_OPTIONS;
    const newLine =
      prevLine +
      " ".repeat(nbOfSpaces) +
      option.description.replace(
        /\n/g,
        "\n" + " ".repeat(maxLenOptsName + SPACES_AFTER_OPTIONS),
      );
    lines[currentLineIdx] = newLine;
    currentLineIdx++;
  }

  console.log(lines.join("\n"));
}
