import {
  InspectorState,
  InventoryTimelineRangeInfo,
  InventoryTimelineRepresentationInfo,
  RequestInformation,
  STATE_PROPS,
} from "../constants";
import { UPDATE_TYPE } from "../observable_state";

// Welcome to RegExp hell
const REGEX_CONTENT_DURATION =
  /Updating duration (?:newDuration=)?([0-9]+(?:\.[0-9]+)?)$/;
const REGEX_PLAYBACK_TIMELINE_POSITION = /\^([0-9]+(?:\.[0-9]+)?)/;
const REGEX_PLAYER_STATE_CHANGE_STATE_PRE_4_4_0 = /(\w+)$/;
const REGEX_PLAYER_STATE_CHANGE_STATE_POST_4_4_0 = /newState=\"(\w+)"/;
const REGEX_PLAYBACK_INVENTORY_BITRATE = /\((\d+)\)$/;
const REGEX_PLAYBACK_INVENTORY_RANGE = /^(\d+\.\d+)\|(.)\|(\d+\.\d+)/;
const REGEX_BEGINNING_REQUEST_PRE_4_4_0 =
  /* eslint-disable-next-line max-len */
  /^SF: Beginning request (\w+) P: ([^ ]+) A: ([^ ]+) R: ([^ ]+) S: (?:(?:(\d+(?:.\d+)?)-(\d+(?:.\d+)?))|(?:init))/;
const REGEX_ENDED_REQUEST_PRE_4_4_0 =
  /* eslint-disable-next-line max-len */
  /^SF: Segment request ended with success (\w+) P: ([^ ]+) A: ([^ ]+) R: ([^ ]+) S: (?:(?:(\d+(?:.\d+)?)-(\d+(?:.\d+)?))|(?:init))/;
const REGEX_FAILED_REQUEST_PRE_4_4_0 =
  /* eslint-disable-next-line max-len */
  /^SF: Segment request failed (\w+) P: ([^ ]+) A: ([^ ]+) R: ([^ ]+) S: (?:(?:(\d+(?:.\d+)?)-(\d+(?:.\d+)?))|(?:init))/;
const REGEX_CANCELLED_REQUEST_PRE_4_4_0 =
  /* eslint-disable-next-line max-len */
  /^SF: Segment request cancelled (\w+) P: ([^ ]+) A: ([^ ]+) R: ([^ ]+) S: (?:(?:(\d+(?:.\d+)?)-(\d+(?:.\d+)?))|(?:init))/;
const REGEX_MANIFEST_PARSING_TIME = /^MF: Manifest parsed in (\d+(?:\.\d+)?)ms/;
const REGEX_BITRATE_ESTIMATE =
  /^Stream: new video bitrate estimate .* (?:bitrate=)?(\d+\.?\d+)/;

/**
 * Each of the following objects is linked to a type of log.
 *
 * - The `filter` function should return true when we're handling the log concerned
 *   by this object.
 *
 *   It takes in argument the log line and should return `true` if the given log
 *   line concerns this `LogProcessor`.
 *   If `true` is returned, the `processor` function will then be called on that
 *   same line.
 *
 *   Note that multiple LogProcessors' filter functions can pass on the same log
 *   line.
 *
 * - The `processor` function will be the function called if the filter passes.
 *   It should return an array in which each element describes a state update
 *   that can be deduced from that log line (@see StateUpdate).
 *
 * - the `updatedProps` array should list all state properties the `processor`
 *   might alter.
 *   It is used when doing optimizations, such as parsing logs in bulk beginning
 *   by the newest, where we might stop calling the corresponding `LogProcessor`
 *   object once all of its `updatedProps` are already known.
 */
const LogProcessors: Array<LogProcessor<keyof InspectorState>> = [
  {
    filter: (log: string): boolean =>
      // Pre-v4.4.0
      log.startsWith("Init: Updating duration") ||
      // v4.4.0+
      log.startsWith("mse: Updating duration"),
    processor: (
      log: string,
    ): Array<StateUpdate<STATE_PROPS.CONTENT_DURATION>> =>
      processDurationLog(log),
    updatedProps: [STATE_PROPS.CONTENT_DURATION],
  },

  {
    filter: (log: string): boolean =>
      log.startsWith("SI: current video inventory timeline"),
    processor: (log: string): Array<StateUpdate<STATE_PROPS.VIDEO_INVENTORY>> =>
      processInventoryTimelineLog("video", log),
    updatedProps: [STATE_PROPS.VIDEO_INVENTORY],
  },

  {
    filter: (log: string): boolean =>
      log.startsWith("SI: current audio inventory timeline"),
    processor: (log: string): Array<StateUpdate<STATE_PROPS.AUDIO_INVENTORY>> =>
      processInventoryTimelineLog("audio", log),
    updatedProps: [STATE_PROPS.AUDIO_INVENTORY],
  },

  {
    filter: (log: string): boolean =>
      // Pre-v4.4.0
      log.startsWith("API: current playback timeline") ||
      // v4.4.0+
      log.startsWith("media: current playback timeline"),
    processor: (
      log: string,
      _,
      timestamp: number,
    ): Array<StateUpdate<keyof InspectorState>> =>
      processPlaybackTimelineLog(log, timestamp),
    updatedProps: [
      STATE_PROPS.POSITION,
      STATE_PROPS.BUFFER_GAPS,
      STATE_PROPS.BUFFERED_RANGES,
    ],
  },

  {
    filter: (log: string): boolean =>
      log.startsWith("Stream: new video bitrate estimate"),
    processor: (
      log: string,
      _,
      timestamp: number,
    ): Array<StateUpdate<keyof InspectorState>> =>
      processBitrateEstimateLog(log, timestamp),
    updatedProps: [STATE_PROPS.BITRATE_ESTIMATE],
  },
  {
    filter: (log: string): boolean =>
      log.startsWith("API: playerStateChange event"),
    processor: (
      log: string,
      logId: number,
      timestamp: number,
    ): Array<StateUpdate<keyof InspectorState>> =>
      processPlayerStateChangeLog(log, logId, timestamp),
    updatedProps: [
      STATE_PROPS.POSITION,
      STATE_PROPS.BUFFER_GAPS,
      STATE_PROPS.BUFFERED_RANGES,
      STATE_PROPS.PLAYER_STATE,
      STATE_PROPS.STATE_CHANGE_HISTORY,
      STATE_PROPS.CONTENT_DURATION,
      STATE_PROPS.VIDEO_INVENTORY,
      STATE_PROPS.AUDIO_INVENTORY,
      STATE_PROPS.AUDIO_REQUEST_HISTORY,
      STATE_PROPS.VIDEO_REQUEST_HISTORY,
      STATE_PROPS.TEXT_REQUEST_HISTORY,
      STATE_PROPS.MANIFEST_PARSING_TIME_HISTORY,
    ],
  },

  {
    filter: (log: string): boolean =>
      log.startsWith("SF: Beginning request") ||
      log.startsWith("SF: Segment request "),
    processor: (
      log: string,
      _,
      timestamp: number,
    ): Array<StateUpdate<keyof InspectorState>> =>
      processRequestLog(log, timestamp),
    updatedProps: [
      STATE_PROPS.AUDIO_REQUEST_HISTORY,
      STATE_PROPS.VIDEO_REQUEST_HISTORY,
      STATE_PROPS.TEXT_REQUEST_HISTORY,
    ],
  },

  {
    filter: (log: string): boolean => log.startsWith("MF: Manifest parsed in "),
    processor: (
      log: string,
      _,
      timestamp: number,
    ): Array<StateUpdate<keyof InspectorState>> =>
      processManifestParsingTimeLog(log, timestamp),
    updatedProps: [
      STATE_PROPS.AUDIO_REQUEST_HISTORY,
      STATE_PROPS.VIDEO_REQUEST_HISTORY,
      STATE_PROPS.TEXT_REQUEST_HISTORY,
    ],
  },
];

export default LogProcessors;

/**
 * Object allowing to parse a given log line into state updates.
 *
 * `T` corresponds here to the names of the property states that can be updated
 * by this LogProcessor.
 */
export interface LogProcessor<T extends keyof InspectorState> {
  /**
   * Indicates if the current LogProcessor is able to parse state from the
   * given log line.
   * @param {string} log - The log line in question
   * @returns {boolean} - `true` if the current LogProcessor can parse this log
   * line. `false` otherwise.
   */
  filter(log: string): boolean;
  /**
   * State updates that can be deduced from the given log line.
   * Returns an empty array if no state can be deduced.
   * @param {string} log - The log line in question
   * @param {number} id - An identifier to identify that log and select it.
   * @param {number} timestamp - The timestamp at which the log was generated on
   * the device.
   * @returns {Array.<Object>}
   */
  processor(log: string, id: number, timestamp: number): Array<StateUpdate<T>>;
  /** All state properties that might be updated by the `processor` function. */
  updatedProps: T[];
}

/** Information on a state update that can be performed. */
export interface StateUpdate<P extends keyof InspectorState> {
  /** The property that can be updated. */
  property: P;
  /** The type of update that should be performed on the given property. */
  updateType: UPDATE_TYPE;
  /** The value accompanying this update type (@see UPDATE_TYPE). */
  updateValue: InspectorState[P];
}

/**
 * @param {string} logTxt
 * @returns {Array.<Object>}
 */
function processDurationLog(
  logTxt: string,
): Array<StateUpdate<STATE_PROPS.CONTENT_DURATION>> {
  const match = logTxt.match(REGEX_CONTENT_DURATION);
  let duration: number;
  if (match !== null) {
    duration = +match[1];
    return [
      {
        property: STATE_PROPS.CONTENT_DURATION,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: duration,
      },
    ];
  } else {
    console.error("Has duration log format changed?");
  }
  return [];
}

/**
 * @param {string} logTxt
 */
function processPlaybackTimelineLog(
  logTxt: string,
  timestamp: number,
): Array<
  StateUpdate<
    STATE_PROPS.POSITION | STATE_PROPS.BUFFER_GAPS | STATE_PROPS.BUFFERED_RANGES
  >
> {
  const stateUpdates: Array<
    StateUpdate<
      | STATE_PROPS.POSITION
      | STATE_PROPS.BUFFER_GAPS
      | STATE_PROPS.BUFFERED_RANGES
    >
  > = [];
  const splitted = logTxt.split("\n");
  const lastIdx = splitted.length - 1;
  const positionPart = splitted[lastIdx - 1];
  const match = positionPart.match(REGEX_PLAYBACK_TIMELINE_POSITION);
  let position: number;
  if (match !== null) {
    position = +match[1];
    stateUpdates.push({
      property: STATE_PROPS.POSITION,
      updateType: UPDATE_TYPE.REPLACE,
      updateValue: position,
    });
    let bufferLine = splitted[lastIdx - 2];
    if (bufferLine === undefined) {
      console.error("Has playback timeline log format changed?");
    } else {
      bufferLine = bufferLine.trim();
      let bufferGap;
      const ranges: Array<[number, number]> = [];
      while (true) {
        let indexOfPipe = bufferLine.indexOf("|");
        if (indexOfPipe === -1) {
          break;
        }
        const rangeStart = parseFloat(bufferLine.substring(0, indexOfPipe));
        if (isNaN(rangeStart)) {
          console.error("Has playback timeline range log format changed?");
          break;
        }
        bufferLine = bufferLine.substring(indexOfPipe + 1);
        indexOfPipe = bufferLine.indexOf("|");
        if (indexOfPipe === -1) {
          console.error("Has playback timeline range end log format changed?");
          break;
        }
        let indexOfTilde = bufferLine.indexOf("~");
        let rangeEnd;
        if (indexOfTilde === -1) {
          rangeEnd = parseFloat(bufferLine.substring(indexOfPipe + 1).trim());
        } else {
          rangeEnd = parseFloat(
            bufferLine.substring(indexOfPipe + 1, indexOfTilde).trim(),
          );
        }
        if (isNaN(rangeEnd)) {
          console.error("Has playback timeline range end log format changed?");
          break;
        }
        ranges.push([rangeStart, rangeEnd]);
        if (position >= rangeStart && position <= rangeEnd) {
          bufferGap = rangeEnd - position;
        }
        if (indexOfTilde === -1) {
          break;
        }
        bufferLine = bufferLine.substring(indexOfTilde + 1);
        indexOfTilde = bufferLine.indexOf("~");
        if (indexOfTilde === -1) {
          console.error(
            "Has playback timeline consecutive buffer log format changed?",
          );
          break;
        }
        bufferLine = bufferLine.substring(indexOfTilde + 1);
      }
      stateUpdates.push({
        property: STATE_PROPS.BUFFERED_RANGES,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: ranges,
      });

      stateUpdates.push({
        property: STATE_PROPS.BUFFER_GAPS,
        updateType: UPDATE_TYPE.PUSH,
        updateValue: [{ bufferGap, timestamp }],
      });
    }
  } else {
    console.error("Has playback timeline position log format changed?");
  }
  return stateUpdates;
}

/**
 * @param {string} logTxt
 * @param {number} logId
 * @param {number} timestamp
 */
function processPlayerStateChangeLog(
  logTxt: string,
  logId: number,
  timestamp: number,
): Array<
  StateUpdate<
    | STATE_PROPS.POSITION
    | STATE_PROPS.BUFFER_GAPS
    | STATE_PROPS.BITRATE_ESTIMATE
    | STATE_PROPS.BUFFERED_RANGES
    | STATE_PROPS.CONTENT_DURATION
    | STATE_PROPS.VIDEO_INVENTORY
    | STATE_PROPS.AUDIO_INVENTORY
    | STATE_PROPS.AUDIO_REQUEST_HISTORY
    | STATE_PROPS.VIDEO_REQUEST_HISTORY
    | STATE_PROPS.TEXT_REQUEST_HISTORY
    | STATE_PROPS.STATE_CHANGE_HISTORY
    | STATE_PROPS.MANIFEST_PARSING_TIME_HISTORY
    | STATE_PROPS.PLAYER_STATE
  >
> {
  const stateUpdates: Array<
    StateUpdate<
      | STATE_PROPS.POSITION
      | STATE_PROPS.BUFFER_GAPS
      | STATE_PROPS.BITRATE_ESTIMATE
      | STATE_PROPS.BUFFERED_RANGES
      | STATE_PROPS.CONTENT_DURATION
      | STATE_PROPS.VIDEO_INVENTORY
      | STATE_PROPS.AUDIO_INVENTORY
      | STATE_PROPS.AUDIO_REQUEST_HISTORY
      | STATE_PROPS.VIDEO_REQUEST_HISTORY
      | STATE_PROPS.TEXT_REQUEST_HISTORY
      | STATE_PROPS.STATE_CHANGE_HISTORY
      | STATE_PROPS.MANIFEST_PARSING_TIME_HISTORY
      | STATE_PROPS.PLAYER_STATE
    >
  > = [];
  const match =
    logTxt.match(REGEX_PLAYER_STATE_CHANGE_STATE_POST_4_4_0) ??
    logTxt.match(REGEX_PLAYER_STATE_CHANGE_STATE_PRE_4_4_0);
  if (match !== null) {
    const playerState = match[1];
    if (playerState === "STOPPED") {
      stateUpdates.push({
        property: STATE_PROPS.AUDIO_REQUEST_HISTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.VIDEO_REQUEST_HISTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.TEXT_REQUEST_HISTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.MANIFEST_PARSING_TIME_HISTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
    }
    stateUpdates.push({
      property: STATE_PROPS.STATE_CHANGE_HISTORY,
      updateType: UPDATE_TYPE.PUSH,
      updateValue: [
        {
          timestamp,
          state: playerState,
          logId,
        },
      ],
    });
    if (
      playerState === "STOPPED" ||
      playerState === "RELOADING" ||
      playerState === "LOADING"
    ) {
      stateUpdates.push({
        property: STATE_PROPS.POSITION,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.BUFFER_GAPS,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.BUFFERED_RANGES,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.CONTENT_DURATION,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.AUDIO_INVENTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
      stateUpdates.push({
        property: STATE_PROPS.VIDEO_INVENTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: undefined,
      });
    }
    stateUpdates.push({
      property: STATE_PROPS.PLAYER_STATE,
      updateType: UPDATE_TYPE.REPLACE,
      updateValue: playerState,
    });
  } else {
    console.error("Has state log format changed?");
  }
  return stateUpdates;
}

/**
 * @param {string} logTxt
 */
function processInventoryTimelineLog(
  mediaType: "audio",
  logTxt: string,
): Array<StateUpdate<STATE_PROPS.AUDIO_INVENTORY>>;
function processInventoryTimelineLog(
  mediaType: "video",
  logTxt: string,
): Array<StateUpdate<STATE_PROPS.VIDEO_INVENTORY>>;
function processInventoryTimelineLog(
  mediaType: "audio" | "video",
  logTxt: string,
): Array<
  StateUpdate<STATE_PROPS.VIDEO_INVENTORY | STATE_PROPS.AUDIO_INVENTORY>
> {
  const splitted = logTxt.split("\n");

  // Example of format:
  //
  // 39200.00 [log] SI: current video inventory timeline:
  // 0.00|A|6.00 ~ 6.00|B|9.00 ~ 9.00|A|15.00 ~ 15.00|B|18.00
  // [A] P: gen-dash-period-0 || R: video/1(686685)
  // [B] P: gen-dash-period-0 || R: video/4(1929169)

  // Here, we begin at the end by parsing all the Representation informations
  // Then we will parse the timeline and associate both.

  let currentIndex = splitted.length - 1;
  const representationsInfo: Record<
    string,
    InventoryTimelineRepresentationInfo
  > = {};
  while (
    splitted[currentIndex] !== undefined &&
    splitted[currentIndex][0] === "["
  ) {
    const currentLine = splitted[currentIndex];
    const repLetter = currentLine[1];
    const substrStartingWithPeriodId = currentLine.substring("[X] P: ".length);
    const indexOfRep = substrStartingWithPeriodId.indexOf(" || R: ");
    if (indexOfRep < 0) {
      console.error("Has inventory timeline log format changed?");
      return [];
    }
    const periodId = substrStartingWithPeriodId.substring(0, indexOfRep);

    const representationInfoStr = substrStartingWithPeriodId.substring(
      indexOfRep + " || R: ".length,
    );
    const match = representationInfoStr.match(REGEX_PLAYBACK_INVENTORY_BITRATE);
    if (match === null) {
      console.error("Has inventory timeline log format changed?");
      return [];
    }
    const bitrate = +match[1];
    const representationId = representationInfoStr.substring(
      0,
      representationInfoStr.length - match[0].length,
    );
    representationsInfo[repLetter] = {
      bitrate,
      periodId,
      representationId,
    };
    currentIndex--;
  }

  // We should now be at the timeline line, like:
  // 0.00|A|6.00 ~ 6.00|B|9.00 ~ 9.00|A|15.00 ~ 15.00|B|18.00

  const ranges: InventoryTimelineRangeInfo[] = [];
  let remainingTimeline = splitted[currentIndex];
  while (remainingTimeline !== undefined && remainingTimeline.length > 0) {
    const match = remainingTimeline.match(REGEX_PLAYBACK_INVENTORY_RANGE);
    if (match === null) {
      console.error("Has inventory timeline log format changed?");
      return [];
    }
    const start = +match[1];
    const letter = match[2];
    const end = +match[3];
    ranges.push({ start, end, letter });
    remainingTimeline = remainingTimeline.substring(
      match[0].length + " ~ ".length,
    );
  }

  const firstLine = splitted[0];
  if (firstLine === undefined) {
    console.error("Has inventory timeline log format changed?");
    return [];
  }

  if (mediaType === "video") {
    return [
      {
        property: STATE_PROPS.VIDEO_INVENTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: { representations: representationsInfo, ranges },
      },
    ];
  } else if (mediaType === "audio") {
    return [
      {
        property: STATE_PROPS.AUDIO_INVENTORY,
        updateType: UPDATE_TYPE.REPLACE,
        updateValue: { representations: representationsInfo, ranges },
      },
    ];
  }
  return [];
}

/**
 * @param {string} logTxt
 * @returns {Array.<Object>}
 */
function processRequestLog(
  logTxt: string,
  timestamp: number,
): Array<
  StateUpdate<
    | STATE_PROPS.AUDIO_REQUEST_HISTORY
    | STATE_PROPS.VIDEO_REQUEST_HISTORY
    | STATE_PROPS.TEXT_REQUEST_HISTORY
  >
> {
  let parsed: [string, RequestInformation] | null = null;

  if (logTxt.startsWith("SF: Beginning request")) {
    const match = logTxt.match(REGEX_BEGINNING_REQUEST_PRE_4_4_0);
    parsed =
      match === null
        ? parseRequestInformationPost440(logTxt, "start", timestamp)
        : parseRequestInformationPre440(match, "start");
    if (parsed === null) {
      console.error(
        "Unrecognized type. Has Beginning request log format changed?",
      );
      return [];
    }
  } else if (logTxt.startsWith("SF: Segment request ended")) {
    const match = logTxt.match(REGEX_ENDED_REQUEST_PRE_4_4_0);
    parsed =
      match === null
        ? parseRequestInformationPost440(logTxt, "success", timestamp)
        : parseRequestInformationPre440(match, "success");
    if (parsed === null) {
      console.error(
        "Unrecognized type. Has ending request log format changed?",
      );
      return [];
    }
  } else if (logTxt.startsWith("SF: Segment request failed")) {
    const match = logTxt.match(REGEX_FAILED_REQUEST_PRE_4_4_0);
    parsed =
      match === null
        ? parseRequestInformationPost440(logTxt, "failed", timestamp)
        : parseRequestInformationPre440(match, "failed");
    if (parsed === null) {
      console.error(
        "Unrecognized type. Has ending request log format changed?",
      );
      return [];
    }
  } else if (logTxt.startsWith("SF: Segment request cancelled")) {
    const match = logTxt.match(REGEX_CANCELLED_REQUEST_PRE_4_4_0);
    parsed =
      match === null
        ? parseRequestInformationPost440(logTxt, "aborted", timestamp)
        : parseRequestInformationPre440(match, "aborted");
    if (parsed === null) {
      console.error(
        "Unrecognized type. Has ending request log format changed?",
      );
      return [];
    }
  }
  if (parsed === null) {
    return [];
  }
  const [mediaType, requestInfo] = parsed;
  switch (mediaType) {
    case "audio":
      return [
        {
          property: STATE_PROPS.AUDIO_REQUEST_HISTORY,
          updateType: UPDATE_TYPE.PUSH,
          updateValue: [requestInfo],
        },
      ];
    case "video":
      return [
        {
          property: STATE_PROPS.VIDEO_REQUEST_HISTORY,
          updateType: UPDATE_TYPE.PUSH,
          updateValue: [requestInfo],
        },
      ];
    case "text":
      return [
        {
          property: STATE_PROPS.TEXT_REQUEST_HISTORY,
          updateType: UPDATE_TYPE.PUSH,
          updateValue: [requestInfo],
        },
      ];
    default:
      console.error(
        "Unrecognized type. Has Beginning request log format changed?",
        mediaType,
      );
  }
  return [];

  function parseRequestInformationPre440(
    match: RegExpMatchArray | null,
    eventType: RequestInformation["eventType"],
  ): [string, RequestInformation] | null {
    if (match === null) {
      return null;
    }
    const parsedMediaType = match[1];
    const periodId = match[2];
    const adaptationId = match[3];
    const representationId = match[4];
    const segmentStart = +(match[5] ?? -1);
    const segmentDuration = +(match[6] ?? -1);
    if (isNaN(timestamp) || isNaN(segmentStart) || isNaN(segmentDuration)) {
      return null;
    } else {
      return [
        parsedMediaType,
        {
          eventType,
          timestamp,
          periodId,
          adaptationId,
          representationId,
          segmentStart,
          segmentDuration,
        },
      ];
    }
  }
}

function parseRequestInformationPost440(
  logLine: string,
  eventType: RequestInformation["eventType"],
  timestamp: number,
): [string, RequestInformation] | null {
  const parameters = parseLogParameters(logLine);
  if (parameters === null) {
    console.error("Has Beginning request log format changed?");
    return null;
  }
  let parsedMediaType;
  switch (parameters.t) {
    case "v":
      parsedMediaType = "video";
      break;
    case "a":
      parsedMediaType = "audio";
      break;
    case "t":
      parsedMediaType = "text";
      break;
    default:
      console.error(
        "Unrecognized type. Has Beginning request log format changed?",
      );
      return null;
  }

  let segmentDuration = (parameters.se as number) - (parameters.ss as number);
  if (isNaN(segmentDuration)) {
    segmentDuration = -1;
  }
  return [
    parsedMediaType,
    {
      eventType,
      timestamp,
      periodId: parameters.p as string,
      adaptationId: parameters.a as string,
      representationId: parameters.r as string,
      segmentStart: (parameters.ss as number) ?? -1,
      segmentDuration,
    },
  ];
}

/**
 * @param {string} logTxt
 * @param {number} timestamp
 * @returns {Array.<Object>}
 */
function processManifestParsingTimeLog(
  logTxt: string,
  timestamp: number,
): Array<StateUpdate<STATE_PROPS.MANIFEST_PARSING_TIME_HISTORY>> {
  const match = logTxt.match(REGEX_MANIFEST_PARSING_TIME);
  if (match === null) {
    console.error(
      "Unrecognized manifest parsing time log format. Has it changed?",
    );
    return [];
  }
  const timeMs = +match[1];
  if (isNaN(timestamp) || isNaN(timeMs)) {
    console.error(
      "Unrecognized manifest parsing time log format. Has it changed?",
    );
    return [];
  }
  return [
    {
      property: STATE_PROPS.MANIFEST_PARSING_TIME_HISTORY,
      updateType: UPDATE_TYPE.PUSH,
      updateValue: [
        {
          timeMs,
          timestamp,
        },
      ],
    },
  ];
}

/**
 * @param {string} logTxt
 * @param {number} timestamp
 * @returns {Array.<Object>}
 */
function processBitrateEstimateLog(
  logTxt: string,
  timestamp: number,
): Array<StateUpdate<STATE_PROPS.BITRATE_ESTIMATE>> {
  const match = logTxt.match(REGEX_BITRATE_ESTIMATE);
  if (match === null) {
    console.error("Unrecognized bitrate estimate log format. Has it changed?");
    return [];
  }
  const bitrateEstimate = +match[1];
  if (isNaN(timestamp) || isNaN(bitrateEstimate)) {
    console.error("something wrong", timestamp, bitrateEstimate);

    console.error("Unrecognized bitrate estimate log format. Has it changed?");
    return [];
  }
  return [
    {
      property: STATE_PROPS.BITRATE_ESTIMATE,
      updateType: UPDATE_TYPE.PUSH,
      updateValue: [
        {
          timestamp,
          bitrateEstimate,
        },
      ],
    },
  ];
}

function parseLogParameters(
  logLine: string,
): Partial<
  Record<string, number | string | null | undefined | boolean>
> | null {
  // Extract everything after the last space before the parameter list starts
  // Find the part that contains key=value pairs
  const match = logLine.match(/\s+(.+)$/);
  if (!match) {
    return null;
  }

  const paramString = match[1];
  const params: Partial<
    Record<string, number | string | null | undefined | boolean>
  > = {};

  // Regex to match key=value pairs, handling quoted strings with escaped quotes
  const paramRegex = /(\w+)=((?:"(?:[^"\\]|\\.)*")|(?:[^\s]+))/g;

  let regexMatch;
  while ((regexMatch = paramRegex.exec(paramString)) !== null) {
    const [, key, value] = regexMatch;

    // Parse the value based on its format
    if (value.startsWith('"') && value.endsWith('"')) {
      // It's a quoted string - remove quotes and unescape
      params[key] = value
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (value === "true" || value === "false") {
      // It's a boolean
      params[key] = value === "true";
    } else if (value === "null") {
      params[key] = null;
    } else if (value === "undefined") {
      params[key] = undefined;
    } else if (!isNaN(parseFloat(value))) {
      // It's a number
      params[key] = parseFloat(value);
    } else {
      // It's an unquoted string?
      params[key] = value;
    }
  }

  return params;
}
