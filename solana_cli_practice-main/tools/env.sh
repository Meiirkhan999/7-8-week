# Source this before building/testing Anchor modules:  source tools/env.sh
#
# Why each line exists (see README → Troubleshooting):
#  - Solana/Agave 1.18.26 + anchor-cli 0.30.1 match modules 04–08.
#  - anchor-cli 0.30.1 always compiles the IDL with `--cfg procmacro2_semver_exempt`, which needs
#    `proc_macro2::Span::source_file()`. That exists only in proc-macro2 <= 1.0.94 *and* only on a
#    nightly compiler from before `proc_macro::Span::source_file` was removed (spring 2025).
#    So: Cargo.lock pins proc-macro2 = 1.0.94 and the host toolchain is nightly-2025-04-15.
#    The on-chain .so is still built by the Solana platform-tools toolchain (cargo-build-sbf).
#  - COPYFILE_DISABLE=1 stops macOS from adding ._* AppleDouble files to the test-validator genesis tarball.
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
export RUSTUP_TOOLCHAIN="${ANCHOR_HOST_TOOLCHAIN:-nightly-2025-04-15}"
export COPYFILE_DISABLE=1

if ! rustup toolchain list | grep -q "^${RUSTUP_TOOLCHAIN}"; then
  echo "Installing host toolchain ${RUSTUP_TOOLCHAIN} (one-time)..."
  rustup toolchain install "${RUSTUP_TOOLCHAIN}" --profile minimal
fi

# Pin proc-macro2 and keep the lockfile at v3 (platform-tools cargo 1.75 can't read v4).
anchor_lock_fix() {
  cargo update -p proc-macro2 --precise 1.0.94 >/dev/null 2>&1 || true
  sed -i '' 's/^version = 4$/version = 3/' Cargo.lock
}

echo "solana: $(solana --version | cut -d' ' -f2) | anchor: $(anchor --version | cut -d' ' -f2) | host rustc: ${RUSTUP_TOOLCHAIN}"
