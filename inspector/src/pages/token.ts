import strHtml from "str-html";
import { CLIENT_SCRIPT_URL, DISABLE_PASSWORD, SERVER_URL } from "../constants";
import { displayError, isTokenValid, generatePageUrl } from "../utils";

/**
 * Generate the HTML page asking for the wanted token.
 * @param {string} password - The password currently used for server
 * interaction. Empty string for no password.
 * @returns {Function} - Perform clean-up if the page is exited.
 */
export default function generateTokenPage(password: string): () => void {
  const persistentTokensListElt = strHtml`<pre class="persistent-tokens-list">Loading... </pre>`;
  const temporaryTokensListElt = strHtml`<pre class="temporary-tokens-list">Loading...</pre>`;
  const errorContainerElt = strHtml`<div></div>`;
  const pageBodyElt = strHtml`<div>
    ${errorContainerElt}
    <div class="header">
      <div class="header-item page-title">
      ${
        DISABLE_PASSWORD
          ? null
          : [
              strHtml`<a href=${generatePageUrl({
                tokenId: null,
                forcePassReset: true,
                isPostDebugger: false,
              })}>${"Password"}</a>`,
              " > Token",
            ]
      }
      </div>
    </div>
    <div class="page-input-block token-block">
      <div class="token-presentation">
        <h2>RxPaired - Token Generation Page</h2>
        <p>${
          "You need a token to link the inspector to a client. " +
          "Those may be created (or reused) in this page."
        }</p>
        <p>${
          "A temporary token (the default type) can be used until either its " +
          "expiration or until no inspector AND no device are linked " +
          "to it anymore."
        }<br>A persistent token can be used until its expiration.</p>
      </div>
      <div>
        <div class="input-title">
          Generate a temporary token:
        </div>
        ${createGenerateTokenButton(errorContainerElt)}
      </div>
      <br>
      <div>
        <div class="input-title">
          <span class="emphasized">OR</span>
          <span> enter the wanted token:</span>
        </div>
        ${createTokenInputElement(password, errorContainerElt)}
      </div>
      <br>
      <div>
        <div class="input-title">
          <span class="emphasized">OR</span>
          <span> import an already-generated log file (Post-Debugger page):</span>
        </div>
        ${createPostDebuggingButtonElt()}
      </div>
      <br>
      <div>
        <div class="persistent-tokens-title">
          List of active persistent tokens:
        </div>
        ${persistentTokensListElt}
        <div class="temporary-tokens-title">
          List of active temporary tokens:
        </div>
        ${temporaryTokensListElt}
      </div>
    </div>
  </div>`;
  document.body.appendChild(pageBodyElt);

  let hasAddedNoTokenTutorial = false;

  // Refresh list of tokens
  const wsUrl =
    password === "" ? `${SERVER_URL}!list` : `${SERVER_URL}${password}/!list`;
  const socket = new WebSocket(wsUrl);
  socket.onmessage = function (evt) {
    let data;
    if (Array.isArray(evt.data)) {
      data = evt.data as unknown as ParsedTokenListServerMessage;
    } else if (typeof evt.data === "string") {
      data = JSON.parse(evt.data) as unknown as ParsedTokenListServerMessage;
    } else {
      console.error("Unrecognized list data");
      return;
    }
    onActiveTokenListUpdate(
      data.tokenList,
      password,
      temporaryTokensListElt,
      persistentTokensListElt,
    );

    if (!hasAddedNoTokenTutorial) {
      pageBodyElt.appendChild(createNoTokenTutorialElement(password !== ""));
      hasAddedNoTokenTutorial = true;
    }
  };
  socket.onclose = function onWebSocketClose() {
    temporaryTokensListElt.innerHTML = "Error: WebSocket connection closed";
    persistentTokensListElt.innerHTML = "Error: WebSocket connection closed";
  };

  return () => {
    socket.onclose = null;
    socket.close();
    document.body.removeChild(pageBodyElt);
  };
}

/**
 * Returns an HTML element corresponding to token generation.
 * @param {HTMLElement} errorContainerElt - HTMLElement on which might be
 * displayed errors if the token is invalid.
 * @returns {HTMLElement}
 */
function createGenerateTokenButton(
  errorContainerElt: HTMLElement,
): HTMLElement {
  const generateTokenButtonElt = strHtml`<button class="btn-generate-token">
    Generate Token
  </button>`;
  generateTokenButtonElt.onclick = () => {
    const tokenId = generateToken();
    setToken(tokenId, errorContainerElt);
  };
  return generateTokenButtonElt;
}

/**
 * @returns {HTMLElement}
 */
function createPostDebuggingButtonElt(): HTMLElement {
  const postDebuggingButtonElt = strHtml`<button>
    Go to Post-Debugger page
  </button>`;
  postDebuggingButtonElt.onclick = () => {
    window.location.href = generatePageUrl({
      tokenId: null,
      forcePassReset: false,
      isPostDebugger: true,
    });
  };
  return postDebuggingButtonElt;
}

/**
 * @param {string} password - The password currently used for server
 * interaction. Empty string for no password.
 * @param {HTMLElement} errorContainerElt - HTMLElement on which might be
 * displayed errors if the token is invalid.
 * @returns {HTMLElement}
 */
function createTokenInputElement(
  password: string,
  errorContainerElt: HTMLElement,
): HTMLElement {
  const tokenInputElt =
    strHtml`<input placeholder="Enter the wanted token">` as HTMLInputElement;
  tokenInputElt.onkeyup = function (evt) {
    if (evt.key === "Enter" || evt.keyCode === 13) {
      if (
        !checkTokenValidityAndDisplayErrorIfNot(
          tokenInputElt.value,
          errorContainerElt,
        )
      ) {
        return;
      }
      setToken(tokenInputElt.value, errorContainerElt);
    }
  };

  const useNowButtonElt =
    strHtml`<button>Use now</button>` as HTMLButtonElement;
  useNowButtonElt.onclick = () => {
    if (
      !checkTokenValidityAndDisplayErrorIfNot(
        tokenInputElt.value,
        errorContainerElt,
      )
    ) {
      return;
    }
    setToken(tokenInputElt.value, errorContainerElt);
  };
  useNowButtonElt.style.marginLeft = "5px";

  const createPersistentButtonElt =
    strHtml`<button>Make persistent</button>` as HTMLButtonElement;
  createPersistentButtonElt.style.marginLeft = "5px";
  const returnedInputedTokenElt = strHtml`<span>${[
    tokenInputElt,
    useNowButtonElt,
    createPersistentButtonElt,
  ]}</span>`;

  const expirationInputElt = strHtml`<input
    placeholder="Duration (hours)"
    type="number" value="48" />` as HTMLInputElement;
  const expirationInputValidateElt = strHtml`<button>Validate!</button>`;
  expirationInputValidateElt.style.marginLeft = "5px";
  expirationInputValidateElt.onclick = onPersistentTokenExpirationValidation;
  expirationInputElt.onkeyup = function (evt) {
    if (evt.key === "Enter" || evt.keyCode === 13) {
      onPersistentTokenExpirationValidation();
    }
  };

  tokenInputElt.onkeyup = function (evt) {
    if (evt.key === "Enter" || evt.keyCode === 13) {
      if (
        !checkTokenValidityAndDisplayErrorIfNot(
          tokenInputElt.value,
          errorContainerElt,
        )
      ) {
        return;
      }
      setToken(tokenInputElt.value, errorContainerElt);
    }
  };

  const expirationInputCancelElt = strHtml`<button>Cancel</button>`;
  expirationInputCancelElt.style.marginLeft = "5px";
  const persistentElt = strHtml`<div class="persistent-token-creation">${[
    "Enter wanted expiration time (in hours):",
    strHtml`<br>`,
    expirationInputElt,
    expirationInputValidateElt,
    expirationInputCancelElt,
  ]}</div>`;
  expirationInputCancelElt.onclick = () => {
    expirationInputElt.value = "48";
    returnedInputedTokenElt.removeChild(persistentElt);
    useNowButtonElt.disabled = false;
    createPersistentButtonElt.disabled = false;
  };

  createPersistentButtonElt.onclick = () => {
    if (tokenInputElt.value === "") {
      displayError(errorContainerElt, new Error("No token inputed"), true);
      return;
    }
    useNowButtonElt.disabled = true;
    createPersistentButtonElt.disabled = true;
    returnedInputedTokenElt.appendChild(persistentElt);
  };

  return returnedInputedTokenElt;

  function onPersistentTokenExpirationValidation() {
    const expirationDelayHours = +expirationInputElt.value;
    if (isNaN(expirationDelayHours)) {
      displayError(
        errorContainerElt,
        new Error("Invalid expiration number"),
        true,
      );
      return;
    }
    const expirationDelayMs = expirationDelayHours * 60 * 60 * 1000;
    if (
      !checkTokenValidityAndDisplayErrorIfNot(
        tokenInputElt.value,
        errorContainerElt,
      )
    ) {
      return;
    }
    createPersistentToken(password, tokenInputElt.value, expirationDelayMs);
    useNowButtonElt.disabled = false;
    createPersistentButtonElt.disabled = false;
    returnedInputedTokenElt.removeChild(persistentElt);
    expirationInputElt.value = "48";
    tokenInputElt.value = "";
  }
}

/**
 * @param {string} tokenValue - The value of the token to set.
 * @param {HTMLElement} errorContainerElt - HTMLElement on which might be
 * displayed errors if the token is invalid.
 */
function setToken(tokenValue: string, errorContainerElt: HTMLElement): void {
  if (!checkTokenValidityAndDisplayErrorIfNot(tokenValue, errorContainerElt)) {
    return;
  }
  window.location.href = generatePageUrl({
    tokenId: tokenValue,
    forcePassReset: false,
    isPostDebugger: false,
  });
}

/**
 * Generate token used to identify a single log session.
 * @returns {string}
 */
function generateToken(): string {
  return Math.random().toString(36).substring(2, 8); // remove `0.`
}

function createNoTokenTutorialElement(hasPassword: boolean): HTMLElement {
  const fakeTokenStr = `!notoken${!hasPassword ? "" : "/<SERVER_PASSWORD>"}`;

  /* eslint-disable max-len */
  const liElt1 = strHtml`<li>
    Load in your HTML page the following script before all other running scripts:
    "<span class="emphasized">${CLIENT_SCRIPT_URL}#${fakeTokenStr}</span>"
    <br>
    For example, you can just add before the first script tag:
    <span class="emphasized">
      ${`<script src="${CLIENT_SCRIPT_URL.replace(
        /"/g,
        '\\"',
      )}#${fakeTokenStr}"></script>`}
    </span>
  </li>`;
  /* eslint-enable max-len */

  const liElt2 = strHtml`<li>
  <span class="emphasized">${"OR"}</span>
    copy-paste the content of <a class="emphasized" href=${CLIENT_SCRIPT_URL}>this file</a>
    inside a new <span class="emphasized">${"<script>"}</span> tag before all other
    ${"<script>"} tags in your page and manually set the
    \`<span class="emphasized">__FORCED_TOKEN__</span>\`
    variable on top of that script to
    <span class="emphasized">"${fakeTokenStr}"</span>${
      hasPassword
        ? [
            " (and again, ",
            strHtml`<span class="emphasized">${"<SERVER_PASSWORD>"}</span>`,
            " to the server's password)",
          ]
        : ""
    }.
  </li>`;

  const dynamicImportCode1 = `import("${CLIENT_SCRIPT_URL}")
  .then(() => {
    window.__RX_INSPECTOR_RUN__({
      url: "${CLIENT_SCRIPT_URL}#${fakeTokenStr}",
      playerClass: <RX_PLAYER_CLASS>,
    });
    console.info("Inspector initialized with success!");
  })
  .catch((error) =>
    console.error("Failed to dynamically import inspector:", error)
  );`;
  const dynamicImportCode2 = `fetch("${CLIENT_SCRIPT_URL}")
  .then((res) => res.text())
  .then((code) => {
    Function(code)();
    window.__RX_INSPECTOR_RUN__({
      url: "${CLIENT_SCRIPT_URL}#${fakeTokenStr}",
      playerClass: <RX_PLAYER_CLASS>,
    });
    console.info("Inspector initialized with success!");
  })
  .catch((error) =>
    console.error("Failed to dynamically import inspector:", error)
  );`;
  const liElt3 = strHtml`<li>
    <span class="emphasized">${"OR"}</span>
    import dynamically the script in your code by writing something like:
    <details class="code-details">
      <summary>code</summary>
      <pre>${dynamicImportCode1}</pre>
      Where <span class="emphasized">${"<RX_PLAYER_CLASS>"}</span>
      is a reference to the RxPlayer's class in your code${
        hasPassword
          ? [
              " and ",
              strHtml`<span class="emphasized">${"<SERVER_PASSWORD>"}</span>`,
              " has to be replaced by the server's password",
            ]
          : ""
      }.
      <br>
      <br>
      Alternatively, if that does not work because dynamic import is not
      supported by your building process or by the device, you may be able
      to rely on dynamic function creation instead:
      <pre>${dynamicImportCode2}</pre>
      Likewise don't forget to replace
      <span class="emphasized">${"<RX_PLAYER_CLASS>"}</span>
      by a reference to the RxPlayer's class in your code${
        hasPassword
          ? [
              " and ",
              strHtml`<span class="emphasized">${"<SERVER_PASSWORD>"}</span>`,
              " by the server's password",
            ]
          : ""
      }.
    </details>
  </li>`;

  const noTokenStr = !hasPassword ? "!notoken" : "!notoken/<SERVER_PASSWORD>";
  const res = strHtml`<div class="no-token-tutorial">
    <span class="emphasized">
      If you want to start logging without creating a token through the inspector:
    </span>
    <br>
    <span>
      You can also start debugging on the device without
      having to create a token first, by replacing on the client script
      the token by
    </span>
    <span class="emphasized">${noTokenStr}</span><span>${
      hasPassword
        ? [
            " where ",
            strHtml`<span class="emphasized">${"<SERVER_PASSWORD>"}</span>`,
            " has to be replaced by the server's password",
          ]
        : ""
    }. In that case, a token will be automatically generated by the server and
    listed on this page when active on the device.</span>
    <br>
    <br>
    <span>
      This can be done in any of the following way:
    </span>
    <ul>${[liElt1, liElt2, liElt3]}</ul>
  </div>`;
  return res;
}

/**
 * Function to call when the WebSocket maintained to update the list of current
 * tokens receives a message.
 * @param {Array.<Object>} activeTokensList
 * @param {string} password - The password currently used for server
 * interaction. Empty string for no password.
 * @param {HTMLElement} temporaryTokensListElt - The HTMLElement which will be
 * updated to the list of available temporary tokens regularly.
 * @param {HTMLElement} persistentTokensListElt - The HTMLElement which will be
 * updated to the list of available persistent tokens regularly.
 */
function onActiveTokenListUpdate(
  activeTokensList: ParsedTokenListServerMessage["tokenList"],
  password: string,
  temporaryTokensListElt: HTMLElement,
  persistentTokensListElt: HTMLElement,
): void {
  activeTokensList.sort((a, b) => b.date - a.date);
  const persistentTokenElements: HTMLElement[] = [];
  let hasActiveTemporaryToken = false;
  const temporaryTokenDataElt: HTMLElement = activeTokensList.reduce(
    (acc, d) => {
      const date = new Date(d.date);
      const dateStr =
        date.toLocaleDateString() + " @ " + date.toLocaleTimeString();
      const linkElt = strHtml`<a href=${generatePageUrl({
        tokenId: d.tokenId,
        forcePassReset: false,
        isPostDebugger: false,
      })} />`;
      if (d.isPersistent) {
        linkElt.appendChild(strHtml`<td>${d.tokenId}</td>`);
        const revokeButtonElt = strHtml`<button
          class="persistent-token-revokation-button"
        >Revoke</button>`;
        revokeButtonElt.onclick = () => {
          createPersistentToken(password, d.tokenId, -1);
        };
        persistentTokenElements.push(strHtml`<tr>
            <td>${dateStr}</td>
            <td>${linkElt}</td>
            <td>${millisecondsToTimeString(d.msUntilExpiration)}</td>
            <td>${revokeButtonElt}</td>
          </tr>`);
        return acc;
      }
      hasActiveTemporaryToken = true;
      linkElt.appendChild(strHtml`<span>${dateStr}</span>`);
      linkElt.appendChild(document.createTextNode(" - "));
      linkElt.appendChild(strHtml`<span>${d.tokenId}</span>`);
      linkElt.appendChild(document.createTextNode(" "));
      linkElt.appendChild(
        strHtml`<span>(expires in ${millisecondsToTimeString(
          d.msUntilExpiration,
        )})</span>`,
      );
      const listElt = strHtml`<li class="button-input-right">${linkElt}</li>`;
      acc.appendChild(listElt);
      return acc;
    },
    strHtml`<ul class="temporary-token-list" />`,
  );
  if (!hasActiveTemporaryToken) {
    temporaryTokensListElt.innerHTML = "No active token";
  } else {
    temporaryTokensListElt.innerHTML = "";
    temporaryTokensListElt.appendChild(temporaryTokenDataElt);
  }
  if (persistentTokenElements.length === 0) {
    persistentTokensListElt.innerHTML = "No persistent token";
  } else {
    persistentTokensListElt.innerHTML = "";
    persistentTokensListElt.appendChild(strHtml`<table class="persistent-token-table">
        <tr>
          <th>Date of creation</th>
          <th>Token</th>
          <th>Expires in</th>
          <th>Revoke</th>
        </tr>
        ${persistentTokenElements}
      </table>`);
    persistentTokensListElt.appendChild(strHtml`<br>`);
  }
}

function millisecondsToTimeString(timeMs: number): string {
  if (timeMs < 1000) {
    return "< 1 s";
  }
  if (timeMs < 120_000) {
    return `${Math.floor(timeMs / 1000)} s`;
  }
  if (timeMs < 2 * 3600_000) {
    return `${Math.floor(timeMs / 60_000)} minutes`;
  }

  const hours = Math.floor(timeMs / 3600_000);
  const minutes = Math.floor((timeMs % 3600_000) / 60_000);
  if (minutes === 0) {
    return `${hours} hours`;
  }
  if (minutes === 1) {
    return `${hours} hours, ${minutes} minute`;
  }
  return `${hours} hours, ${minutes} minutes`;
}

/**
 * Tells the server side to create a new persistent token.
 * @param {string} password - The password currently used for server
 * interaction. Empty string for no password.
 * @param {string} tokenId - The current used token.
 * @param {number} expirationDelayMs - Time in milliseconds, after which
 * the token should be revokated.
 */
function createPersistentToken(
  password: string,
  tokenId: string,
  expirationDelayMs: number,
): void {
  const wsUrl =
    password === ""
      ? `${SERVER_URL}!persist/${tokenId}/${expirationDelayMs}`
      : `${SERVER_URL}${password}/!persist/${tokenId}/${expirationDelayMs}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = function (evt) {
    if (evt?.data === "ack") {
      ws.close();
    }
  };
}

interface ParsedTokenListServerMessage {
  isNoTokenEnabled: boolean;
  tokenList: Array<{
    date: number;
    timestamp: number;
    tokenId: string;
    isPersistent: boolean;
    msUntilExpiration: number;
  }>;
}

function checkTokenValidityAndDisplayErrorIfNot(
  tokenValue: string,
  errorContainerElt: HTMLElement,
): boolean {
  if (tokenValue === "") {
    displayError(errorContainerElt, new Error("No token inputed"), true);
    return false;
  }
  if (!isTokenValid(tokenValue)) {
    const error = new Error(
      "Error: A token must only contain alphanumeric characters",
    );
    displayError(errorContainerElt, error, true);
    return false;
  }
  return true;
}
