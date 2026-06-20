// Variation library for the ambient Focus Sound categories. Each category
// has 1 bundled track (served locally from /sounds/, works offline) plus 7
// CDN variations hosted in sbrd2010/Loci-flow-sounds and served via jsDelivr,
// keeping the app bundle small for the Android build.
//
// CDN file paths (containing "/") are resolved against CDN_BASE; local
// filenames (no "/") are resolved against /sounds/ — see trackUrl().

const CDN_BASE = "https://cdn.jsdelivr.net/gh/sbrd2010/Loci-flow-sounds@main";

export const SOUND_CATEGORIES = {
  rain: {
    title: "Relaxing Rain",
    icon: "🌧️",
    variations: [
      { file: "gentle-midday-rain.mp3", title: "Gentle Midday Rain" },
      { file: "sounds/rain/calming-rain.mp3", title: "Calming Rain" },
      { file: "sounds/rain/gentle-rain.mp3", title: "Gentle Rain" },
      { file: "sounds/rain/light-rain-loop.mp3", title: "Light Rain Loop" },
      { file: "sounds/rain/rain-in-the-jungle-and-birds.mp3", title: "Rain in the Jungle and Birds" },
    ]
  },
  nature: {
    title: "Nature Sounds",
    icon: "🌲",
    variations: [
      { file: "forest-birds.mp3", title: "Forest Birds" },
      { file: "sounds/nature/river-atmosphere.mp3", title: "River Atmosphere" },
      { file: "sounds/nature/river-wildlife-environment.mp3", title: "River Wildlife Environment" },
    ]
  },
  lofi: {
    title: "Lo-Fi Beats",
    icon: "🎧",
    variations: [
      { file: "2-am-debug-loop.mp3", title: "2 AM Debug Loop" },
      { file: "sounds/lofi/first-coffee-thoughts.mp3", title: "First Coffee Thoughts" },
      { file: "sounds/lofi/penciled-sunbeams.mp3", title: "Penciled Sunbeams" },
      { file: "sounds/lofi/terminal-rain.mp3", title: "Terminal Rain" },
      { file: "sounds/lofi/coffee-ring-notebook.mp3", title: "Coffee Ring Notebook" },
      { file: "sounds/lofi/graphite-mornings.mp3", title: "Graphite Mornings" },
      { file: "sounds/lofi/margin-notes-at-dusk.mp3", title: "Margin Notes at Dusk" },
      { file: "sounds/lofi/morning-pages.mp3", title: "Morning Pages" },
    ]
  },
  jazz: {
    title: "Jazz Lounge",
    icon: "🎷",
    variations: [
      { file: "midnight-amber-room.mp3", title: "Midnight Amber Room" },
      { file: "sounds/jazz/rain-on-the-boulevard.mp3", title: "Rain on the Boulevard" },
      { file: "sounds/jazz/breezy-afternoon-terrace.mp3", title: "Breezy Afternoon Terrace" },
      { file: "sounds/jazz/saxophone-in-the-rain.mp3", title: "Saxophone in the Rain" },
      { file: "sounds/jazz/candlelit-at-70-bpm.mp3", title: "Candlelit at 70 BPM" },
      { file: "sounds/jazz/linen-and-limoncello.mp3", title: "Linen and Limoncello" },
      { file: "sounds/jazz/ashes-in-the-coffee-cup.mp3", title: "Ashes in the Coffee Cup" },
      { file: "sounds/jazz/last-call-in-c-minor.mp3", title: "Last Call in C Minor" },
    ]
  },
  piano: {
    title: "Cozy Piano",
    icon: "🎹",
    variations: [
      { file: "dust-on-the-morning-keys.mp3", title: "Dust on the Morning Keys" },
      { file: "sounds/piano/dusk-between-stoops.mp3", title: "Dusk Between Stoops" },
      { file: "sounds/piano/porchlight-golden-hour.mp3", title: "Porchlight Golden Hour" },
      { file: "sounds/piano/soft-gold-sky.mp3", title: "Soft Gold Sky" },
      { file: "sounds/piano/window-seat-daydream.mp3", title: "Window Seat Daydream" },
      { file: "sounds/piano/glow-on-the-overpass.mp3", title: "Glow on the Overpass" },
      { file: "sounds/piano/sidewalk-slow-jam.mp3", title: "Sidewalk Slow Jam" },
      { file: "sounds/piano/sunset-offbeat.mp3", title: "Sunset Offbeat" },
    ]
  },
  chillhop: {
    title: "Chillhop",
    icon: "🌇",
    variations: [
      { file: "2tech-audio-technology.mp3", title: "Technology" },
      { file: "sounds/chillhop/aerohead-leaving.mp3", title: "Leaving" },
      { file: "sounds/chillhop/nettson-dont-leave.mp3", title: "Don't Leave" },
      { file: "sounds/chillhop/oraeth-reflections.mp3", title: "Reflections" },
      { file: "sounds/chillhop/oraeth-still-falling.mp3", title: "Still Falling" },
      { file: "sounds/chillhop/neutrin05-rain-and-tears.mp3", title: "Rain and Tears" },
      { file: "sounds/chillhop/sappheiros-aura.mp3", title: "Aura" },
      { file: "sounds/chillhop/sappheiros-dawn.mp3", title: "Dawn" },
      { file: "sounds/chillhop/sappheiros-escape.mp3", title: "Escape" },
      { file: "sounds/chillhop/sappheiros-falling.mp3", title: "Falling" },
      { file: "sounds/chillhop/sappheiros-memories.mp3", title: "Memories" },
      { file: "sounds/chillhop/sappheiros-passion.mp3", title: "Passion" },
      { file: "sounds/chillhop/sappheiros-descent.mp3", title: "Descent" },
      { file: "sounds/chillhop/sappheiros-embrace.mp3", title: "Embrace" },
      { file: "sounds/chillhop/sappheiros-stay.mp3", title: "Stay" },
    ]
  }
};

export function trackUrl(file) {
  return file.includes("/") ? `${CDN_BASE}/${file}` : `/sounds/${file}`;
}

export function getCategoryKeyForTrack(trackId) {
  if (!trackId) return null;
  for (const [key, category] of Object.entries(SOUND_CATEGORIES)) {
    if (category.variations.some(v => v.file === trackId)) return key;
  }
  return null;
}

export function getTrackTitle(trackId) {
  for (const category of Object.values(SOUND_CATEGORIES)) {
    const variation = category.variations.find(v => v.file === trackId);
    if (variation) return variation.title;
  }
  return null;
}

export function pickRandomVariation(categoryKey, excludeFile = null) {
  const pool = SOUND_CATEGORIES[categoryKey].variations.filter(v => v.file !== excludeFile);
  return pool[Math.floor(Math.random() * pool.length)].file;
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Builds a freshly shuffled no-repeat play order covering every variation in
// a category. When avoidFirst is given and the category has more than one
// variation, deterministically swaps the first slot with the next entry
// that isn't avoidFirst, so a new cycle never starts with the track that
// just finished playing.
export function shuffleCategoryOrder(categoryKey, avoidFirst = null) {
  const files = SOUND_CATEGORIES[categoryKey].variations.map(v => v.file);
  const order = shuffle(files);
  if (avoidFirst && files.length > 1 && order[0] === avoidFirst) {
    const swapIndex = order.findIndex(file => file !== avoidFirst);
    if (swapIndex > 0) {
      [order[0], order[swapIndex]] = [order[swapIndex], order[0]];
    }
  }
  return order;
}

export function migrateTrackId(trackId) {
  if (!trackId) return trackId;
  const legacyRainTracks = new Set([
    "rain-light",
    "rain-steady",
    "rain-heavy",
    "after-school-rain.mp3",
    "sounds/rain/amber-sidewalks.mp3",
    "sounds/rain/sidewalk-puddles.mp3",
    "sounds/rain/blossoms-on-the-pavement.mp3",
    "sounds/rain/petals-after-rain.mp3",
    "sounds/rain/amber-windowpane.mp3",
    "sounds/rain/storm-over-side-streets.mp3",
    "sounds/rain/bloom-between-showers.mp3"
  ]);
  if (legacyRainTracks.has(trackId)) {
    return "gentle-midday-rain.mp3";
  }
  return trackId;
}
