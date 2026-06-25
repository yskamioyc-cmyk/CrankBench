import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import * as THREE from "three";
import "./App.css";

// Rustから返ってくるデータの型定義
interface SimulationPoint {
  crank_angle_deg: number;
  volume_cc: number;
  piston_y_mm: number;
  pressure_mpa: number;    
  temperature_k: number;   
}

function Engine3D({ simData, stroke, bore, conrod, onFrameUpdate }: { 
  simData: SimulationPoint[]; 
  stroke: number; 
  bore: number; 
  conrod: number;
  onFrameUpdate: (index: number) => void; 
}) {
  const pistonRef = useRef<THREE.Mesh>(null);
  const conrodRef = useRef<THREE.Mesh>(null);
  const crankRef = useRef<THREE.Group>(null);
  const angleRef = useRef(0);
  const lastUpdatedIdxRef = useRef<number>(-1);

  const SCALE = 0.05; 
  const crankRadius = (stroke * SCALE) / 2;
  const pistonRadius = (bore * SCALE) / 2;
  const conrodLength3D = conrod * SCALE;

  useFrame((state, delta) => {
    if (simData.length === 0) return;

    // 【①対策】回転数を 20 RPM（ゆっくり・確実な動作）に設定
    const rpm = 20; 
    const degPerSecond = (rpm * 360) / 60;
    
    // angleRef.current は毎フレーム、小数点以下まで「完全に連続した滑らかな数値」として増えます
    angleRef.current = (angleRef.current + degPerSecond * delta) % 720;
    
    const exactAngle = angleRef.current;
    const currentIndex = Math.floor(exactAngle);

    // 【①対策】重いReact側の再レンダリング通知は、整数（度）が変わった瞬間だけ「間引き」して負荷を激減
    if (currentIndex !== lastUpdatedIdxRef.current) {
      onFrameUpdate(currentIndex);
      lastUpdatedIdxRef.current = currentIndex;
    }

    // 【①対策】元の正常に動いていた数式に、小数点を含んだ「exactAngle」を直接投入
    // 数式そのものは一切弄っていないため、パーツ間の接合位置がズレることは絶対にありません
    const thetaRad = THREE.MathUtils.degToRad(exactAngle);

    const pinX = crankRadius * Math.sin(thetaRad);
    const pinY = crankRadius * Math.cos(thetaRad);

    const conrodAngle = Math.asin((crankRadius * Math.sin(thetaRad)) / conrodLength3D);
    const pistonY = pinY + conrodLength3D * Math.cos(conrodAngle);

    if (pistonRef.current) {
      pistonRef.current.position.x = 0;
      pistonRef.current.position.y = pistonY;
    }

    if (crankRef.current) {
      crankRef.current.rotation.z = -thetaRad; 
    }

    if (conrodRef.current) {
      conrodRef.current.position.x = 0;
      conrodRef.current.position.y = pistonY;

      const dx = pinX - 0;
      const dy = pinY - pistonY;
      conrodRef.current.rotation.z = Math.atan2(dx, -dy);
    }
  });

  return (
    // 【②対策】パーツ全体が綺麗に収まるよう、エンジンの初期配置位置を少し下に下げました
    <group position={[0, -2.2, 0]}>
      {/* ① シリンダ壁 */}
      <mesh position={[0, crankRadius + conrodLength3D - 0.5, 0]}>
        <cylinderGeometry args={[pistonRadius + 0.05, pistonRadius + 0.05, 5, 16, 1, true]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.15} />
      </mesh>

      {/* ② ピストン */}
      <mesh ref={pistonRef}>
        <cylinderGeometry args={[pistonRadius, pistonRadius, 1.0, 32]} />
        <meshLambertMaterial color="#ffffff" emissive="#222222" />
      </mesh>

      {/* ③ コネクティングロッド */}
      <group ref={conrodRef}>
        <mesh position={[0, -conrodLength3D / 2, 0]}>
          <boxGeometry args={[0.15, conrodLength3D, 0.1]} />
          <meshLambertMaterial color="#aaaaaa" emissive="#111111" />
        </mesh>
      </group>

      {/* ④ クランクシャフト */}
      <group ref={crankRef}>
        <mesh position={[0, crankRadius / 2, 0]}>
          <boxGeometry args={[0.4, crankRadius, 0.2]} />
          <meshLambertMaterial color="#666666" />
        </mesh>
        <mesh position={[0, crankRadius, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.4, 16]} />
          <meshLambertMaterial color="#cccccc" />
        </mesh>
      </group>
    </group>
  );
}

export default function App() {
  const [bore, setBore] = useState(64.0);
  const [stroke, setStroke] = useState(68.2);
  const [conrod, setConrod] = useState(120.0);
  const [compression, setCompression] = useState(9.1);
  const [cylinders, setCylinders] = useState(3); 

  const [simData, setSimData] = useState<SimulationPoint[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0); 

  useEffect(() => {
    const fetchKinematics = async () => {
      try {
        const result: SimulationPoint[] = await invoke("calculate_kinematics", {
          config: {
            bore_mm: bore,
            stroke_mm: stroke,
            conrod_length_mm: conrod,
            compression_ratio: compression,
          },
        });
        setSimData(result);
      } catch (error) {
        console.error("Simulation failed:", error);
      }
    };

    fetchKinematics();
  }, [bore, stroke, conrod, compression]);

  const currentPoint = simData[currentIdx] || { volume_cc: 0, pressure_mpa: 0, temperature_k: 0, crank_angle_deg: 0 };

  return (
    <div className="container" style={{ display: "flex", width: "100vw", height: "100vh", background: "#111", color: "#fff", fontFamily: "sans-serif", overflow: "hidden" }}>
      
      {/* 左側：コントロールパネル */}
      <div className="control-panel" style={{ width: "320px", padding: "25px", borderRight: "1px solid #222", background: "#151515", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto", zIndex: 10 }}>
        <div>
          <h2 style={{ margin: 0, color: "#4fa9ff", letterSpacing: "1px" }}>CrankBench</h2>
          <p style={{ margin: "5px 0 0 0", fontSize: "12px", color: "#666" }}>Thermodynamic Engine Simulator</p>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #222", width: "100%" }} />

        <div>
          <label style={{ fontSize: "14px", color: "#aaa" }}>気筒配置 (Layout)</label>
          <select 
            value={cylinders} 
            onChange={(e) => setCylinders(parseInt(e.target.value))}
            style={{ width: "100%", padding: "8px", marginTop: "5px", background: "#222", color: "#fff", border: "1px solid #333", borderRadius: "4px" }}
          >
            <option value={1}>単気筒 (Single Cylinder)</option>
            <option value={3}>直列3気筒 (Inline-3 / HA36S Base)</option>
            <option value={4}>直列4気筒 (Inline-4)</option>
            <option value={6}>V型6気筒 (V6 Configuration)</option>
          </select>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>ボア径 (Bore)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{bore.toFixed(1)} mm</span>
          </div>
          <input type="range" min="50" max="100" step="0.1" value={bore} onChange={(e) => setBore(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>ストローク (Stroke)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{stroke.toFixed(1)} mm</span>
          </div>
          <input type="range" min="50" max="100" step="0.1" value={stroke} onChange={(e) => setStroke(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>コンロッド長 (Conrod)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{conrod.toFixed(1)} mm</span>
          </div>
          <input type="range" min="100" max="160" step="0.1" value={conrod} onChange={(e) => setConrod(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>圧縮比 (Compression)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{compression.toFixed(1)} : 1</span>
          </div>
          <input type="range" min="7.0" max="13.0" step="0.1" value={compression} onChange={(e) => setCompression(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        <div style={{ padding: "15px", background: "#1c1c1c", borderRadius: "6px", border: "1px solid #222" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#888", letterSpacing: "0.5px" }}>REALTIME THERMODYNAMICS</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#888" }}>クランク角:</span>
              <span style={{ fontFamily: "monospace" }}>{currentPoint.crank_angle_deg.toFixed(0)}°</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#aa88ff" }}>筒内圧力 P:</span>
              <span style={{ fontFamily: "monospace", color: "#aa88ff", fontWeight: "bold" }}>{currentPoint.pressure_mpa ? currentPoint.pressure_mpa.toFixed(3) : "0.100"} MPa</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#ff8866" }}>筒内温度 T:</span>
              <span style={{ fontFamily: "monospace", color: "#ff8866" }}>{currentPoint.temperature_k ? (currentPoint.temperature_k - 273.15).toFixed(1) : "20.0"} ℃</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "15px", background: "#1c1c1c", borderRadius: "6px", border: "1px solid #222" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#888" }}>SPECIFICATION</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>単気筒容積:</span>
              <span>{((Math.PI * Math.pow(bore / 2, 2) * stroke) / 1000).toFixed(1)} cc</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", color: "#4fa9ff" }}>
              <span>総排気量:</span>
              <span>{((Math.PI * Math.pow(bore / 2, 2) * stroke * cylinders) / 1000).toFixed(0)} cc</span>
            </div>
          </div>
        </div>
      </div>

      {/* 右側：3Dビューアエリア ＋ PVグラフエリア */}
      <div className="viewer-area" style={{ flex: 1, display: "flex", background: "#161616", height: "100%" }}>
        
        {/* 3D領域 (左半分) */}
        <div style={{ flex: 1, height: "100%", position: "relative" }}>
          {/* 【②対策】初期カメラ設定を調整（Z軸を引き、画角fovを45に狭めることで歪みを抑えて全体を美しく収めます） */}
          <Canvas camera={{ position: [0, 0, 10.5], fov: 45 }}>
            <ambientLight intensity={1.5} />
            <directionalLight position={[5, 10, 5]} intensity={2.0} />

            <Engine3D simData={simData} stroke={stroke} bore={bore} conrod={conrod} onFrameUpdate={setCurrentIdx} />

            <OrbitControls makeDefault />
            <gridHelper args={[20, 20, "#555555", "#222222"]} position={[0, -4.0, 0]} />
          </Canvas>
          <div style={{ position: "absolute", bottom: 15, left: 20, pointerEvents: "none", color: "#666", fontSize: "11px" }}>
            [3D Viewport] Drag to Rotate
          </div>
        </div>

        {/* PV線図グラフ領域 (右半分) */}
        <div style={{ flex: 1, height: "100%", padding: "30px", background: "#131313", display: "flex", flexDirection: "column", borderLeft: "1px solid #222" }}>
          <div style={{ marginBottom: "15px" }}>
            <h3 style={{ margin: 0, fontSize: "16px", color: "#ffb64f" }}>P-V Diagram (圧力 - 容積線図)</h3>
            <p style={{ margin: "3px 0 0 0", fontSize: "12px", color: "#666" }}>断熱圧縮・膨張サイクルにおけるエネルギー動態</p>
          </div>

          <div style={{ flex: 1, width: "100%", minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                {/* 初期起動時や安全対策のため tickFormatter にガードを追加 */}
                <XAxis type="number" dataKey="volume_cc" name="Volume" unit="cc" domain={["auto", "auto"]} stroke="#888" tickFormatter={(v) => v != null ? v.toFixed(0) : "0"} />
                <YAxis type="number" dataKey="pressure_mpa" name="Pressure" unit="MPa" domain={[0, "auto"]} stroke="#888" />
                <ZAxis type="number" range={[4, 4]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#222", border: "1px solid #444" }} />
                
                {/* 【③対策】薄いバラバラの点ではなく、一本の綺麗な「熱力学サイクル軌跡線」として常時マッピングされるよう強化 */}
                <Scatter name="Cycle" data={simData} fill="#4fa9ff" opacity={0.5} line={{ stroke: "#4fa9ff", strokeWidth: 1.5 }} shape = {() => null} />
                
                {/* 現在のクランク角の位置を示すリアルタイムインジケータ（赤い大きなドット） */}
                {simData.length > 0 && (
                  <ReferenceDot x={currentPoint.volume_cc} y={currentPoint.pressure_mpa} r={6} fill="#ff4f4f" stroke="#fff" strokeWidth={2} />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

    </div>
  );
}