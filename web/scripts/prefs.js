/* The handful of settings that describe how someone likes to work rather than
   anything about the file they're working on: DPI, mask color and opacity, silk
   color. They're restored for every design that's opened, including in later
   sessions.

   localStorage isn't always there — private windows, storage disabled by
   policy, quota exhausted — and none of that is worth breaking the app over, so
   every access is guarded and a failure only costs the persistence. */

const STORAGE_KEY = "gingerbread.preferences";

/* Dragging a slider assigns the same preference dozens of times a second;
   writes are batched so only the value it lands on reaches storage. */
const WRITE_DELAY_MS = 250;

function read() {
    try {
        return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch (err) {
        console.warn("Couldn't read saved preferences:", err);
        return {};
    }
}

const values = read();
let write_timer = null;

function write() {
    write_timer = null;

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch (err) {
        console.warn("Couldn't save preferences:", err);
    }
}

export const preferences = {
    get(name, fallback = undefined) {
        const value = values[name];
        return value === undefined || value === null ? fallback : value;
    },

    /* Storage is editable by hand and outlives any given release, so a stored
       value that isn't a number in range is treated as absent. */
    get_number(name, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
        const value = Number(this.get(name));
        return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    },

    get_boolean(name, fallback) {
        const value = this.get(name);
        return typeof value === "boolean" ? value : fallback;
    },

    /* Same idea for the color swatches: a color an older release offered but
       this one doesn't would leave the palette with nothing selected. */
    get_choice(name, allowed, fallback) {
        const value = this.get(name);
        return allowed.includes(value) ? value : fallback;
    },

    set(name, value) {
        if (values[name] === value) {
            return;
        }

        values[name] = value;

        if (write_timer === null) {
            write_timer = window.setTimeout(write, WRITE_DELAY_MS);
        }
    },
};
