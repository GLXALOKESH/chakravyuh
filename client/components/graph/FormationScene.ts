// The overview graph, drawn on one WebGL canvas that can be panned and zoomed.
//
// Every account starts as an ordinary node in a plain node-link graph. Nothing
// is known in advance: an account appears the first time it transacts, a line
// joins every pair that has paid each other, and a force simulation
// (layout.worker.ts) arranges them by who deals with whom, so whatever
// structure the data has is the structure on screen. Accounts with more
// counterparties are drawn larger.
//
// A ring only becomes known when its alert arrives. At that moment its
// accounts leave the crowd and line up in a panel of their own as a flow
// diagram, victim on the left and cash on the right, which opens at the edge
// of the graph and pushes the other accounts out of its way.

import gsap from "gsap";
import * as THREE from "three";
import { COLORS, ROLES } from "@/lib/constants";
import { buildFormation, type Formation } from "@/lib/formation";
import { CASH, isPseudoAccount } from "@/lib/ring";
import type { RingDetail, Role, Txn } from "@/lib/types";
import type { LayoutFrame, LayoutMessage } from "./layout.worker";

/** A ring's panel: its centre and half its width and height, in world units. */
interface Site {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** World units per unit of the ring layout, and the panel's margin round the accounts. */
const RING_SCALE_X = 0.62;
const RING_SCALE_Y = 0.85;
const PANEL_PAD = 40;
/** Clear space kept between two panels, and the extra a panel's tag needs above it. */
const PANEL_GAP = 60;
const TAG_ROOM = 70;
/** Radius of an ordinary account with one counterparty, in world units, and its limits on screen in pixels. */
const POINT_RADIUS = 3.6;
const POINT_MIN_PX = 2.2;
const POINT_MAX_PX = 15;
/** Room for accounts and for links between them; beyond these, new ones are not drawn. */
const MAX_NODES = 40000;
const MAX_LINKS = 60000;
/** Strength of a link at rest when everything is in view, and once zoomed in. */
const LINK_FAR = 0.1;
const LINK_NEAR = 0.5;
const ZOOM_OUT_LIMIT = 0.5; // relative to the zoom that fits everything
const ZOOM_IN_LIMIT = 9;
/** With nothing on the stage yet, the camera frames this much of the world. */
const EMPTY_VIEW = 420;
/** Stage pixels kept clear round the graph when everything is in view. */
const FIT_TOP = 96;
const FIT_SIDE = 64;

export interface RingAnchor {
  ringId: string;
  x: number;
  y: number;
  r: number;
  specials: { id: string; label: string; x: number; y: number; above: boolean }[];
}

export interface NodeHit {
  id: string;
  kind: "account" | "victim" | "cash" | "other";
  role?: Role;
  risk?: number;
  /** For an ordinary account: how many others it has dealt with. */
  partners?: number;
  x: number;
  y: number;
}

interface NodeVis {
  id: string;
  kind: "account" | "victim" | "cash";
  role?: Role;
  risk: number;
  x: number;
  y: number;
  r: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  seen: boolean;
}

interface EdgeVis {
  from: NodeVis;
  to: NodeVis;
  material: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface RingVis {
  id: string;
  site: Site;
  formation: Formation;
  group: THREE.Group;
  nodes: Map<string, NodeVis>;
  edges: Map<string, EdgeVis>;
  links: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>[];
  materials: THREE.Material[];
  state: { dim: number };
}

function flatMaterial(color: string, opacity: number) {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  m.userData.o = opacity;
  return m;
}

export class FormationScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  private world = new THREE.Group();
  private rings = new Map<string, RingVis>();
  private nodeRing = new Map<string, RingVis>();
  /** Rings whose alert has arrived but whose accounts the layout has not placed yet. */
  private waiting: { detail: RingDetail; instant: boolean }[] = [];
  private tweens = new Set<gsap.core.Tween>();
  private frame = 0;
  private lastTime = 0;
  private focus: string | null = null;

  // Camera: stage pixel = world * scale + (x, y).
  private view = { scale: 1, x: 0, y: 0 };
  private size = { w: 1, h: 1 };
  private bounds = { x0: -EMPTY_VIEW, y0: -EMPTY_VIEW, x1: EMPTY_VIEW, y1: EMPTY_VIEW };
  private fitScale = 1;
  private cameraDirty = true;
  /** When the person last moved the camera themselves; the graph does not steer it away from them. */
  private lastHandled = -Infinity;
  /** While true the camera keeps the whole graph in view as it grows. */
  private following = true;

  private worker: Worker;
  private pendingLinks: number[] = [];
  private pendingSettle = false;
  private sentCount = 0;

  private crowd: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private crowdIndex = new Map<string, number>();
  private crowdIds: string[] = [];
  private crowdPos = new Float32Array(MAX_NODES * 3);
  private crowdHeat = new Float32Array(MAX_NODES);
  private crowdSize = new Float32Array(MAX_NODES);
  private crowdDegree = new Uint16Array(MAX_NODES);
  /** 1 for an account that has left the crowd to stand in a formation. */
  private crowdGone = new Uint8Array(MAX_NODES);
  /** How many accounts the layout has placed so far; only these are drawn. */
  private placed = 0;
  private crowdState = { dim: 1 };
  /** Accounts that have withdrawn cash, so a formation knows its cash line has been used. */
  private cashedOut = new Set<string>();

  private links: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private linkPos = new Float32Array(MAX_LINKS * 6);
  private linkColor = new Float32Array(MAX_LINKS * 8);
  /** Two account numbers per link. */
  private linkEnds = new Int32Array(MAX_LINKS * 2);
  private linkCount = 0;
  private linkSeen = new Set<string>();
  /** Links still settling from their bright arrival to their resting strength. */
  private fresh: { index: number; life: number }[] = [];
  /** 1 for a short link, less for a long one: long links are drawn fainter so they do not bury the rest. */
  private linkReach = new Float32Array(MAX_LINKS).fill(1);
  /** 1 for a link now drawn as part of a formation instead. */
  private linkGone = new Uint8Array(MAX_LINKS);

  private circle = new THREE.CircleGeometry(1, 40);
  private diamond = new THREE.CircleGeometry(1, 4);
  private triangle = new THREE.CircleGeometry(1, 3);
  private hollow = new THREE.RingGeometry(0.58, 1, 40);
  private plane = new THREE.PlaneGeometry(1, 1);
  private moneyMaterial = flatMaterial(COLORS.turmeric, 1);

  constructor(
    canvas: HTMLCanvasElement,
    private reducedMotion: boolean,
    /** Called at most once a frame after the camera has moved, so HTML overlays can follow. */
    private onCamera: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.world);

    const linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute("position", new THREE.BufferAttribute(this.linkPos, 3));
    linkGeometry.setAttribute("color", new THREE.BufferAttribute(this.linkColor, 4));
    linkGeometry.setDrawRange(0, 0);
    this.links = new THREE.LineSegments(
      linkGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false }),
    );
    this.links.frustumCulled = false;
    this.links.renderOrder = 1;
    this.world.add(this.links);

    const crowdGeometry = new THREE.BufferGeometry();
    crowdGeometry.setAttribute("position", new THREE.BufferAttribute(this.crowdPos, 3));
    crowdGeometry.setAttribute("aHeat", new THREE.BufferAttribute(this.crowdHeat, 1));
    crowdGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.crowdSize, 1));
    crowdGeometry.setDrawRange(0, 0);
    this.crowd = new THREE.Points(
      crowdGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        uniforms: {
          uScale: { value: 1 },
          uMin: { value: POINT_MIN_PX },
          uMax: { value: POINT_MAX_PX },
          uDim: { value: 1 },
          uColor: { value: new THREE.Color(COLORS.crowd) },
          uHot: { value: new THREE.Color(COLORS.crowdHot) },
        },
        vertexShader: `
          attribute float aHeat;
          attribute float aSize;
          uniform float uScale;
          uniform float uMin;
          uniform float uMax;
          varying float vHeat;
          varying float vShow;
          void main() {
            vHeat = aHeat;
            vShow = step(0.001, aSize);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(aSize * uScale, uMin, uMax * (0.6 + 0.4 * aSize)) * (1.0 + aHeat * 0.9) * vShow;
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          uniform vec3 uHot;
          uniform float uDim;
          varying float vHeat;
          varying float vShow;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float disc = smoothstep(0.5, 0.38, d);
            gl_FragColor = vec4(mix(uColor, uHot, vHeat), disc * uDim * vShow * (0.82 + 0.18 * vHeat));
          }`,
      }),
    );
    this.crowd.frustumCulled = false;
    this.crowd.renderOrder = 2;
    this.world.add(this.crowd);

    this.worker = new Worker(new URL("./layout.worker.ts", import.meta.url));
    this.worker.onmessage = (event: MessageEvent<LayoutFrame>) => this.place(event.data.positions);

    this.frame = requestAnimationFrame(this.loop);
  }

  resize(width: number, height: number) {
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.right = width;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
    const before = this.size;
    this.size = { w: width, h: height };
    // Keep the same world point in the middle of the stage.
    this.view.x += (width - before.w) / 2;
    this.view.y += (height - before.h) / 2;
    this.cameraDirty = true;
  }

  // ---- camera ------------------------------------------------------------

  /** The camera that shows the whole graph. */
  private fitTarget() {
    const b = this.bounds;
    // Room is left at the top for a ring's tag and the Graph / Map switch.
    const scale = Math.min((this.size.w - FIT_SIDE * 2) / (b.x1 - b.x0), (this.size.h - FIT_TOP - FIT_SIDE) / (b.y1 - b.y0));
    return {
      scale,
      x: this.size.w / 2 - ((b.x0 + b.x1) / 2) * scale,
      y: (this.size.h + FIT_TOP - FIT_SIDE) / 2 - ((b.y0 + b.y1) / 2) * scale,
    };
  }

  /** Bring everything into view, and keep it in view as the graph grows. */
  fit(animate = true) {
    gsap.killTweensOf(this.view);
    this.following = true;
    if (!animate || this.reducedMotion) {
      Object.assign(this.view, this.fitTarget());
      this.fitScale = this.view.scale;
      this.cameraDirty = true;
    }
  }

  /** Frame one formation. */
  flyTo(ringId: string, animate = true) {
    const ring = this.rings.get(ringId);
    if (!ring) return;
    const scale = Math.min(this.size.w / (ring.site.hw * 2 + 160), this.size.h / (ring.site.hh * 2 + 200));
    const target = { scale, x: this.size.w / 2 - ring.site.x * scale, y: this.size.h / 2 - ring.site.y * scale };
    this.following = false;
    gsap.killTweensOf(this.view);
    if (!animate || this.reducedMotion) {
      Object.assign(this.view, target);
      this.cameraDirty = true;
      return;
    }
    this.track(
      gsap.to(this.view, {
        ...target,
        duration: 1.1,
        ease: "power3.inOut",
        onUpdate: () => {
          this.cameraDirty = true;
        },
      }),
    );
  }

  /** Zoom by `factor` keeping the world point under stage pixel (px, py) still. */
  zoomAt(px: number, py: number, factor: number) {
    const v = this.view;
    const next = Math.min(this.fitScale * ZOOM_IN_LIMIT, Math.max(this.fitScale * ZOOM_OUT_LIMIT, v.scale * factor));
    const k = next / v.scale;
    gsap.killTweensOf(v);
    v.x = px - (px - v.x) * k;
    v.y = py - (py - v.y) * k;
    v.scale = next;
    this.handled();
  }

  /** Zoom about the middle of the stage, for the buttons and the keyboard. */
  zoomBy(factor: number) {
    this.zoomAt(this.size.w / 2, this.size.h / 2, factor);
  }

  panBy(dx: number, dy: number) {
    gsap.killTweensOf(this.view);
    this.view.x += dx;
    this.view.y += dy;
    this.handled();
  }

  private handled() {
    this.following = false;
    this.lastHandled = performance.now();
    this.cameraDirty = true;
  }

  // ---- data --------------------------------------------------------------

  addTxn(txn: Txn, instant = false) {
    const quiet = instant || this.reducedMotion;
    if (instant) this.pendingSettle = true;
    if (txn.to === CASH) this.cashedOut.add(txn.from);

    // Money moving inside a formation travels along its drawn path.
    const ring = this.nodeRing.get(txn.from);
    const edge = ring?.edges.get(`${txn.from}>${txn.to}`);
    if (ring && edge) {
      this.reveal(edge.from, quiet);
      this.reveal(edge.to, quiet);
      if (!edge.seen) {
        edge.seen = true;
        this.fade(edge.material, 0.62, quiet ? 0 : 0.5);
      }
      if (!quiet) this.sendMoney(ring, edge, txn.amount);
      return;
    }

    // Otherwise both accounts join the graph, and the first time a pair pays
    // each other a line is kept between them. Cash and salary are not accounts.
    const a = isPseudoAccount(txn.from) ? null : this.node(txn.from, quiet);
    const b = isPseudoAccount(txn.to) ? null : this.node(txn.to, quiet);
    if (a === null || b === null || a === b || this.linkCount >= MAX_LINKS) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (this.linkSeen.has(key)) return;
    this.linkSeen.add(key);
    const i = this.linkCount++;
    this.linkEnds[i * 2] = a;
    this.linkEnds[i * 2 + 1] = b;
    this.pendingLinks.push(a, b);
    for (const end of [a, b]) {
      const degree = ++this.crowdDegree[end];
      // Area grows with the number of counterparties, so a hub stands out without swamping its neighbours.
      if (!this.crowdGone[end]) this.crowdSize[end] = POINT_RADIUS * 2 * Math.sqrt(1 + 0.3 * (degree - 1));
    }
    this.paintLink(i, quiet ? 0 : 1);
    if (!quiet) this.fresh.push({ index: i, life: 1 });
    this.links.geometry.attributes.color.needsUpdate = true;
    this.crowd.geometry.attributes.aSize.needsUpdate = true;
  }

  /**
   * A ring has been detected. Its formation is drawn as soon as the layout has
   * a place for every one of its accounts, which is at most a frame or two away.
   */
  addRing(detail: RingDetail, instant = false) {
    if (this.rings.has(detail.id) || this.waiting.some((w) => w.detail.id === detail.id)) return;
    if (instant) this.pendingSettle = true;
    for (const n of detail.nodes) {
      if (n.type === "account" || n.type === "victim") this.node(n.id, true);
    }
    this.waiting.push({ detail, instant });
  }

  hasRing(id: string) {
    return this.rings.has(id) || this.waiting.some((w) => w.detail.id === id);
  }

  setFocus(ringId: string | null) {
    if (this.focus === ringId) return;
    this.focus = ringId;
    const duration = this.reducedMotion ? 0 : 0.35;
    for (const ring of this.rings.values()) {
      this.track(gsap.to(ring.state, { dim: !ringId || ring.id === ringId ? 1 : 0.16, duration, overwrite: true }));
    }
    this.track(gsap.to(this.crowdState, { dim: ringId ? 0.25 : 1, duration, overwrite: true }));
  }

  reset() {
    this.tweens.forEach((t) => t.kill());
    this.tweens.clear();
    for (const ring of this.rings.values()) this.world.remove(ring.group);
    this.rings.clear();
    this.nodeRing.clear();
    this.waiting = [];
    this.cashedOut.clear();
    this.post({ type: "reset" });

    this.crowdIndex.clear();
    this.crowdIds = [];
    this.crowdHeat.fill(0);
    this.crowdDegree.fill(0);
    this.crowdGone.fill(0);
    this.placed = 0;
    this.sentCount = 0;
    this.pendingLinks = [];
    this.pendingSettle = false;
    this.linkCount = 0;
    this.linkSeen.clear();
    this.linkGone.fill(0);
    this.fresh.length = 0;
    this.crowd.geometry.setDrawRange(0, 0);
    this.links.geometry.setDrawRange(0, 0);
    this.bounds = { x0: -EMPTY_VIEW, y0: -EMPTY_VIEW, x1: EMPTY_VIEW, y1: EMPTY_VIEW };

    this.crowdState.dim = 1;
    this.focus = null;
    this.lastHandled = -Infinity;
    this.fit(false);
  }

  // ---- forming a ring ----------------------------------------------------

  /**
   * Where a new ring's panel goes: beside, above or below the crowd and clear
   * of any panel already there, wherever leaves the whole graph largest on the
   * stage. Opening it in the middle would crush the ordinary accounts.
   */
  private siteFor(formation: Formation): Site {
    const hw = (formation.width * RING_SCALE_X) / 2 + PANEL_PAD;
    const hh = (formation.height * RING_SCALE_Y) / 2 + PANEL_PAD;

    // How far the crowd reaches from the middle (the layout pulls it toward the origin).
    let reach = 0;
    for (let i = 0; i < this.placed; i++) {
      if (!this.crowdGone[i]) reach = Math.max(reach, Math.hypot(this.crowdPos[i * 3], this.crowdPos[i * 3 + 1]));
    }
    const sites = [...this.rings.values()].map((r) => r.site);
    const clear = (cx: number, cy: number) =>
      sites.every(
        (o) => Math.abs(cx - o.x) >= hw + o.hw + PANEL_GAP || Math.abs(cy - o.y) >= hh + o.hh + PANEL_GAP + TAG_ROOM,
      );
    /** The zoom at which everything would fit with the panel at (cx, cy). */
    const fitWith = (cx: number, cy: number) => {
      let x0 = -reach;
      let x1 = reach;
      let y0 = -reach;
      let y1 = reach;
      for (const o of [...sites, { x: cx, y: cy, hw, hh }]) {
        x0 = Math.min(x0, o.x - o.hw);
        x1 = Math.max(x1, o.x + o.hw);
        y0 = Math.min(y0, o.y - o.hh);
        y1 = Math.max(y1, o.y + o.hh);
      }
      return Math.min((this.size.w - FIT_SIDE * 2) / (x1 - x0), (this.size.h - FIT_TOP - FIT_SIDE) / (y1 - y0));
    };

    let best: Site | null = null;
    let bestScore = -Infinity;
    const beside = reach + PANEL_GAP * 0.6 + hw;
    const above = reach + PANEL_GAP * 0.6 + hh + TAG_ROOM;
    for (let out = 0; out < 3 && !best; out++) {
      for (let step = 0; step < 50; step++) {
        const slide = (step % 2 ? -1 : 1) * Math.ceil(step / 2) * 40;
        const far = out * 2;
        for (const [cx, cy] of [
          [-(beside + far * hw), slide],
          [beside + far * hw, slide],
          [slide, -(above + far * hh)],
          [slide, above + far * hh],
        ]) {
          if (!clear(cx, cy)) continue;
          // Among equally roomy places, the one nearest the middle of its side.
          const score = fitWith(cx, cy) * (1 - Math.abs(slide) * 0.0002);
          if (score > bestScore) {
            bestScore = score;
            best = { x: cx, y: cy, hw, hh };
          }
        }
      }
    }
    return best ?? { x: (reach + hw) * 4, y: 0, hw, hh };
  }

  /** A rectangle with rounded corners, centred on the origin. */
  private roundedRect(hw: number, hh: number, radius: number) {
    const path = new THREE.Shape();
    path.moveTo(-hw + radius, -hh);
    path.lineTo(hw - radius, -hh);
    path.quadraticCurveTo(hw, -hh, hw, -hh + radius);
    path.lineTo(hw, hh - radius);
    path.quadraticCurveTo(hw, hh, hw - radius, hh);
    path.lineTo(-hw + radius, hh);
    path.quadraticCurveTo(-hw, hh, -hw, hh - radius);
    path.lineTo(-hw, -hh + radius);
    path.quadraticCurveTo(-hw, -hh, -hw + radius, -hh);
    return path;
  }

  private formRing(detail: RingDetail, instant: boolean) {
    const quick = instant || this.reducedMotion;
    const formation = buildFormation(detail);
    const site = this.siteFor(formation);
    const group = new THREE.Group();
    group.position.set(site.x, site.y, 0);
    const ring: RingVis = {
      id: detail.id,
      site,
      formation,
      group,
      nodes: new Map(),
      edges: new Map(),
      links: [],
      materials: [],
      state: { dim: this.focus && this.focus !== detail.id ? 0.16 : 1 },
    };

    // The panel: a darker ground with a turmeric outline.
    const outline = this.roundedRect(site.hw, site.hh, 16);
    outline.holes.push(this.roundedRect(site.hw - 2.2, site.hh - 2.2, 14));
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(this.roundedRect(site.hw, site.hh, 16), 8), flatMaterial(COLORS.stageDeep, 0));
    const border = new THREE.Mesh(new THREE.ShapeGeometry(outline, 8), flatMaterial(COLORS.turmeric, 0));
    ground.renderOrder = 3;
    border.renderOrder = 3;
    group.add(ground, border);
    ring.materials.push(ground.material, border.material);
    this.fade(ground.material, 0.82, quick ? 0 : 0.7);
    this.fade(border.material, 0.9, quick ? 0 : 0.7, quick ? 0 : 0.5);

    // Each account leaves the crowd and walks to its place, taking its role colour.
    const pins: number[] = [];
    const inRing = new Set<number>();
    formation.nodes.forEach((n, order) => {
      const p = { x: n.x * RING_SCALE_X, y: n.y * RING_SCALE_Y };
      const r = n.type === "account" ? 8 + n.risk * 4 : 10;
      const color = n.type === "account" && n.role ? ROLES[n.role].color : n.type === "cash" ? COLORS.turmeric : COLORS.stone;
      const shape = n.type !== "account" ? this.diamond : n.role === "member" ? this.hollow : this.circle;
      const mesh = new THREE.Mesh(shape, flatMaterial(quick ? color : COLORS.crowd, 1));
      if (n.type === "cash") mesh.rotation.z = Math.PI / 4;
      mesh.renderOrder = 6;
      group.add(mesh);
      const node: NodeVis = { id: n.id, kind: n.type, role: n.role, risk: n.risk, x: p.x, y: p.y, r, mesh, seen: true };
      ring.nodes.set(n.id, node);
      ring.materials.push(mesh.material);

      const i = n.type === "cash" ? undefined : this.crowdIndex.get(n.id);
      if (i === undefined) {
        // Cash withdrawn has no place in the crowd: it appears at the end of the flow.
        mesh.position.set(p.x, p.y, 0);
        mesh.material.color.set(color);
        if (quick) mesh.scale.setScalar(r);
        else {
          mesh.scale.setScalar(0.0001);
          this.track(gsap.to(mesh.scale, { x: r, y: r, duration: 0.6, delay: 1, ease: "back.out(2.2)" }));
        }
        return;
      }
      this.nodeRing.set(n.id, ring);
      inRing.add(i);
      pins.push(i, site.x + p.x, site.y + p.y);
      this.crowdGone[i] = 1;
      this.crowdSize[i] = 0;
      if (quick) {
        mesh.position.set(p.x, p.y, 0);
        mesh.scale.setScalar(r);
        return;
      }
      const target = new THREE.Color(color);
      mesh.position.set(this.crowdPos[i * 3] - site.x, this.crowdPos[i * 3 + 1] - site.y, 0);
      mesh.scale.setScalar(Math.max(4, this.crowdSize[i] / 2));
      this.track(gsap.to(mesh.position, { x: p.x, y: p.y, duration: 0.9, ease: "power3.inOut" }));
      this.track(gsap.to(mesh.scale, { x: r, y: r, duration: 0.9, ease: "power3.inOut" }));
      this.track(
        gsap.to(mesh.material.color, { r: target.r, g: target.g, b: target.b, duration: 0.5, delay: 0.9 + order * 0.05 }),
      );
    });
    this.crowd.geometry.attributes.aSize.needsUpdate = true;

    // Links between two of its accounts are now drawn as part of the formation.
    for (let l = 0; l < this.linkCount; l++) {
      if (inRing.has(this.linkEnds[l * 2]) && inRing.has(this.linkEnds[l * 2 + 1])) this.linkGone[l] = 1;
    }

    const peak = Math.max(...formation.flows.map((f) => f.amount), 1);
    for (const f of formation.flows) {
      const from = ring.nodes.get(f.from);
      const to = ring.nodes.get(f.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const span = Math.max(4, length - from.r - to.r - 6);
      // A shaft and an arrowhead at the receiver, so direction still reads
      // when the replay is paused and no money is moving.
      const material = flatMaterial(COLORS.stone, 0);
      const width = 1.2 + 3.2 * Math.sqrt(f.amount / peak);
      const head = Math.max(6, width * 1.5);
      const ux = dx / length;
      const uy = dy / length;
      const startAt = from.r + 3;
      const shaft = Math.max(2, span - head);
      const mesh = new THREE.Mesh(this.plane, material);
      mesh.position.set(from.x + ux * (startAt + shaft / 2), from.y + uy * (startAt + shaft / 2), 0);
      mesh.rotation.z = Math.atan2(dy, dx);
      mesh.scale.set(shaft, width, 1);
      mesh.renderOrder = 5;
      const tip = new THREE.Mesh(this.triangle, material);
      tip.position.set(from.x + ux * (startAt + shaft + head * 0.5), from.y + uy * (startAt + shaft + head * 0.5), 0);
      tip.rotation.z = mesh.rotation.z;
      tip.scale.setScalar(head);
      tip.renderOrder = 5;
      group.add(mesh, tip);

      // A path is shown once money has actually moved along it.
      const a = this.crowdIndex.get(f.from);
      const b = this.crowdIndex.get(f.to);
      const used =
        f.to === CASH
          ? this.cashedOut.has(f.from)
          : a !== undefined && b !== undefined && this.linkSeen.has(a < b ? `${a},${b}` : `${b},${a}`);
      ring.edges.set(`${f.from}>${f.to}`, { from, to, material, seen: used });
      ring.materials.push(material);
      if (used) this.fade(material, 0.62, quick ? 0 : 0.5, quick ? 0 : 0.9);
    }

    for (const [a, b] of formation.links) {
      const na = ring.nodes.get(a);
      const nb = ring.nodes.get(b);
      if (!na || !nb) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(na.x, na.y, 0),
        new THREE.Vector3(nb.x, nb.y, 0),
      ]);
      const material = new THREE.LineDashedMaterial({
        color: COLORS.stone,
        dashSize: 5,
        gapSize: 5,
        transparent: true,
        opacity: 0,
        depthTest: false,
      });
      material.userData.o = 0;
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 4;
      group.add(line);
      ring.links.push(line);
      ring.materials.push(material);
      this.fade(material, 0.5, quick ? 0 : 0.8, quick ? 0 : 1.2);
    }

    this.world.add(group);
    this.rings.set(detail.id, ring);
    this.post({ type: "ring", site, pins });

    // Go to the ring that was just caught, then pull back out to the whole
    // graph, unless the person is steering.
    if (!instant && performance.now() - this.lastHandled > 4000) {
      this.flyTo(detail.id);
      const flownAt = performance.now();
      this.track(
        gsap.delayedCall(4.5, () => {
          if (this.lastHandled < flownAt && !this.following) this.fit();
        }) as unknown as gsap.core.Tween,
      );
    }
    this.cameraDirty = true;
  }

  // ---- read-outs for the HTML overlay -----------------------------------

  private toStage(x: number, y: number) {
    return { x: this.view.x + x * this.view.scale, y: this.view.y + y * this.view.scale };
  }

  anchors(): RingAnchor[] {
    return [...this.rings.values()].map((ring) => {
      const centre = this.toStage(ring.site.x, ring.site.y);
      return {
        ringId: ring.id,
        x: centre.x,
        y: centre.y,
        r: ring.site.hh * this.view.scale,
        // The victim and the cash point are named once there is room to read
        // the names; the legend and the tooltips name them at any zoom.
        specials:
          ring.site.hw * this.view.scale < 150
            ? []
            : [...ring.nodes.values()]
                .filter((n) => n.kind !== "account")
                .map((n) => {
                  const above = false;
                  const at = this.toStage(ring.site.x + n.x, ring.site.y + n.y + (above ? -1 : 1) * (n.r + 4));
                  return { id: n.id, label: n.kind === "victim" ? "Victim" : "Cash withdrawn", above, x: at.x, y: at.y };
                }),
      };
    });
  }

  /** The account under a pointer position, in stage pixels. */
  pick(px: number, py: number): (NodeHit & { alerted: boolean }) | null {
    const x = (px - this.view.x) / this.view.scale;
    const y = (py - this.view.y) / this.view.scale;
    for (const ring of this.rings.values()) {
      for (const n of ring.nodes.values()) {
        if (Math.hypot(x - ring.site.x - n.x, y - ring.site.y - n.y) <= n.r + 5) {
          const at = this.toStage(ring.site.x + n.x, ring.site.y + n.y - n.r);
          return {
            id: n.id,
            kind: n.kind,
            role: n.role,
            risk: n.kind === "account" ? n.risk : undefined,
            x: at.x,
            y: at.y,
            alerted: true,
          };
        }
      }
    }
    // Ordinary accounts: the nearest one within a few pixels of the pointer.
    const reach = 8 / this.view.scale;
    let best = -1;
    let bestGap = reach;
    for (let i = 0; i < this.placed; i++) {
      if (this.crowdGone[i]) continue;
      const dx = this.crowdPos[i * 3] - x;
      if (dx > reach || dx < -reach) continue;
      const gap = Math.hypot(dx, this.crowdPos[i * 3 + 1] - y);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best < 0) return null;
    const at = this.toStage(this.crowdPos[best * 3], this.crowdPos[best * 3 + 1] - POINT_RADIUS);
    return { id: this.crowdIds[best], kind: "other", partners: this.crowdDegree[best], x: at.x, y: at.y, alerted: false };
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.worker.terminate();
    this.tweens.forEach((t) => t.kill());
    gsap.killTweensOf(this.view);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.renderer.dispose();
  }

  // ---- internals ---------------------------------------------------------

  private post(message: LayoutMessage) {
    this.worker.postMessage(message);
  }

  private track(tween: gsap.core.Tween) {
    this.tweens.add(tween);
    return tween;
  }

  private fade(material: THREE.Material, to: number, duration: number, delay = 0) {
    if (!duration) {
      material.userData.o = to;
      return;
    }
    this.track(gsap.to(material.userData, { o: to, duration, delay, ease: "power2.out" }));
  }

  private reveal(node: NodeVis, instant: boolean) {
    if (node.seen) return;
    node.seen = true;
    if (instant) {
      node.mesh.scale.setScalar(node.r);
      return;
    }
    this.track(gsap.to(node.mesh.scale, { x: node.r, y: node.r, duration: 0.6, ease: "back.out(2.2)" }));
  }

  private sendMoney(ring: RingVis, edge: EdgeVis, amount: number) {
    const size = 2.5 + Math.min(3, Math.sqrt(amount / 60000));
    const dot = new THREE.Mesh(this.circle, this.moneyMaterial);
    dot.scale.setScalar(size);
    dot.position.set(edge.from.x, edge.from.y, 0);
    dot.renderOrder = 7;
    ring.group.add(dot);
    this.track(
      gsap.to(dot.position, {
        x: edge.to.x,
        y: edge.to.y,
        duration: 0.85,
        ease: "power2.inOut",
        onComplete: () => {
          ring.group.remove(dot);
          // The receiving account swells as the money lands.
          this.track(
            gsap.fromTo(
              edge.to.mesh.scale,
              { x: edge.to.r * 1.45, y: edge.to.r * 1.45 },
              { x: edge.to.r, y: edge.to.r, duration: 0.5, ease: "expo.out", overwrite: true },
            ),
          );
        },
      }),
    );
  }

  /** The layout's number for an account, adding the account the first time it is seen. */
  private node(account: string, quiet: boolean): number | null {
    let i = this.crowdIndex.get(account);
    if (i === undefined) {
      if (this.crowdIds.length >= MAX_NODES) return null;
      i = this.crowdIds.length;
      this.crowdIndex.set(account, i);
      this.crowdIds.push(account);
      this.crowdSize[i] = POINT_RADIUS * 2;
    }
    if (!quiet && !this.crowdGone[i]) this.crowdHeat[i] = 1;
    return i;
  }

  /** New positions from the layout worker. */
  private place(positions: Float32Array) {
    const count = Math.min(positions.length / 2, this.crowdIds.length);
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < count; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      this.crowdPos[i * 3] = x;
      this.crowdPos[i * 3 + 1] = y;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
    this.placed = count;

    // Any ring whose accounts all have a place now can take its formation.
    if (this.waiting.length) {
      const ready = (w: (typeof this.waiting)[number]) =>
        w.detail.nodes.every(
          (n) => (n.type !== "account" && n.type !== "victim") || (this.crowdIndex.get(n.id) ?? Infinity) < count,
        );
      const now = this.waiting.filter(ready);
      this.waiting = this.waiting.filter((w) => !ready(w));
      for (const w of now) this.formRing(w.detail, w.instant);
    }

    for (const ring of this.rings.values()) {
      const s = ring.site;
      b.x0 = Math.min(b.x0, s.x - s.hw);
      b.y0 = Math.min(b.y0, s.y - s.hh);
      b.x1 = Math.max(b.x1, s.x + s.hw);
      b.y1 = Math.max(b.y1, s.y + s.hh);
    }
    // A small graph is not blown up to fill the stage.
    this.bounds = {
      x0: Math.min(b.x0, -EMPTY_VIEW),
      y0: Math.min(b.y0, -EMPTY_VIEW),
      x1: Math.max(b.x1, EMPTY_VIEW),
      y1: Math.max(b.y1, EMPTY_VIEW),
    };
    this.crowd.geometry.setDrawRange(0, count);
    this.crowd.geometry.attributes.position.needsUpdate = true;

    // A link is drawn once both of its accounts have a place.
    let drawn = 0;
    for (let i = 0; i < this.linkCount; i++) {
      const a = this.linkEnds[i * 2];
      const c = this.linkEnds[i * 2 + 1];
      if (a >= count || c >= count) break;
      const o = i * 6;
      this.linkPos[o] = this.crowdPos[a * 3];
      this.linkPos[o + 1] = this.crowdPos[a * 3 + 1];
      this.linkPos[o + 3] = this.crowdPos[c * 3];
      this.linkPos[o + 4] = this.crowdPos[c * 3 + 1];
      const length = Math.hypot(this.linkPos[o + 3] - this.linkPos[o], this.linkPos[o + 4] - this.linkPos[o + 1]);
      this.linkReach[i] = this.linkGone[i] ? 0 : Math.min(1, Math.max(0.1, 70 / (length || 1)));
      this.linkColor[i * 8 + 3] = this.linkColor[i * 8 + 7] = this.linkReach[i];
      drawn = i + 1;
    }
    // Links that are still lit from arriving keep their brightness.
    for (const f of this.fresh) this.paintLink(f.index, f.life);
    this.links.geometry.setDrawRange(0, drawn * 2);
    this.links.geometry.attributes.position.needsUpdate = true;
    this.links.geometry.attributes.color.needsUpdate = true;
  }

  /** Colours link `i`: `life` 1 is a link that has just appeared, 0 one at rest. */
  private paintLink(i: number, life: number) {
    const o = i * 8;
    const alpha = this.linkGone[i] ? 0 : this.linkReach[i] + 1.4 * life;
    for (const v of [o, o + 4]) {
      this.linkColor[v] = 0.85 + 0.15 * life;
      this.linkColor[v + 1] = 0.66 + 0.3 * life;
      this.linkColor[v + 2] = 0.64 + 0.26 * life;
      this.linkColor[v + 3] = alpha;
    }
  }

  private loop = (time: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;

    // Hand the layout whatever arrived since the last frame, in one message.
    if (this.crowdIds.length > this.sentCount || this.pendingLinks.length) {
      this.post({ type: "add", count: this.crowdIds.length, links: this.pendingLinks, settle: this.pendingSettle });
      this.sentCount = this.crowdIds.length;
      this.pendingLinks = [];
      this.pendingSettle = false;
    }

    // While following, the camera eases toward the view that shows everything.
    const fit = this.fitTarget();
    this.fitScale = fit.scale;
    if (this.following) {
      const ease = this.reducedMotion ? 1 : Math.min(1, dt * 4);
      const v = this.view;
      if (Math.abs(fit.scale - v.scale) > 1e-5 || Math.abs(fit.x - v.x) > 0.05 || Math.abs(fit.y - v.y) > 0.05) {
        v.scale += (fit.scale - v.scale) * ease;
        v.x += (fit.x - v.x) * ease;
        v.y += (fit.y - v.y) * ease;
        this.cameraDirty = true;
      }
    }

    if (this.cameraDirty) {
      this.cameraDirty = false;
      this.world.scale.setScalar(this.view.scale);
      this.world.position.set(this.view.x, this.view.y, 0);
      this.onCamera();
    }
    const ratio = this.renderer.getPixelRatio();
    const uniforms = this.crowd.material.uniforms;
    uniforms.uScale.value = this.view.scale * ratio;
    uniforms.uMin.value = POINT_MIN_PX * ratio;
    uniforms.uMax.value = POINT_MAX_PX * ratio;
    uniforms.uDim.value = this.crowdState.dim;

    const heat = this.crowdHeat;
    for (let i = 0; i < this.placed; i++) if (heat[i] > 0) heat[i] = Math.max(0, heat[i] - dt * 1.6);
    this.crowd.geometry.attributes.aHeat.needsUpdate = true;

    if (this.fresh.length) {
      for (const f of this.fresh) {
        f.life = Math.max(0, f.life - dt * 1.3);
        this.paintLink(f.index, f.life);
      }
      this.fresh = this.fresh.filter((f) => f.life > 0);
      this.links.geometry.attributes.color.needsUpdate = true;
    }
    // Links are quieter with everything in view and firmer once zoomed in.
    const zoom = this.view.scale / this.fitScale;
    const near = Math.min(1, Math.max(0, (zoom - 1.2) / 2));
    this.links.material.opacity = this.crowdState.dim * (LINK_FAR + (LINK_NEAR - LINK_FAR) * near);

    for (const ring of this.rings.values()) {
      for (const m of ring.materials) m.opacity = (m.userData.o as number) * ring.state.dim;
    }
    for (const t of this.tweens) if (!t.isActive() && t.progress() === 1) this.tweens.delete(t);

    this.renderer.render(this.scene, this.camera);
  };
}
