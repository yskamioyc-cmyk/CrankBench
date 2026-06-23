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
    pub pressure_mpa: f64,    // 【追加】筒内圧力 (MPa)
    pub temperature_k: f64,   // 【追加】筒内温度 (ケルビン)
}

// シミュレーション実行コマンド
#[tauri::command]
fn calculate_kinematics(config: EngineConfig) -> Vec<SimulationPoint> {
    let mut points = Vec::with_capacity(721);

    // 単位を mm から cm に変換（容積 cc = cm^3 を計算しやすくするため）
    let bore_cm = config.bore_mm / 10.0;
    let stroke_cm = config.stroke_mm / 10.0;
    let conrod_cm = config.conrod_length_mm / 10.0;

    // クランク半径 r と ピストン断面積 A (cm^2)
    let r_cm = stroke_cm / 2.0;
    let area_cm2 = PI * (bore_cm / 2.0).powi(2);

    // 1気筒あたりの行程容積（排気量）V_d = A * stroke
    let v_d_cc = area_cm2 * stroke_cm;

    // 隙間容積（燃焼室容積）V_c = V_d / (圧縮比 - 1)
    let v_c_cc = v_d_cc / (config.compression_ratio - 1.0);

    // 下死点(BDC)時の最大容積 (V0)
    let max_volume = v_d_cc + v_c_cc;

    // 熱力学の初期条件設定
    let p0 = 0.1;       // 初期圧力: 大気圧 0.1 MPa (約1気圧)
    let t0 = 293.15;    // 初期温度: 20℃ (273.15 + 20)
    let kappa = 1.4;    // 比熱比 (空気・混合気)

    // 4ストロークの1サイクル（0°〜720°）を1度刻みで計算
    for angle_deg in 0..=720 {
        let theta = (angle_deg as f64).to_radians();

        // 1. 上死点(TDC)からのピストン変位 x (cm)
        // 数式: x = r + l - (r*cos(θ) + sqrt(l^2 - r^2*sin(θ)^2))
        let term1 = r_cm * theta.cos();
        let term2 = (conrod_cm.powi(2) - r_cm.powi(2) * theta.sin().powi(2)).sqrt();
        let x_cm = r_cm + conrod_cm - (term1 + term2);

        // 2. その瞬間のシリンダ容積 V(θ) = V_c + A * x
        let volume_cc = v_c_cc + (area_cm2 * x_cm);

        // 3. 3Dモデル表示用に、変位を mm に戻し、上死点を基準にした座標を計算
        let piston_y_mm = config.stroke_mm - (x_cm * 10.0);

        // 4. 【熱力学サイクル計算】簡易4ストロークモデル (工程ごとの判定)
        // 0~180: 吸気 / 180~360: 圧縮 / 360~540: 膨張 / 540~720: 排気
        let (pressure, temperature) = if angle_deg >= 180 && angle_deg <= 360 {
            // 圧縮工程：容積減少に伴い、ポアソンの法則で圧力・温度が急上昇
            let p = p0 * (max_volume / volume_cc).powf(kappa);
            let t = t0 * (max_volume / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else if angle_deg > 360 && angle_deg <= 540 {
            // 膨張工程：現段階では点火なし（断熱膨張）として元に戻る計算
            let p = p0 * (max_volume / volume_cc).powf(kappa);
            let t = t0 * (max_volume / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else {
            // 吸気・排気工程：バルブ開放につき、大気圧・常温
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

// --- Tauri エントリーポイント ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![calculate_kinematics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}