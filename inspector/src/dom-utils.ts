/**
 * Create an HTML element.
 * @param {string} elementName - The element's name, like `"div"` for example.
 * @param {Object} [options={}] - Optional attributes for the element.
 * @param {string} [options.textContent] - Inner text for that element.
 * @param {string} [options.className] - Value for a `class` attribute
 * associated to this element.
 * @param {Function} [options.onClick] - Action to take if the user clicks on
 * the element.
 * @param {Object} [options.style] - Overriding of the default CSS style
 * declaration for that element.
 * @returns {HTMLElement}
 */
export function createElement(
  elementName: "input",
  opts?: CreateElementOptions | undefined,
): HTMLInputElement;
export function createElement(
  elementName: "button",
  opts?: CreateElementOptions | undefined,
): HTMLButtonElement;
export function createElement(
  elementName: "select",
  opts?: CreateElementOptions | undefined,
): HTMLSelectElement;
export function createElement(
  elementName: "option",
  opts?: CreateElementOptions | undefined,
): HTMLOptionElement;
export function createElement(
  elementName: "a",
  opts?: CreateElementOptions | undefined,
): HTMLLinkElement;
export function createElement(
  elementName: string,
  opts?: CreateElementOptions | undefined,
): HTMLElement;
export function createElement(
  elementName: string,
  {
    textContent,
    className,
    onClick,
    style,
  }: CreateElementOptions | undefined = {},
): HTMLElement {
  const elt = document.createElement(elementName);
  if (className !== undefined) {
    elt.className = className;
  }
  if (textContent !== undefined) {
    elt.textContent = textContent;
  }
  if (onClick !== undefined) {
    elt.onclick = onClick;
  }
  applyPartialStyleOnElement(elt, style);
  return elt;
}

interface CreateElementOptions {
  textContent?: string | undefined;
  className?: string | undefined;
  onClick?: (() => void) | undefined;
  style?: Partial<CSSStyleDeclaration> | undefined;
}

/**
 * Create an HTML element which may contain mutiple HTML sub-elements.
 * @param {string} rootElementName - The element's name, like `"div"` for
 * example.
 * @param {Array.<string|HTMLElement>} parts - The HTML sub-elements, in order.
 * Those can also just be strings, in which case only text nodes (and no actual
 * HTMLElement) will be added at this place.
 * @param {Object} [options={}] - Optional attributes for the element.
 * @param {string} [options.className] - Value for a `class` attribute
 * associated to this element.
 * @param {Function} [options.onClick] - Action to take if the user clicks on
 * the element.
 * @param {Object} [options.style] - Overriding of the default CSS style
 * declaration for that element.
 * @returns {HTMLElement}
 */
export function createCompositeElement(
  rootElementName: string,
  parts: Array<HTMLElement | string>,
  {
    className,
    onClick,
    style,
  }: Exclude<CreateElementOptions, "textContent"> | undefined = {},
): HTMLElement {
  const elt = document.createElement(rootElementName);
  if (className !== undefined) {
    elt.className = className;
  }
  if (onClick !== undefined) {
    elt.onclick = onClick;
  }
  applyPartialStyleOnElement(elt, style);
  for (const subElt of parts) {
    if (typeof subElt === "string") {
      elt.appendChild(document.createTextNode(subElt));
    } else {
      elt.appendChild(subElt);
    }
  }
  return elt;
}

/**
 * Create an HTML Link element.
 * @param {Object} [options={}] - Optional attributes for the element.
 * @param {string} [options.href] - The link's href
 * @param {string} [options.textContent] - Inner text for that element.
 * @param {string} [options.className] - Value for a `class` attribute
 * associated to this element.
 * @param {Function} [options.onClick] - Action to take if the user clicks on
 * the element.
 * @param {Object} [options.style] - Overriding of the default CSS style
 * declaration for that element.
 * @returns {HTMLLinkElement}
 */
export function createLinkElement(
  options:
    | (CreateElementOptions & { href?: string | undefined })
    | undefined = {},
): HTMLLinkElement {
  const element = createElement("a", options);
  if (options.href !== undefined) {
    element.href = options.href;
  }
  return element;
}

/**
 * Create an HTML button element.
 * @param {Object} [options={}] - Optional attributes for the button element.
 * @param {string} [options.className] - Value for a `class` attribute
 * associated to this button element.
 * @param {string} [options.title] - Value for a `title` attribute
 * associated to this button element.
 * @param {boolean} [options.title] - If `true`, the button element is disabled
 * by default.
 * @param {Function} [options.onClick] - Action to take if the user clicks on
 * the button element.
 * @param {Object} [options.style] - Overriding of the default CSS style
 * declaration for that element.
 * @returns {HTMLElement}
 */
export function createButton({
  className,
  textContent,
  title,
  disabled,
  onClick,
  style,
}: {
  textContent?: string | undefined;
  className?: string | undefined;
  title?: string | undefined;
  disabled?: boolean;
  onClick?: (() => void) | undefined;
  style?: Partial<CSSStyleDeclaration> | undefined;
}): HTMLButtonElement {
  const buttonElt = createElement("button", {
    className,
    textContent,
  });
  if (title !== undefined) {
    buttonElt.title = title;
  }
  if (onClick !== undefined) {
    buttonElt.onclick = onClick;
  }
  if (disabled !== undefined) {
    buttonElt.disabled = disabled;
  }
  applyPartialStyleOnElement(buttonElt, style);
  return buttonElt;
}

/**
 * Apply the given optional and partial CSSStyleDeclaration on the given
 * element.
 * @param {HTMLElement} element
 * @param {Object|undefined} style - Overriding of the default CSS style
 * declaration for that element.
 */
function applyPartialStyleOnElement(
  element: HTMLElement,
  style: Partial<CSSStyleDeclaration> | undefined,
): void {
  if (style !== undefined) {
    for (const key in style) {
      if (style.hasOwnProperty(key)) {
        const val = style[key];
        if (val !== undefined) {
          element.style[key] = val;
        }
      }
    }
  }
}
