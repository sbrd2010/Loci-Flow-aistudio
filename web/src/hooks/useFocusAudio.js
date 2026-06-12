import { useState, useEffect, useRef } from "react";
import { BINAURAL_TRACK_ID, createBinauralBeatNode, migrateTrackId } from "../utils/binauralBeat";
import { trackUrl, getCategoryKeyForTrack, pickRandomVariation } from "../utils/soundLibrary";

export function useFocusAudio(isRunning, config = {}, saveSubPath) {
  const [selectedTrack, setSelectedTrack] = useState(migrateTrackId(config.focusSoundTrack) || null);
  const [volume, setVolume] = useState(config.focusSoundVolume !== undefined ? config.focusSoundVolume : 0.5);

  const audioRef = useRef(null);

  // Sync state if config changes externally (e.g. from sync/reload, or a
  // different account/config with no saved sound prefs).
  useEffect(() => {
    const next = config.focusSoundTrack !== undefined ? migrateTrackId(config.focusSoundTrack) : null;
    if (next !== selectedTrack) {
      setSelectedTrack(next);
    }
  }, [config.focusSoundTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const next = config.focusSoundVolume !== undefined ? config.focusSoundVolume : 0.5;
    if (next !== volume) {
      setVolume(next);
    }
  }, [config.focusSoundVolume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle track changing
  useEffect(() => {
    // 1. Pause and fully release the previous audio instance immediately
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.dispose?.();
      audioRef.current = null;
    }

    // 2. If a valid track is selected, create the new audio instance
    if (selectedTrack === BINAURAL_TRACK_ID) {
      const node = createBinauralBeatNode(volume);
      if (node) {
        audioRef.current = node;
        if (isRunning) {
          node.play().catch(err => {
            console.warn("Binaural beat play failed or blocked by browser:", err);
          });
        }
      }
    } else if (selectedTrack && selectedTrack !== "none" && typeof Audio !== "undefined") {
      const audio = new Audio(trackUrl(selectedTrack));
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
        audioRef.current.dispose?.();
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

  // Selecting one of the ambient categories (Rain, Lo-Fi, Jazz, Piano) picks
  // a random variation from its 8 tracks (1 bundled + 7 CDN), or toggles the
  // category off if it's already playing.
  const selectCategory = (categoryKey) => {
    if (getCategoryKeyForTrack(selectedTrack) === categoryKey) {
      selectTrack("none");
    } else {
      selectTrack(pickRandomVariation(categoryKey));
    }
  };

  // Swap the current track for a different random variation in the same
  // category, without changing the active category.
  const reshuffleTrack = () => {
    const categoryKey = getCategoryKeyForTrack(selectedTrack);
    if (!categoryKey) return;
    selectTrack(pickRandomVariation(categoryKey, selectedTrack));
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
    selectCategory,
    reshuffleTrack,
    changeVolume
  };
}
