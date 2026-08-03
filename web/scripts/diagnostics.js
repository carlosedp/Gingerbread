/* Keeps the last little while of console output around, so that when something
   goes wrong the user can hand over what the browser saw instead of being asked
   to open devtools and describe it.

   Importing this module patches the console. Everything still goes to the real
   console as well — this only listens in. */

/* Enough to cover a whole conversion (the tracer is chatty) without letting a
   long session grow without bound. */
const MAX_ENTRIES = 400;
const MAX_VALUE_LENGTH = 2000;

const entries = [];

/* Console arguments are anything at all, and a report is no place to throw. */
function describe(value) {
    if (typeof value === "string") {
        return value;
    }

    if (value instanceof Error) {
        return value.stack || `${value.name}: ${value.message}`;
    }

    if (value === null || value === undefined || typeof value !== "object") {
        return String(value);
    }

    try {
        return JSON.stringify(value);
    } catch {
        /* Circular, or full of things JSON doesn't do, such as the wasm
           exports object. */
        return Object.prototype.toString.call(value);
    }
}

function truncate(text) {
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}… (truncated)` : text;
}

export function record(level, args) {
    const text = truncate(args.map(describe).join(" "));
    const last = entries[entries.length - 1];

    /* The tracer logs the same line over and over on some designs; collapsing
       repeats keeps the interesting entries from scrolling out of the buffer. */
    if (last && last.level === level && last.text === text) {
        last.repeats += 1;
        return;
    }

    entries.push({ time: new Date(), level: level, text: text, repeats: 1 });

    if (entries.length > MAX_ENTRIES) {
        entries.shift();
    }
}

for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);

    console[level] = (...args) => {
        record(level, args);
        original(...args);
    };
}

/* Failures that never reach a console call of ours. */
window.addEventListener("error", (event) => {
    record("uncaught", [event.error ?? event.message]);
});

window.addEventListener("unhandledrejection", (event) => {
    record("rejection", [event.reason]);
});

function timestamp(date) {
    return date.toISOString().slice(11, 23);
}

/* The whole buffer as text, under a header describing the browser and whatever
   context the caller knows about (the design, the settings, the error itself).
   Fenced, because it's meant to be pasted into an issue. */
export function report(context = {}) {
    const lines = [
        `Gingerbread diagnostics — ${new Date().toISOString()}`,
        `Page: ${window.location.href}`,
        `Browser: ${window.navigator.userAgent}`,
    ];

    for (const [name, value] of Object.entries(context)) {
        if (value !== undefined && value !== null) {
            lines.push(`${name}: ${value}`);
        }
    }

    lines.push("", `Console (${entries.length} of the last ${MAX_ENTRIES} entries):`);

    for (const entry of entries) {
        const repeats = entry.repeats > 1 ? ` (×${entry.repeats})` : "";
        lines.push(`${timestamp(entry.time)} ${entry.level.padEnd(9)} ${entry.text}${repeats}`);
    }

    if (!entries.length) {
        lines.push("(nothing logged)");
    }

    return ["```", ...lines, "```"].join("\n");
}
