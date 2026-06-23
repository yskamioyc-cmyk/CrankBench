use std::f64::consts::PI;

// フロントエンドから受け取る入力データの構造体
#[derive(serde::Deserialize)]
pub struct EngineConfig {
    bore_mm: f64,
    stroke_mm: f64,
    conrod_length_mm: f64,
    compression_ratio: f64,
}

// フロントエンドへ返す1データ点（1度ごと）の構造体
#[derive(serde::Serialize)]
pub struct SimulationPoint {
    crank_angle_deg: f64,
    volume_cc: f64,
    piston_y_mm: f64, // 3Dモデルの位置制御にそのまま使えるY座標
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
        // ピストンのY軸移動量（最下点を0にしたい場合は「stroke_mm - 変位」など調整可能）
        let piston_y_mm = config.stroke_mm - (x_cm * 10.0);

        points.push(SimulationPoint {
            crank_angle_deg: angle_deg as f64,
            volume_cc,
            piston_y_mm,
        });
    }

    points
}

// --- 修正後 ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // エラーの出た .plugin(...) の行を丸ごと削除（またはコメントアウト）します
        .invoke_handler(tauri::generate_handler![calculate_kinematics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}