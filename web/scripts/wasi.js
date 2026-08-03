const WASI_ESUCCESS = 0;
const WASI_ENOSYS = 52;
const WASI_STDOUT_FILENO = 1;
const WASI_STDERR_FILENO = 2;

export default class WASI {
    memory;
    /* The tail of each stream: what's been written since its last newline. */
    buffers;

    constructor() {
        this.buffers = {
            [WASI_STDOUT_FILENO]: "",
            [WASI_STDERR_FILENO]: "",
        };
        this.decoder = new TextDecoder();
    }

    setMemory(memory) {
        this.memory = memory;
    }

    getDataView() {
        return new DataView(this.memory.buffer);
    }

    exports() {
        const implemented = {
            proc_exit() {},

            environ_get: (_environ, _buf) => {
                return WASI_ESUCCESS;
            },
            environ_sizes_get: (count, buf_size) => {
                const view = this.getDataView();

                view.setUint32(count, 0, !0);
                view.setUint32(buf_size, 0, !0);

                return WASI_ESUCCESS;
            },

            fd_prestat_get() {},
            fd_prestat_dir_name() {},

            fd_write: (fd, iovs, iovsLen, nwritten) => {
                const view = this.getDataView();
                let written = 0;

                const buffers = Array.from({ length: iovsLen }, (_, i) => {
                    const ptr = iovs + i * 8;
                    const buf = view.getUint32(ptr, !0);
                    const bufLen = view.getUint32(ptr + 4, !0);

                    return new Uint8Array(this.memory.buffer, buf, bufLen);
                });

                /* A write can carry any number of lines, or half of one, so
                   whatever follows the last newline is held over until the rest
                   of it turns up. */
                for (const iov of buffers) {
                    const lines = (this.buffers[fd] + this.decoder.decode(iov, { stream: true })).split("\n");

                    this.buffers[fd] = lines.pop();

                    for (const line of lines) {
                        if (fd === WASI_STDOUT_FILENO) console.log(line);
                        else if (fd === WASI_STDERR_FILENO) console.warn(line);
                    }

                    written += iov.byteLength;
                }

                view.setUint32(nwritten, written, !0);

                return WASI_ESUCCESS;
            },

            fd_close() {},
            fd_read() {},
            fd_seek() {},

            path_open() {},
            path_rename() {},
            path_create_directory() {},
            path_remove_directory() {},
            path_unlink_file() {},

            fd_filestat_get() {},
            fd_fdstat_get: (_fd, _buf_ptr) => {
                return WASI_ESUCCESS;
            },

            random_get: (buf, buf_len) => {
                const bytes = new Uint8Array(this.memory.buffer, buf, buf_len);

                // getRandomValues() rejects requests larger than 64KiB.
                for (let i = 0; i < bytes.length; i += 65536) {
                    crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, bytes.length)));
                }

                return WASI_ESUCCESS;
            },

            clock_time_get() {},
        };

        // wasi-libc imports far more of preview1 than this module actually
        // calls, and the exact set shifts between Zig releases. Instantiation
        // fails outright if any import is missing, so hand back an ENOSYS stub
        // for everything we haven't implemented.
        return new Proxy(implemented, {
            get: (target, name) => (name in target ? target[name] : () => WASI_ENOSYS),
            has: () => true,
        });
    }
}
