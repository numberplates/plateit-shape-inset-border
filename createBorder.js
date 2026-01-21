#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { svgPathProperties } from "svg-path-properties";
import ClipperLib from "clipper-lib";

// ====== CONFIG ======
const INPUT_DIR = process.argv[2] || "./svgs";
const INSET = 5;          // inset distance (margin) in SVG user units
const STROKE_WIDTH = 2;   // stroke width in SVG user units
const SAMPLE_STEP = 2.5;  // sample spacing along path length (smaller = smoother but larger size)
const CLIPPER_SCALE = 1000; // scale to ints for Clipper
// ====================

function parseSvg(xml) {
  return new DOMParser().parseFromString(xml, "image/svg+xml");
}

function serializeSvg(doc) {
  return new XMLSerializer().serializeToString(doc);
}

function getElementByIdLoose(doc, id) {
  // xmldom doesn't reliably support getElementById without DTD, so search manually
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el?.getAttribute?.("id") === id) return el;
  }
  return null;
}

function samplePathToPolygon(d) {
  const props = new svgPathProperties(d);
  const len = props.getTotalLength();
  const step = Math.max(0.1, SAMPLE_STEP);

  const pts = [];
  for (let s = 0; s <= len; s += step) {
    const { x, y } = props.getPointAtLength(s);
    pts.push({
      X: Math.round(x * CLIPPER_SCALE),
      Y: Math.round(y * CLIPPER_SCALE),
    });
  }

  // Close polygon by repeating first point (Clipper doesn't require it, but helps area calc)
  if (pts.length > 2) {
    const a = pts[0], b = pts[pts.length - 1];
    if (a.X !== b.X || a.Y !== b.Y) pts.push({ ...a });
  }

  // Remove exact duplicates in sequence
  const cleaned = [];
  for (const p of pts) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev.X !== p.X || prev.Y !== p.Y) cleaned.push(p);
  }

  return cleaned;
}

function signedAreaClosed(polyClosed) {
  // polyClosed should have last point == first point
  let a = 0;
  for (let i = 0; i < polyClosed.length - 1; i++) {
    const p = polyClosed[i], q = polyClosed[i + 1];
    a += p.X * q.Y - q.X * p.Y;
  }
  return a / 2;
}

function insetPolygon(polyClosed, inset) {
  if (!polyClosed || polyClosed.length < 4) return null;

  // Remove last duplicate for ClipperOffset AddPath
  let p = polyClosed.slice();
  const a = p[0], b = p[p.length - 1];
  if (a.X === b.X && a.Y === b.Y) p = p.slice(0, -1);

  // Normalize orientation to clockwise (Clipper often assumes orientation conventions)
  const area = signedAreaClosed([...p, p[0]]);
  const isClockwise = area < 0;
  if (!isClockwise) p.reverse();

  const co = new ClipperLib.ClipperOffset(
    2.0,                    // miter limit (only matters for miter joins)
    0.25 * CLIPPER_SCALE     // arc tolerance (smaller => more points on rounded joins)
  );

  co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

  const solution = new ClipperLib.Paths();
  const delta = -inset * CLIPPER_SCALE; // negative => inward
  co.Execute(solution, delta);

  if (!solution?.length) return null;

  // If multiple polys result, keep the largest by absolute area
  let best = solution[0];
  let bestAbsArea = Math.abs(signedAreaClosed([...best, best[0]]));

  for (let i = 1; i < solution.length; i++) {
    const absA = Math.abs(signedAreaClosed([...solution[i], solution[i][0]]));
    if (absA > bestAbsArea) {
      best = solution[i];
      bestAbsArea = absA;
    }
  }

  return best;
}

function polygonToPathD(poly) {
  if (!poly || poly.length < 3) return null;

  const pts = poly.map(p => ({
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE,
  }));

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  d += " Z";
  return d;
}

function upsertBorderPath(doc, plateEl, borderD) {
  const existing = getElementByIdLoose(doc, "border");
  if (existing?.parentNode) existing.parentNode.removeChild(existing);

  const border = doc.createElement("path");
  border.setAttribute("id", "border");
  border.setAttribute("d", borderD);
  border.setAttribute("fill", "none");
  border.setAttribute("stroke", "black");
  border.setAttribute("stroke-width", String(STROKE_WIDTH));
  border.setAttribute("stroke-linejoin", "round");
  border.setAttribute("stroke-linecap", "round");

  const parent = plateEl.parentNode ?? doc.documentElement;
  if (plateEl.nextSibling) parent.insertBefore(border, plateEl.nextSibling);
  else parent.appendChild(border);
}

async function main() {
  const files = await fg(["**/*.svg"], { cwd: INPUT_DIR, absolute: true });

  if (!files.length) {
    console.error(`No SVG files found in: ${INPUT_DIR}`);
    process.exit(1);
  }

  let ok = 0, fail = 0;

  for (const file of files) {
    try {
      const xml = fs.readFileSync(file, "utf8");
      const doc = parseSvg(xml);

      const plate = getElementByIdLoose(doc, "plate");
      if (!plate) throw new Error("Missing <path id=\"plate\">");

      const d = plate.getAttribute("d");
      if (!d) throw new Error("plate has no d attribute");

      const polyClosed = samplePathToPolygon(d);
      const insetPoly = insetPolygon(polyClosed, INSET);
      if (!insetPoly) throw new Error("Inset failed (shape too small/degenerate?)");

      const borderD = polygonToPathD(insetPoly);
      if (!borderD) throw new Error("Failed to convert inset polygon to path");

      upsertBorderPath(doc, plate, borderD);

      fs.writeFileSync(file, serializeSvg(doc), "utf8");
      ok++;
      console.log(`✓ ${path.basename(file)}`);
    } catch (e) {
      fail++;
      console.warn(`✗ ${path.basename(file)}: ${e?.message ?? String(e)}`);
    }
  }

  console.log(`\nDone. Updated: ${ok}, Failed: ${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
