Act as a senior C++/WebAssembly developer. I need to port the "PoissonRecon" algorithm (by Michael Kazhdan) to a web browser using Emscripten and WebAssembly. 

### Context & Constraints:
- **Input Data:** LiDAR point clouds containing 2 to 3 million points.
- **Data Structure (JS side):** A single flat Float32Array containing [X, Y, Z, Nx, Ny, Nz, ...] for performance. Size is approx. 72MB.
- **Performance Requirement:** The main thread MUST NOT freeze. The calculation must run entirely in a Web Worker.
- **Memory:** The data must be transferred to the Wasm Heap using Transferable Objects and pointer allocation (_malloc/_free).
- **Algorithm Config:** Depth parameter should be configurable from JS (default to 8, max 9).

### Task:
Generate the boilerplate and the architecture for this project. Provide:

1. **C++ Wrapper (`wrapper.cpp`):**
   - An `extern "C"` function exposed via `EMSCRIPTEN_KEEPALIVE`.
   - It must accept a pointer to the Float32Array, the number of points, and the octree depth.
   - It should simulate or call the entry point of PoissonRecon and return a pointer to the generated mesh data (vertices and indices).

2. **Emscripten Compilation Command (`emcc`):**
   - Include `-O3`, memory growth flags (`ALLOW_MEMORY_GROWTH=1`, `INITIAL_MEMORY=536870912`), and necessary exported methods (`cwrap`, `malloc`, `free`).
   - Standard mono-thread compilation for robustness.

3. **Web Worker (`poisson.worker.js`):**
   - Code to initialize the Emscripten module.
   - A `onmessage` listener that receives the `ArrayBuffer` via transferable objects.
   - The memory management logic: allocating Wasm memory, copying the points into `HEAPF32`, calling the C++ function, and freeing the memory.
   - Code to extract the resulting mesh and send it back to the main thread.

4. **Main Thread Javascript (`main.js`):**
   - Dummy data generation (3 million random points with normals) as a Float32Array.
   - Sending the buffer to the worker using the transferable objects syntax: `worker.postMessage({data}, [data.buffer])`.
   - Handling the worker's response.

Write clean, modern, and production-ready code with concise comments.