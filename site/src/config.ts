const env = import.meta.env;

export const FIELDS_URL: string = env.VITE_FIELDS_URL ?? '/data/fields.pmtiles';
export const OVERVIEW_URL: string = env.VITE_OVERVIEW_URL ?? '/data/overview.pmtiles';
export const BASEMAP_URL: string = env.VITE_BASEMAP_URL ?? '/data/basemap.pmtiles';
export const REGIONS_URL: string = env.VITE_REGIONS_URL ?? '/data/regions.json';
export const CROPS_URL: string = env.VITE_CROPS_URL ?? '/data/crops.json';
export const ICONS_BASE: string = env.VITE_ICONS_BASE ?? '/icons/';

export const TERRAIN_TILES_URL =
  env.VITE_TERRAIN_URL ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
