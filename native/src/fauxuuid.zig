const builtin = @import("builtin");
const std = @import("std");
const print = std.debug.print;
const testing = std.testing;

// std.crypto.random was removed in Zig 0.16, so seed a PRNG once from the
// host's entropy instead. These UUIDs are only used as KiCAD tstamps, so a
// PRNG is plenty — hence "faux".
var prng: ?std.Random.DefaultPrng = null;

fn random() std.Random {
    if (prng == null) {
        var seed: u64 = 0;
        if (builtin.os.tag == .wasi) {
            _ = std.os.wasi.random_get(@ptrCast(&seed), @sizeOf(u64));
        }
        prng = std.Random.DefaultPrng.init(seed);
    }
    return prng.?.random();
}

pub const FauxUUID = struct {
    bytes: [16]u8,

    pub fn init() FauxUUID {
        var uuid = FauxUUID{ .bytes = undefined };
        random().bytes(&uuid.bytes);
        return uuid;
    }

    pub fn format(self: FauxUUID, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try writer.print("{x}-{x}-{x}-{x}-{x}", .{
            self.bytes[0..4],
            self.bytes[4..6],
            self.bytes[6..8],
            self.bytes[8..10],
            self.bytes[10..16],
        });
    }
};

test "fauxuuid" {
    std.debug.print("\n{f}\n", .{FauxUUID.init()});
}
