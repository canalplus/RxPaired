/** Parse the timestamp and optional app-minus-capture offset of a log line. */
export function parseLogPrefixTime(log: string): {
  timestamp: number;
  offset: number | undefined;
  message: string;
} | null {
  const match = log.match(/^(\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)? (.*)$/s);
  if (match === null) {
    return null;
  }
  return {
    timestamp: Number(match[1]),
    offset: match[2] === undefined ? undefined : Number(match[2]),
    message: match[3],
  };
}
