import * as yak from "./yak.js";
import { LibGingerbread } from "./libgingerbread.js";
import { PreviewCanvas } from "./preview-canvas.js";
import { DropTarget } from "./dragdrop.js";
import { DEFAULT_WIDTH_OFFSET_MM, PANEL_FORMATS, generate_panel_svg } from "./panel.js";
import { preferences } from "./prefs.js";

/* Drops any match that's nested inside another one.

   A layer's name can sit on the layer group *and* on the artwork inside it —
   Inkscape does this readily, and the selectors match on both id and
   inkscape:label — so the same element can be matched twice over. Transplanting
   both copies exports every shape twice, which is invisible on raster layers
   but leaves Edge.Cuts with duplicate coincident outlines that KiCad can't
   resolve into cutouts. */
function outermost(elms) {
    const matches = Array.from(elms);
    return matches.filter((elm) => !matches.some((other) => other !== elm && other.contains(elm)));
}

/* What a design starts out as, before anything the user saved last session. */
const DEFAULT_DPI = 2540;
const DEFAULT_MASK_OPACITY = 0.9;
const DEFAULT_MIRROR_BACK = true;

class Design {
    static mask_colors = {
        green: "rgb(0, 84, 3)",
        red: "rgb(127, 0, 0)",
        yellow: "rgb(207, 184, 0)",
        blue: "rgb(0, 28, 204)",
        white: "white",
        black: "black",
        pink: "pink",
        grey: "grey",
        orange: "orange",
        purple: "rgb(117, 0, 207)",
    };

    static silk_colors = ["white", "black", "yellow", "blue", "grey"];

    /* Board finishes. These only change how the preview looks: the exporter
       traces each layer's alpha, so the color it's drawn in never reaches the
       .kicad_pcb. */
    static copper_colors = {
        gold: "gold",
        tin: "rgb(160, 160, 160)",
        silver: "rgb(213, 213, 213)",
        copper: "rgb(184, 115, 50)",
    };

    static layer_defs = [
        {
            name: "Drill",
            type: "drill",
            selector: "#Drill, #Drills, [*|label=\"Drill\"], [*|label=\"Drills\"]",
            color: "Fuchsia",
        },
        {
            name: "FSilkS",
            type: "raster",
            selector: "#FSilkS, #F\\.SilkS, [*|label=\"FSilkS\"], [*|label=\"F\\.SilkS\"]",
            color: "white",
            number: 3,
        },
        {
            name: "FMask",
            type: "raster",
            selector: "#FMask, #F\\.Mask, [*|label=\"FMask\"], [*|label=\"F\\.Mask\"]",
            color: "black",
            is_mask: true,
            number: 5,
        },
        {
            name: "FCu",
            type: "raster",
            selector: "#FCu, #F\\.Cu, [*|label=\"FCu\"], [*|label=\"F\\.Cu\"]",
            color: "gold",
            number: 1,
        },
        {
            name: "BCu",
            type: "raster",
            selector: "#BCu, #B\\.Cu, [*|label=\"BCu\"], [*|label=\"B\\.Cu\"]",
            color: "gold",
            is_back: true,
            number: 2,
        },
        {
            name: "BMask",
            type: "raster",
            selector: "#BMask, #B\\.Mask, [*|label=\"BMask\"], [*|label=\"B\\.Mask\"]",
            color: "black",
            is_mask: true,
            is_back: true,
            number: 6,
        },
        {
            name: "BSilkS",
            type: "raster",
            selector: "#BSilkS, #B\\.SilkS, [*|label=\"BSilkS\"], [*|label=\"B\\.SilkS\"]",
            color: "white",
            is_back: true,
            number: 4,
        },
        {
            name: "EdgeCuts",
            type: "vector",
            selector: "#EdgeCuts, #Edge\\.Cuts, [*|label=\"EdgeCuts\"], [*|label=\"Edge\\.Cuts\"]",
            color: "PeachPuff",
            force_color: true,
            number: 7,
        },
    ];

    constructor(canvas, svg, name = "design.svg") {
        this.cvs = canvas;
        this.svg = svg;
        /* Examples are loaded by path, so keep just the basename. */
        this.name = name.split("/").pop();
        this.svg_template = yak.cloneDocumentRoot(this.svg, "image/svg+xml");
        this._preview_layout = "both";
        this._mask_opacity = DEFAULT_MASK_OPACITY;
        this._mirror_back = DEFAULT_MIRROR_BACK;
        /* The draw in flight, if any, and whether another was asked for while
           it ran. See draw(). */
        this.drawing = null;
        this.draw_requested = false;
        this.determine_size();
        this.make_layers();
        this.restore_preferences();

        this.resize_observer = new ResizeObserver(() => {
            this.cvs.resize_to_container();
            this.draw();
        });
        this.resize_observer.observe(this.cvs.elm);
    }

    /* Detaches a design that's being replaced or closed, so that it stops
       redrawing itself over whatever comes next. */
    dispose() {
        this.resize_observer.disconnect();
        this.draw_requested = false;
    }

    /* Exports sit next to the design they came from, rather than all being
       called the same thing. */
    get output_filename() {
        return `${this.name.replace(/\.svg$/i, "")}.kicad_pcb`;
    }

    determine_size() {
        const viewbox = this.svg.documentElement.viewBox.baseVal;
        /* Assigned behind the setter: this is the starting point, not a choice
           the user just made, so it shouldn't write itself back to storage. */
        this._dpi = DEFAULT_DPI;
        this.width_pts = viewbox.width;
        this.height_pts = viewbox.height;
        this.preview_width = Math.min(this.width_pts * 0.25, 1024);
        this.raster_width = this.width_pts * 0.5;
    }

    make_layers() {
        this.layers = [];
        this.layers_by_name = {};

        for (const layer_def of Design.layer_defs) {
            const layer_doc = this.svg_template.cloneNode(true);
            const layer_elms = outermost(this.svg.querySelectorAll(layer_def.selector));

            for (const layer_elm of layer_elms) {
                yak.transplantElement(layer_elm, layer_doc);
            }

            const layer = new Layer(this, layer_doc, layer_def);
            layer.present = layer_elms.length > 0;

            this.layers.push(layer);
            this.layers_by_name[layer_def.name] = layer;
        }
    }

    /* Puts back the settings the user picked last time. Colors go straight onto
       the layers rather than through the setters, which would redraw a canvas
       that hasn't been sized yet; the first draw comes from the resize
       observer. */
    restore_preferences() {
        this._dpi = preferences.get_number("dpi", this._dpi, 1);
        this._mask_opacity = preferences.get_number("mask_opacity", this._mask_opacity, 0, 1);
        this._mirror_back = preferences.get_boolean("mirror_back", this._mirror_back);

        const mask_color = preferences.get_choice("mask_color", Object.values(Design.mask_colors), null);
        if (mask_color) {
            this.layers_by_name["FMask"].color = mask_color;
            this.layers_by_name["BMask"].color = mask_color;
        }

        const silk_color = preferences.get_choice("silk_color", Design.silk_colors, null);
        if (silk_color) {
            this.layers_by_name["FSilkS"].color = silk_color;
            this.layers_by_name["BSilkS"].color = silk_color;
        }

        const copper_color = preferences.get_choice("copper_color", Object.values(Design.copper_colors), null);
        if (copper_color) {
            this.layers_by_name["FCu"].color = copper_color;
            this.layers_by_name["BCu"].color = copper_color;
        }
    }

    get dpi() {
        return this._dpi;
    }

    set dpi(val) {
        /* Number(), because the size fields set this by way of dpmm, which
           hands over a fixed-precision string. */
        this._dpi = Number(val);
        preferences.set("dpi", this._dpi);
    }

    get dpmm() {
        return 25.4 / this.dpi;
    }

    set dpmm(val) {
        this.dpi = (25.4 / val).toFixed(1);
    }

    get trace_scale_factor() {
        return (this.width_pts * this.dpmm) / this.raster_width;
    }

    get width_mm() {
        return (this.width_pts * this.dpmm).toFixed(2);
    }

    set width_mm(val) {
        this.dpmm = val / this.width_pts;
    }

    get height_mm() {
        return (this.height_pts * this.dpmm).toFixed(2);
    }

    set height_mm(val) {
        this.dpmm = val / this.height_pts;
    }

    get edge_cuts() {
        return this.layers_by_name["EdgeCuts"];
    }

    get mask_color() {
        return this.layers_by_name["FMask"].color;
    }

    set mask_color(val) {
        this.layers_by_name["FMask"].color = val;
        this.layers_by_name["BMask"].color = val;
        preferences.set("mask_color", val);
        this.draw();
    }

    get mask_opacity() {
        return this._mask_opacity;
    }

    set mask_opacity(val) {
        this._mask_opacity = val;
        preferences.set("mask_opacity", val);
        this.draw();
    }

    get silk_color() {
        return this.layers_by_name["FSilkS"].color;
    }

    set silk_color(val) {
        this.layers_by_name["FSilkS"].color = val;
        this.layers_by_name["BSilkS"].color = val;
        preferences.set("silk_color", val);
        this.draw();
    }

    get copper_color() {
        return this.layers_by_name["FCu"].color;
    }

    set copper_color(val) {
        this.layers_by_name["FCu"].color = val;
        this.layers_by_name["BCu"].color = val;
        preferences.set("copper_color", val);
        this.draw();
    }

    get mirror_back() {
        return this._mirror_back;
    }

    set mirror_back(val) {
        this._mirror_back = val;
        preferences.set("mirror_back", val);
    }

    /* Where the back layers get flipped, in SVG user units.

       The middle of the board outline rather than the middle of the page, so
       that mirrored artwork lands back on the board even when the page is
       bigger than what's being cut out of it. Designs without an Edge.Cuts
       layer have no board to speak of, so the page it is. */
    get mirror_axis() {
        let left = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;

        for (const path of this.edge_cuts.get_paths()) {
            for (const point of path) {
                left = Math.min(left, point[0]);
                right = Math.max(right, point[0]);
            }
        }

        return left <= right ? (left + right) / 2 : this.width_pts / 2;
    }

    get preview_layout() {
        return this._preview_layout;
    }

    set preview_layout(val) {
        this._preview_layout = val;
        this.draw();
    }

    async draw_layers(layers, side) {
        const cvs = this.cvs;

        let i = 0;
        for (const layer_name of layers) {
            const layer = this.layers_by_name[layer_name];

            if (!layer.visible) {
                continue;
            }

            if (layer.is_mask) {
                cvs.ctx.globalAlpha = this.mask_opacity;
            }

            if (this.preview_layout === "both") {
                cvs.draw_image_two_up(await layer.get_preview_bitmap(), side);
            } else if (this.preview_layout.endsWith("-spread")) {
                cvs.draw_image_n_up(await layer.get_preview_bitmap(), i, layers.length);
            } else {
                cvs.draw_image(await layer.get_preview_bitmap());
            }

            cvs.ctx.globalAlpha = 1;
            i++;
        }
    }

    /* Dragging the opacity slider asks for redraws far faster than one can
       finish, and draw_frame() awaits between clearing the canvas and filling
       it again, so overlapping calls would tear. Only one runs at a time; while
       it does, further requests collapse into a single repeat afterwards, which
       lands on whatever the newest values are. */
    draw() {
        if (this.drawing) {
            this.draw_requested = true;
            return this.drawing;
        }

        this.drawing = (async () => {
            try {
                do {
                    this.draw_requested = false;
                    await this.draw_frame();
                } while (this.draw_requested);
            } finally {
                this.drawing = null;
            }
        })();

        return this.drawing;
    }

    async draw_frame() {
        const cvs = this.cvs;

        cvs.clear();

        if (this.preview_layout === "front" || this.preview_layout === "front-spread" || this.preview_layout === "both") {
            await this.draw_layers(["EdgeCuts", "FCu", "FMask", "FSilkS", "Drill"], "left");
        }

        if (this.preview_layout === "back" || this.preview_layout === "back-spread" || this.preview_layout === "both") {
            await this.draw_layers(["EdgeCuts", "BCu", "BMask", "BSilkS", "Drill"], "right");
        }
    }

    toggle_layer_visibility(layer_name) {
        const layer = this.layers_by_name[layer_name];
        layer.visible = !layer.visible;
        return layer.visible;
    }

    async export(method) {
        const gingerbread = await LibGingerbread.new();
        console.log(gingerbread);

        gingerbread.conversion_start();

        /* Rasters are traced at raster_width px across the page, so the flip
           has to be expressed in those pixels rather than in user units. */
        const mirror_x = this.mirror_back ? (this.mirror_axis * this.raster_width) / this.width_pts : null;

        for (const layer of this.layers) {
            switch (layer.type) {
                case "raster": {
                    const bm = await layer.get_raster_bitmap();
                    const imgdata = await yak.ImageData_from_ImageBitmap(bm, layer.is_back ? mirror_x : null);
                    gingerbread.conversion_add_raster_layer(layer.number, this.trace_scale_factor, imgdata);
                    break;
                }
                case "vector":
                    for (const path of layer.get_paths()) {
                        gingerbread.conversion_start_poly();
                        for (const pt of path) {
                            gingerbread.conversion_add_poly_point(pt[0], pt[1], this.dpmm);
                        }
                        gingerbread.conversion_end_poly(layer.number, 0.05, false);
                    }
                    break;
                case "drill":
                    for (const circle of layer.get_circles()) {
                        gingerbread.conversion_add_drill(circle.cx, circle.cy, circle.r * 2, this.dpmm);
                    }
                    break;
                default:
                    throw `Unexpected layer type ${layer.type}`;
            }
        }

        const footprint = gingerbread.conversion_finish();

        if (method === "clipboard") {
            navigator.clipboard.writeText(footprint);
        } else {
            const file = new File([footprint], this.output_filename);
            yak.initiateDownload(file);
        }
    }
}

class Layer {
    constructor(design, svg, options) {
        this.design = design;
        this.svg = svg;

        this.name = options.name;
        this.number = options.number;
        this.type = options.type || "raster";
        this.force_color = options.force_color || false;
        this.is_mask = options.is_mask || false;
        this.is_back = options.is_back || false;
        this.color = options.color || "red";

        this.visible = true;
        /* Whether the design actually contained anything for this layer. */
        this.present = false;
    }

    get color() {
        return this._color;
    }

    set color(val) {
        this._color = val;

        if (this.force_color) {
            yak.SVGElement_color(this.svg, this._color, this._color);
        } else {
            yak.SVGElement_recolor(this.svg, this._color, this._color);
        }

        if (this.bitmap) {
            this.bitmap.close();
            this.bitmap = null;
        }
    }

    async get_preview_bitmap() {
        if (!this.bitmap) {
            this.bitmap = await yak.createImageBitmap(this.svg, this.design.preview_width);
            if (this.is_mask) {
                this.bitmap = await yak.ImageBitmap_inverse_mask(this.bitmap, await this.design.edge_cuts.get_preview_bitmap(), this.color);
            }
        }
        return this.bitmap;
    }

    async get_raster_bitmap() {
        return await yak.createImageBitmap(this.svg, this.design.raster_width);
    }

    *get_paths() {
        yield* yak.SVGElement_to_paths(this.svg.documentElement);
    }

    *get_circles() {
        yield* yak.SVGElement_to_circles(this.svg.documentElement);
    }
}

let cvs = undefined;
let design = undefined;

/* An error worth showing to the user verbatim, as opposed to an unexpected
   exception. */
class DesignError extends Error {}

/* Browsers don't always report a type for .svg files, so fall back to the
   extension. */
function is_svg_file(file) {
    return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

async function load_design_file(file) {
    if (!is_svg_file(file)) {
        throw new DesignError(
            `Gingerbread needs an SVG file, but "${file.name}" is ${file.type || "of an unknown type"}.`,
        );
    }

    const svg_doc = new DOMParser().parseFromString(await file.text(), "image/svg+xml");

    // DOMParser reports XML errors by returning a <parsererror> document rather
    // than by throwing.
    if (svg_doc.querySelector("parsererror") !== null || svg_doc.documentElement.tagName !== "svg") {
        throw new DesignError(`"${file.name}" couldn't be parsed as SVG.`);
    }

    const viewbox = svg_doc.documentElement.viewBox.baseVal;

    if (!viewbox.width || !viewbox.height) {
        throw new DesignError(
            `"${file.name}" has no viewBox, so Gingerbread can't tell how big it is. Set a document size in your editor and export it again.`,
        );
    }

    // Checked before building the Design so that a design with nothing usable
    // in it never becomes the current one.
    const found = Design.layer_defs.filter((layer_def) => svg_doc.querySelector(layer_def.selector) !== null);

    if (!found.length) {
        const names = Design.layer_defs.map((layer_def) => layer_def.name).join(", ");
        throw new DesignError(
            `None of Gingerbread's layers were found in "${file.name}". Name your layers (or the objects themselves) after the KiCad layers: ${names}. Dotted spellings such as F.Cu and Edge.Cuts work too.`,
        );
    }

    if (cvs === undefined) {
        cvs = new PreviewCanvas(document.getElementById("preview-canvas"));
    }

    design?.dispose();
    design = new Design(cvs, svg_doc, file.name);

    window.dispatchEvent(new CustomEvent("designloaded", { detail: design }));
}

/* Loads a design, reporting any problem to the user instead of leaving them
   with a blank screen. */
async function open_design_file(file) {
    window.dispatchEvent(new CustomEvent("designerror", { detail: null }));

    try {
        await load_design_file(file);
    } catch (err) {
        console.error(err);
        window.dispatchEvent(
            new CustomEvent("designerror", {
                detail: err instanceof DesignError ? err.message : `Couldn't load "${file.name}": ${err.message}`,
            }),
        );
    }
}

new DropTarget(
    document.querySelector("body"),
    async (files) => {
        await open_design_file(files[0]);
    },
    (dragging) => {
        window.dispatchEvent(new CustomEvent("dragging", { detail: dragging }));
    },
);

/* The layer list as it looks before anything is loaded. */
function default_layers() {
    return Design.layer_defs.map((prop) => {
        return { name: prop.name, visible: true };
    });
}

document.addEventListener("alpine:init", () => {
    Alpine.data("app", () => ({
        mask_colors: Design.mask_colors,
        silk_colors: Design.silk_colors,
        copper_colors: Design.copper_colors,
        layers: default_layers(),
        design: false,
        error: null,
        dragging: false,
        current_layer: "FSilkS",
        toggle_layer_visibility(layer) {
            layer.visible = design.toggle_layer_visibility(layer.name);
            design.draw(cvs);
        },
        designloaded(e) {
            this.design = e.detail;
            this.error = null;
            this.layers = this.design.layers.map((layer) => {
                return { name: layer.name, visible: layer.visible, present: layer.present };
            });
        },
        designerror(e) {
            this.error = e.detail;
        },
        dragged(e) {
            this.dragging = e.detail;
        },
        /* Returns to the landing screen so another design can be opened
           without reloading the page. */
        close_design() {
            design?.dispose();
            design = undefined;
            cvs?.clear();
            this.design = false;
            this.error = null;
            this.layers = default_layers();
        },
        exporting: false,
        async export_design(method) {
            this.error = null;
            this.exporting = true;

            try {
                await this.design.export(method);
            } catch (err) {
                // Without this the buttons stay disabled forever and the only
                // way out is a reload.
                console.error(err);
                this.error = `Export failed: ${err.message}`;
                this.exporting = false;
                return;
            }

            this.exporting = "done";
            window.setTimeout(() => {
                this.exporting = false;
            }, 3000);
        },
        async open_file(event) {
            const file = event.target.files[0];

            // Cleared so that picking the same file twice in a row still fires
            // a change event.
            event.target.value = "";

            if (file) {
                await open_design_file(file);
            }
        },
        async load_example_design(name) {
            const response = await fetch(name);
            await open_design_file(new File([await response.blob()], name, { type: "image/svg+xml" }));
        },

        /* Eurorack panel template generator */
        panel_modal: false,
        panel_formats: PANEL_FORMATS,
        panel: {
            hp: 6,
            height_mm: PANEL_FORMATS["3U"],
            offset_mm: DEFAULT_WIDTH_OFFSET_MM,
            symmetric: false,
            slotted: false,
            center_marks: false,
        },
        /* Regenerated on every change to the options above, which is what keeps
           the modal's preview and its download in sync. */
        get panel_template() {
            return generate_panel_svg(this.panel);
        },
        get panel_preview_src() {
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.panel_template.svg)}`;
        },
        panel_file() {
            const template = this.panel_template;
            return new File([template.svg], template.filename, { type: "image/svg+xml" });
        },
        download_panel() {
            yak.initiateDownload(this.panel_file());
        },
        async open_panel() {
            this.panel_modal = false;
            await open_design_file(this.panel_file());
        },
    }));
});
