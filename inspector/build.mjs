#!/usr/bin/env node

import { readFileSync } from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import esbuild from "esbuild";

const currentDirName = getCurrentDirectoryName();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The script has been run directly

  let configFile;
  try {
    configFile = readFileSync("./rx-paired.config.json");
  } catch (err1) {
    if (err1.code === "ENOENT") {
      try {
        configFile = readFileSync(
          path.join(currentDirName, "..", "rx-paired.config.json"),
        );
      } catch (err2) {
        if (err2.code === "ENOENT") {
          console.error("ERROR: Config file not found.");
          console.error(
            'Please create a file named "rx-paired.config.json" first in either the root directory of the project or in the current working directory. You can take "rx-player.config.example.json" as an example of what this configuration file should contain.',
          );
        } else {
          console.error(
            "ERROR: Failed to open configuration file: " + err2.toString(),
          );
        }
        process.exit(1);
      }
    } else {
      console.error(
        "ERROR: Failed to open configuration file: " + err1.toString(),
      );
      process.exit(1);
    }
  }

  let configFileJson;
  try {
    configFileJson = JSON.parse(configFile);
  } catch (err) {
    console.error(
      "ERROR: Failed to parse configuration file: " + err.toString(),
    );
    process.exit(1);
  }

  let serverUrl = configFileJson.serverUrl;
  if (typeof serverUrl !== "string") {
    console.error("Error: Invalid `serverUrl` configuration.");
    if (!configFileJson.hasOwnProperty("serverUrl")) {
      console.error('"serverUrl" not defined');
    } else {
      console.error(
        'Expected type: "string"\n' + 'Actual type: "' + typeof serverUrl + '"',
      );
    }
    process.exit(1);
  }
  if (!/^(http|ws)s?:\/\//.test(serverUrl)) {
    console.error(
      'ERROR: Invalid "serverUrl" property.' +
        "\n" +
        "Please make sure that this url uses either the http, https, ws or wss.",
    );
    process.exit(1);
  }
  if (serverUrl.startsWith("http")) {
    serverUrl = "ws" + serverUrl.slice(4);
  }

  let rxPairedInspectorUrl = serverUrl.endsWith("/")
    ? serverUrl + "inspector/"
    : serverUrl + "/inspector/";

  let deviceScriptUrl = configFileJson.deviceScriptUrl;
  if (typeof deviceScriptUrl !== "string") {
    console.error("Error: Invalid `deviceScriptUrl` configuration.");
    if (!configFileJson.hasOwnProperty("deviceScriptUrl")) {
      console.error('"deviceScriptUrl" not defined');
    } else {
      console.error(
        'Expected type: "string"\n' +
          'Actual type: "' +
          typeof deviceScriptUrl +
          '"',
      );
    }
    process.exit(1);
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
            "New inspector build started",
        );
      });
      build.onEnd((result) => {
        if (result.errors.length > 0 || result.warnings.length > 0) {
          const { errors, warnings } = result;
          console.log(
            `\x1b[33m[${getHumanReadableHours()}]\x1b[0m ` +
              `inspector re-built with ${errors.length} error(s) and ` +
              ` ${warnings.length} warning(s) `,
          );
          return;
        }
        console.log(
          `\x1b[32m[${getHumanReadableHours()}]\x1b[0m ` + "inspector built!",
        );
      });
    },
  };
  buildWebInspector({
    minify: shouldMinify,
    watch: shouldWatch,
    plugins: [consolePlugin],
    deviceScriptUrl,
    serverUrl: rxPairedInspectorUrl,
  }).catch((err) => {
    console.error(
      `\x1b[31m[${getHumanReadableHours()}]\x1b[0m Inspector build failed:`,
      err,
    );
    process.exit(1);
  });
}

/**
 * Build the inspector with the given options.
 * @param {Object} options
 * @param {string} options.serverUrl - URL to contact the RxPaired
 * server.
 * @param {string|null|undefined} [options.deviceScriptUrl] - URL where the
 * RxPaired client script may be fetched.
 * @param {boolean|null|undefined} [options.noPassword] - If `true` the
 * password page will never be displayed.
 * @param {boolean} [options.minify] - If `true`, the output will be minified.
 * @param {boolean} [options.watch] - If `true`, the files involved
 * will be watched and the code re-built each time one of them changes.
 * @param {Array|undefined} [plugins]
 * @returns {Promise}
 */
export default function buildWebInspector(options) {
  const minify = !!options.minify;
  const watch = !!options.watch;
  const esbuildOpts = {
    entryPoints: [path.join(currentDirName, "src", "index.ts")],
    bundle: true,
    minify,
    plugins: options.plugins,
    outfile: path.join(currentDirName, "inspector.js"),
    define: {
      __RX_PAIRED_SERVER_URL__: JSON.stringify(options.serverUrl),
      __DEVICE_SCRIPT_URL__: JSON.stringify(options.deviceScriptUrl ?? null),
      __DISABLE_PASSWORD__: JSON.stringify(options.noPassword ?? false),
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
    `Usage: node build.js [options]
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
