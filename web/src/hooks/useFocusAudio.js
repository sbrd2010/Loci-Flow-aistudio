import { useState, useEffect, useRef } from "react";
import { BINAURAL_TRACK_ID, createBinauralBeatNode, migrateTrackId as migrateBinauralTrackId } from "../utils/binauralBeat";
import { SOUND_CATEGORIES, trackUrl, getCategoryKeyForTrack, shuffleCategoryOrder, migrateTrackId as migrateSoundLibraryTrackId } from "../utils/soundLibrary";

function migrateTrackId(trackId) {
  return migrateSoundLibraryTrackId(migrateBinauralTrackId(trackId));
}

// Stops a specific audio/binaural instance, re-asserting pause once any
// in-flight play() promise settles (some mobile browsers can keep playing
// past a pause() called while play() is still pending). Operates only on
// the instance passed in — never on whatever audioRef.current is by the
// time the promise settles — so a delayed pause can't stop a track the
// user has since switched to.
// `hardTeardown` additionally removes the canplay/error listeners and
// releases the media resource; used when the instance is being discarded
// for good (track change, unmount) rather than just paused for resume later.
// Some pause() implementations are synchronous (HTMLAudioElement), while the
// binaural beat node's pause() returns ctx.suspend() — a promise that can
// reject if the AudioContext has already been closed (e.g. by dispose()
// during hard teardown). safePause() handles both shapes without leaving an
// unhandled promise rejection.
function safePause(instance) {
  try {
    const result = instance.pause?.();
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch {
    // ignore pause failures during cleanup
  }
}

function stopInstance(instance, hardTeardown = false) {
  if (!instance) return;
  safePause(instance);
  // Capture the in-flight play() promise by reference so the deferred pause
  // below only re-fires for *this* play() call. If the user resumes the same
  // instance before it settles, __pendingPlay is reassigned to the new play()
  // call, and this stale callback must not pause that newer, still-wanted playback.
  const pendingPlay = instance.__pendingPlay;
  Promise.resolve(pendingPlay)
    .catch(() => {})
    .then(() => {
      if (instance.__pendingPlay === pendingPlay) {
        safePause(instance);
      }
    })
    .catch(() => {});

  if (hardTeardown) {
    if (typeof instance.removeEventListener === "function") {
      if (instance.__onCanPlay) instance.removeEventListener("canplay", instance.__onCanPlay);
      if (instance.__onError) instance.removeEventListener("error", instance.__onError);
    }
    if (typeof instance.removeAttribute === "function") instance.removeAttribute("src");
    if (typeof instance.load === "function") instance.load();
  }
}

export function useFocusAudio(isRunning, config = {}, saveSubPath) {
  const [selectedTrack, setSelectedTrack] = useState(migrateTrackId(config.focusSoundTrack) || null);
  const [volume, setVolume] = useState(config.focusSoundVolume !== undefined ? config.focusSoundVolume : 0.5);

  // Tracks whether the active track's audio is still buffering. CDN variations
  // can take a few seconds to start playing on a cold cache, so the UI surfaces
  // this instead of leaving the user unsure whether anything is happening.
  const [trackLoadState, setTrackLoadState] = useState("idle");

  const audioRef = useRef(null);

  // No-repeat shuffle queue per sound category, in-memory only (never
  // persisted to config/Firebase): { remaining: string[], last: string }.
  // "remaining" holds this cycle's not-yet-played files; when it runs out,
  // the next pick starts a fresh shuffled cycle.
  const shuffleQueuesRef = useRef({});

  function nextInCategoryShuffle(categoryKey, { forceNewCycle = false } = {}) {
    const state = shuffleQueuesRef.current[categoryKey];
    let remaining = forceNewCycle ? null : state?.remaining;
    if (!remaining || remaining.length === 0) {
      if (!state && !forceNewCycle && getCategoryKeyForTrack(selectedTrack) === categoryKey) {
        // First shuffle for a track that's already playing (e.g. loaded from
        // saved config rather than picked via selectCategory) — treat it as
        // already played this cycle so it can't resurface on the very next
        // click, not merely avoided as the first pick.
        remaining = shuffleCategoryOrder(categoryKey).filter(file => file !== selectedTrack);
      } else {
        remaining = shuffleCategoryOrder(categoryKey, state?.last);
      }
    }
    const [next, ...rest] = remaining;
    shuffleQueuesRef.current[categoryKey] = { remaining: rest, last: next };
    return next;
  }

  // Sync state if config changes externally (e.g. from sync/reload, or a
  // different account/config with no saved sound prefs).
  useEffect(() => {
    const next = config.focusSoundTrack !== undefined ? migrateTrackId(config.focusSoundTrack) : null;
    if (next !== selectedTrack) {
      // Drop the affected category's in-memory queue: it may be stale
      // relative to this externally-synced track, and reshuffling off a
      // stale queue could hand back the very track that was just synced in.
      const categoryKey = getCategoryKeyForTrack(next);
      if (categoryKey) delete shuffleQueuesRef.current[categoryKey];
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
      stopInstance(audioRef.current, true);
      audioRef.current.dispose?.();
      audioRef.current = null;
    }

    // 2. If a valid track is selected, create the new audio instance
    if (selectedTrack === BINAURAL_TRACK_ID) {
      const node = createBinauralBeatNode(volume);
      if (node) {
        audioRef.current = node;
        setTrackLoadState("ready");
        if (isRunning) {
          node.__pendingPlay = node.play().catch(err => {
            console.warn("Binaural beat play failed or blocked by browser:", err);
          });
        }
      }
    } else if (selectedTrack && selectedTrack !== "none" && typeof Audio !== "undefined") {
      const audio = new Audio(trackUrl(selectedTrack));
      audio.loop = true;
      audio.volume = volume;
      audio.preload = "auto";
      audioRef.current = audio;

      setTrackLoadState("loading");
      audio.__onCanPlay = () => {
        if (audioRef.current === audio) setTrackLoadState("ready");
      };
      audio.__onError = () => {
        if (audioRef.current !== audio) return;
        // CDN variations can fail to load (network issue, cold CDN cache, etc.) —
        // fall back to the category's bundled local track, which is always
        // available, rather than leaving the user with silence.
        const categoryKey = getCategoryKeyForTrack(selectedTrack);
        const bundled = categoryKey && SOUND_CATEGORIES[categoryKey].variations.find(v => !v.file.includes("/"));
        if (bundled && bundled.file !== selectedTrack) {
          // Drop the category's in-memory queue: it's stale relative to this
          // out-of-band fallback, and reshuffling off a stale queue could
          // hand back the very track that's now playing.
          if (categoryKey) delete shuffleQueuesRef.current[categoryKey];
          setSelectedTrack(bundled.file);
        } else {
          setTrackLoadState("error");
        }
      };
      audio.addEventListener("canplay", audio.__onCanPlay);
      audio.addEventListener("error", audio.__onError);

      // Play if timer is already running
      if (isRunning) {
        audio.__pendingPlay = audio.play().catch(err => {
          console.warn("Audio play failed or blocked by browser:", err);
        });
      }
    } else {
      setTrackLoadState("idle");
    }
  }, [selectedTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync isRunning state with play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isRunning) {
      audio.__pendingPlay = audio.play().catch(err => {
        console.warn("Audio play failed on timer run:", err);
      });
    } else {
      stopInstance(audio);
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
        stopInstance(audioRef.current, true);
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

  // Selecting one of the ambient categories (Rain, Lo-Fi, Jazz, Piano) starts
  // a fresh shuffled play order for that category, or toggles the category
  // off if it's already playing.
  const selectCategory = (categoryKey) => {
    if (getCategoryKeyForTrack(selectedTrack) === categoryKey) {
      selectTrack("none");
    } else {
      selectTrack(nextInCategoryShuffle(categoryKey, { forceNewCycle: true }));
    }
  };

  // Swap the current track for the next unplayed variation in the active
  // category's shuffle order, without changing the active category.
  const reshuffleTrack = () => {
    const categoryKey = getCategoryKeyForTrack(selectedTrack);
    if (!categoryKey) return;
    selectTrack(nextInCategoryShuffle(categoryKey));
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
    trackLoadState,
    selectTrack,
    selectCategory,
    reshuffleTrack,
    changeVolume
  };
}
