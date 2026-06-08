import { useCallback, useEffect } from "react";
import TodayTab from "./TodayTab.jsx";
import {
  buildDeadlineMoveRollover,
  getLocalDateString,
  markDeadlineMoveDone,
  markDeadlineMoveOpen
} from "../utils/deadlineCountdown";

export default function TodayTabWithDeadlineHistory(props) {
  const { payload, savePayload, isSyncingFromCache } = props;
  const config = payload?.config || {};
  const todayStr = getLocalDateString();

  useEffect(() => {
    // Don't run while RTDB hasn't responded yet — cache payload may be stale and
    // calling savePayload here would stamp it with Date.now(), causing the stale
    // cache to win the timestamp comparison and overwrite fresher RTDB data.
    if (isSyncingFromCache) return;
    const nextConfig = buildDeadlineMoveRollover(config, todayStr);
    if (!nextConfig) return;

    savePayload({
      ...payload,
      config: {
        ...nextConfig,
        lastUpdated: Date.now()
      }
    });
  }, [
    isSyncingFromCache,
    todayStr,
    config.deadlineLabel,
    config.deadlineDate,
    config.deadlineAction,
    config.deadlineDailyDoneDate,
    config.deadlineMoveLastCheckedDate,
    config.deadlineMoveTrackingStartDate
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePayloadWithDeadlineHistory = useCallback((nextPayload) => {
    if (!nextPayload?.config) {
      savePayload(nextPayload);
      return;
    }

    const nextConfig = nextPayload.config;
    const previousDoneDate = config.deadlineDailyDoneDate || null;
    const nextDoneDate = nextConfig.deadlineDailyDoneDate || null;
    let patchedConfig = nextConfig;

    if (nextDoneDate === todayStr && previousDoneDate !== todayStr) {
      patchedConfig = markDeadlineMoveDone(nextConfig, todayStr);
    } else if (previousDoneDate === todayStr && !nextDoneDate) {
      patchedConfig = markDeadlineMoveOpen(nextConfig, todayStr);
    }

    if (patchedConfig !== nextConfig) {
      savePayload({
        ...nextPayload,
        config: {
          ...patchedConfig,
          lastUpdated: Date.now()
        }
      });
      return;
    }

    savePayload(nextPayload);
  }, [config.deadlineDailyDoneDate, savePayload, todayStr]);

  return <TodayTab {...props} savePayload={savePayloadWithDeadlineHistory} />;
}
