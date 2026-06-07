import { useCallback, useEffect } from "react";
import TodayTab from "./TodayTab.jsx";
import {
  buildDeadlineMoveRollover,
  getLocalDateString,
  markDeadlineMoveDone,
  markDeadlineMoveOpen
} from "../utils/deadlineCountdown";

export default function TodayTabWithDeadlineHistory(props) {
  const { payload, savePayload } = props;
  const config = payload?.config || {};
  const todayStr = getLocalDateString();

  useEffect(() => {
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
