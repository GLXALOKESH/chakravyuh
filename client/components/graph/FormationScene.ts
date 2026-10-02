// The overview graph. Ordinary accounts are a quiet crowd of points; each ring
// is a formation of concentric gated layers that closes when its alert fires.
// Drawn in a fixed 820 x 680 design space that is scaled to fit the stage.

import gsap from "gsap";
import * as THREE from "three";
import { COLORS, ROLES } from "@/lib/constants";
import { buildFormation, GATE, gateStart, nodePoint, type Formation } from "@/lib/formation";
import type { RingDetail, Role, Txn } from "@/lib/types";

const DESIGN_W = 820;
const DESIGN_H = 680;
// Where formations stand. The first ring to fire gets the large site.
// `turn` rotates a formation so its labels fall in open space; `tagBelow`
// puts the ring's name tag under it instead of on top.
const SITES = [
  { x: 262, y: 356, r: 218, turn: 2.2, tagBelow: false },
  { x: 664, y: 198, r: 124, turn: 1.3, tagBelow: false },
  { x: 652, y: 484, r: 124, turn: 2.6, tagBelow: true },
];
/** Half the stroke of a formation layer, in design units. */
const LAYER_HALF = 1.6;
const CROWD_SLOTS = 900;
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
  kind: "account" | "victim" | "cash";
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
  site: (typeof SITES)[number];
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

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private focus: string | null = null;

  private crowd: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private crowdSlot = new Map<string, number>();
  private crowdAlpha = new Float32Array(CROWD_SLOTS);
  private crowdHeat = new Float32Array(CROWD_SLOTS);
  private crowdPos = new Float32Array(CROWD_SLOTS * 3);
  private crowdState = { dim: 1 };

  private circle = new THREE.CircleGeometry(1, 40);
  private diamond = new THREE.CircleGeometry(1, 4);
  private triangle = new THREE.CircleGeometry(1, 3);
  private hollow = new THREE.RingGeometry(0.58, 1, 40);
  private plane = new THREE.PlaneGeometry(1, 1);
  private moneyMaterial = flatMaterial(COLORS.turmeric, 1);

  constructor(
    canvas: HTMLCanvasElement,
    private reducedMotion: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.world);

    // Crowd: one point per ordinary account, shown the first time it transacts.
    const rand = seeded(7);
    for (let i = 0; i < CROWD_SLOTS; i++) {
      let x = 0;
      let y = 0;
      do {
        x = -260 + rand() * (DESIGN_W + 520);
        y = -120 + rand() * (DESIGN_H + 240);
      } while (SITES.some((s) => Math.hypot(x - s.x, y - s.y) < s.r + 26));
      this.crowdPos.set([x, y, 0], i * 3);
    }
    const crowdGeometry = new THREE.BufferGeometry();
    crowdGeometry.setAttribute("position", new THREE.BufferAttribute(this.crowdPos, 3));
    crowdGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.crowdAlpha, 1));
    crowdGeometry.setAttribute("aHeat", new THREE.BufferAttribute(this.crowdHeat, 1));
    this.crowd = new THREE.Points(
      crowdGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        uniforms: {
          uSize: { value: 7 },
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
            gl_PointSize = uSize * (1.0 + aHeat * 1.4);
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
            gl_FragColor = vec4(mix(uColor, uHot, vHeat), disc * vAlpha * uDim * (0.62 + 0.38 * vHeat));
          }`,
      }),
    );
    this.crowd.frustumCulled = false;
    this.crowd.renderOrder = 1;
    this.world.add(this.crowd);

    this.frame = requestAnimationFrame(this.loop);
  }

  // ---- setup -------------------------------------------------------------

  setRings(rings: RingDetail[]) {
    for (const ring of this.rings.values()) this.world.remove(ring.group);
    this.rings.clear();
    this.nodeRing.clear();

    rings.slice(0, SITES.length).forEach((detail, index) => {
      const site = SITES[index];
      const formation = buildFormation(detail, site.turn);
      const group = new THREE.Group();
      group.position.set(site.x, site.y, 0);
      const ring: RingVis = {
        id: detail.id,
        site,
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

      const big = site.r > 160;
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
        const r = n.type === "account" ? (big ? 8 : 6) + n.risk * (big ? 7 : 4) : big ? 12 : 9;
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
    });
  }

  resize(width: number, height: number) {
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.right = width;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
    this.scale = Math.min(width / DESIGN_W, height / DESIGN_H);
    this.offset = { x: (width - DESIGN_W * this.scale) / 2, y: (height - DESIGN_H * this.scale) / 2 };
    this.world.scale.setScalar(this.scale);
    this.world.position.set(this.offset.x, this.offset.y, 0);
    this.crowd.material.uniforms.uSize.value = 7 * this.scale * this.renderer.getPixelRatio();
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

    // An ordinary transfer: both accounts join the crowd and brighten briefly.
    this.crowdPoint(txn.from);
    if (txn.to !== "CASH") this.crowdPoint(txn.to);
  }

  fireAlert(ringId: string, instant = false) {
    const ring = this.rings.get(ringId);
    if (!ring || ring.alerted) return;
    ring.alerted = true;
    const quick = instant || this.reducedMotion;

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
          delay: (count - 1 - i) * 0.14,
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
          gsap.to(node.mesh.material.color, { r: color.r, g: color.g, b: color.b, duration: 0.5, delay: 0.25 + order * 0.05 }),
        );
      }
      order++;
    }
    for (const edge of ring.edges.values()) if (edge.seen) this.fade(edge.material, 0.62, quick ? 0 : 0.4);
    for (const link of ring.links) this.fade(link.material, 0.5, quick ? 0 : 0.8, quick ? 0 : 0.6);
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
    this.crowdSlot.clear();
    this.crowdAlpha.fill(0);
    this.crowdHeat.fill(0);
    this.crowdState.dim = 1;
    this.focus = null;
  }

  // ---- read-outs for the HTML overlay -----------------------------------

  anchors(): RingAnchor[] {
    return [...this.rings.values()].map((ring) => ({
      ringId: ring.id,
      x: this.offset.x + ring.site.x * this.scale,
      y: this.offset.y + ring.site.y * this.scale,
      r: ring.site.r * this.scale,
      tagBelow: ring.site.tagBelow,
      // Only the large formation has room to name its victim and cash point;
      // the legend and the tooltips name them everywhere else.
      specials:
        ring.site.r < 160
          ? []
          : [...ring.nodes.values()]
              .filter((n) => n.kind !== "account")
              .map((n) => {
                // The victim's label goes on the side away from the source it
                // paid; the cash label goes on the outer side of the rim.
                const source = ring.formation.nodes.find((f) => f.layer === 1);
                const above = n.kind === "victim" ? Math.sin(source?.angle ?? 0) > 0 : n.y < 0;
                return {
                  id: n.id,
                  label: n.kind === "victim" ? "Victim" : "Cash withdrawn",
                  above,
                  x: this.offset.x + (ring.site.x + n.x) * this.scale,
                  y: this.offset.y + (ring.site.y + n.y + (above ? -1 : 1) * (n.r + 4)) * this.scale,
                };
              }),
    }));
  }

  /** The ring account under a pointer position, in stage pixels. */
  pick(px: number, py: number): (NodeHit & { ringId: string; alerted: boolean }) | null {
    const x = (px - this.offset.x) / this.scale;
    const y = (py - this.offset.y) / this.scale;
    for (const ring of this.rings.values()) {
      for (const n of ring.nodes.values()) {
        if (!n.seen) continue;
        if (Math.hypot(x - ring.site.x - n.x, y - ring.site.y - n.y) <= n.r + 5) {
          return {
            id: n.id,
            kind: n.kind,
            role: n.role,
            risk: n.kind === "account" ? n.risk : undefined,
            x: this.offset.x + (ring.site.x + n.x) * this.scale,
            y: this.offset.y + (ring.site.y + n.y - n.r) * this.scale,
            ringId: ring.id,
            alerted: ring.alerted,
          };
        }
      }
    }
    return null;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.tweens.forEach((t) => t.kill());
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

  private crowdPoint(account: string) {
    if (this.nodeRing.has(account)) {
      const ring = this.nodeRing.get(account)!;
      const n = ring.nodes.get(account)!;
      this.reveal(n, false);
      return { x: ring.site.x + n.x, y: ring.site.y + n.y };
    }
    let slot = this.crowdSlot.get(account);
    if (slot === undefined) {
      if (this.crowdSlot.size >= CROWD_SLOTS) return null;
      slot = this.crowdSlot.size;
      this.crowdSlot.set(account, slot);
      this.crowdAlpha[slot] = 1;
      this.crowd.geometry.attributes.aAlpha.needsUpdate = true;
    }
    this.crowdHeat[slot] = 1;
    return { x: this.crowdPos[slot * 3], y: this.crowdPos[slot * 3 + 1] };
  }

  private loop = (time: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;

    for (let i = 0; i < CROWD_SLOTS; i++) {
      if (this.crowdHeat[i] > 0) this.crowdHeat[i] = Math.max(0, this.crowdHeat[i] - dt * 1.6);
    }
    this.crowd.geometry.attributes.aHeat.needsUpdate = true;
    this.crowd.material.uniforms.uDim.value = this.crowdState.dim;

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
