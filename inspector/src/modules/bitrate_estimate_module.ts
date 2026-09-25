import strHtml from "str-html";
import { ConfigState, InspectorState, STATE_PROPS } from "../constants";
import ObservableState from "../observable_state";
import { convertToReadableBitUnit } from "../utils";
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
 * Maximum history of the bitrate estimate that will be displayed, in milliseconds.
 * For example, a value of `3000` indicates that we will just show at most the
 * bitrate estimate evolution during the last 3 seconds.
 */
const TIME_SAMPLES_MS = 60000;

/** Full width of the canvas. */
const DEFAULT_CANVAS_WIDTH = DEFAULT_DRAWABLE_WIDTH;

/** Full height of the canvas. */
const DEFAULT_CANVAS_HEIGHT =
  DEFAULT_DRAWABLE_HEIGHT + HEIGHT_MARGIN_TOP + HEIGHT_MARGIN_BOTTOM;

const CANVAS_ASPECT_RATIO = DEFAULT_CANVAS_WIDTH / DEFAULT_CANVAS_HEIGHT;

/**
 * At start, that value will be taken in the chart as a maximum bitrate.
 * If samples go higher than this value, the chart will adapt automatically to
 * a higher scale.
 * However if values go below that value, the chart won't scale down more than
 * this.
 */
const BITRATE_INITIAL_UPPER_LIMIT = 10000;

/**
 * @param {Object} args
 */
export default function BitrateEstimateModule({
  state,
  configState,
}: ModuleFunctionArguments) {
  const bitrateEstimateBodyElt = strHtml`<div class="bitrate-estimate-body module-body"/>`;
  const [bitrateEstimateElt, disposeBitrateEstimateChart] =
    createBitrateEstimateChart(bitrateEstimateBodyElt, state, configState);
  bitrateEstimateBodyElt.appendChild(bitrateEstimateElt);
  bitrateEstimateBodyElt.style.resize = "vertical";
  bitrateEstimateBodyElt.style.overflow = "auto";

  return {
    body: bitrateEstimateBodyElt,
    destroy() {
      disposeBitrateEstimateChart();
    },
  };
}

/**
 * Display a chart showing the evolution of the bitrate estimate over time.
 * @param {HTMLElement} parentResizableElement
 * @param {Object} state
 * @param {Object} configState
 * @returns {Array.<HTMLElement|Function>}
 */
function createBitrateEstimateChart(
  parentResizableElement: HTMLElement,
  state: ObservableState<InspectorState>,
  configState: ObservableState<ConfigState>,
): [HTMLElement, () => void] {
  let currentMaxBitrate = BITRATE_INITIAL_UPPER_LIMIT;
  const canvasElt =
    strHtml`<canvas class="canvas-bitrate-estimate" />` as HTMLCanvasElement;
  canvasElt.width = DEFAULT_CANVAS_WIDTH;
  canvasElt.height = DEFAULT_CANVAS_HEIGHT;
  canvasElt.style.display = "absolute";
  const canvasCtx = canvasElt.getContext("2d");
  const measurePointEventListener: Array<(e: MouseEvent) => void> = [];
  const canvasOverlay = strHtml`<div>${canvasElt}</div>`;
  canvasOverlay.style.position = "relative";
  canvasOverlay.style.width = `${DEFAULT_CANVAS_WIDTH}px`;
  canvasOverlay.style.height = `${DEFAULT_CANVAS_HEIGHT}px`;
  canvasOverlay.style.maxWidth = "100%";
  const canvasParent = strHtml`<div>${canvasOverlay}</div>`;
  canvasParent.style.display = "flex";
  canvasParent.style.justifyContent = "center";
  canvasParent.style.overflow = "hidden";
  canvasParent.style.aspectRatio = `${CANVAS_ASPECT_RATIO}`;
  const tooltipElements: HTMLElement[] = [];

  reRender();
  state.subscribe(STATE_PROPS.BITRATE_ESTIMATE, reRender);
  configState.subscribe(STATE_PROPS.CSS_MODE, reRender);

  const resizeObserver = new ResizeObserver(onBodyResize);
  resizeObserver.observe(parentResizableElement);
  let lastClientHeight: number | undefined;

  return [
    canvasParent,
    () => {
      cleanTooltips();
      state.unsubscribe(STATE_PROPS.BITRATE_ESTIMATE, reRender);
      configState.unsubscribe(STATE_PROPS.CSS_MODE, reRender);
      resizeObserver.unobserve(parentResizableElement);
    },
  ];

  function reRender(): void {
    cleanTooltips();
    const bitrateEstimates = state.getCurrentState(
      STATE_PROPS.BITRATE_ESTIMATE,
    );
    if (bitrateEstimates !== undefined && bitrateEstimates.length > 0) {
      const lastDate = bitrateEstimates[bitrateEstimates.length - 1].timestamp;
      const minimumTime = Math.max(0, lastDate - TIME_SAMPLES_MS);
      let i;
      for (i = bitrateEstimates.length - 1; i >= 1; i--) {
        if (bitrateEstimates[i].timestamp <= minimumTime) {
          break;
        }
      }
      const consideredData = bitrateEstimates.slice(i);
      onNewData(consideredData);
    } else {
      onNewData([]);
    }
  }

  function cleanTooltips(): void {
    for (const eventListener of measurePointEventListener) {
      canvasElt.removeEventListener("mousemove", eventListener);
    }
    while (tooltipElements.length > 0) {
      const tooltip = tooltipElements.pop();
      // typescript check, it should never occur.
      if (tooltip === undefined) {
        break;
      }
      canvasOverlay.removeChild(tooltip);
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

    canvasOverlay.style.width = `${CANVAS_ASPECT_RATIO * wantedHeight}px`;
    canvasOverlay.style.height = `${wantedHeight}px`;

    reRender();
    lastClientHeight = parentResizableElement.clientHeight;
  }

  function onNewData(
    data: Array<{ bitrateEstimate: number | undefined; timestamp: number }>,
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

    currentMaxBitrate = getNewMaxBitrate();
    const minDate = data[0].timestamp;

    let height = canvasElt.height - HEIGHT_MARGIN_TOP - HEIGHT_MARGIN_BOTTOM;
    const gridHeight = height / currentMaxBitrate;
    const gridWidth = canvasElt.width / TIME_SAMPLES_MS;

    drawData();
    drawGrid();

    /**
     * Get more appropriate maximum bitrate estimate to put on top of the graph
     * according to current data.
     */
    function getNewMaxBitrate(): number {
      const maxPoint = Math.max(...data.map((d) => d.bitrateEstimate ?? 0));
      if (maxPoint >= currentMaxBitrate) {
        return maxPoint * 1.1;
      } else if (maxPoint < currentMaxBitrate * 0.9) {
        return Math.max(maxPoint * 1.1, BITRATE_INITIAL_UPPER_LIMIT);
      }
      return currentMaxBitrate;
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
      const stepVal = currentMaxBitrate / nbGridLines;
      for (let i = 0; i <= nbGridLines; i++) {
        const nHeight = stepHeight * i + HEIGHT_MARGIN_TOP;
        canvasCtx.moveTo(0, nHeight);
        canvasCtx.font = "14px Arial";
        const currStepVal = stepVal * (nbGridLines - i);
        const isDark =
          configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark";
        if (isDark) {
          canvasCtx.fillStyle = "#ffffff";
        } else {
          canvasCtx.fillStyle = "#000000";
        }
        canvasCtx.fillText(convertToReadableBitUnit(currStepVal), 0, nHeight);
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
      canvasCtx.moveTo(0, bitrateValueToY(data[0].bitrateEstimate ?? 0));
      for (let i = 1; i < data.length; i++) {
        canvasCtx.lineTo(
          dateToX(data[i].timestamp),
          bitrateValueToY(data[i].bitrateEstimate ?? 0),
        );
      }
      canvasCtx.stroke();

      // add measure points
      canvasCtx.fillStyle = "rgb(200, 100, 200)";
      for (let i = 1; i < data.length; i++) {
        const x = dateToX(data[i].timestamp);
        const y = bitrateValueToY(data[i].bitrateEstimate ?? 0);
        const circle = new Path2D();
        circle.arc(x, y ?? 0, 4, 0, 2 * Math.PI);
        canvasCtx.fill(circle);

        const tooltip = strHtml`<span> </span>`;
        tooltip.innerText = convertToReadableBitUnit(
          data[i].bitrateEstimate ?? 0,
        );
        tooltip.style.position = "absolute";
        tooltip.style.visibility = "hidden";
        // center the tooltip and display it just a bit higher than the point
        tooltip.style.top = `${y - 30}px`;
        tooltip.style.left = `${x - 20}px`;
        tooltip.style.padding = "2px";
        tooltip.style.backgroundColor =
          configState.getCurrentState(STATE_PROPS.CSS_MODE) === "dark"
            ? "#000"
            : "#fff";

        canvasOverlay.appendChild(tooltip);
        const eventHander = (e: MouseEvent) => {
          if (canvasCtx.isPointInPath(circle, e.offsetX, e.offsetY)) {
            tooltip.style.visibility = "visible";
          } else {
            tooltip.style.visibility = "hidden";
          }
        };
        tooltipElements.push(tooltip);
        canvasElt.addEventListener("mousemove", eventHander);
        measurePointEventListener.push(eventHander);
      }
    }

    /**
     * Convert a value of a given data point, to a u coordinate in the canvas.
     * @param {number} bitrate - Value to convert
     * @returns {number} - y coordinate
     */
    function bitrateValueToY(bitrate: number): number {
      return HEIGHT_MARGIN_TOP + (currentMaxBitrate - bitrate) * gridHeight;
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
