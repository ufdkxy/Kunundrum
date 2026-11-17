# Kunundrum solver as WebAssembly

Phase 0 (spike): build the unchanged CLI to WASM and check it against the native solver.

## One-time Emscripten setup
```sh
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh        # Windows: emsdk_env.bat   (repeat in every new terminal)
em++ --version               # should print a version
```
Needs git and Python 3 (emsdk bundles Node).

## Build and check (from `Solver/`)
```sh
node wasm/build.js           # or: make wasm   -> wasm/build/kunsolve.js (single file, WASM embedded, works from file://)
make                         # native kunsolve for comparison (optional)
node wasm/spike.js           # compares WASM vs native on catalog levels
```
`wasm/build/` is git-ignored for now.
