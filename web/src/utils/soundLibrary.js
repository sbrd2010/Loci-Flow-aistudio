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
    title: "Rainy Day Lo-Fi",
    icon: "🌧️",
    variations: [
      { file: "after-school-rain.mp3", title: "After School Rain" },
      { file: "sounds/rain/amber-sidewalks.mp3", title: "Amber Sidewalks" },
      { file: "sounds/rain/sidewalk-puddles.mp3", title: "Sidewalk Puddles" },
      { file: "sounds/rain/blossoms-on-the-pavement.mp3", title: "Blossoms on the Pavement" },
      { file: "sounds/rain/petals-after-rain.mp3", title: "Petals After Rain" },
      { file: "sounds/rain/amber-windowpane.mp3", title: "Amber Windowpane" },
      { file: "sounds/rain/storm-over-side-streets.mp3", title: "Storm Over Side Streets" },
      { file: "sounds/rain/bloom-between-showers.mp3", title: "Bloom Between Showers" },
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
    title: "Cozy Chillhop",
    icon: "🌇",
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
