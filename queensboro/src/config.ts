export const HOME = { center: [-73.9546, 40.7569] as [number, number], zoom: 15.2, pitch: 58, bearing: -26 };
export const PLACES = [
  { name: 'Queensbridge Park', category: 'A greener point of view', coordinates: [-73.9485, 40.7554] as [number, number], number: '01' },
  { name: 'Gantry Plaza', category: 'The city, from the water', coordinates: [-73.9595, 40.7472] as [number, number], number: '02' },
  { name: 'Four Freedoms Park', category: 'A quiet place to pause', coordinates: [-73.9606, 40.7506] as [number, number], number: '03' },
];

// A cartographic stroke, not an inferred physical carriageway width or lane count.
export const ROAD_RENDERING = { strokeWidthMeters: 6, surfaceHeightMeters: 0.45 };

// Estimated visual approach grades; the tiles do not provide surveyed elevations.
export const BRIDGE_APPROACHES = { maxGrade: 0.08, sampleSpacingMeters: 15, nodeSnapMeters: 2 };
export function bridgeDeckProfile(name: string) {
  const doubleDeck = name === 'Queensboro Bridge' || name === 'George Washington Bridge';
  const lowerCenterMeters = name === 'George Washington Bridge' ? 65 : /^(Queensboro|Brooklyn|Manhattan|Williamsburg) Bridge$/.test(name) ? 43 : 14;
  return {
    lowerCenterMeters,
    lowerSurfaceMeters: lowerCenterMeters + 1.25,
    upperCenterMeters: doubleDeck ? lowerCenterMeters + 10 : undefined,
    upperSurfaceMeters: doubleDeck ? lowerCenterMeters + 10.85 : undefined,
  };
}
