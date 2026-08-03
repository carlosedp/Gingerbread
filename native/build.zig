const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .wasi,
    });
    const optimize = b.standardOptimizeOption(.{});

    const potrace_mod = b.createModule(.{
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const libpotrace = b.addLibrary(.{
        .name = "potrace",
        .linkage = .static,
        .root_module = potrace_mod,
    });
    const libpotrace_flags = .{ "-std=gnu17", "-DHAVE_CONFIG_H" };
    potrace_mod.addIncludePath(b.path("lib/potrace-1.16/src"));
    potrace_mod.addIncludePath(b.path("lib/potrace-config"));
    potrace_mod.addCSourceFile(.{ .file = b.path("lib/potrace-1.16/src/curve.c"), .flags = &libpotrace_flags });
    potrace_mod.addCSourceFile(.{ .file = b.path("lib/potrace-1.16/src/trace.c"), .flags = &libpotrace_flags });
    potrace_mod.addCSourceFile(.{ .file = b.path("lib/potrace-1.16/src/decompose.c"), .flags = &libpotrace_flags });
    potrace_mod.addCSourceFile(.{ .file = b.path("lib/potrace-1.16/src/potracelib.c"), .flags = &libpotrace_flags });

    const clipper2_mod = b.createModule(.{
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
    });
    const libclipper2 = b.addLibrary(.{
        .name = "clipper2",
        .linkage = .static,
        .root_module = clipper2_mod,
    });
    const libclipper2_flags = .{ "-std=gnu++17", "-fno-exceptions", "-Dthrow=abort" };
    clipper2_mod.addIncludePath(b.path("lib/clipper2/CPP/Clipper2Lib"));
    clipper2_mod.addIncludePath(b.path("src"));
    clipper2_mod.addCSourceFile(.{
        .file = b.path("lib/clipper2/CPP/Clipper2Lib/clipper.engine.cpp"),
        .flags = &libclipper2_flags,
    });
    clipper2_mod.addCSourceFile(.{
        .file = b.path("lib/clipper2/CPP/Clipper2Lib/clipper.offset.cpp"),
        .flags = &libclipper2_flags,
    });
    clipper2_mod.addCSourceFile(.{
        .file = b.path("src/clipperwrapper.cpp"),
        .flags = &libclipper2_flags,
    });

    const gingerbread_mod = b.createModule(.{
        .root_source_file = b.path("src/gingerbread.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .strip = true,
    });
    const libgingerbread = b.addExecutable(.{
        .name = "gingerbread",
        .version = .{ .major = 1, .minor = 0, .patch = 0 },
        .root_module = gingerbread_mod,
    });
    libgingerbread.entry = .disabled;
    libgingerbread.rdynamic = true;
    libgingerbread.wasi_exec_model = .reactor;
    gingerbread_mod.linkLibrary(libpotrace);
    gingerbread_mod.linkLibrary(libclipper2);
    gingerbread_mod.addIncludePath(b.path("src"));
    gingerbread_mod.addIncludePath(b.path("lib/potrace-1.16/src"));

    b.installArtifact(libgingerbread);

    // const tests_mod = b.createModule(.{
    //     .root_source_file = b.path("src/tests.zig"),
    //     .target = target,
    //     .optimize = optimize,
    //     .link_libc = true,
    // });
    // const main = b.addTest(.{
    //     .name = "main",
    //     .root_module = tests_mod,
    // });
    // tests_mod.linkLibrary(libpotrace);
    // tests_mod.linkLibrary(libclipper2);
    // tests_mod.addIncludePath(b.path("src/"));
    // tests_mod.addIncludePath(b.path("lib/potrace-1.16/src"));
    // tests_mod.addIncludePath(b.path("lib/potrace-config"));
    // tests_mod.addIncludePath(b.path("lib/stb"));
    // tests_mod.addCSourceFile(.{ .file = b.path("src/load_image.c"), .flags = &.{
    //     "-std=gnu17",
    // } });

    // const test_step = b.step("test", "Test the program");
    // test_step.dependOn(&b.addRunArtifact(main).step);
    // b.default_step.dependOn(test_step);
}
