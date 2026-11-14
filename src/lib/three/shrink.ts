import { transcodeSpz } from "@sparkjsdev/spark";
import { toWorld, type Bounds, type Frame } from "./geometry";

/**
 * Makes a scan small enough to upload and to play on a phone. Browser only.
 *
 * - Everything well outside the room is cut away (scans usually include the hallway and the view out of the window).
 * - Nearly invisible splats are dropped.
 * - View-dependent colour is dropped. It is most of the file, and a room looks almost the same without it.
 * - The result is written as .spz, which is about a tenth the size of .ply.
 */
export async function shrinkScan(
  file: Blob,
  format: "spz" | "ply",
  flip: boolean,
  frame: Frame,
  bounds: Bounds,
): Promise<Blob> {
  // The walkable area's corners in world space, then a generous margin so walls and ceiling survive.
  const corners = [
    toWorld(frame, [bounds.minU, 0, bounds.minV]),
    toWorld(frame, [bounds.minU, 0, bounds.maxV]),
    toWorld(frame, [bounds.maxU, 0, bounds.minV]),
    toWorld(frame, [bounds.maxU, 0, bounds.maxV]),
  ];
  const margin = 2;
  const min = [Math.min(...corners.map((c) => c[0])) - margin, frame.origin[1] - 2.6, Math.min(...corners.map((c) => c[2])) - margin];
  const max = [Math.max(...corners.map((c) => c[0])) + margin, frame.origin[1] + 2.6, Math.max(...corners.map((c) => c[2])) + margin];
  // The clip box is given in the file's own coordinates. A flipped scan is turned half way round the x axis.
  const clipXyz = flip ? { min: [min[0], -max[1], -max[2]], max: [max[0], -min[1], -min[2]] } : { min, max };

  const { fileBytes } = await transcodeSpz({
    inputs: [{ fileBytes: new Uint8Array(await file.arrayBuffer()), pathOrUrl: `scan.${format}` }],
    maxSh: 0,
    opacityThreshold: 0.03,
    clipXyz,
  });
  return new Blob([fileBytes as BlobPart], { type: "application/octet-stream" });
}
