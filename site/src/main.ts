import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/popup.css';
import './styles/markers.css';
import './styles/boot.css';
import { initCropMap, type CropMapApp } from './app';
import { showMapWhenIdle } from './lib/ready';
import { createMap } from './map';

const container = document.getElementById('map');
if (!container) throw new Error('#map container missing');

const requireElement = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const slots = {
  popupRoot: requireElement('popup-root'),
  searchSlot: requireElement('search-slot'),
  legendSlot: requireElement('legend-slot'),
};

const map = createMap(container);

declare global {
  interface Window {
    __map?: typeof map;
    __app?: CropMapApp;
  }
}
window.__map = map;

const ready = initCropMap(map, slots)
  .then((app) => {
    window.__app = app;
  })
  .catch((err: unknown) => console.error('crop layers failed to initialise', err));

// Skeleton until the crop layers are in and the map has painted once more, then fade the map in.
showMapWhenIdle(map, ready);
