import { appendFile } from "fs";

export default new (class Logger {
  private _logFile: string | null;

  constructor() {
    this._logFile = null;
  }

  public setLogFile(logFile: string | null): void {
    this._logFile = logFile;
  }

  public log(...args: unknown[]): void {
    console.log(...args);
    const logStr = new Date().toISOString() + " - LOG - " + args.join(" ");
    if (this._logFile !== null) {
      appendFile(this._logFile, logStr + "\n", function () {
        // on finished. Do nothing for now.
      });
    }
  }

  public warn(...args: unknown[]): void {
    console.warn(...args);
    const logStr = new Date().toISOString() + " - WARN - " + args.join(" ");
    if (this._logFile !== null) {
      appendFile(this._logFile, logStr + "\n", function () {
        // on finished. Do nothing for now.
      });
    }
  }
})();
