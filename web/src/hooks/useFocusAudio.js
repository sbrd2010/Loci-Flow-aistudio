import { useState, useEffect, useRef } from "react";

export function useFocusAudio(isRunning, config = {}, saveSubPath) {
  const [selectedTrack, setSelectedTrack] = useState(config.focusSoundTrack || null);
  const [volume, setVolume] = useState(config.focusSoundVolume !== undefined ? config.focusSoundVolume : 0.5);

  const audioRef = useRef(null);

  // Sync state if config changes externally (e.g. from sync/reload)
  useEffect(() => {
    if (config.focusSoundTrack !== undefined && config.focusSoundTrack !== selectedTrack) {
      setSelectedTrack(config.focusSoundTrack);
    }
  }, [config.focusSoundTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (config.focusSoundVolume !== undefined && config.focusSoundVolume !== volume) {
      setVolume(config.focusSoundVolume);
    }
  }, [config.focusSoundVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle track changing
  useEffect(() => {
    // 1. Pause and dereference the previous Audio instance immediately
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // 2. If a valid track is selected, create new Audio instance
    if (selectedTrack && selectedTrack !== "none" && typeof Audio !== "undefined") {
      const audio = new Audio(`/sounds/${selectedTrack}`);
      audio.loop = true;
      audio.volume = volume;
      audioRef.current = audio;

      // Play if timer is already running
      if (isRunning) {
        audio.play().catch(err => {
          console.warn("Audio play failed or blocked by browser:", err);
        });
      }
    }
  }, [selectedTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync isRunning state with play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isRunning) {
      audio.play().catch(err => {
        console.warn("Audio play failed on timer run:", err);
      });
    } else {
      audio.pause();
    }
  }, [isRunning]);

  // Sync volume adjustments on the active audio instance
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Clean up completely when hook unmounts (Focus mode overlay is closed)
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const selectTrack = (trackName) => {
    // Toggle track off if clicked again, or if explicitly setting to "none"/null
    let nextTrack = trackName;
    if (trackName === "none" || selectedTrack === trackName || !trackName) {
      nextTrack = null;
    }

    setSelectedTrack(nextTrack);

    if (saveSubPath) {
      saveSubPath("config", {
        ...config,
        focusSoundTrack: nextTrack,
        focusSoundVolume: volume,
        lastUpdated: Date.now()
      });
    }
  };

  const changeVolume = (newVolume) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);

    if (saveSubPath) {
      saveSubPath("config", {
        ...config,
        focusSoundTrack: selectedTrack,
        focusSoundVolume: clampedVolume,
        lastUpdated: Date.now()
      });
    }
  };

  return {
    selectedTrack,
    volume,
    selectTrack,
    changeVolume
  };
}
