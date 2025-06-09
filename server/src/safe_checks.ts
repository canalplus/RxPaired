import { performance } from "perf_hooks";
import { WebSocketServer } from "ws";
import ActiveTokensList from "./active_tokens_list.js";
import logger from "./logger.js";

export default function createCheckers(
  activeTokensList: ActiveTokensList,
  {
    deviceSocket,
    inspectorMessageLimit,
    deviceMessageLimit,
    wrongPasswordLimit,
    inspectorConnectionLimit,
    deviceConnectionLimit,
  }: {
    deviceSocket: WebSocketServer;
    maxTokenDuration: number;
    inspectorMessageLimit: number;
    deviceMessageLimit: number;
    wrongPasswordLimit: number;
    inspectorConnectionLimit: number;
    deviceConnectionLimit: number;
  },
) {
  /** Count the number of device messages received in the current 24 hours considered. */
  let deviceMessageInCurrent24Hours = 0;

  /**
   * Count the number of inspector messages received in the current 24 hours
   * considered.
   */
  let inspectorMessageInCurrent24Hours = 0;

  /**
   * Has a new element each time a new bad password in the last 24h has been
   * communicated.
   * Each element is the timestamp, in terms of `performance.now()`, at which the
   * wrong password was communicated.
   */
  const badPasswordEvents: number[] = [];

  /**
   * Has a new element each time a new inspector has connected in the last 24h.
   * Each element is the timestamp, in terms of `performance.now()`, at which the
   * new inspector has connected.
   */
  const newInspectorEvents: number[] = [];

  /**
   * Has a new element each time a new device has connected in the last 24h.
   * Each element is the timestamp, in terms of `performance.now()`, at which the
   * new device has connected.
   */
  const newDeviceEvents: number[] = [];

  /* Clear list of bad events older than 24 hours every 10 minutes. */
  setInterval(() => {
    const now = performance.now();
    [badPasswordEvents, newInspectorEvents, newDeviceEvents].forEach((evts) => {
      while (evts.length > 0 && now - evts[0] > 24 * 60 * 60 * 1000) {
        evts.shift();
      }
    });

    // Also close old tokens
    performExpirationCheck(now);
  }, 60 * 1000);

  setInterval(
    () => {
      deviceMessageInCurrent24Hours = 0;
      inspectorMessageInCurrent24Hours = 0;
    },
    24 * 60 * 60 * 1000,
  );

  function performExpirationCheck(now: number) {
    for (let i = 0; i < activeTokensList.size(); i++) {
      const tokenInfo = activeTokensList.getFromIndex(i);
      if (tokenInfo === undefined) {
        continue;
      }
      if (tokenInfo.getExpirationDelay(now) <= 0) {
        logger.warn("Revokating old token", tokenInfo.tokenId);
        activeTokensList.removeIndex(i);
        i--; // We removed i, so we now need to re-check what is at its place for
        // the next loop iteration
        if (tokenInfo.device !== null) {
          if (tokenInfo.device.type === "websocket") {
            tokenInfo.device.value.close();
          }
          tokenInfo.device = null;
        }
        while (tokenInfo.inspectors.length > 0) {
          const inspectorInfo = tokenInfo.inspectors.pop();
          if (inspectorInfo !== undefined) {
            inspectorInfo.webSocket.close();
            clearInterval(inspectorInfo.pingInterval);
          }
        }
      }
    }
  }

  return {
    forceExpirationCheck() {
      performExpirationCheck(performance.now());
    },
    checkInspectorMessageLimit() {
      if (inspectorMessageLimit === undefined) {
        return;
      } else if (++inspectorMessageInCurrent24Hours > inspectorMessageLimit) {
        logger.warn(
          "Maximum number of inspector messages per 24h reached, " +
            "closing everything",
          inspectorMessageInCurrent24Hours,
        );
        deviceSocket.close();
        process.exit(1);
      }
    },

    checkDeviceMessageLimit() {
      if (deviceMessageLimit === undefined) {
        return;
      } else if (++deviceMessageInCurrent24Hours > deviceMessageLimit) {
        logger.warn(
          "Maximum number of device messages per 24h reached, " +
            "closing everything",
          deviceMessageInCurrent24Hours,
        );
        deviceSocket.close();
        process.exit(1);
      }
    },

    checkBadPasswordLimit() {
      if (wrongPasswordLimit === undefined) {
        return;
      }
      badPasswordEvents.push(performance.now());
      if (badPasswordEvents.length > wrongPasswordLimit) {
        logger.warn(
          "Maximum number of bad passwords reached, closing everything",
        );
        deviceSocket.close();
        process.exit(1);
      }
    },

    checkNewInspectorLimit() {
      newInspectorEvents.push(performance.now());
      if (newInspectorEvents.length > inspectorConnectionLimit) {
        logger.warn(
          "Maximum number of new inspectors reached, closing everything",
        );
        deviceSocket.close();
        process.exit(1);
      }
    },

    checkNewDeviceLimit() {
      if (deviceConnectionLimit === undefined) {
        return;
      }
      newDeviceEvents.push(performance.now());
      if (newDeviceEvents.length > deviceConnectionLimit) {
        logger.warn(
          "Maximum number of new devices reached, closing everything",
        );
        deviceSocket.close();
        process.exit(1);
      }
    },
  };
}
