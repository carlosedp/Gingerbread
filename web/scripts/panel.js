/* Eurorack front panel template generator.

   Dimensions follow the Doepfer A-100 mechanical specification
   (http://www.doepfer.de/a100_man/a100m_e.htm) by way of THX2112's "Eurorack
   Panel Designer" extension for Inkscape.

   What comes out is a Gingerbread design, not just a drawing: the panel outline
   lands on Edge.Cuts, the mounting holes on Drill, and the remaining KiCad
   layers are present as empty Inkscape layers ready to be drawn into. */

const SVG_NS = "http://www.w3.org/2000/svg";
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

/* One horizontal pitch. */
export const HP_MM = 5.08;

/* Panel heights for the common rack formats. */
export const PANEL_FORMATS = {
    "3U": 128.5,
    "1U Intellijel": 39.65,
    "1U PulpLogic": 43.18,
};

/* Doepfer takes a little off the nominal HP width so that adjacent panels
   don't bind against each other. */
export const DEFAULT_WIDTH_OFFSET_MM = 0.36;

/* Mounting hole geometry, all from the A-100 spec. */
const HOLE_INSET_X_MM = 7.5;
const HOLE_INSET_Y_MM = 3.0;
const HOLE_RADIUS_MM = 1.6;
const SLOT_LENGTH_MM = 5.5;

/* Panels narrower than this only get the left-hand pair of holes — there isn't
   room for the right-hand pair. */
const MIN_HP_FOR_RIGHT_HOLES = 5;

/* Gingerbread's default DPI of 2540 works out to 100 user units per mm, so
   generating at that scale means a freshly-loaded template already reports its
   true size. */
const UU_PER_MM = 100;

/* Colors are only ever seen in a vector editor: Gingerbread recolors every
   layer as it draws. */
const PANEL_COLOR = "#e6e6e6";
const HOLE_COLOR = "#ffffff";
const OUTLINE_COLOR = "#666666";
const GUIDE_COLOR = "#f6921e";

/* The empty layers included so that the template opens in Inkscape with
   somewhere to draw. Edge.Cuts and Drill are emitted separately since they
   carry the generated geometry. */
const EMPTY_LAYERS = ["B.SilkS", "B.Mask", "B.Cu", "F.Cu", "F.Mask", "F.SilkS"];

function number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/* Millimetres to user units, trimmed of the float noise that multiplying by
   100 tends to produce. */
function uu(mm) {
    return Number.parseFloat((mm * UU_PER_MM).toFixed(4));
}

function xml_escape(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function panel_width_mm(hp, { offset_mm = DEFAULT_WIDTH_OFFSET_MM, symmetric = false } = {}) {
    /* The symmetric variant sizes the panel from its mounting holes instead of
       from the HP grid, which leaves the same margin on both sides. */
    if (symmetric) {
        return HOLE_INSET_X_MM * 2 + (hp - 3) * HP_MM;
    }
    return hp * HP_MM - offset_mm;
}

/* The centers of the mounting holes, in mm from the top left corner. */
export function mounting_holes(hp, width_mm, height_mm) {
    /* The spec's 7.5mm inset assumes there's a panel to put it in; below about
       2HP there isn't, so fall back to a centered column of holes the way real
       narrow panels do. */
    const left = HOLE_INSET_X_MM + HOLE_RADIUS_MM > width_mm ? width_mm / 2 : HOLE_INSET_X_MM;
    const right = (hp - 3) * HP_MM + HOLE_INSET_X_MM;
    const top = HOLE_INSET_Y_MM;
    const bottom = height_mm - HOLE_INSET_Y_MM;

    const holes = [
        { x: left, y: top },
        { x: left, y: bottom },
    ];

    if (hp >= MIN_HP_FOR_RIGHT_HOLES) {
        holes.push({ x: right, y: top }, { x: right, y: bottom });
    }

    return holes;
}

function rect_path(x, y, w, h) {
    return `M ${uu(x)},${uu(y)} L ${uu(x + w)},${uu(y)} L ${uu(x + w)},${uu(y + h)} L ${uu(x)},${uu(y + h)} Z`;
}

/* A horizontal stadium (a "rounded slot") centered on the given point. */
function slot_path(cx, cy, length, radius) {
    const half = Math.max(length / 2 - radius, 0);
    const x0 = cx - half;
    const x1 = cx + half;
    const r = uu(radius);

    return (
        `M ${uu(x0)},${uu(cy - radius)} L ${uu(x1)},${uu(cy - radius)} ` +
        `A ${r},${r} 0 0 1 ${uu(x1)},${uu(cy + radius)} ` +
        `L ${uu(x0)},${uu(cy + radius)} ` +
        `A ${r},${r} 0 0 1 ${uu(x0)},${uu(cy - radius)} Z`
    );
}

/* A crosshair marking a hole center, sized to sit just inside the hole. */
function center_mark_paths(hole, slotted) {
    const arm = HOLE_RADIUS_MM / 2;
    const reach = slotted ? SLOT_LENGTH_MM / 2 - arm : HOLE_RADIUS_MM - arm;
    const marks = [
        `M ${uu(hole.x - reach)},${uu(hole.y)} L ${uu(hole.x + reach)},${uu(hole.y)}`,
        `M ${uu(hole.x)},${uu(hole.y - HOLE_RADIUS_MM + arm)} L ${uu(hole.x)},${uu(hole.y + HOLE_RADIUS_MM - arm)}`,
    ];

    /* A slot has no single vertical center worth marking, so mark the travel
       of the hole instead: both ends plus the middle. */
    if (slotted) {
        const offset = SLOT_LENGTH_MM / 2 - HOLE_RADIUS_MM;
        for (const dx of [-offset, offset]) {
            marks.push(
                `M ${uu(hole.x + dx)},${uu(hole.y - HOLE_RADIUS_MM + arm)} L ${uu(hole.x + dx)},${uu(hole.y + HOLE_RADIUS_MM - arm)}`,
            );
        }
    }

    return marks;
}

function layer(id, contents, style) {
    const attrs = [`id="${id}"`, `inkscape:groupmode="layer"`, `inkscape:label="${id}"`];

    if (style) {
        attrs.push(`style="${xml_escape(style)}"`);
    }

    if (!contents.length) {
        return [`  <g ${attrs.join(" ")} />`];
    }

    return [`  <g ${attrs.join(" ")}>`, ...contents.map((line) => `    ${line}`), "  </g>"];
}

/* Builds a Eurorack panel template.

   Options:
     hp            width in horizontal pitch units (default 6)
     height_mm     panel height (default 128.5, the 3U format)
     offset_mm     how much to shave off the nominal HP width for fit
     symmetric     size from the mounting holes so both margins match
     slotted       use oval mounting slots instead of round holes
     center_marks  add crosshairs on the hole centers, as an editing guide

   Returns the document source along with the metadata needed to name and
   describe it. */
export function generate_panel_svg(options = {}) {
    const hp = clamp(Math.round(number(options.hp, 6)), 1, 200);
    const height_mm = clamp(number(options.height_mm, PANEL_FORMATS["3U"]), 10, 500);
    const offset_mm = clamp(number(options.offset_mm, DEFAULT_WIDTH_OFFSET_MM), 0, HP_MM);
    const symmetric = Boolean(options.symmetric);
    const slotted = Boolean(options.slotted);
    const center_marks = Boolean(options.center_marks);

    const width_mm = panel_width_mm(hp, { offset_mm, symmetric });
    const holes = mounting_holes(hp, width_mm, height_mm);

    /* Round holes are real drills, so they belong on the Drill layer where
       Gingerbread turns them into non-plated holes. Slots have no drill
       equivalent, so they become cutouts in the board outline instead. */
    const outline = [rect_path(0, 0, width_mm, height_mm)];
    const drills = [];

    for (const hole of holes) {
        if (slotted) {
            outline.push(slot_path(hole.x, hole.y, SLOT_LENGTH_MM, HOLE_RADIUS_MM));
        } else {
            drills.push(`<circle cx="${uu(hole.x)}" cy="${uu(hole.y)}" r="${uu(HOLE_RADIUS_MM)}" />`);
        }
    }

    const layers = [
        ...layer(
            "Edge.Cuts",
            [`<path d="${outline.join(" ")}" />`],
            `fill:${PANEL_COLOR};fill-rule:evenodd;stroke:${OUTLINE_COLOR};stroke-width:${uu(0.1)}`,
        ),
        ...EMPTY_LAYERS.flatMap((name) => layer(name, [])),
        ...layer("Drill", drills, `fill:${HOLE_COLOR};stroke:${OUTLINE_COLOR};stroke-width:${uu(0.1)}`),
    ];

    if (center_marks) {
        /* Gingerbread ignores layers it doesn't recognize, so these are safe to
           leave in the file. */
        const marks = holes.flatMap((hole) => center_mark_paths(hole, slotted));
        layers.push(
            ...layer(
                "Guides",
                marks.map((d) => `<path d="${d}" />`),
                `fill:none;stroke:${GUIDE_COLOR};stroke-width:${uu(0.05)}`,
            ),
        );
    }

    const title = `Eurorack panel — ${hp}HP × ${height_mm}mm`;

    const lines = [
        `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
        `<svg xmlns="${SVG_NS}" xmlns:inkscape="${INKSCAPE_NS}" version="1.1"`,
        `     width="${width_mm}mm" height="${height_mm}mm"`,
        `     viewBox="0 0 ${uu(width_mm)} ${uu(height_mm)}">`,
        `  <title>${xml_escape(title)}</title>`,
        ...layers,
        "</svg>",
        "",
    ];

    return {
        svg: lines.join("\n"),
        title: title,
        filename: `eurorack-panel-${hp}hp-${height_mm}mm.svg`,
        hp: hp,
        width_mm: Number.parseFloat(width_mm.toFixed(2)),
        height_mm: height_mm,
        hole_count: holes.length,
    };
}
