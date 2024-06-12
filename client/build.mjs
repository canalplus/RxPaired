#!/usr/bin/env node

import path from "path";
import process from "process";
import esbuild from "esbuild";
import { fileURLToPath } from "url";

const currentDirName = getCurrentDirectoryName();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The script has been run directly

  if (typeof process.env.npm_config_device_debugger_url !== "string") {
    console.error(
      "Error: Invalid environment variable(s)." +
        "\n" +
        "Please make sure that you:\n" +
        `  1. Declared an ".npmrc" file in the "${currentDirName}" directory based on ` +
        "the content of the following file: " +
        path.join(currentDirName, ".npmrc.sample") +
        ".\n" +
        "  2. Called this script through an npm script command (e.g. npm run *script*).",
    );
    process.exit(1);
  }

  let deviceDebuggerUrl = process.env.npm_config_device_debugger_url;
  if (!/^(http|ws)s?:\/\//.test(deviceDebuggerUrl)) {
    console.error(
      "Error: Invalid device_debugger_url." +
        "\n" +
        "Please make sure that this url uses either the http, https, ws or wss.",
    );
    process.exit(1);
  }
  if (deviceDebuggerUrl.startsWith("http")) {
    deviceDebuggerUrl = "ws" + deviceDebuggerUrl.slice(4);
  }

  const { argv } = process;
  if (argv.includes("-h") || argv.includes("--help")) {
    displayHelp();
    process.exit(0);
  }
  const shouldWatch = argv.includes("-w") || argv.includes("--watch");
  const shouldMinify = argv.includes("-m") || argv.includes("--minify");

  const consolePlugin = {
    name: "onEnd",
    setup(build) {
      build.onStart(() => {
        console.log(
          `\x1b[33m[${getHumanReadableHours()}]\x1b[0m ` +
            "New client build started",
        );
      });
      build.onEnd((result) => {
        if (result.errors.length > 0 || result.warnings.length > 0) {
          const { errors, warnings } = result;
          console.log(
            `\x1b[33m[${getHumanReadableHours()}]\x1b[0m ` +
              `client re-built with ${errors.length} error(s) and ` +
              ` ${warnings.length} warning(s) `,
          );
          return;
        }
        console.log(
          `\x1b[32m[${getHumanReadableHours()}]\x1b[0m ` + "client built!",
        );
      });
    },
  };
  buildClient({
    minify: shouldMinify,
    watch: shouldWatch,
    plugins: [consolePlugin],
    deviceDebuggerUrl,
  }).catch((err) => {
    console.error(
      `\x1b[31m[${getHumanReadableHours()}]\x1b[0m Client build failed:`,
      err,
    );
    process.exit(1);
  });
}

/**
 * Build the client with the given options.
 * @param {Object} options
 * @param {string} options.deviceDebuggerUrl - URL to contact the RxPaired
 * server.
 * @param {boolean} [options.minify] - If `true`, the output will be minified.
 * @param {boolean} [options.watch] - If `true`, the files involved
 * will be watched and the code re-built each time one of them changes.
 * @param {Array|undefined} [options.plugins]
 * @param {Array|undefined} [options.tokenValue]
 * @returns {Promise}
 */
export default function buildClient(options) {
  const minify = !!options.minify;
  const watch = !!options.watch;
  const esbuildOpts = {
    entryPoints: [path.join(currentDirName, "src", "client.js")],
    bundle: true,
    format: "esm",
    minifySyntax: minify,
    minifyWhitespace: minify,
    target: "es6",
    outfile: path.join(currentDirName, "client.js"),
    legalComments: "inline",
    plugins: options.plugins,
    define: {
      _DEVICE_DEBUGGER_URL_: JSON.stringify(options.deviceDebuggerUrl),
      _BUILD_TIME_TOKEN_VALUE_: JSON.stringify(options.tokenValue ?? null),
      _HAS_SERVER_: "false",
    },
  };
  return watch
    ? esbuild.context(esbuildOpts).then((context) => {
        context.watch();
      })
    : esbuild.build(esbuildOpts);
}

/**
 * Returns the current time in a human-readable format.
 * @returns {string}
 */
function getHumanReadableHours() {
  const date = new Date();
  return (
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0") +
    ":" +
    String(date.getSeconds()).padStart(2, "0") +
    "." +
    String(date.getMilliseconds()).padStart(4, "0")
  );
}

/**
 * Display through `console.log` an helping message relative to how to run this
 * script.
 */
function displayHelp() {
  console.log(
    /* eslint-disable indent */
    `Usage: node build.mjs [options]
Options:
  -h, --help             Display this help
  -m, --minify           Minify the built demo
  -w, --watch            Re-build each time either the demo or library files change`,
    /* eslint-enable indent */
  );
}

/**
 * Returns the path to the directory where the current script is found.
 * @returns {String}
 */
function getCurrentDirectoryName() {
  return path.dirname(fileURLToPath(import.meta.url));
}
