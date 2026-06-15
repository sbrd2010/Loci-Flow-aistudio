# Focus Sounds Library Credits

All background audio loops utilized in Loci Focus are sourced from the **Open Lo-Fi** public-domain collection.

## General Information
- **Source Repository**: [btahir/open-lofi](https://github.com/btahir/open-lofi)
- **Release Package**: [OpenLo-Fi v1.0.0 Release](https://github.com/btahir/open-lofi/releases/tag/v1.0.0)
- **License**: [CC0 1.0 Universal (Public Domain)](https://github.com/btahir/open-lofi/blob/main/LICENSE)
- **Author/Creator**: [btahir](https://github.com/btahir) (Tracks generated using Suno AI v5 and donated to the public domain)

---

## Track List & Attributions

### 1. Relaxing Rain (Synthesized)
- **Source**: Self-synthesized (not from Open Lo-Fi) — generated live in the browser via the Web Audio API (see [rainAmbience.js](../../src/utils/rainAmbience.js)). A stereo white noise buffer is shaped by a highpass filter and modulated by a slow LFO to simulate natural wind and intensity swells without audio file assets.
- **License**: Public Domain / CC0 (original work, no third-party content)
- **Presets**:
  - `rain-light`: Light Rain (highpass cutoff ~2200Hz, LFO modulation +/- 200Hz)
  - `rain-steady`: Steady Rain (highpass cutoff ~1400Hz, LFO modulation +/- 250Hz)
  - `rain-heavy`: Heavy Rain (highpass cutoff ~700Hz, LFO modulation +/- 300Hz)

### 2. Lo-Fi Beats
- **Filename**: [2-am-debug-loop.mp3](./2-am-debug-loop.mp3)
  - **Title**: 2 AM Debug Loop
  - **Category**: Focus, Rituals & Daily Routines (`activities`)
  - **License**: CC0 1.0 Universal (Public Domain)
- **Filename**: [after-school-rain.mp3](./after-school-rain.mp3) (Migrated from Relaxing Rain category)
  - **Title**: After School Rain
  - **Category**: Seasons, Rain & Weather (`seasonal-weather`)
  - **License**: CC0 1.0 Universal (Public Domain)
- **Note**: The 7 CDN variations for Rain (hosted in `sbrd2010/Loci-flow-sounds`) are also served under the Lo-Fi Beats category.

### 3. Jazz Lounge
- **Filename**: [midnight-amber-room.mp3](./midnight-amber-room.mp3)
- **Title**: Midnight Amber Room
- **Category**: Jazz Lounge & Bookstore Grooves (`jazzhop`)
- **License**: CC0 1.0 Universal (Public Domain)

### 4. Classical Piano
- **Filename**: [dust-on-the-morning-keys.mp3](./dust-on-the-morning-keys.mp3)
- **Title**: Dust on the Morning Keys
- **Category**: Chillhop & Cozy Beats (`chillhop`)
- **License**: CC0 1.0 Universal (Public Domain)

### 5. Binaural 40Hz
- **Source**: Self-synthesized (not from Open Lo-Fi) — generated live in the browser via the Web Audio API: a 200Hz sine tone in the left channel and a 240Hz sine tone in the right channel, producing a 40Hz binaural beat (see [binauralBeat.js](../../src/utils/binauralBeat.js)). No audio file — the tone is continuous and never loops or repeats, for sessions of any length.
- **License**: Public Domain / CC0 (original work, no third-party content)
