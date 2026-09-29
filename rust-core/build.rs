use std::env;

fn main() {
    // Compile GLIBC compatibility stubs for older Linux distributions.
    // Only needed on Linux — skipped on macOS/Windows.
    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "linux" {
        // Link the stubs whole. They are bundled into this crate's rlib, which comes
        // before ort-sys on the linker command line; ONNX Runtime's objects reference
        // them only later, so the linker would otherwise drop them (it does as soon as
        // libstdc++ is linked statically).
        cc::Build::new()
            .file("glibc_compat.c")
            .cargo_metadata(false)
            .compile("glibc_compat");
        println!("cargo:rustc-link-search=native={}", env::var("OUT_DIR").unwrap());
        println!("cargo:rustc-link-lib=static:+whole-archive=glibc_compat");
        println!("cargo:rerun-if-changed=glibc_compat.c");
    }
}
