/* Whether a drag is carrying files, as opposed to selected text, a link, or
   anything else the browser will happily let you drag onto the page. */
function has_files(event) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export class DropTarget {
    constructor(elm, callback, on_dragging = null) {
        this.elm = elm;
        this.callback = callback;
        this.on_dragging = on_dragging;

        /* dragenter and dragleave fire for every element the pointer crosses on
           its way in and out, so a single leave doesn't mean the drag is gone.
           Count them and only report a change at the edges. */
        this.depth = 0;

        elm.addEventListener(
            "dragenter",
            (e) => {
                if (!has_files(e)) {
                    return;
                }
                e.preventDefault();
                this.depth += 1;
                if (this.depth === 1) {
                    this.set_dragging(true);
                }
            },
            false,
        );

        elm.addEventListener(
            "dragover",
            (e) => {
                if (!has_files(e)) {
                    return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
            },
            false,
        );

        elm.addEventListener(
            "dragleave",
            () => {
                if (this.depth === 0) {
                    return;
                }
                this.depth -= 1;
                if (this.depth === 0) {
                    this.set_dragging(false);
                }
            },
            false,
        );

        elm.addEventListener(
            "drop",
            async (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.reset_dragging();

                const files = e.dataTransfer.files;

                if (files.length > 0) {
                    callback(files);
                }
            },
            false,
        );

        /* A drag abandoned outside the window never sends a matching leave,
           which would otherwise strand the overlay on screen. */
        window.addEventListener("dragend", () => this.reset_dragging(), false);
    }

    set_dragging(dragging) {
        this.on_dragging?.(dragging);
    }

    reset_dragging() {
        this.depth = 0;
        this.set_dragging(false);
    }
}
