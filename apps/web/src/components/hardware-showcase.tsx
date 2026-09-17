"use client";

/** Usage: import { HardwareShowcase } from "@/components/hardware-showcase";
 * Render <HardwareShowcase />. CAD assets are local, centered, and in meters.
 * See public/models/sources.json for the original STEP sources.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox, useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type Key = "screen" | "camera" | "pi" | "hat" | "speakers" | "microphone";
type Vector = [number, number, number];
// The requested 100 mm speakers need 106 mm clearance. A literal 6.5-inch
// display cannot have an 85 mm footprint; this layout follows the specified
// Pi-sized screen footprint. This is an assembly illustration, not fitment CAD.
const DEVICE = { width: .115, height: .106, depth: .045 };
const PARTS: { key: Key; title: string; spec: string; assembled: Vector; exploded: Vector; rotation: Vector }[] = [
  { key: "screen", title: '6.5″ LCD screen', spec: "Glossy display · front panel", assembled: [0, 0, .024], exploded: [-.012, -.007, .095], rotation: [0, -.12, 0] },
  { key: "camera", title: "Camera Module 3", spec: "12 MP · autofocus", assembled: [-.026, .048, 0], exploded: [-.045, .091, .012], rotation: [.3, 0, 0] },
  { key: "pi", title: "Raspberry Pi 5", spec: "Cortex-A76 · quad-core · 2.4 GHz", assembled: [0, 0, .003], exploded: [.013, .005, -.063], rotation: [0, .16, 0] },
  { key: "hat", title: "SSD / M.2 HAT+", spec: "Waveshare · PCIe to NVMe", assembled: [0, 0, -.015], exploded: [.035, .024, -.16], rotation: [0, -.12, 0] },
  { key: "speakers", title: "Twin speakers", spec: "5 Ω · 100 × 25 × 10 mm", assembled: [0, 0, 0], exploded: [0, 0, 0], rotation: [0, 0, 0] },
  { key: "microphone", title: "USB microphone", spec: "Waveshare · 60 × 10 × 8 mm", assembled: [.017, .039, .012], exploded: [.058, .097, .044], rotation: [0, .18, -.12] },
];
const clamp = THREE.MathUtils.clamp;
const SCROLL_VIEWPORTS = 1.6;
const STAGE_DRIFT_VIEWPORTS = .22;
const EXTRA_TRAVEL_VIEWPORTS = SCROLL_VIEWPORTS - STAGE_DRIFT_VIEWPORTS;
const phase = (progress: number, index: number) => clamp((progress - index * .135) / .25, 0, 1);
type Groups = Record<Key, RefObject<THREE.Group | null>>;
type Labels = Record<Key, RefObject<HTMLDivElement | null>>;
type Lines = Record<Key, RefObject<SVGLineElement | null>>;

function Model({ url, rotation = [0, 0, 0] }: { url: string; rotation?: Vector }) {
  const { scene } = useGLTF(url);
  const model = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    return copy;
  }, [scene]);
  return <primitive object={model} rotation={rotation} />;
}

// R3F owns these mutable Three.js objects and DOM refs. Mutations occur only
// in effects and useFrame, outside React rendering. The compiler cannot infer
// that the typed ref dictionaries contain refs rather than React state.
/* eslint-disable react-hooks/immutability, react-hooks/refs */
function Scene({ target, groups, labels, lines, mobile, reducedMotion, dark }: {
  target: RefObject<number>; groups: Groups; labels: Labels; lines: Lines;
  mobile: boolean; reducedMotion: boolean; dark: boolean;
}) {
  const { camera, size } = useThree();
  const progress = useRef(0);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Group>(null);
  const point = useMemo(() => new THREE.Vector3(), []);
  const destination = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    // Fix the inspection angle: global auto-rotation used to hide the display
    // and move projected labels outside the canvas as the page sat idle.
    camera.position.set(.24, .17, .32);
    camera.lookAt(0, .008, -.01);
    if (camera instanceof THREE.PerspectiveCamera) {
      const aspect = size.width / size.height;
      const baseFov = THREE.MathUtils.degToRad(mobile ? 43 : 36);
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(baseFov / 2) * Math.max(1, (mobile ? .7 : 1.7) / aspect)));
      camera.near = .001;
      camera.far = 5;
      camera.updateProjectionMatrix();
    }
  }, [camera, mobile, size.width, size.height]);
  useFrame((state, delta) => {
    progress.current = THREE.MathUtils.lerp(progress.current, target.current, reducedMotion ? 1 : 1 - Math.exp(-8 * Math.min(delta, .1)));
    const p = progress.current;
    for (const [index, part] of PARTS.entries()) {
      const group = groups[part.key].current;
      if (!group) continue;
      const separation = phase(p, index);
      const distance = mobile ? .72 : 1;
      group.position.fromArray(part.assembled).lerp(destination.fromArray(part.exploded), separation * distance);
      const active = Math.sin(Math.PI * clamp((p - index * .135) / .135, 0, 1));
      const sway = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * .65) * .06 * active;
      group.rotation.set(part.rotation[0] * active, part.rotation[1] * active + sway, part.rotation[2] * active);
      group.scale.setScalar(1 + (reducedMotion ? 0 : active * .055));
      group.updateWorldMatrix(true, true);
      const label = labels[part.key].current;
      const line = lines[part.key].current;
      const fade = clamp((separation - .22) / .4, 0, 1);
      if (label) {
        label.style.opacity = String(fade);
        label.style.visibility = fade > .01 ? "visible" : "hidden";
        label.dataset.active = String(active > .1);
      }
      if (line && label && !mobile) {
        point.set(part.key === "speakers" ? -.083 : 0, 0, 0);
        group.localToWorld(point).project(camera);
        const isLeft = index % 2 === 0;
        line.setAttribute("x1", String((point.x * .5 + .5) * size.width));
        line.setAttribute("y1", String((-point.y * .5 + .5) * size.height));
        line.setAttribute("x2", String(isLeft ? label.offsetLeft + label.offsetWidth : label.offsetLeft));
        line.setAttribute("y2", String(label.offsetTop + label.offsetHeight / 2));
        line.style.opacity = String(fade * .65);
      }
    }
    const spread = phase(p, 4) * (mobile ? .026 : .043);
    left.current?.position.set(-.05 - spread, 0, 0);
    right.current?.position.set(.05 + spread, 0, 0);
    if (shell.current) {
      shell.current.position.z = -.025 * p;
      shell.current.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
          object.material.opacity = 1 - p * .88;
          object.material.depthWrite = p < .15;
        }
      });
    }
  });
  return <>
    <ambientLight intensity={dark ? .6 : .8} />
    <directionalLight position={[.2, .3, .4]} intensity={2.4} />
    <directionalLight position={[-.3, .1, .1]} intensity={1.3} />
    <directionalLight position={[.1, .2, -.3]} intensity={2} />
    {/* Local studio reflections: no remote HDR download or inverse-square
        point light at millimeter distances, which washed out the old scene. */}
    <Environment resolution={128}>
      <Lightformer position={[0, 2, 1]} scale={[3, 2, 1]} intensity={2} />
      <Lightformer position={[-2, 0, 1]} rotation={[0, Math.PI / 2, 0]} scale={[2, 3, 1]} intensity={1.5} />
    </Environment>
    <ContactShadows position={[0, -.058, 0]} opacity={dark ? .3 : .18} scale={.65} blur={2.5} far={.3} resolution={256} />
    <group ref={shell}>
      {/* Hollow enclosure; split roof leaves a real opening for the camera. */}
      {([
        [[0, 0, -.022], [DEVICE.width, DEVICE.height, .002]],
        [[-.0565, 0, 0], [.002, DEVICE.height, DEVICE.depth]],
        [[.0565, 0, 0], [.002, DEVICE.height, DEVICE.depth]],
        [[0, -.052, 0], [DEVICE.width, .002, DEVICE.depth]],
        [[-.048, .052, 0], [.019, .002, DEVICE.depth]],
        [[.022, .052, 0], [.071, .002, DEVICE.depth]],
      ] as [Vector, Vector][]).map(([position, dimensions], i) => <RoundedBox key={i} position={position} args={dimensions} radius={.0008} smoothness={3}>
        <meshStandardMaterial color={dark ? "#45494b" : "#b8babc"} roughness={.76} metalness={.08} transparent />
      </RoundedBox>)}
    </group>
    <group ref={groups.screen}>
      <RoundedBox args={[.089, .060, .004]} radius={.002} smoothness={4}>
        <meshStandardMaterial color="#202326" roughness={.45} />
      </RoundedBox>
      <RoundedBox position={[0, 0, .0022]} args={[.080, .051, .0008]} radius={.0015} smoothness={4}>
        <meshPhysicalMaterial color="#080b0e" roughness={.16} metalness={.12} clearcoat={1} />
      </RoundedBox>
    </group>
    <group ref={groups.camera}><Model url="/models/camera-module-3.glb" rotation={[Math.PI / 2, 0, 0]} /></group>
    <group ref={groups.pi}><Model url="/models/raspberry-pi-5.glb" /></group>
    <group ref={groups.hat}><Model url="/models/waveshare-m2-hat.glb" /></group>
    <group ref={groups.speakers}>
      {[left, right].map((ref, i) => <group ref={ref} key={i} rotation={[0, i ? -Math.PI / 2 : Math.PI / 2, 0]}>
        <RoundedBox args={[.025, .1, .01]} radius={.002} smoothness={3}>
          <meshStandardMaterial color="#242729" roughness={.85} />
        </RoundedBox>
        {[-.026, .026].map((y) => <mesh key={y} position={[0, y, .0052]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[.009, .009, .001, 32]} /><meshStandardMaterial color="#111315" roughness={.92} />
        </mesh>)}
        {Array.from({length: 21}, (_, j) => <mesh key={j} position={[(j % 3 - 1) * .004, (Math.floor(j / 3) - 3) * .004, .0056]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[.0007, .0007, .0004, 8]} /><meshStandardMaterial color="#090a0b" roughness={1} />
        </mesh>)}
      </group>)}
    </group>
    <group ref={groups.microphone}>
      <RoundedBox args={[.06, .01, .008]} radius={.0015} smoothness={3}><meshStandardMaterial color="#303336" roughness={.65} /></RoundedBox>
      <mesh position={[-.033, 0, 0]}><boxGeometry args={[.006, .008, .003]} /><meshStandardMaterial color="#aeb3b7" roughness={.3} metalness={.85} /></mesh>
      {[-.003, 0, .003].map(y => <mesh key={y} position={[.022, y, .0041]}><boxGeometry args={[.01, .0007, .0003]} /><meshStandardMaterial color="#08090a" /></mesh>)}
    </group>
  </>;
}

/* eslint-enable react-hooks/immutability, react-hooks/refs */

export function HardwareShowcase() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const [mobile, setMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dark, setDark] = useState(true);
  const groups = useMemo(() => Object.fromEntries(PARTS.map(p => [p.key, {current: null}])) as Groups, []);
  const labels = useMemo(() => Object.fromEntries(PARTS.map(p => [p.key, {current: null}])) as Labels, []);
  const lines = useMemo(() => Object.fromEntries(PARTS.map(p => [p.key, {current: null}])) as Lines, []);
  useEffect(() => {
    const narrow = matchMedia("(max-width: 767px)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const preferences = () => { setMobile(narrow.matches); setReducedMotion(reduced.matches); };
    const theme = () => setDark(document.documentElement.classList.contains("dark"));
    // Spread the sequence across 1.6 viewport heights. The stage continues
    // moving up slowly instead of being pinned or leaving before completion.
    const scroll = () => {
      if (!section.current) return;
      const rect = section.current.getBoundingClientRect();
      target.current = clamp(-rect.top / Math.max(window.innerHeight * SCROLL_VIEWPORTS, 1), 0, 1);
      if (stage.current) {
        stage.current.style.transform = `translate3d(0, ${target.current * window.innerHeight * EXTRA_TRAVEL_VIEWPORTS}px, 0)`;
      }
      section.current.dataset.progress = target.current.toFixed(3);
    };
    preferences(); theme(); scroll();
    narrow.addEventListener("change", preferences); reduced.addEventListener("change", preferences);
    window.addEventListener("scroll", scroll, {passive: true}); window.addEventListener("resize", scroll);
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "style"]});
    return () => { narrow.removeEventListener("change", preferences); reduced.removeEventListener("change", preferences); window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll); observer.disconnect(); };
  }, []);
  return <section ref={section} aria-labelledby="hardware-title" className="hardware-showcase relative bg-background px-5 pt-12 sm:px-10 sm:pt-16" style={{ minHeight: `${(1.25 + EXTRA_TRAVEL_VIEWPORTS) * 100}svh`, paddingBottom: `calc(4rem + ${EXTRA_TRAVEL_VIEWPORTS * 100}svh)` }}>
    <header className="mx-auto max-w-6xl">
      <p className="text-xs font-medium tracking-[.18em] text-muted-foreground uppercase">Attune / Hardware</p>
      <h1 id="hardware-title" className="mt-4 text-4xl font-medium tracking-tight sm:text-6xl">Inside the screening kit.</h1>
      <p className="mt-4 text-sm text-muted-foreground">Six components. One connected device. Scroll to explore.</p>
    </header>
    <div ref={stage} className="hardware-stage relative mx-auto mt-6 h-[65svh] min-h-[380px] max-w-7xl md:h-[65svh] md:min-h-[360px]">
      <Canvas dpr={[1, 1.5]} camera={{position: [.24, .17, .32], fov: 36, near: .001, far: 5}} gl={{antialias: true, alpha: true}} fallback={<p className="p-6 text-sm text-muted-foreground">3D rendering needs a browser with WebGL enabled.</p>}>
        {/* Transparent canvas reads the CSS background directly, including live theme changes. */}
        <Suspense fallback={<Html center><Badge variant="secondary">Loading hardware…</Badge></Html>}>
          <Scene target={target} groups={groups} labels={labels} lines={lines} mobile={mobile} reducedMotion={reducedMotion} dark={dark} />
        </Suspense>
      </Canvas>
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full text-muted-foreground md:block" aria-hidden="true">
        {PARTS.map(p => <line key={p.key} ref={lines[p.key]} stroke="currentColor" strokeWidth="1" opacity="0" />)}
      </svg>
      <div className="hardware-labels pointer-events-none absolute inset-0">
        {PARTS.map((p, index) => <div key={p.key} ref={labels[p.key]} className="hardware-label absolute w-[205px] opacity-0" style={{left: index % 2 === 0 ? 0 : undefined, right: index % 2 ? 0 : undefined, top: `${18 + Math.floor(index / 2) * 27}%`}}>
          <Card className="gap-2 rounded-lg border-border/70 bg-background/95 p-3 shadow-none">
            <div className="flex items-center gap-2"><Badge variant="outline" className="px-1.5 text-[10px] tabular-nums">0{index + 1}</Badge><p className="text-sm font-medium">{p.title}</p></div>
            <p className="text-xs leading-5 text-muted-foreground">{p.spec}</p>
          </Card>
        </div>)}
      </div>
    </div>
    <style>{`
      .hardware-label[data-active="true"] [data-slot="card"]{border-color:var(--foreground)}
      @media(max-width:767px){
        .hardware-stage{margin-bottom:340px}
        .hardware-labels{top:100%;bottom:auto;display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:16px}
        .hardware-labels .hardware-label{position:relative;inset:auto!important;width:auto}
      }
      @media(max-width:370px){.hardware-labels{grid-template-columns:1fr}.hardware-stage{margin-bottom:620px}}
    `}</style>
  </section>;
}
