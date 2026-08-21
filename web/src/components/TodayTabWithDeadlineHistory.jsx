import { useCallback, useEffect } from "react";
import TodayTab from "./TodayTab.jsx";
import {
  buildDeadlineMoveRollover,
  markDeadlineMoveDone,
  markDeadlineMoveOpen
} from "../utils/deadlineCountdown";
import { useTodayStr } from "../hooks/useTodayStr";

export default function TodayTabWithDeadlineHistory(props) {
  const { payload, savePayload, saveConfigPatch, isSyncingFromCache } = props;
  const config = payload?.config || {};
  const todayStr = useTodayStr();

  useEffect(() => {
    // Don't run while RTDB hasn't responded yet — cache payload may be stale and
    // calling savePayload here would stamp it with Date.now(), causing the stale
    // cache to win the timestamp comparison and overwrite fresher RTDB data.
    // That flag only covers a fresh mount, though, and this effect also fires on
    // todayStr rollover — which useTodayStr triggers on a 60s timer that doesn't
    // wait for sync, so on a resumed laptop it can run against pre-sleep config.
    // buildDeadlineMoveRollover returns a full config, but only ever changes the
    // three keys below; patching just those keeps the rest of config (the
    // deadline itself included) at whatever RTDB currently holds.
    if (isSyncingFromCache) return;
    const nextConfig = buildDeadlineMoveRollover(config, todayStr);
    if (!nextConfig) return;

    saveConfigPatch({
      deadlineMoveHistory: nextConfig.deadlineMoveHistory,
      deadlineMoveTrackingStartDate: nextConfig.deadlineMoveTrackingStartDate,
      deadlineMoveLastCheckedDate: nextConfig.deadlineMoveLastCheckedDate,
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
