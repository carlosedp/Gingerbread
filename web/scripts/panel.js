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

/* Colors are only ever seen in the template preview and in a vector editor:
   Gingerbread recolors every layer as it draws. The panel is dark so that the
   white mounting holes stand out against it, and so that silkscreen artwork
   drawn on top previews the way it will look on a finished board. */
const PANEL_COLOR = "#262b33";
const HOLE_COLOR = "#ffffff";
const OUTLINE_COLOR = "#9aa4b3";
const GUIDE_COLOR = "#f6921e";
const PCB_COLOR = "#4fc36b";

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

/* The circuit board that sits behind the panel. It has to fit between the
   rails, which take up the top and bottom ~10mm of a 3U panel, and be narrower
   than the panel so that it clears the modules either side of it. */
export const DEFAULT_PCB_HEIGHT_MM = 110;
export const DEFAULT_PCB_WIDTH_REDUCTION_MM = 2;

/* The edge of the board, in mm from the panel's top left corner. The board is
   centered on the panel both ways, so it stays clear of both rails. */
export function pcb_rect(width_mm, height_mm, options = {}) {
    const pcb_height = clamp(number(options.pcb_height_mm, DEFAULT_PCB_HEIGHT_MM), 1, height_mm);
    const reduction = clamp(number(options.pcb_width_reduction_mm, DEFAULT_PCB_WIDTH_REDUCTION_MM), 0, width_mm - 1);
    const pcb_width = width_mm - reduction;

    return {
        x: (width_mm - pcb_width) / 2,
        y: (height_mm - pcb_height) / 2,
        width: pcb_width,
        height: pcb_height,
    };
}

/* Shared by the SVG and PCB generators so the two always agree on the panel
   they describe. */
function panel_geometry(options) {
    const hp = clamp(Math.round(number(options.hp, 6)), 1, 200);
    const height_mm = clamp(number(options.height_mm, PANEL_FORMATS["3U"]), 10, 500);
    const offset_mm = clamp(number(options.offset_mm, DEFAULT_WIDTH_OFFSET_MM), 0, HP_MM);
    const symmetric = Boolean(options.symmetric);
    const width_mm = panel_width_mm(hp, { offset_mm, symmetric });

    return {
        hp: hp,
        height_mm: height_mm,
        width_mm: width_mm,
        holes: mounting_holes(hp, width_mm, height_mm),
        pcb: pcb_rect(width_mm, height_mm, options),
    };
}

/* Builds a Eurorack panel template.

   Options:
     hp            width in horizontal pitch units (default 6)
     height_mm     panel height (default 128.5, the 3U format)
     offset_mm     how much to shave off the nominal HP width for fit
     symmetric     size from the mounting holes so both margins match
     slotted       use oval mounting slots instead of round holes
     center_marks  add crosshairs on the hole centers, as an editing guide
     pcb_outline   draw where the companion PCB sits (see generate_panel_pcb)

   Returns the document source along with the metadata needed to name and
   describe it. */
export function generate_panel_svg(options = {}) {
    const { hp, height_mm, width_mm, holes, pcb } = panel_geometry(options);
    const slotted = Boolean(options.slotted);
    const center_marks = Boolean(options.center_marks);

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

    if (options.pcb_outline) {
        layers.push(
            ...layer(
                "PCB",
                [`<path d="${rect_path(pcb.x, pcb.y, pcb.width, pcb.height)}" />`],
                `fill:none;stroke:${PCB_COLOR};stroke-width:${uu(0.3)};stroke-dasharray:${uu(1)},${uu(0.6)}`,
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

/* KiCad's coordinates are mm, rounded the same way the wasm exporter does. */
function mm(value) {
    return Number.parseFloat(value.toFixed(3));
}

function uuid() {
    return globalThis.crypto.randomUUID();
}

/* Builds an empty KiCad board sized to sit behind the panel.

   It takes the same options as generate_panel_svg, plus:
     pcb_height_mm           board height (default 110)
     pcb_width_reduction_mm  how much narrower than the panel (default 2)

   The board is laid out in the panel's own coordinate frame — the panel's top
   left corner is the origin, just like the .kicad_pcb Gingerbread exports from
   the panel artwork — so a jack placed at the same position on both lines up.
   The panel outline and its mounting holes are drawn on Dwgs.User as a guide
   for placing parts. */
export function generate_panel_pcb(options = {}) {
    const { hp, height_mm, width_mm, holes, pcb } = panel_geometry(options);
    const slotted = Boolean(options.slotted);

    const rect = (x, y, w, h, layer, width) =>
        `  (gr_rect (start ${mm(x)} ${mm(y)}) (end ${mm(x + w)} ${mm(y + h)}) ` +
        `(layer "${layer}") (width ${width}) (fill none) (tstamp "${uuid()}"))`;
    const line = (x0, y0, x1, y1, layer, width) =>
        `  (gr_line (start ${mm(x0)} ${mm(y0)}) (end ${mm(x1)} ${mm(y1)}) ` +
        `(layer "${layer}") (width ${width}) (tstamp "${uuid()}"))`;
    const circle = (cx, cy, r, layer, width) =>
        `  (gr_circle (center ${mm(cx)} ${mm(cy)}) (end ${mm(cx + r)} ${mm(cy)}) ` +
        `(layer "${layer}") (width ${width}) (fill none) (tstamp "${uuid()}"))`;
    const text = (value, x, y, layer) =>
        `  (gr_text "${value}" (at ${mm(x)} ${mm(y)}) (layer "${layer}") (tstamp "${uuid()}")
    (effects (font (size 1 1) (thickness 0.15)))
  )`;

    /* Holes are drawn at their full travel when slotted, since that's the area
       the panel screws can occupy. */
    const hole_guides = holes.flatMap((hole) => {
        if (!slotted) {
            return [circle(hole.x, hole.y, HOLE_RADIUS_MM, "Dwgs.User", 0.1)];
        }
        const half = SLOT_LENGTH_MM / 2 - HOLE_RADIUS_MM;
        return [
            circle(hole.x - half, hole.y, HOLE_RADIUS_MM, "Dwgs.User", 0.1),
            circle(hole.x + half, hole.y, HOLE_RADIUS_MM, "Dwgs.User", 0.1),
            line(hole.x - half, hole.y - HOLE_RADIUS_MM, hole.x + half, hole.y - HOLE_RADIUS_MM, "Dwgs.User", 0.1),
            line(hole.x - half, hole.y + HOLE_RADIUS_MM, hole.x + half, hole.y + HOLE_RADIUS_MM, "Dwgs.User", 0.1),
        ];
    });

    const pcb_width = mm(pcb.width);
    const pcb_height = mm(pcb.height);
    const title = `Eurorack PCB — ${hp}HP, ${pcb_width} × ${pcb_height}mm`;

    const lines = [
        "(kicad_pcb (version 20211014) (generator pcbnew)",
        "  (general (thickness 1.6))",
        '  (paper "A4")',
        `  (title_block (title "${title}"))`,
        "  (layers",
        '    (0 "F.Cu" signal)',
        '    (31 "B.Cu" signal)',
        '    (36 "B.SilkS" user "B.Silkscreen")',
        '    (37 "F.SilkS" user "F.Silkscreen")',
        '    (38 "B.Mask" user)',
        '    (39 "F.Mask" user)',
        '    (40 "Dwgs.User" user "User.Drawings")',
        '    (41 "Cmts.User" user "User.Comments")',
        '    (44 "Edge.Cuts" user)',
        '    (46 "B.CrtYd" user "B.Courtyard")',
        '    (47 "F.CrtYd" user "F.Courtyard")',
        '    (48 "B.Fab" user)',
        '    (49 "F.Fab" user)',
        "  )",
        '  (net 0 "")',
        rect(pcb.x, pcb.y, pcb.width, pcb.height, "Edge.Cuts", 0.1),
        rect(0, 0, width_mm, height_mm, "Dwgs.User", 0.1),
        ...hole_guides,
        text(`${hp}HP panel outline`, width_mm / 2, height_mm + 2, "Dwgs.User"),
        ")",
        "",
    ];

    return {
        kicad_pcb: lines.join("\n"),
        title: title,
        filename: `eurorack-pcb-${hp}hp-${pcb_width}x${pcb_height}mm.kicad_pcb`,
        width_mm: pcb_width,
        height_mm: pcb_height,
    };
}
