import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceDot } from "recharts";
import "./App.css";

interface SimulationPoint {
  crank_angle_deg: number;
  volume_cc: number;
  piston_y_mm: number;
  pressure_mpa: number;    
  temperature_k: number;   
}

interface SimulationResult {
  points: SimulationPoint[];
  max_torque_nm: number; // 更新
  max_power_ps: number;  // 更新
}

function Engine2D({ simData, stroke, bore, conrod, cylinders, rpm, onFrameUpdate }: { 
  simData: SimulationPoint[]; 
  stroke: number; 
  bore: number; 
  conrod: number;
  cylinders: number;
  rpm: number;
  onFrameUpdate: (index: number) => void; 
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const lastTimeRef = useRef<number>(0);
  const lastGraphUpdateTimeRef = useRef<number>(0);

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

      const degPerSecond = (rpm * 360) / 60;
      angleRef.current = (angleRef.current + degPerSecond * delta) % 720;
      const exactAngle = angleRef.current;

      lastGraphUpdateTimeRef.current += delta;
      if (lastGraphUpdateTimeRef.current >= 0.033) {
        onFrameUpdate(Math.floor(exactAngle) % 720);
        lastGraphUpdateTimeRef.current = 0;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const SCALE = 1.1;
      const r = (stroke * SCALE) / 2;      
      const l = conrod * SCALE;            
      const b = bore * SCALE;              
      
      const frontCenterX = 110;             
      const sideBaseX = 260;               
      const pSpacing = 90;                 
      const centerY = canvas.height * 0.72; 

      // 【修正】シリンダーの描画領域を完全に固定するための事前計算
      const maxPistonHeight = r + l;
      const cylinderTopY = centerY - maxPistonHeight - 35; // 燃焼室の天井（シリンダーヘッド）
      const cylinderHeight = maxPistonHeight + r + 50;     // シリンダーブロックの固定長

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

      // 【修正】固定サイズのシリンダー壁を描画
      ctx.fillRect(frontCenterX - b/2, cylinderTopY, b, cylinderHeight);
      ctx.strokeRect(frontCenterX - b/2, cylinderTopY, b, cylinderHeight);

      // 【修正】燃焼エフェクト（シリンダーヘッドからピストン上面までの可変空間）
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
        
        // 【修正】固定サイズのシリンダー壁を描画
        ctx.fillStyle = COLOR_CASE;
        ctx.strokeStyle = "#252525";
        ctx.fillRect(cX - b/2, cylinderTopY, b, cylinderHeight);
        
        // 【修正】燃焼エフェクト（シリンダーヘッドからピストン上面までの可変空間）
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

      // ctx.strokeStyle = "#ff3333";
      // ctx.lineWidth = 3;
      // ctx.lineCap = "round";
      
      // ctx.beginPath();
      // ctx.arc(frontCenterX + r + 35, centerY + 10, 18, Math.PI * 1.1, Math.PI * 1.6);
      // ctx.stroke();
      // ctx.fillStyle = "#ff3333";
      // ctx.beginPath();
      // ctx.moveTo(frontCenterX + r + 45, centerY - 8);
      // ctx.lineTo(frontCenterX + r + 53, centerY + 2);
      // ctx.lineTo(frontCenterX + r + 37, centerY + 1);
      // ctx.fill();

      // ctx.beginPath();
      // ctx.bezierCurveTo(sideBaseX - 45, centerY + 50, sideBaseX - 35, centerY + 30, sideBaseX - 35, centerY + 10);
      // ctx.stroke();
      // ctx.beginPath();
      // ctx.moveTo(sideBaseX - 35, centerY + 10);
      // ctx.lineTo(sideBaseX - 41, centerY + 20);
      // ctx.lineTo(sideBaseX - 29, centerY + 18);
      // ctx.fill();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [simData, stroke, bore, conrod, cylinders, rpm]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <canvas ref={canvasRef} width={560} height={450} style={{ background: "#1a1a1a", borderRadius: "8px", boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)" }} />
    </div>
  );
}

export default function App() {
  const [bore, setBore] = useState(64.0);
  const [stroke, setStroke] = useState(68.2);
  const [conrod, setConrod] = useState(120.0);
  const [compression, setCompression] = useState(9.1);
  const [cylinders, setCylinders] = useState(3); 
  const [rpm, setRpm] = useState(12); // 【修正】初期値をゆっくりと動く 12 RPM に設定

  const [simData, setSimData] = useState<SimulationPoint[]>([]);
  const [torque, setTorque] = useState<number>(0); 
  const [power, setPower] = useState<number>(0);   
  const [currentIdx, setCurrentIdx] = useState<number>(0); 

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
            rpm: rpm,
          },
        });
        setSimData(result.points);
        setTorque(result.max_torque_nm); // 更新
        setPower(result.max_power_ps);   // 更新
      } catch (error) {
        console.error("Simulation failed:", error);
      }
    };

    fetchKinematics();
  }, [bore, stroke, conrod, compression, cylinders, rpm]);

  const currentPoint = simData[currentIdx] || { volume_cc: 0, pressure_mpa: 0, temperature_k: 0, crank_angle_deg: 0 };

  const getStrokeInfo = (angle: number) => {
    if (angle >= 0 && angle < 180) return { name: "① 吸気行程 (Intake)", color: "#4fa9ff" };
    if (angle >= 180 && angle < 360) return { name: "② 圧縮行程 (Compression)", color: "#ffb64f" };
    if (angle >= 360 && angle < 540) return { name: "③ 燃焼膨張 (Power)", color: "#ff4f4f" };
    return { name: "④ 排気行程 (Exhaust)", color: "#aaaaaa" };
  };
  const strokeStatus = getStrokeInfo(currentPoint.crank_angle_deg);

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

        {/* 【修正】スライダーの最小値を 12 RPM に設定 */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span style={{ color: "#aaa" }}>描画回転数 (Animation RPM)</span>
            <span style={{ color: "#ffb64f", fontWeight: "bold" }}>{rpm} RPM</span>
          </div>
          <input type="range" min="12" max="6000" step="1" value={rpm} onChange={(e) => setRpm(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "5px" }} />
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
          <div style={{ margin: "0 0 12px 0", padding: "6px 10px", background: "#222", borderRadius: "4px", borderLeft: `4px solid ${strokeStatus.color}`, fontSize: "13px", fontWeight: "bold", color: strokeStatus.color }}>
            {strokeStatus.name}
          </div>
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

        {/* 【修正】タイトルをMAX PERFORMANCEに変更し、ポテンシャル出力を表示 */}
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

      {/* 右側：2Dビューアエリア ＋ PVグラフエリア */}
      <div className="viewer-area" style={{ flex: 1, display: "flex", background: "#161616", height: "100%" }}>
        
        {/* 2Dグラフィックス領域 (左半分) */}
        <div style={{ flex: 1, height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
          <Engine2D simData={simData} stroke={stroke} bore={bore} conrod={conrod} cylinders={cylinders} rpm={rpm} onFrameUpdate={setCurrentIdx} />
          <div style={{ position: "absolute", bottom: 15, left: 20, pointerEvents: "none", color: "#666", fontSize: "11px" }}>
            [2D Canvas Viewport] 正面・側面 ツインビューモード
          </div>
        </div>

        {/* PV線図グラフ領域 (右半分) */}
        <div style={{ flex: 1, height: "100%", padding: "30px", background: "#131313", display: "flex", flexDirection: "column", borderLeft: "1px solid #222" }}>
          <div style={{ marginBottom: "15px" }}>
            <h3 style={{ margin: 0, fontSize: "16px", color: "#ffb64f" }}>P-V Diagram (圧力 - 容積線図)</h3>
            <p style={{ margin: "3px 0 0 0", fontSize: "12px", color: "#666" }}>全行程における1気筒あたりのインジケータ仕事</p>
          </div>

          <div style={{ flex: 1, width: "100%", minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis type="number" dataKey="volume_cc" name="Volume" unit="cc" domain={["auto", "auto"]} stroke="#888" tickFormatter={(v) => v != null ? v.toFixed(0) : "0"} />
                <YAxis type="number" dataKey="pressure_mpa" name="Pressure" unit="MPa" domain={[0, "auto"]} stroke="#888" />
                <ZAxis type="number" range={[4, 4]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#222", border: "1px solid #444" }} />
                
                <Scatter name="Cycle" data={simData} fill="#4fa9ff" opacity={0.5} line={{ stroke: "#4fa9ff", strokeWidth: 1.5 }} shape={() => null} />
                
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