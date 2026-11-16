/** Most vertices a body is skinned at on the CPU to measure it; larger bodies are read at an even stride. */
const SKIN_SAMPLE_BUDGET = 3000;

/** The stride that reads at most SKIN_SAMPLE_BUDGET of `count` vertices, spread evenly over the mesh. */
export function skinStride(count: number): number {
  return Math.max(1, Math.ceil(count / SKIN_SAMPLE_BUDGET));
}
