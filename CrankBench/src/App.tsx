import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import "./App.css";

// Rustから返ってくるデータの型定義
interface SimulationPoint {
  crank_angle_deg: number;
  volume_cc: number;
  piston_y_mm: number;
}

function Engine3D({ simData, stroke, bore, conrod }: { simData: SimulationPoint[]; stroke: number; bore: number; conrod: number }) {
  const pistonRef = useRef<THREE.Mesh>(null);
  const conrodRef = useRef<THREE.Mesh>(null);
  const crankRef = useRef<THREE.Group>(null);
  const angleRef = useRef(0);

  const SCALE = 0.05; 
  const crankRadius = (stroke * SCALE) / 2;
  const pistonRadius = (bore * SCALE) / 2;
  const conrodLength3D = conrod * SCALE;

  useFrame((state, delta) => {
    if (simData.length === 0) return;

    const rpm = 300; // 動きを完全に目視確認できるように300 RPMまで落とします
    const degPerSecond = (rpm * 360) / 60;
    angleRef.current = (angleRef.current + degPerSecond * delta) % 720;
    
    const currentIndex = Math.floor(angleRef.current);
    const data = simData[currentIndex];
    if (!data) return;

    // クランクの回転角（ラジアン）
    const thetaRad = THREE.MathUtils.degToRad(data.crank_angle_deg);

    // 1. クランクピンの現在位置 (中心からの相対座標)
    const pinX = crankRadius * Math.sin(thetaRad);
    const pinY = crankRadius * Math.cos(thetaRad);

    // 2. ピストンの正確なY座標
    const conrodAngle = Math.asin((crankRadius * Math.sin(thetaRad)) / conrodLength3D);
    const pistonY = pinY + conrodLength3D * Math.cos(conrodAngle);

    if (pistonRef.current) {
      pistonRef.current.position.x = 0;
      pistonRef.current.position.y = pistonY;
    }

    // 3. クランクシャフトの回転（時計回りに素直に回す）
    if (crankRef.current) {
      crankRef.current.rotation.z = -thetaRad; 
    }

    // 4. 【修正のコア】逆位相の解消
    if (conrodRef.current) {
      // コンロッドの根本（グループの原点）はピストンの中心に接着
      conrodRef.current.position.x = 0;
      conrodRef.current.position.y = pistonY;

      // ピストン位置(0, pistonY) から クランクピン位置(pinX, pinY) へのベクトル
      const dx = pinX - 0;
      const dy = pinY - pistonY;
      
      // atan2に渡すyの符号を反転（-dyに）させ、ベクトルの向きを正しく下（クランク側）に向けます
      conrodRef.current.rotation.z = Math.atan2(dx, -dy);
    }
  });

  return (
    <group position={[0, -0.8, 0]}>
      
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

      {/* ③ 【修正】コネクティングロッドのメッシュ位置 */}
      {/* 親グループ(conrodRef)がピストン位置を支点として、下（クランク側）を向くように回転します。
          そのため、中のメッシュは「マイナスY方向（下側）」にずらすことで、
          ピストンの下にぶら下がりつつクランクピンを捉える構造になります。
      */}
      <group ref={conrodRef}>
        <mesh position={[0, -conrodLength3D / 2, 0]}> {/* ← 符号をマイナス（-）に修正 */}
          <boxGeometry args={[0.15, conrodLength3D, 0.1]} />
          <meshLambertMaterial color="#aaaaaa" emissive="#111111" />
        </mesh>
      </group>

      {/* ④ クランクシャフト */}
      <group ref={crankRef}>
        {/* クランクウェブ */}
        <mesh position={[0, crankRadius / 2, 0]}>
          <boxGeometry args={[0.4, crankRadius, 0.2]} />
          <meshLambertMaterial color="#666666" />
        </mesh>
        {/* クランクピン */}
        <mesh position={[0, crankRadius, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.4, 16]} />
          <meshLambertMaterial color="#cccccc" />
        </mesh>
      </group>

    </group>
  );
}

// ==========================================
// メインアプリケーション
// ==========================================
export default function App() {
  const [bore, setBore] = useState(64.0);
  const [stroke, setStroke] = useState(68.2);
  const [conrod, setConrod] = useState(120.0);
  const [compression, setCompression] = useState(9.1);
  const [cylinders, setCylinders] = useState(3); // 気筒数

  const [simData, setSimData] = useState<SimulationPoint[]>([]);

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

  return (
    <div className="container" style={{ display: "flex", width: "100vw", height: "100vh", background: "#111", color: "#fff", fontFamily: "sans-serif" }}>
      
      {/* 左側：コントロールパネル */}
      <div className="control-panel" style={{ width: "320px", padding: "25px", borderRight: "1px solid #222", background: "#151515", display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto" }}>
        <div>
          <h2 style={{ margin: 0, color: "#4fa9ff", letterSpacing: "1px" }}>CrankBench</h2>
          <p style={{ margin: "5px 0 0 0", fontSize: "12px", color: "#666" }}>Thermodynamic Engine Simulator</p>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #222", width: "100%" }} />

        {/* 気筒数セレクト */}
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

        {/* ボアスライダー */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>ボア径 (Bore)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{bore.toFixed(1)} mm</span>
          </div>
          <input type="range" min="50" max="100" step="0.1" value={bore} onChange={(e) => setBore(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        {/* ストロークスライダー */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>ストローク (Stroke)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{stroke.toFixed(1)} mm</span>
          </div>
          <input type="range" min="50" max="100" step="0.1" value={stroke} onChange={(e) => setStroke(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        {/* コンロッド長スライダー */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>コンロッド長 (Conrod)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{conrod.toFixed(1)} mm</span>
          </div>
          <input type="range" min="100" max="160" step="0.1" value={conrod} onChange={(e) => setConrod(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        {/* 圧縮比スライダー */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>圧縮比 (Compression)</span>
            <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{compression.toFixed(1)} : 1</span>
          </div>
          <input type="range" min="7.0" max="13.0" step="0.1" value={compression} onChange={(e) => setCompression(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
        </div>

        {/* インフォメーション基盤 */}
        <div style={{ marginTop: "auto", padding: "15px", background: "#1c1c1c", borderRadius: "6px", border: "1px solid #222" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", color: "#888" }}>SPECIFICATION</h4>
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

      {/* 右側：3Dビューアエリア */}
      <div className="viewer-area" style={{ flex: 1, position: "relative", background: "#161616" }}>
        <Canvas camera={{ position: [0, 0.5, 5], fov: 45 }}>
          {/* 非常に明るい環境光を均一に当てる */}
          <ambientLight intensity={1.5} />
          <directionalLight position={[5, 10, 5]} intensity={2.0} />

          {/* 3Dエンジンモデルの描画ロジック */}
          <Engine3D simData={simData} stroke={stroke} bore={bore} conrod={conrod} />

          <OrbitControls makeDefault />
          
          {/* 【修正】position.y を -4.0 に下げて、エンジンとは絶対に重ならない「遥か下の床」に配置します */}
          <gridHelper args={[20, 20, "#555555", "#222222"]} position={[0, -4.0, 0]} />
        </Canvas>
        
        <div style={{ position: "absolute", bottom: 15, left: 20, pointerEvents: "none", color: "#666", fontSize: "12px" }}>
          [Mouse] Drag: Rotate / Wheel: Zoom / Right-Drag: Pan
        </div>
      </div>

    </div>
  );
}