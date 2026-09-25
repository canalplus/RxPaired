import strHtml from "str-html";
import modules from "./modules/index";

/**
 * Re-generate the page URL according to the communicated arguments.
 * Optionally update localStorage to sync with password
 *
 * Format of the hash:
 * #!token=<TOKEN>
 * If you want to reset the password, add `!passreset`:
 * #!token=<TOKEN>!passreset
 * If you want the postdebugger:
 * #!post
 *
 * @param {Object} options
 * @param {string|undefined|null} options.tokenId - Token ID wanted.
 * `null` if you want no token ID.
 * `undefined` if you want to keep the current one as is.
 * @param {boolean|undefined} options.isPostDebugger - If the wanted page is
 * the Post-Debugger page.
 * `undefined` if you want to keep the current one as is.
 * @param {boolean|undefined} options.forcePassReset - If true, the password
 * will be reset.
 * `undefined` if you want to keep the current one as is.
 * @returns {string}
 */
export function generatePageUrl(options: {
  tokenId: string | undefined | null;
  forcePassReset: boolean | undefined;
  isPostDebugger: boolean | undefined;
}): string {
  const { tokenId, forcePassReset, isPostDebugger } = options;
  const originalUrl = new URL(document.location.href);
  const currPageInfo = getPageInfo();
  originalUrl.hash = "";
  let url = originalUrl.toString() + "#";
  const wantPostDebugger =
    isPostDebugger === true ||
    (isPostDebugger === undefined && currPageInfo.isPostDebugger);
  const wantPassReset =
    forcePassReset === true ||
    (forcePassReset === undefined && currPageInfo.forcePassReset);
  if (wantPostDebugger) {
    url += "!post";
  }
  let useToken = tokenId;
  if (tokenId === undefined) {
    useToken = currPageInfo.tokenId;
  }
  if (useToken !== null) {
    url += "!token=" + useToken;
  }
  if (wantPassReset) {
    url += "!passreset";
  }
  return url;
}

/**
 * Parse information that can be gathered from the current URL
 * @returns {Object} urlInfo
 * @returns {boolean} urlInfo.isPostDebugger - If `true` we should be running
 * the "Post-Debugger" page.
 * @param {boolean} urlInfo.forcePassReset - If true, the password should be
 * reset.
 * @returns {string|null} urlInfo.tokenId - Current token inputed.
 * `null` if no token has been inputed for now.
 */
export function getPageInfo(): {
  isPostDebugger: boolean;
  tokenId: string | null;
  forcePassReset: boolean;
} {
  let tokenId;
  const initialHashValues = window.location.hash.split("!");
  const isPostDebugger = initialHashValues.some((val) => val === "post");
  const forcePassReset = initialHashValues.some((val) => val === "passreset");
  const tokenStr = initialHashValues.filter((val) =>
    val.startsWith("token="),
  )[0];
  if (tokenStr !== undefined) {
    tokenId = tokenStr.substring("token=".length);
  }
  return { isPostDebugger, tokenId: tokenId ?? null, forcePassReset };
}

/**
 * Returns `true` if the given token can be considered valid.
 * Returns `false` otherwise.
 * @param {string} tokenId
 */
export function isTokenValid(tokenId: string): boolean {
  return /^[A-Za-z0-9]+$/.test(tokenId);
}

/**
 * Display error message given on the top of the page.
 * @param {HTMLElement} errorWrapperElt - HTML
 * @param {Error|string} [err] - The Error encountered.
 * @param {boolean|undefined} [fadeOut] - If `true`, the error fades out at 3
 * seconds then disappears after 5 seconds.
 */
export function displayError(
  errorWrapperElt: HTMLElement,
  err?: unknown,
  fadeOut?: boolean,
): void {
  let message;
  if (err != null) {
    if (typeof err === "string") {
      message = err;
    } else if (typeof (err as Error).message === "string") {
      message = (err as Error).message;
    }
  }
  if (message === undefined) {
    message = "Encountered unknown Error";
  }

  const errorDiv = strHtml`<div class="error-msg">
    ${`${new Date().toISOString()}: Error: ${message}`}
  </div>`;
  if (fadeOut === true) {
    setTimeout(() => {
      errorDiv.classList.add("fade-out");
    }, 3000);
    setTimeout(() => {
      if (errorDiv.parentElement === errorWrapperElt) {
        errorWrapperElt.removeChild(errorDiv);
      }
    }, 5000);
  }
  const bodyElements = errorWrapperElt.children;
  if (bodyElements.length > 0) {
    errorWrapperElt.insertBefore(errorDiv, bodyElements[0]);
  } else {
    errorWrapperElt.appendChild(errorDiv);
  }
}

/**
 * Returns the default top-to-bottom order of the movable inspector modules.
 *
 * The returned value is an array of the module's id in that order.
 * @returns {Array.<string>}
 */
export function getDefaultModuleOrder(): string[] {
  return modules.map(({ moduleId }) => moduleId);
}

/**
 * Similar to Date.toISOString(), but without the timezone offset part
 * and using the local time.
 * '2024-02-01T14:58:36.051Z' => '2024-02-01T14:58:36.051'
 * '2024-02-01T14:58:36.051+05:00' => '2024-02-01T14:58:36.051'
 * @param date the date to convert
 * @returns the date converted to ISO string
 */
export function convertDateToLocalISOString(date: Date): string {
  let ISOstring = "";
  ISOstring += String(date.getFullYear()) + "-";
  ISOstring += String(date.getMonth() + 1).padStart(2, "0") + "-";
  ISOstring += String(date.getDate()).padStart(2, "0") + "T";
  ISOstring += String(date.getHours()).padStart(2, "0") + ":";
  ISOstring += String(date.getMinutes()).padStart(2, "0") + ":";
  ISOstring += String(date.getSeconds()).padStart(2, "0") + ".";
  ISOstring += String(date.getMilliseconds()).padStart(3, "0");
  return ISOstring;
}
/**
 * Converts a number to a human-readable string representation with appropriate bit unit.
 * @example 12500000 => 12.5mb
 * @param value The number to convert.
 * @returns A string representing the human-readable bit unit of the number.
 */
export function convertToReadableBitUnit(value: number): string {
  const units = ["b", "kb", "mb", "gb", "tb"];

  let i = 0;
  let val = value;
  while (val >= 1000 && i < units.length - 1) {
    val /= 1000;
    i++;
  }

  return `${val.toFixed(2)} ${units[i]}`;
}
