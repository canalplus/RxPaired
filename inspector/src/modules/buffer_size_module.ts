import strHtml from "str-html";
import { ConfigState, InspectorState, STATE_PROPS } from "../constants";
import ObservableState from "../observable_state";
import { ModuleFunctionArguments } from ".";

/**
 * Margin on the bottom of the canvas.
 * No line will be drawn below it.
 */
const HEIGHT_MARGIN_BOTTOM = 5;

/**
 * Margin on the top of the canvas.
 * No line will be drawn above it.
 */
const HEIGHT_MARGIN_TOP = 20;

/**
 * "Drawable" height of the canvas.
 * The drawable height is basically the full height minus height margins.
 */
const DEFAULT_DRAWABLE_HEIGHT = 230;

/**
 * "Drawable" with of the canvas.
 * The drawable width is basically the full width minus potential width
 * margins.
 */
const DEFAULT_DRAWABLE_WIDTH = 1500;

/**
 * Maximum history of the buffer size that will be displayed, in milliseconds.
 * For example, a value of `3000` indicates that we will just show at most the
 * buffer size evolution during the last 3 seconds.
 */
const TIME_SAMPLES_MS = 60000;

/** Full width of the canvas. */
const DEFAULT_CANVAS_WIDTH = DEFAULT_DRAWABLE_WIDTH;

/** Full height of the canvas. */
const DEFAULT_CANVAS_HEIGHT =
  DEFAULT_DRAWABLE_HEIGHT + HEIGHT_MARGIN_TOP + HEIGHT_MARGIN_BOTTOM;

const CANVAS_ASPECT_RATIO = DEFAULT_CANVAS_WIDTH / DEFAULT_CANVAS_HEIGHT;

/**
 * At minimum, that value will be taken in the chart as a maximum buffer size,
 * in seconds.
 * If samples go higher than this size, the chart will adapt automatically to
 * a higher scale.
 * However if values go below that value, the chart won't scale down more than
 * this.
 */
const MINIMUM_MAX_BUFFER_SIZE = 20;

/**
 * @param {Object} args
 */
export default function BufferSizeModule({
  state,
  configState,
}: ModuleFunctionArguments) {
  const bufferSizeBodyElt = strHtml`<div class="buffer-size-body module-body"/>`;
  const [bufferSizeElt, disposeBufferSizeChart] = createBufferSizeChart(
    bufferSizeBodyElt,
    state,
    configState,
  );
  bufferSizeBodyElt.appendChild(bufferSizeElt);
  bufferSizeBodyElt.style.resize = "vertical";
  bufferSizeBodyElt.style.overflow = "auto";

  return {
    body: bufferSizeBodyElt,
    destroy() {
      disposeBufferSizeChart();
    },
  };
}

/**
 * Display a chart showing the evolution of the buffer size over time.
 * @param {HTMLElement} parentResizableElement
 * @param {Object} state
 * @param {Object} configState
 * @returns {Array.<HTMLElement|Function>}
 */
function createBufferSizeChart(
  parentResizableElement: HTMLElement,
  state: ObservableState<InspectorState>,
  configState: ObservableState<ConfigState>,
): [HTMLElement, () => void] {
  let currentMaxSize = MINIMUM_MAX_BUFFER_SIZE;
  const canvasElt =
    strHtml`<canvas class="canvas-buffer-size" />` as HTMLCanvasElement;
  canvasElt.width = DEFAULT_CANVAS_WIDTH;
  canvasElt.height = DEFAULT_CANVAS_HEIGHT;
  const canvasCtx = canvasElt.getContext("2d");

  reRender();
  state.subscribe(STATE_PROPS.BUFFER_GAPS, reRender);
  configState.subscribe(STATE_PROPS.CSS_MODE, reRender);

  const resizeObserver = new ResizeObserver(onBodyResize);
  resizeObserver.observe(parentResizableElement);
  let lastClientHeight: number | undefined;

  const canvasParent = strHtml`<div>${canvasElt}</div>`;
  canvasParent.style.textAlign = "center";

  return [
    canvasParent,
    () => {
      state.unsubscribe(STATE_PROPS.BUFFER_GAPS, reRender);
      configState.unsubscribe(STATE_PROPS.CSS_MODE, reRender);
      resizeObserver.unobserve(parentResizableElement);
    },
  ];

  function reRender(): void {
    const bufferGaps = state.getCurrentState(STATE_PROPS.BUFFER_GAPS);
    if (bufferGaps !== undefined && bufferGaps.length > 0) {
      const lastDate = bufferGaps[bufferGaps.length - 1].timestamp;
      const minimumTime = Math.max(0, lastDate - TIME_SAMPLES_MS);
      let i;
      for (i = bufferGaps.length - 1; i >= 1; i--) {
        if (bufferGaps[i].timestamp <= minimumTime) {
          break;
        }
      }
      const consideredData = bufferGaps.slice(i);
      onNewData(consideredData);
    } else {
      onNewData([]);
    }
  }

  function onBodyResize(): void {
    const clientHeight = parentResizableElement.clientHeight;
    const wantedHeight = clientHeight - 20;
    if (lastClientHeight === clientHeight) {
      return;
    }
    canvasElt.height = wantedHeight;
    canvasElt.width = CANVAS_ASPECT_RATIO * wantedHeight;
    reRender();
    lastClientHeight = parentResizableElement.clientHeight;
  }

  function onNewData(
    data: Array<{ bufferGap: number | undefined; timestamp: number }>,
  ): void {
    if (canvasCtx === null) {
      return;
    }
    clearAndResizeCanvas(canvasCtx);
    if (data.length === 0) {
      canvasCtx.font = "14px Arial";
      const posX = canvasElt.width / 2 - 40;
      const isDark =
        configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
      if (isDark) {
        canvasCtx.fillStyle = "#ffffff";
      } else {
        canvasCtx.fillStyle = "#000000";
      }
      canvasCtx.fillText("No data yet", posX, 14 + 5);
      return;
    }

    currentMaxSize = getNewMaxBufferSize();
    const minDate = data[0].timestamp;

    let height = canvasElt.height - HEIGHT_MARGIN_TOP - HEIGHT_MARGIN_BOTTOM;
    const gridHeight = height / currentMaxSize;
    const gridWidth = canvasElt.width / TIME_SAMPLES_MS;

    drawData();
    drawGrid();

    /**
     * Get more appropriate maximum buffer size to put on top of the graph
     * according to current data.
     */
    function getNewMaxBufferSize(): number {
      const maxPoint = Math.max(...data.map((d) => d.bufferGap ?? 0));
      if (maxPoint >= currentMaxSize) {
        return maxPoint + 5;
      } else if (maxPoint < currentMaxSize - 5) {
        return Math.max(maxPoint + 5, MINIMUM_MAX_BUFFER_SIZE);
      }
      return currentMaxSize;
    }

    /**
     * Draw grid lines on canvas and their correspinding values.
     */
    function drawGrid(): void {
      if (canvasCtx === null) {
        return;
      }
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = "lightgrey";
      canvasCtx.lineWidth = 1;
      height = canvasElt.height - HEIGHT_MARGIN_TOP - HEIGHT_MARGIN_BOTTOM;
      let nbGridLines;
      if (height > 300) {
        nbGridLines = 10;
      } else if (height > 200) {
        nbGridLines = 7;
      } else if (height > 100) {
        nbGridLines = 5;
      } else if (height > 50) {
        nbGridLines = 3;
      } else {
        nbGridLines = 2;
      }
      const stepHeight = height / nbGridLines;
      const stepVal = currentMaxSize / nbGridLines;
      for (let i = 0; i <= nbGridLines; i++) {
        const nHeight = stepHeight * i + HEIGHT_MARGIN_TOP;
        canvasCtx.moveTo(0, nHeight);
        canvasCtx.font = "14px Arial";
        const currStepVal = (stepVal * (nbGridLines - i)).toFixed(1);
        const isDark =
          configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
        if (isDark) {
          canvasCtx.fillStyle = "#ffffff";
        } else {
          canvasCtx.fillStyle = "#000000";
        }
        canvasCtx.fillText(`${currStepVal} s`, 0, nHeight);
        canvasCtx.lineTo(canvasElt.width, nHeight);
      }
      canvasCtx.stroke();
    }

    /**
     * Draw all data contained in `data` in the canvas given.
     */
    function drawData(): void {
      if (canvasCtx === null) {
        return;
      }
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = "rgb(200, 100, 200)";
      canvasCtx.lineWidth = 2;
      canvasCtx.moveTo(0, bufferValueToY(data[0].bufferGap ?? 0));
      for (let i = 1; i < data.length; i++) {
        canvasCtx.lineTo(
          dateToX(data[i].timestamp),
          bufferValueToY(data[i].bufferGap ?? 0),
        );
      }
      canvasCtx.stroke();
    }

    /**
     * Convert a value of a given data point, to a u coordinate in the canvas.
     * @param {number} bufferVal - Value to convert
     * @returns {number} - y coordinate
     */
    function bufferValueToY(bufferVal: number): number {
      return HEIGHT_MARGIN_TOP + (currentMaxSize - bufferVal) * gridHeight;
    }

    /**
     * Convert a date of a given data point, to a x coordinate in the canvas.
     * @param {number} date - Date to convert, in milliseconds
     * @returns {number} - x coordinate
     */
    function dateToX(date: number): number {
      return (date - minDate) * gridWidth;
    }
  }
}

/**
 * Clear the whole canvas.
 * @param {CanvasRenderingContext2D} canvasContext
 */
function clearAndResizeCanvas(canvasContext: CanvasRenderingContext2D): void {
  const canvasElt = canvasContext.canvas;
  canvasContext.clearRect(0, 0, canvasElt.width, canvasElt.height);
}
