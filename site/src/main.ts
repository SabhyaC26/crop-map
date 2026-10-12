import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/popup.css';
import './styles/markers.css';
import { initCropMap, type CropMapApp } from './app';
import { createMap } from './map';

const container = document.getElementById('map');
if (!container) throw new Error('#map container missing');

const popupRoot = document.getElementById('popup-root');
if (!popupRoot) throw new Error('#popup-root missing');

const map = createMap(container);
map.once('idle', () => document.documentElement.classList.add('map-ready'));

declare global {
  interface Window {
    __map?: typeof map;
    __app?: CropMapApp;
  }
}
window.__map = map;

initCropMap(map, popupRoot)
  .then((app) => {
    window.__app = app;
  })
  .catch((err: unknown) => console.error('crop layers failed to initialise', err));
