declare module "mgrs" {
  const mgrs: {
    forward(lonLat: [number, number] | number[], accuracy?: number): string;
    inverse(str: string): {
      zoneNumber: number;
      zoneLetter: string;
      easting: number;
      northing: number;
    };
    toPoint(str: string): [number, number];
  };
  export default mgrs;
  export const forward: typeof mgrs.forward;
  export const inverse: typeof mgrs.inverse;
  export const toPoint: typeof mgrs.toPoint;
}
