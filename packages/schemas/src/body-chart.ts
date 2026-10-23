import type { ScreeningRegion } from './red-flags';

/**
 * The body chart (INT-05, Frontend Specification §5: "front and back outline; tap regions to mark
 * pain; regions map to knowledge base subregions"). User decision, 23 October 2026: the whole
 * body, front and back, with zones by area and side; several may be marked. A zone names its
 * region where one fits and its face, front for the knowledge base's Anterior subregions and back
 * for Posterior; the upper arm, thigh and shin or calf name no region.
 *
 * Zones are boxes on a 100 by 200 outline (`x`, `w` out of 100; `y`, `h` out of 200), drawn for
 * the patient's right side; the left side mirrors it. On the front view the patient's right is on
 * the viewer's left; on the back view, on the viewer's right.
 */
export const bodyChartViews = ['front', 'back'] as const;
export type BodyChartView = (typeof bodyChartViews)[number];

export const bodyChartViewLabels: Record<BodyChartView, string> = {
  front: 'Front',
  back: 'Back',
};

export type BodyChartFace = 'anterior' | 'posterior';

export interface BodyChartZone {
  key: string;
  label: string;
  view: BodyChartView;
  side: 'right' | 'left' | 'centre';
  region: ScreeningRegion | null;
  face: BodyChartFace;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SideArea {
  area: string;
  /** As written on each view; the side comes first ("Right knee, front"). */
  front: string;
  back: string;
  region: ScreeningRegion | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

// The patient's right side, as seen on the front view (the viewer's left).
const sideAreas: readonly SideArea[] = [
  {
    area: 'shoulder',
    front: 'shoulder, front',
    back: 'shoulder, back',
    region: 'shoulder',
    x: 19,
    y: 25,
    w: 15,
    h: 11,
  },
  {
    area: 'upper_arm',
    front: 'upper arm, front',
    back: 'upper arm, back',
    region: null,
    x: 18,
    y: 36,
    w: 12,
    h: 22,
  },
  {
    area: 'elbow',
    front: 'elbow, front',
    back: 'elbow, back',
    region: 'elbow',
    x: 16,
    y: 58,
    w: 13,
    h: 10,
  },
  {
    area: 'forearm',
    front: 'forearm, front',
    back: 'forearm, back',
    region: 'wrist_hand',
    x: 15,
    y: 68,
    w: 13,
    h: 20,
  },
  {
    area: 'wrist_hand',
    front: 'wrist and hand, front',
    back: 'wrist and hand, back',
    region: 'wrist_hand',
    x: 13,
    y: 88,
    w: 14,
    h: 16,
  },
  {
    area: 'hip',
    front: 'hip and groin',
    back: 'buttock',
    region: 'hip',
    x: 33,
    y: 78,
    w: 17,
    h: 14,
  },
  {
    area: 'thigh',
    front: 'thigh, front',
    back: 'thigh, back',
    region: null,
    x: 33,
    y: 92,
    w: 16,
    h: 32,
  },
  {
    area: 'knee',
    front: 'knee, front',
    back: 'knee, back',
    region: 'knee',
    x: 34,
    y: 124,
    w: 15,
    h: 14,
  },
  { area: 'lower_leg', front: 'shin', back: 'calf', region: null, x: 35, y: 138, w: 13, h: 40 },
  {
    area: 'ankle_foot',
    front: 'ankle and foot, front',
    back: 'ankle and heel, back',
    region: 'foot_ankle',
    x: 33,
    y: 178,
    w: 16,
    h: 14,
  },
];

const sideLabel = { right: 'Right', left: 'Left' } as const;

function sideZone(area: SideArea, view: BodyChartView, side: 'right' | 'left'): BodyChartZone {
  // On the front the patient's right is on the viewer's left, as drawn; the back mirrors it.
  const drawnLeft = (view === 'front') === (side === 'right');
  return {
    key: `${side}_${area.area}_${view}`,
    label: `${sideLabel[side]} ${area[view]}`,
    view,
    side,
    region: area.region,
    face: view === 'front' ? 'anterior' : 'posterior',
    x: drawnLeft ? area.x : 100 - area.x - area.w,
    y: area.y,
    w: area.w,
    h: area.h,
  };
}

const centreZones: readonly BodyChartZone[] = [
  {
    key: 'neck_front',
    label: 'Neck, front',
    view: 'front',
    side: 'centre',
    region: 'neck',
    face: 'anterior',
    x: 42,
    y: 19,
    w: 16,
    h: 9,
  },
  {
    key: 'neck_back',
    label: 'Neck, back',
    view: 'back',
    side: 'centre',
    region: 'neck',
    face: 'posterior',
    x: 42,
    y: 19,
    w: 16,
    h: 9,
  },
  {
    key: 'upper_back',
    label: 'Upper back',
    view: 'back',
    side: 'centre',
    region: 'back',
    face: 'posterior',
    x: 36,
    y: 30,
    w: 28,
    h: 26,
  },
  {
    key: 'lower_back',
    label: 'Lower back',
    view: 'back',
    side: 'centre',
    region: 'back',
    face: 'posterior',
    x: 36,
    y: 58,
    w: 28,
    h: 20,
  },
];

export const bodyChartZones: readonly BodyChartZone[] = bodyChartViews.flatMap((view) => [
  ...centreZones.filter((zone) => zone.view === view),
  ...sideAreas.flatMap((area) => [sideZone(area, view, 'right'), sideZone(area, view, 'left')]),
]);

export const bodyChartZoneByKey: ReadonlyMap<string, BodyChartZone> = new Map(
  bodyChartZones.map((zone) => [zone.key, zone]),
);
