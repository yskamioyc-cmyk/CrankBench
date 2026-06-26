import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import "./App.css";

interface SimulationPoint {
  crank_angle_deg: number;
  volume_cc: number;
  piston_y_mm: number;
  pressure_mpa: number;    
  temperature_k: number;   
  entropy_j_k: number; 
}

interface SimulationResult {
  points: SimulationPoint[];
  max_torque_nm: number; 
  max_power_ps: number;  
}

// 【最適化1】Engine2DをReact.memoでラップし、親(App)が再レンダリングされても再描画されないようにする
const Engine2D = memo(function Engine2D({ simData, stroke, bore, conrod, cylinders, onFastUpdate, onSlowUpdate }: { 
  simData: SimulationPoint[]; 
  stroke: number; 
  bore: number; 
  conrod: number;
  cylinders: number;
  onFastUpdate: (point: SimulationPoint) => void;
  onSlowUpdate: (point: SimulationPoint) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const lastTimeRef = useRef<number>(0);
  const lastGraphUpdateTimeRef = useRef<number>(0);

  const ANIMATION_RPM = 12; 

  const getPhases = (count: number) => {
    if (count === 3) return [0, 240, 480];        
    if (count === 4) return [0, 180, 540, 360];   
    if (count === 6) return [0, 120, 240, 360, 480, 600]; 
    return [0];                                   
  };
  const phases = getPhases(cylinders);

  useEffect(() => {
    let animationFrameId: number;

    const render = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const delta = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      if (simData.length === 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const degPerSecond = (ANIMATION_RPM * 360) / 60;
      angleRef.current = (angleRef.current + degPerSecond * delta) % 720;
      const exactAngle = angleRef.current;

      const idx = Math.floor(exactAngle) % 720;
      const currentPoint = simData[idx];

      if (currentPoint) {
        // 【最適化2】テキスト系のDOM直接更新（60FPSで滑らかに実行、Reactの再レンダリングは発生しない）
        onFastUpdate(currentPoint);
      }

      // 【最適化3】重いグラフの点更新は15FPS(約0.066秒間隔)に制限
      lastGraphUpdateTimeRef.current += delta;
      if (lastGraphUpdateTimeRef.current >= 1 / 15) {
        if (currentPoint) {
          onSlowUpdate(currentPoint);
        }
        lastGraphUpdateTimeRef.current = 0;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Canvasの描画処理（ブラウザの最高FPSで毎回実行）
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const SCALE = 1.1;
      const r = (stroke * SCALE) / 2;      
      const l = conrod * SCALE;            
      const b = bore * SCALE;              
      
      const frontCenterX = 110;             
      const sideBaseX = 260;               
      const pSpacing = 90;                 
      const centerY = canvas.height * 0.72; 

      const maxPistonHeight = r + l;
      const cylinderTopY = centerY - maxPistonHeight - 35; 
      const cylinderHeight = maxPistonHeight + r + 50;     

      const COLOR_CRANK = "#3b6fe2";       
      const COLOR_CONROD = "#2cd147";      
      const COLOR_PISTON = "#dedede";      
      const COLOR_CASE = "#2a2a2a";        

      const cylCoords = phases.map((phase) => {
        const cylAngle = (exactAngle + phase) % 720;
        const rad = (cylAngle * Math.PI) / 180;

        const pinOffsetReplX = r * Math.sin(rad);
        const pinOffsetReplY = -r * Math.cos(rad);

        const conrodAngle = Math.asin((r * Math.sin(rad)) / l);
        const pistonY = centerY - (r * Math.cos(rad) + l * Math.cos(conrodAngle));

        return { pinOffsetReplX, pinOffsetReplY, pistonY, cylAngle };
      });

      // =============================================================
      // 【左半分】正面断面図
      // =============================================================
      const fData = cylCoords[0]; 

      ctx.fillStyle = COLOR_CASE;
      ctx.strokeStyle = "#3a3a3a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(frontCenterX, centerY, r + 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillRect(frontCenterX - b/2, cylinderTopY, b, cylinderHeight);
      ctx.strokeRect(frontCenterX - b/2, cylinderTopY, b, cylinderHeight);

      if (fData.cylAngle >= 360 && fData.cylAngle <= 460) {
        ctx.fillStyle = `rgba(255, 68, 0, ${0.4 * (1.0 - (fData.cylAngle - 360) / 100)})`;
        ctx.fillRect(frontCenterX - b/2, cylinderTopY, b, (fData.pistonY - 25) - cylinderTopY);
      }

      ctx.fillStyle = "#444444";
      ctx.strokeStyle = "#555555";
      ctx.beginPath();
      ctx.arc(frontCenterX, centerY, r + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.lineWidth = 10;
      ctx.strokeStyle = COLOR_CRANK;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(frontCenterX, centerY);
      ctx.lineTo(frontCenterX + fData.pinOffsetReplX, centerY + fData.pinOffsetReplY);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(frontCenterX, centerY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 8;
      ctx.strokeStyle = COLOR_CONROD;
      ctx.beginPath();
      ctx.moveTo(frontCenterX + fData.pinOffsetReplX, centerY + fData.pinOffsetReplY);
      ctx.lineTo(frontCenterX, fData.pistonY);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(frontCenterX + fData.pinOffsetReplX, centerY + fData.pinOffsetReplY, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COLOR_PISTON;
      ctx.fillRect(frontCenterX - b/2, fData.pistonY - 25, b, 25);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(frontCenterX - b/2, fData.pistonY - 25, b, 25);
      
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(frontCenterX, fData.pistonY - 5, 3, 0, Math.PI * 2);
      ctx.fill();

      // =============================================================
      // 【右半分】側面断面図
      // =============================================================
      cylCoords.forEach((coord, i) => {
        const cX = sideBaseX + i * pSpacing;
        
        ctx.fillStyle = COLOR_CASE;
        ctx.strokeStyle = "#252525";
        ctx.fillRect(cX - b/2, cylinderTopY, b, cylinderHeight);
        
        if (coord.cylAngle >= 360 && coord.cylAngle <= 460) {
          ctx.fillStyle = `rgba(255, 68, 0, ${0.4 * (1.0 - (coord.cylAngle - 360) / 100)})`;
          ctx.fillRect(cX - b/2, cylinderTopY, b, (coord.pistonY - 25) - cylinderTopY);
        }
        
        ctx.strokeStyle = "#3a3a3a";
        ctx.lineWidth = 1;
        ctx.strokeRect(cX - b/2, cylinderTopY, b, cylinderHeight);
      });

      cylCoords.forEach((coord, i) => {
        const cX = sideBaseX + i * pSpacing;

        ctx.lineWidth = 8;
        ctx.strokeStyle = COLOR_CONROD;
        ctx.lineCap = "square";
        ctx.beginPath();
        ctx.moveTo(cX, centerY + coord.pinOffsetReplY);
        ctx.lineTo(cX, coord.pistonY);
        ctx.stroke();

        ctx.fillStyle = COLOR_CONROD;
        ctx.fillRect(cX - 8, centerY + coord.pinOffsetReplY - 5, 16, 10);

        ctx.fillStyle = COLOR_PISTON;
        ctx.fillRect(cX - b/2, coord.pistonY - 25, b, 25);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cX - b/2, coord.pistonY - 25, b, 25);

        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.arc(cX, coord.pistonY - 5, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.lineWidth = 12;
      ctx.strokeStyle = COLOR_CRANK;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter"; 
      ctx.beginPath();

      ctx.moveTo(sideBaseX - pSpacing / 2 - 20, centerY);

      cylCoords.forEach((coord, i) => {
        const currentCylinderX = sideBaseX + i * pSpacing;
        const prevJournalEndX = currentCylinderX - 25; 
        const nextJournalStartX = currentCylinderX + 25; 
        const pinY = centerY + coord.pinOffsetReplY;

        ctx.lineTo(prevJournalEndX, centerY);
        ctx.lineTo(prevJournalEndX, pinY);
        ctx.lineTo(nextJournalStartX, pinY);
        ctx.lineTo(nextJournalStartX, centerY);
      });

      const endX = sideBaseX + (cylinders - 1) * pSpacing + pSpacing / 2 + 20;
      ctx.lineTo(endX, centerY);
      ctx.stroke();

      cylCoords.forEach((coord, i) => {
        const cX = sideBaseX + i * pSpacing;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cX, centerY + coord.pinOffsetReplY, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [simData, stroke, bore, conrod, cylinders, onFastUpdate, onSlowUpdate]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <canvas ref={canvasRef} width={560} height={450} style={{ background: "#1a1a1a", borderRadius: "8px", boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)" }} />
    </div>
  );
});

export default function App() {
  const [bore, setBore] = useState(64.0);
  const [stroke, setStroke] = useState(68.2);
  const [conrod, setConrod] = useState(120.0);
  const [compression, setCompression] = useState(9.1);
  const [cylinders, setCylinders] = useState(3); 

  const [simData, setSimData] = useState<SimulationPoint[]>([]);
  const [torque, setTorque] = useState<number>(0); 
  const [power, setPower] = useState<number>(0);   
  
  // グラフ上の点のみを管理するためのState (React再描画用)
  const [currentPoint, setCurrentPoint] = useState<SimulationPoint | null>(null); 

  // DOMを直接書き換えるためのRefs (仮想DOMを介さない超高速更新用)
  const angleDisplayRef = useRef<HTMLSpanElement>(null);
  const pressureDisplayRef = useRef<HTMLSpanElement>(null);
  const tempDisplayRef = useRef<HTMLSpanElement>(null);
  const strokeDisplayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchKinematics = async () => {
      try {
        const result: SimulationResult = await invoke("calculate_kinematics", {
          config: {
            bore_mm: bore,
            stroke_mm: stroke,
            conrod_length_mm: conrod,
            compression_ratio: compression,
            cylinders: cylinders,
            rpm: 2000,
          },
        });
        setSimData(result.points);
        setTorque(result.max_torque_nm); 
        setPower(result.max_power_ps);   
      } catch (error) {
        console.error("Simulation failed:", error);
      }
    };

    fetchKinematics();
  }, [bore, stroke, conrod, compression, cylinders]);

  const getStrokeInfo = (angle: number) => {
    if (angle >= 0 && angle < 180) return { name: "① 吸気行程 (Intake)", color: "#4fa9ff" };
    if (angle >= 180 && angle < 360) return { name: "② 圧縮行程 (Compression)", color: "#ffb64f" };
    if (angle >= 360 && angle < 540) return { name: "③ 燃焼膨張 (Power)", color: "#ff4f4f" };
    return { name: "④ 排気行程 (Exhaust)", color: "#aaaaaa" };
  };

  // 【最適化4】毎フレーム呼ばれる直接DOM更新ロジック (useCallbackでメモ化)
  const handleFastUpdate = useCallback((point: SimulationPoint) => {
    if (angleDisplayRef.current) angleDisplayRef.current.innerText = `${point.crank_angle_deg.toFixed(0)}°`;
    if (pressureDisplayRef.current) pressureDisplayRef.current.innerText = `${point.pressure_mpa.toFixed(3)} MPa`;
    if (tempDisplayRef.current) tempDisplayRef.current.innerText = `${(point.temperature_k - 273.15).toFixed(1)} ℃`;
    
    if (strokeDisplayRef.current) {
      const info = getStrokeInfo(point.crank_angle_deg);
      if (strokeDisplayRef.current.innerText !== info.name) {
        strokeDisplayRef.current.innerText = info.name;
        strokeDisplayRef.current.style.color = info.color;
        strokeDisplayRef.current.style.borderLeftColor = info.color;
      }
    }
  }, []);

  // 15FPSで呼ばれるグラフ描画用のState更新ロジック
  const handleSlowUpdate = useCallback((point: SimulationPoint) => {
    setCurrentPoint(point);
  }, []);

  // 【最適化5】Rechartsに渡す描画データを軽量化 (180点まで間引くことでグラフの処理負荷を大幅削減)
  const chartData = useMemo(() => {
    if (!simData || simData.length === 0) return [];
    return simData.filter((_, i) => i % 4 === 0);
  }, [simData]);

  return (
    <div className="container" style={{ display: "flex", width: "100vw", height: "100vh", background: "#111", color: "#fff", fontFamily: "sans-serif", overflow: "hidden" }}>
      
      {/* 左側：コントロールパネル */}
      <div className="control-panel" style={{ width: "320px", padding: "25px", borderRight: "1px solid #222", background: "#151515", display: "flex", flexDirection: "column", gap: "18px", overflowY: "auto", zIndex: 10 }}>
        <div>
          <h2 style={{ margin: 0, color: "#4fa9ff", letterSpacing: "1px" }}>CrankBench</h2>
          <p style={{ margin: "5px 0 0 0", fontSize: "12px", color: "#666" }}>2D Kinematic Engine Bench</p>
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
            <option value={3}>直列3気筒 (Inline-3 / 120° Crank)</option>
            <option value={4}>直列4気筒 (Inline-4 / 180° Flat)</option>
            <option value={6}>直列6気筒 (Inline-6 / 120° Smooth)</option>
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

        <div style={{ padding: "12px", background: "#1c1c1c", border: "1px solid #222", borderRadius: "6px" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#888", letterSpacing: "0.5px" }}>REF CYLINDER (#1) THERMO</h4>
          <div 
            ref={strokeDisplayRef}
            style={{ margin: "0 0 12px 0", padding: "6px 10px", background: "#222", borderRadius: "4px", borderLeft: `4px solid #4fa9ff`, fontSize: "13px", fontWeight: "bold", color: "#4fa9ff" }}>
            -
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#888" }}>クランク角:</span>
              <span ref={angleDisplayRef} style={{ fontFamily: "monospace" }}>0°</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#aa88ff" }}>筒内圧力 P:</span>
              <span ref={pressureDisplayRef} style={{ fontFamily: "monospace", color: "#aa88ff", fontWeight: "bold" }}>0.000 MPa</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#ff8866" }}>筒内温度 T:</span>
              <span ref={tempDisplayRef} style={{ fontFamily: "monospace", color: "#ff8866" }}>0.0 ℃</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "12px", background: "#1c1c1c", borderRadius: "6px", border: "1px solid #222" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#888" }}>MAX PERFORMANCE (up to 9000 RPM)</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#888" }}>総排気量:</span>
              <span style={{ color: "#4fa9ff", fontWeight: "bold" }}>{((Math.PI * Math.pow(bore / 2, 2) * stroke * cylinders) / 1000).toFixed(0)} cc</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #222", paddingTop: "5px" }}>
              <span style={{ color: "#888" }}>最大トルク:</span>
              <span style={{ fontFamily: "monospace", fontWeight: "bold", color: "#ffb64f" }}>{torque.toFixed(1)} Nm</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", color: "#ff4f4f" }}>
              <span>最高出力:</span>
              <span style={{ fontFamily: "monospace" }}>{power.toFixed(1)} PS</span>
            </div>
          </div>
        </div>
      </div>

      {/* 右側：2Dビューアエリア ＋ グラフエリア（P-V & T-S 上下分割） */}
      <div className="viewer-area" style={{ flex: 1, display: "flex", background: "#161616", height: "100%" }}>
        
        {/* 左側: 2Dグラフィックス領域 */}
        <div style={{ flex: 1, height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
          <Engine2D 
            simData={simData} 
            stroke={stroke} 
            bore={bore} 
            conrod={conrod} 
            cylinders={cylinders} 
            onFastUpdate={handleFastUpdate} 
            onSlowUpdate={handleSlowUpdate} 
          />
          <div style={{ position: "absolute", bottom: 15, left: 20, pointerEvents: "none", color: "#666", fontSize: "11px" }}>
            [2D Canvas Viewport] DOM直接更新・軽量化グラフモード
          </div>
        </div>

        {/* 右側: グラフ領域 (P-V線図 と T-S線図 を上下に分割配置) */}
        <div style={{ flex: 1, height: "100%", padding: "20px", background: "#131313", display: "flex", flexDirection: "column", borderLeft: "1px solid #222", gap: "20px" }}>
          
          {/* 上段：P-V線図 (Pressure - Volume) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "10px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #333" }}>
            <div style={{ marginBottom: "10px" }}>
              <h3 style={{ margin: 0, fontSize: "14px", color: "#4fa9ff" }}>P-V Diagram (圧力 - 容積線図)</h3>
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#666" }}>1気筒あたりの図示仕事（ループ面積＝力学的エネルギー）</p>
            </div>
            <div style={{ flex: 1, width: "100%", minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis type="number" dataKey="volume_cc" name="Volume" unit="cc" domain={["auto", "auto"]} stroke="#888" tickFormatter={(v) => v != null ? v.toFixed(0) : "0"} />
                  <YAxis type="number" dataKey="pressure_mpa" name="Pressure" unit="MPa" domain={[0, "auto"]} stroke="#888" />
                  <ZAxis type="number" range={[4, 4]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#222", border: "1px solid #444", fontSize: "12px" }} />
                  {/* isAnimationActive={false} でRechartsの重いトランジション計算をカット */}
                  <Scatter name="Cycle" data={chartData} fill="#4fa9ff" opacity={0.5} line={{ stroke: "#4fa9ff", strokeWidth: 1.5 }} shape={() => null} isAnimationActive={false} />
                  {currentPoint && (
                    <ReferenceDot x={currentPoint.volume_cc} y={currentPoint.pressure_mpa} r={5} fill="#4fa9ff" stroke="#fff" strokeWidth={2} />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 下段：T-S線図 (Temperature - Entropy) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "10px", background: "#1a1a1a", borderRadius: "8px", border: "1px solid #333" }}>
            <div style={{ marginBottom: "10px" }}>
              <h3 style={{ margin: 0, fontSize: "14px", color: "#ff6b6b" }}>T-S Diagram (温度 - エントロピー線図)</h3>
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#666" }}>断熱過程と等容燃焼における熱力学的エネルギーの推移</p>
            </div>
            <div style={{ flex: 1, width: "100%", minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                  <XAxis type="number" dataKey="entropy_j_k" name="Entropy" unit="J/K" domain={["auto", "auto"]} stroke="#888" tickFormatter={(v) => v != null ? v.toFixed(1) : "0"} />
                  <YAxis type="number" dataKey="temperature_k" name="Temperature" unit="K" domain={[0, "auto"]} stroke="#888" />
                  <ZAxis type="number" range={[4, 4]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#222", border: "1px solid #444", fontSize: "12px" }} />
                  {/* isAnimationActive={false} でRechartsの重いトランジション計算をカット */}
                  <Scatter name="Cycle" data={chartData} fill="#ff6b6b" opacity={0.5} line={{ stroke: "#ff6b6b", strokeWidth: 1.5 }} shape={() => null} isAnimationActive={false} />
                  {currentPoint && (
                    <ReferenceDot x={currentPoint.entropy_j_k} y={currentPoint.temperature_k} r={5} fill="#ff6b6b" stroke="#fff" strokeWidth={2} />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}