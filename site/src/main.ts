import 'maplibre-gl/dist/maplibre-gl.css';
import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import { createMap } from './map';

const container = document.getElementById('map');
if (!container) throw new Error('#map container missing');

const map = createMap(container);
map.once('idle', () => document.documentElement.classList.add('map-ready'));

declare global {
  interface Window {
    __map?: typeof map;
  }
}
window.__map = map;
