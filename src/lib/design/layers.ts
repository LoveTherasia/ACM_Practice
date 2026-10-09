/**
 * The z-index scale (taste-skill Section 6.F).
 *
 * Layering is systemic, not per component. Nothing outside this file should
 * hard-code a z-index; if a new surface needs to sit between two of these, add
 * a step here and use it everywhere.
 */
export const z = {
  /** Default stacking context. No positioning, no z-index. */
  base: 0,
  /** Sticky table headers, sticky sub-navigation. */
  sticky: 10,
  /** Console shell header (Carbon UIShell pinned). */
  shell: 30,
  /** Overlays that sit above page content: menus, panels. */
  overlay: 40,
  /** Modals and their scrims. */
  modal: 60,
  /** Skip link, toasts. Must beat modal scrims to stay reachable. */
  transient: 70,
  /** Dev affordances. Never ship product UI at this layer. */
  dev: 80,
} as const;

export type ZLayer = keyof typeof z;