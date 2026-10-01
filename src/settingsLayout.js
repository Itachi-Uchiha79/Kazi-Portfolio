// Where every settings panel lives in the settings window. Six sections, sorted by topic:
//   Scene   camera, scene size, wind / motion, page, reference
//   Sky     sun (or moon at night), night sky, sky colours
//   Clouds  look, add clouds, cloud types, the selected cloud
//   Ocean   colours, waves & sparkle
//   Raft    position, look & motion, shape, wake
//   Birds   look, add birds, the selected flock
// Components add their panels as `${SECTION.x}.Panel name` (leva nests folders on the dots).
export const SECTION = {
  scene: 'Scene',
  sky: 'Sky',
  clouds: 'Clouds',
  ocean: 'Ocean',
  raft: 'Raft',
  birds: 'Birds',
}
export const SECTION_ORDER = ['scene', 'sky', 'clouds', 'ocean', 'raft', 'birds']

// What each page has, so every page gets only its own scene parts and settings panels.
// Add a page here (and in activeConfig.js / vite.config.js) to give it its own set.
//   sun       daytime sun (Sky > Sun)          moon      the sun drawn as the moon (Sky > Moon)
//   nightSky  stars and Milky Way               birds     bird flocks (scene + Birds section)
//   reference compare with the reference film frame (Scene > Reference)
import { PAGE } from './activeConfig.js'

export const PAGE_FEATURES = {
  landing: { sun: true, moon: false, nightSky: false, birds: true, reference: false },
  sail: { sun: true, moon: false, nightSky: false, birds: false, reference: true },
  night: { sun: false, moon: true, nightSky: true, birds: false, reference: true },
}
export const features = PAGE_FEATURES[PAGE]
