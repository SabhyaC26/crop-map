import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import type { Crop } from '../data/crops';
import type { SearchPlace } from '../markers/regions';
import { cropImg, el } from './format';
import type { IconManifest } from './emphasis';

export interface PlacePins {
  setActive(index: number | null): void;
  destroy(): void;
}

const STAGGER_MS = 110;
const FIRST_DELAY_MS = 380;

/** Numbered, softly pulsing crop badges dropped on each destination. */
export function createPins(
  map: MapLibreMap,
  crop: Crop,
  manifest: IconManifest,
  places: readonly SearchPlace[],
  onSelect: (index: number) => void,
): PlacePins {
  const nodes = places.map((place, i) => {
    const marker = el('div', 'dp');
    marker.style.setProperty('--crop', crop.color);
    marker.style.setProperty('--delay', `${FIRST_DELAY_MS + i * STAGGER_MS}ms`);

    const button = el('button', 'dp-btn');
    button.type = 'button';
    button.setAttribute('aria-label', `${i + 1}. ${place.label}`);
    const disc = el('span', 'dp-disc');
    disc.append(cropImg(manifest, crop, 'dp-icon'));
    const label = el('span', 'dp-label', place.label);
    button.append(el('span', 'dp-pulse'), disc, el('span', 'dp-num', String(i + 1)), label);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(i);
    });
    // Keep map drag/click handlers from swallowing the pin tap.
    button.addEventListener('pointerdown', (e) => e.stopPropagation());
    marker.append(button);

    const mapMarker = new Marker({ element: marker, anchor: 'center' }).setLngLat(place.center).addTo(map);
    return { mapMarker, marker };
  });

  return {
    setActive(index) {
      nodes.forEach(({ marker }, i) => marker.classList.toggle('is-active', i === index));
    },
    destroy() {
      for (const { mapMarker, marker } of nodes) {
        marker.classList.add('is-leaving');
        window.setTimeout(() => mapMarker.remove(), 260);
      }
    },
  };
}
