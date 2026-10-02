// The overview graph, drawn on one WebGL canvas that can be panned and zoomed.
// Ordinary accounts are points that join the picture the first time they
// transact, with a thin line for every pair that has paid each other. Each ring
// is a formation of concentric gated layers that closes when its alert fires.
// Everything is placed in world units; the camera maps world to stage pixels.

import gsap from "gsap";
import * as THREE from "three";
import { COLORS, ROLES } from "@/lib/constants";
import { buildFormation, GATE, gateStart, nodePoint, type Formation } from "@/lib/formation";
import type { GraphAccount, RingDetail, Role, Txn } from "@/lib/types";

interface Site {
  x: number;
  y: number;
  r: number;
}

// Used when a ring arrives without a `site` of its own.
const FALLBACK_SITES: Site[] = [
  { x: 900, y: 990, r: 230 },
  { x: 1830, y: 560, r: 150 },
  { x: 1780, y: 1360, r: 150 },
];
/** Rotation of each formation, in the order rings are given, so labels fall in open space. */
const TURNS = [2.2, 1.3, 2.6];
/** Half the stroke of a formation layer, in world units. */
const LAYER_HALF = 2.3;
/** Radius of an ordinary account, in world units, and its limits on screen in pixels. */
const POINT_RADIUS = 3.4;
const POINT_MIN_PX = 2.4;
const POINT_MAX_PX = 16;
/** Most pairs of ordinary accounts that can be linked. */
const MAX_LINKS = 24000;
const LINK_REST = 0.16;
const ZOOM_OUT_LIMIT = 0.6; // relative to the zoom that fits everything
const ZOOM_IN_LIMIT = 7;
const TAU = Math.PI * 2;

export interface RingAnchor {
  ringId: string;
  x: number;
  y: number;
  r: number;
  tagBelow: boolean;
  specials: { id: string; label: string; x: number; y: number; above: boolean }[];
}

export interface NodeHit {
  id: string;
  kind: "account" | "victim" | "cash" | "other";
  role?: Role;
  risk?: number;
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

interface ArcVis {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  radius: number;
  start: number;
  spin: number;
  state: { p: number };
}

interface RingVis {
  id: string;
  site: Site;
  tagBelow: boolean;
  formation: Formation;
  group: THREE.Group;
  nodes: Map<string, NodeVis>;
  edges: Map<string, EdgeVis>;
  arcs: ArcVis[];
  disc: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  links: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>[];
  materials: THREE.Material[];
  alerted: boolean;
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
  private tweens = new Set<gsap.core.Tween>();
  private frame = 0;
  private lastTime = 0;
  private focus: string | null = null;

  // Camera: stage pixel = world * scale + (x, y).
  private view = { scale: 1, x: 0, y: 0 };
  private size = { w: 1, h: 1 };
  private bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private fitScale = 1;
  private cameraDirty = true;
  /** When the person last moved the camera themselves; the graph does not steer it away from them. */
  private lastHandled = -Infinity;
  /** True until the person moves the camera, so a resize keeps everything in view. */
  private following = true;

  private crowd: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private crowdIndex = new Map<string, number>();
  private crowdIds: string[] = [];
  private crowdPos = new Float32Array(0);
  private crowdAlpha = new Float32Array(0);
  private crowdHeat = new Float32Array(0);
  private crowdState = { dim: 1 };

  private links: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private linkPos = new Float32Array(MAX_LINKS * 6);
  private linkColor = new Float32Array(MAX_LINKS * 8);
  private linkCount = 0;
  private linkSeen = new Set<number>();
  /** Links still settling from their bright arrival to their resting strength. */
  private fresh: { index: number; life: number }[] = [];

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

    this.frame = requestAnimationFrame(this.loop);
  }

  // ---- setup -------------------------------------------------------------

  setData(accounts: GraphAccount[], rings: RingDetail[]) {
    for (const ring of this.rings.values()) this.world.remove(ring.group);
    this.rings.clear();
    this.nodeRing.clear();
    if (this.crowd) this.world.remove(this.crowd);

    const sites = rings.map((r, i) => r.site ?? FALLBACK_SITES[i % FALLBACK_SITES.length]);
    this.buildCrowd(accounts, sites);
    rings.forEach((detail, index) => this.buildRing(detail, sites[index], index));

    // The world is whatever the accounts and formations cover.
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x: number, y: number, pad: number) => {
      b.x0 = Math.min(b.x0, x - pad);
      b.y0 = Math.min(b.y0, y - pad);
      b.x1 = Math.max(b.x1, x + pad);
      b.y1 = Math.max(b.y1, y + pad);
    };
    for (let i = 0; i < this.crowdIds.length; i++) grow(this.crowdPos[i * 3], this.crowdPos[i * 3 + 1], 0);
    for (const s of sites) grow(s.x, s.y, s.r + 40);
    if (b.x0 === Infinity) grow(0, 0, 400);
    this.bounds = b;
    this.fit(false);
  }

  private buildCrowd(accounts: GraphAccount[], sites: Site[]) {
    const n = accounts.length;
    this.crowdIndex.clear();
    this.crowdIds = accounts.map((a) => a.id);
    this.crowdPos = new Float32Array(n * 3);
    this.crowdAlpha = new Float32Array(n);
    this.crowdHeat = new Float32Array(n);
    accounts.forEach((a, i) => {
      this.crowdIndex.set(a.id, i);
      let x: number;
      let y: number;
      if (a.pos) [x, y] = a.pos;
      else {
        // No position in the data: stand the account on a sunflower spiral,
        // pushed out of any formation it would land in.
        const angle = i * 2.39996;
        const radius = 26 * Math.sqrt(i + 1);
        x = 1300 + Math.cos(angle) * radius;
        y = 950 + Math.sin(angle) * radius;
        for (const s of sites) {
          const d = Math.hypot(x - s.x, y - s.y);
          if (d < s.r + 30) {
            x = s.x + ((x - s.x) / (d || 1)) * (s.r + 30);
            y = s.y + ((y - s.y) / (d || 1)) * (s.r + 30);
          }
        }
      }
      this.crowdPos.set([x, y, 0], i * 3);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.crowdPos, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.crowdAlpha, 1));
    geometry.setAttribute("aHeat", new THREE.BufferAttribute(this.crowdHeat, 1));
    this.crowd = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        uniforms: {
          uSize: { value: 6 },
          uDim: { value: 1 },
          uColor: { value: new THREE.Color(COLORS.crowd) },
          uHot: { value: new THREE.Color(COLORS.crowdHot) },
        },
        vertexShader: `
          attribute float aAlpha;
          attribute float aHeat;
          uniform float uSize;
          varying float vAlpha;
          varying float vHeat;
          void main() {
            vAlpha = aAlpha;
            vHeat = aHeat;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize * (1.0 + aHeat * 1.2);
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          uniform vec3 uHot;
          uniform float uDim;
          varying float vAlpha;
          varying float vHeat;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float disc = smoothstep(0.5, 0.36, d);
            gl_FragColor = vec4(mix(uColor, uHot, vHeat), disc * vAlpha * uDim * (0.7 + 0.3 * vHeat));
          }`,
      }),
    );
    this.crowd.frustumCulled = false;
    this.crowd.renderOrder = 2;
    this.world.add(this.crowd);
  }

  private buildRing(detail: RingDetail, site: Site, index: number) {
    const formation = buildFormation(detail, TURNS[index % TURNS.length]);
    const group = new THREE.Group();
    group.position.set(site.x, site.y, 0);
    const ring: RingVis = {
      id: detail.id,
      site,
      // A formation in the lower half of the world carries its name tag underneath.
      tagBelow: index > 0 && site.y > (FALLBACK_SITES[0].y + 100),
      formation,
      group,
      nodes: new Map(),
      edges: new Map(),
      arcs: [],
      disc: new THREE.Mesh(this.circle, flatMaterial(COLORS.stageDeep, 0)),
      links: [],
      materials: [],
      alerted: false,
      state: { dim: 1 },
    };
    ring.disc.scale.setScalar(site.r + 12);
    ring.disc.renderOrder = 0;
    group.add(ring.disc);
    ring.materials.push(ring.disc.material);

    const big = site.r > 180;
    for (let k = 1; k <= formation.layers; k++) {
      const arc: ArcVis = {
        mesh: new THREE.Mesh(new THREE.BufferGeometry(), flatMaterial(COLORS.turmeric, 0.85)),
        radius: (site.r * k) / formation.layers,
        start: gateStart(k),
        spin: (k % 2 ? 1 : -1) * 0.035,
        state: { p: 0 },
      };
      arc.mesh.renderOrder = 3;
      arc.mesh.visible = false;
      group.add(arc.mesh);
      ring.arcs.push(arc);
      ring.materials.push(arc.mesh.material);
    }

    for (const n of formation.nodes) {
      const p = nodePoint(n, formation.layers, site.r);
      const r = n.type === "account" ? (big ? 8 : 6.500) + n.risk * (big ? 7 : 4.500) : big ? 12 : 10;
      const mesh = new THREE.Mesh(n.type === "account" ? this.circle : this.diamond, flatMaterial(COLORS.stone, 1));
      mesh.position.set(p.x, p.y, 0);
      if (n.type === "cash") mesh.rotation.z = Math.PI / 4;
      mesh.scale.setScalar(0.0001);
      mesh.visible = false;
      mesh.renderOrder = 6;
      group.add(mesh);
      const node: NodeVis = { id: n.id, kind: n.type, role: n.role, risk: n.risk, x: p.x, y: p.y, r, mesh, seen: false };
      ring.nodes.set(n.id, node);
      ring.materials.push(mesh.material);
      if (n.type !== "cash") this.nodeRing.set(n.id, ring);
    }

    const peak = Math.max(...formation.flows.map((f) => f.amount), 1);
    for (const f of formation.flows) {
      const from = ring.nodes.get(f.from);
      const to = ring.nodes.get(f.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const span = Math.max(4, length - from.r - to.r - 6);
      // A shaft and an arrowhead at the receiver, so direction still reads
      // when the replay is paused and no money is moving.
      const material = flatMaterial(COLORS.stone, 0);
      const width = 1.4 + 4.6 * Math.sqrt(f.amount / peak);
      const head = Math.max(big ? 7 : 5, width * 1.5);
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
      ring.edges.set(`${f.from}>${f.to}`, { from, to, material, seen: false });
      ring.materials.push(material);
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
    }

    this.world.add(group);
    this.rings.set(detail.id, ring);
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
    if (this.following) this.fit(false);
    else {
      // Keep the same world point in the middle of the stage.
      this.view.x += (width - before.w) / 2;
      this.view.y += (height - before.h) / 2;
      this.fitScale = this.scaleToFit();
      this.cameraDirty = true;
    }
  }

  // ---- camera ------------------------------------------------------------

  private scaleToFit() {
    const b = this.bounds;
    return Math.min(this.size.w / (b.x1 - b.x0), this.size.h / (b.y1 - b.y0)) * 0.96;
  }

  private moveTo(scale: number, cx: number, cy: number, animate: boolean) {
    const target = { scale, x: this.size.w / 2 - cx * scale, y: this.size.h / 2 - cy * scale };
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

  /** Bring every account and formation into view. */
  fit(animate = true) {
    const b = this.bounds;
    this.fitScale = this.scaleToFit();
    this.following = true;
    this.moveTo(this.fitScale, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, animate);
  }

  /** Frame one formation. */
  flyTo(ringId: string, animate = true) {
    const ring = this.rings.get(ringId);
    if (!ring) return;
    const span = (ring.site.r + 70) * 2;
    const scale = Math.min(this.size.w / span, this.size.h / span, this.fitScale * ZOOM_IN_LIMIT);
    this.following = false;
    this.moveTo(scale, ring.site.x, ring.site.y, animate);
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

  private applyCamera() {
    const v = this.view;
    this.world.scale.setScalar(v.scale);
    this.world.position.set(v.x, v.y, 0);
    if (this.crowd) {
      const px = Math.min(POINT_MAX_PX, Math.max(POINT_MIN_PX, POINT_RADIUS * 2 * v.scale));
      this.crowd.material.uniforms.uSize.value = px * this.renderer.getPixelRatio();
    }
  }

  // ---- data --------------------------------------------------------------

  addTxn(txn: Txn, instant = false) {
    const ring = this.nodeRing.get(txn.from);
    const edge = ring?.edges.get(`${txn.from}>${txn.to}`);
    if (ring && edge) {
      this.reveal(edge.from, instant);
      this.reveal(edge.to, instant);
      if (!edge.seen) {
        edge.seen = true;
        this.fade(edge.material, ring.alerted ? 0.62 : 0.45, instant ? 0 : 0.5);
      }
      if (!instant && !this.reducedMotion) this.sendMoney(ring, edge, txn.amount);
      return;
    }

    // An ordinary transfer: both accounts join the picture, and the first time
    // a pair pays each other a line is drawn between them and stays.
    const a = this.wake(txn.from);
    const b = txn.to === "CASH" ? -1 : this.wake(txn.to);
    if (a < 0 || b < 0 || a === b || this.linkCount >= MAX_LINKS) return;
    const key = a < b ? a * 100000 + b : b * 100000 + a;
    if (this.linkSeen.has(key)) return;
    this.linkSeen.add(key);
    const i = this.linkCount++;
    this.linkPos.set(
      [this.crowdPos[a * 3], this.crowdPos[a * 3 + 1], 0, this.crowdPos[b * 3], this.crowdPos[b * 3 + 1], 0],
      i * 6,
    );
    const settled = instant || this.reducedMotion;
    this.paintLink(i, settled ? 0 : 1);
    if (!settled) this.fresh.push({ index: i, life: 1 });
    this.links.geometry.setDrawRange(0, this.linkCount * 2);
    this.links.geometry.attributes.position.needsUpdate = true;
    this.links.geometry.attributes.color.needsUpdate = true;
  }

  fireAlert(ringId: string, instant = false) {
    const ring = this.rings.get(ringId);
    if (!ring || ring.alerted) return;
    ring.alerted = true;
    const quick = instant || this.reducedMotion;

    // Go to the ring that was just caught, unless the person is steering.
    if (!instant && performance.now() - this.lastHandled > 4000) this.flyTo(ringId);

    this.fade(ring.disc.material, 0.5, quick ? 0 : 0.9);

    // The layers close from the rim inwards.
    const count = ring.arcs.length;
    ring.arcs.forEach((arc, i) => {
      arc.mesh.visible = true;
      if (quick) {
        arc.state.p = 1;
        this.drawArc(arc);
        return;
      }
      this.track(
        gsap.to(arc.state, {
          p: 1,
          duration: 1.1,
          delay: 0.5 + (count - 1 - i) * 0.14,
          ease: "expo.out",
          onUpdate: () => this.drawArc(arc),
        }),
      );
    });

    // Every member is now known, so each takes its place and its role colour.
    let order = 0;
    for (const node of ring.nodes.values()) {
      this.reveal(node, quick);
      if (node.role === "member") node.mesh.geometry = this.hollow;
      const color = new THREE.Color(
        node.kind === "account" && node.role ? ROLES[node.role].color : node.kind === "cash" ? COLORS.turmeric : COLORS.stone,
      );
      if (quick) node.mesh.material.color.copy(color);
      else {
        this.track(
          gsap.to(node.mesh.material.color, { r: color.r, g: color.g, b: color.b, duration: 0.5, delay: 0.7 + order * 0.05 }),
        );
      }
      order++;
    }
    for (const edge of ring.edges.values()) if (edge.seen) this.fade(edge.material, 0.62, quick ? 0 : 0.4);
    for (const link of ring.links) this.fade(link.material, 0.5, quick ? 0 : 0.8, quick ? 0 : 1);
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
    for (const ring of this.rings.values()) {
      ring.alerted = false;
      ring.state.dim = 1;
      ring.disc.material.userData.o = 0;
      for (const arc of ring.arcs) {
        arc.state.p = 0;
        arc.mesh.visible = false;
      }
      for (const node of ring.nodes.values()) {
        node.seen = false;
        node.mesh.visible = false;
        node.mesh.scale.setScalar(0.0001);
        node.mesh.material.color.set(COLORS.stone);
        if (node.kind === "account") node.mesh.geometry = this.circle;
      }
      for (const edge of ring.edges.values()) {
        edge.seen = false;
        edge.material.userData.o = 0;
      }
      for (const link of ring.links) link.material.userData.o = 0;
      // Money still in flight belongs to the run that just ended.
      for (const child of [...ring.group.children]) {
        if (child.userData.money) ring.group.remove(child);
      }
    }
    this.crowdAlpha.fill(0);
    this.crowdHeat.fill(0);
    if (this.crowd) this.crowd.geometry.attributes.aAlpha.needsUpdate = true;
    this.crowdState.dim = 1;
    this.linkCount = 0;
    this.linkSeen.clear();
    this.fresh.length = 0;
    this.links.geometry.setDrawRange(0, 0);
    this.focus = null;
    this.lastHandled = -Infinity;
    this.fit(false);
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
        r: ring.site.r * this.view.scale,
        tagBelow: ring.tagBelow,
        // The victim and the cash point are named once there is room to read
        // the names; the legend and the tooltips name them at any zoom.
        specials:
          ring.site.r * this.view.scale < 150
            ? []
            : [...ring.nodes.values()]
                .filter((n) => n.kind !== "account")
                .map((n) => {
                  // The victim's label goes on the side away from the source it
                  // paid; the cash label goes on the outer side of the rim.
                  const source = ring.formation.nodes.find((f) => f.layer === 1);
                  const above = n.kind === "victim" ? Math.sin(source?.angle ?? 0) > 0 : n.y < 0;
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
        if (!n.seen) continue;
        if (Math.hypot(x - ring.site.x - n.x, y - ring.site.y - n.y) <= n.r + 5) {
          const at = this.toStage(ring.site.x + n.x, ring.site.y + n.y - n.r);
          return {
            id: n.id,
            kind: n.kind,
            role: n.role,
            risk: n.kind === "account" ? n.risk : undefined,
            x: at.x,
            y: at.y,
            alerted: ring.alerted,
          };
        }
      }
    }
    // Ordinary accounts: the nearest one within a few pixels of the pointer.
    const reach = 7 / this.view.scale;
    let best = -1;
    let bestGap = reach;
    for (let i = 0; i < this.crowdIds.length; i++) {
      if (!this.crowdAlpha[i]) continue;
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
    return { id: this.crowdIds[best], kind: "other", x: at.x, y: at.y, alerted: false };
  }

  dispose() {
    cancelAnimationFrame(this.frame);
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
    node.mesh.visible = true;
    if (instant || this.reducedMotion) {
      node.mesh.scale.setScalar(node.r);
      return;
    }
    this.track(gsap.to(node.mesh.scale, { x: node.r, y: node.r, duration: 0.6, ease: "back.out(2.2)" }));
  }

  private sendMoney(ring: RingVis, edge: EdgeVis, amount: number) {
    const size = 3 + Math.min(4, Math.sqrt(amount / 60000));
    const dot = new THREE.Mesh(this.circle, this.moneyMaterial);
    dot.userData.money = true;
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

  private drawArc(arc: ArcVis) {
    arc.mesh.geometry.dispose();
    const sweep = Math.max(0.001, arc.state.p * (TAU - GATE));
    arc.mesh.geometry = new THREE.RingGeometry(arc.radius - LAYER_HALF, arc.radius + LAYER_HALF, 120, 1, arc.start, sweep);
  }

  /** Shows an ordinary account and brightens it; returns its index, or -1 if it is not an ordinary account. */
  private wake(account: string) {
    const ring = this.nodeRing.get(account);
    if (ring) {
      this.reveal(ring.nodes.get(account)!, false);
      return -1;
    }
    const i = this.crowdIndex.get(account);
    if (i === undefined || !this.crowd) return -1;
    if (!this.crowdAlpha[i]) {
      this.crowdAlpha[i] = 1;
      this.crowd.geometry.attributes.aAlpha.needsUpdate = true;
    }
    this.crowdHeat[i] = 1;
    return i;
  }

  /** Colours link `i`: `life` 1 is a link that has just appeared, 0 one at rest. */
  private paintLink(i: number, life: number) {
    const o = i * 8;
    const alpha = LINK_REST + (0.9 - LINK_REST) * life;
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

    if (this.cameraDirty) {
      this.cameraDirty = false;
      this.applyCamera();
      this.onCamera();
    }

    if (this.crowd) {
      const heat = this.crowdHeat;
      for (let i = 0; i < heat.length; i++) if (heat[i] > 0) heat[i] = Math.max(0, heat[i] - dt * 1.6);
      this.crowd.geometry.attributes.aHeat.needsUpdate = true;
      this.crowd.material.uniforms.uDim.value = this.crowdState.dim;
    }

    if (this.fresh.length) {
      for (const f of this.fresh) {
        f.life = Math.max(0, f.life - dt * 1.3);
        this.paintLink(f.index, f.life);
      }
      this.fresh = this.fresh.filter((f) => f.life > 0);
      this.links.geometry.attributes.color.needsUpdate = true;
    }
    this.links.material.opacity = this.crowdState.dim;

    for (const ring of this.rings.values()) {
      for (const m of ring.materials) m.opacity = (m.userData.o as number) * ring.state.dim;
      if (ring.alerted && !this.reducedMotion) {
        for (const arc of ring.arcs) arc.mesh.rotation.z += arc.spin * dt;
      }
    }
    for (const t of this.tweens) if (!t.isActive() && t.progress() === 1) this.tweens.delete(t);

    this.renderer.render(this.scene, this.camera);
  };
}
