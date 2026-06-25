use std::f64::consts::PI;

// フロントエンドから受け取る入力データの構造体
#[derive(serde::Deserialize)]
pub struct EngineConfig {
    pub bore_mm: f64,
    pub stroke_mm: f64,
    pub conrod_length_mm: f64,
    pub compression_ratio: f64,
}

// フロントエンドへ返す1データ点（1度ごと）の構造体
#[derive(serde::Serialize)]
pub struct SimulationPoint {
    pub crank_angle_deg: f64,
    pub volume_cc: f64,
    pub piston_y_mm: f64,     // 3Dモデルの位置制御用Y座標
    pub pressure_mpa: f64,    // 筒内圧力 (MPa)
    pub temperature_k: f64,   // 筒内温度 (ケルビン)
}

// シミュレーション実行コマンド
#[tauri::command]
fn calculate_kinematics(config: EngineConfig) -> Vec<SimulationPoint> {
    let mut points = Vec::with_capacity(721);

    let bore_cm = config.bore_mm / 10.0;
    let stroke_cm = config.stroke_mm / 10.0;
    let conrod_cm = config.conrod_length_mm / 10.0;

    let r_cm = stroke_cm / 2.0;
    let area_cm2 = PI * (bore_cm / 2.0).powi(2);

    // 行程容積と隙間容積の計算
    let v_d_cc = area_cm2 * stroke_cm;
    let v_c_cc = v_d_cc / (config.compression_ratio - 1.0);
    let max_volume = v_d_cc + v_c_cc;

    // 熱力学の初期条件
    let p0 = 0.1;       // 大気圧 0.1 MPa
    let t0 = 293.15;    // 吸気温度 20℃
    let kappa = 1.4;    // 空気比熱比

    for angle_deg in 0..=720 {
        let theta = (angle_deg as f64).to_radians();

        // 1. 上死点からのピストン変位 x (cm)
        let term1 = r_cm * theta.cos();
        let term2 = (conrod_cm.powi(2) - r_cm.powi(2) * theta.sin().powi(2)).sqrt();
        let x_cm = r_cm + conrod_cm - (term1 + term2);

        // 2. シリンダ容積 V(θ)
        let volume_cc = v_c_cc + (area_cm2 * x_cm);

        // 3. 3Dモデル用の高さ (mm)
        let piston_y_mm = config.stroke_mm - (x_cm * 10.0);

        // 4. 熱力学サイクル計算
        let (pressure, temperature) = if angle_deg >= 180 && angle_deg <= 360 {
            // 圧縮工程
            let p = p0 * (max_volume / volume_cc).powf(kappa);
            let t = t0 * (max_volume / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else if angle_deg > 360 && angle_deg <= 540 {
            // 膨画工程 (未点火の断熱膨張)
            let p = p0 * (max_volume / volume_cc).powf(kappa);
            let t = t0 * (max_volume / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else {
            // 吸気・排気
            (p0, t0)
        };

        points.push(SimulationPoint {
            crank_angle_deg: angle_deg as f64,
            volume_cc,
            piston_y_mm,
            pressure_mpa: pressure,
            temperature_k: temperature,
        });
    }

    points
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![calculate_kinematics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}