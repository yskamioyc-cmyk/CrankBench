// src/lib.rs
use std::f64::consts::PI;
use std::sync::OnceLock;

#[derive(serde::Deserialize)]
pub struct EngineConfig {
    pub bore_mm: f64,
    pub stroke_mm: f64,
    pub conrod_length_mm: f64,
    pub compression_ratio: f64,
    pub cylinders: i32, 
    pub rpm: f64,
    pub boost_x100kpa: f64,
}

// === TOMLの構造に対応するRustの構造体定義 ===
#[derive(serde::Deserialize)]
pub struct ModelConfig {
    pub combustion: CombustionConfig,
    pub performance: PerformanceConfig,
}

#[derive(serde::Deserialize)]
pub struct CombustionConfig {
    pub intake_temp_k: f64,
    pub kappa: f64,
    pub cv_air: f64,
    pub r_gas_air: f64,
    pub mixture_heating_value_j_kg: f64,
    pub cv_slope: f64,
    pub mol_increase_ratio: f64,
    pub dissoc_start_temp_k: f64,       // ★熱解離開始温度
    pub cv_dissoc_coefficient: f64,     // ★熱解離比熱係数
    pub wiebe_start_angle: f64,         // ★Wiebe燃焼開始角
    pub wiebe_duration: f64,            // ★Wiebe燃焼期間
    pub wiebe_efficiency_a: f64,        // ★Wiebe効率係数
    pub wiebe_shape_m: f64,             // ★Wiebe形状係数
}

#[derive(serde::Deserialize)]
pub struct PerformanceConfig {
    pub base_volumetric_efficiency: f64,
    pub ve_rpm_center: f64,
    pub ve_rpm_scale: f64,
    pub ve_drop_coefficient: f64,
    pub base_friction_loss: f64,
    pub friction_rpm_coefficient: f64,
}

// === アプリ起動時に一度だけTOMLをパースして、静的に共有する関数 ===
fn model_params() -> &'static ModelConfig {
    static PARAMS: OnceLock<ModelConfig> = OnceLock::new();
    PARAMS.get_or_init(|| {
        let toml_str = include_str!("../physics_model.toml");
        toml::from_str(toml_str).expect("Failed to parse physics_model.toml")
    })
}

#[derive(serde::Serialize)]
pub struct PerformancePoint {
    pub rpm: f64,
    pub torque_kgfm: f64,
    pub power_ps: f64,
}

#[derive(serde::Serialize)]
pub struct SimulationPoint {
    pub crank_angle_deg: f64,
    pub volume_cc: f64,
    pub piston_y_mm: f64,     
    pub pressure_mpa: f64,    
    pub temperature_k: f64,   
    pub entropy_j_k: f64,
}

#[derive(serde::Serialize)]
pub struct SimulationResult {
    pub points: Vec<SimulationPoint>,
    pub performance_curve: Vec<PerformancePoint>,
    pub max_torque_nm: f64, 
    pub max_power_ps: f64,  
}

#[tauri::command]
fn calculate_kinematics(config: EngineConfig) -> SimulationResult {
    // TOMLパラメータの取得
    let params = model_params();

    // 1. 基本幾何学形状の計算
    let bore_cm = config.bore_mm / 10.0;
    let stroke_cm = config.stroke_mm / 10.0;
    let conrod_cm = config.conrod_length_mm / 10.0;
    let r_cm = stroke_cm / 2.0;
    let area_cm2 = PI * (bore_cm / 2.0).powi(2);
    let v_d_cc = area_cm2 * stroke_cm;
    let v_c_cc = v_d_cc / (config.compression_ratio - 1.0);
    let max_volume = v_d_cc + v_c_cc;

    // 2. 吸気圧（過給圧の考慮）
    let p_intake = 0.1 + (config.boost_x100kpa * 0.1);
    let t0 = params.combustion.intake_temp_k;    

    // 3. 単室モデル（数値積分ループ）による熱力学状態の進展計算
    let mut points = Vec::with_capacity(721);
    let mut total_work_j = 0.0; 
    let mut prev_volume = v_c_cc; // 0°(上死点)の容積で初期化
    
    // ループ外で保持・蓄積する動的状態量
    let mut current_p = p_intake;
    let mut current_t = t0;
    let mut current_z = 0.0;       // 現在の燃焼進行度 (0.0〜1.0)
    let mut current_entropy = 0.0; // 数値積分されるエントロピー

    // 下死点（最大容積）でシリンダー内に閉じ込められた質量の計算 (P*V = m*R*T より)
    let m_air = (p_intake * max_volume) / (params.combustion.r_gas_air * t0); 

    for angle_deg in 0..=720 {
        let theta = (angle_deg as f64).to_radians();

        // ピストン運動幾何学
        let term1 = r_cm * theta.cos();
        let term2 = (conrod_cm.powi(2) - r_cm.powi(2) * theta.sin().powi(2)).sqrt();
        let x_cm = r_cm + conrod_cm - (term1 + term2);

        let volume_cc = v_c_cc + (area_cm2 * x_cm);
        let piston_y_mm = config.stroke_mm - (x_cm * 10.0);

        if angle_deg == 0 {
            prev_volume = volume_cc;
        }

        if angle_deg <= 180 {
            // ① 吸気行程：吸気条件に固定リセット
            current_p = p_intake;
            current_t = t0;
            current_z = 0.0;
            current_entropy = 0.0;
        } else if angle_deg > 180 && angle_deg <= 540 {
            // ② 圧縮・燃焼・膨張行程（完全なる単室微分方程式の積分区間）
            let dv = volume_cc - prev_volume;
            let d_work = current_p * dv; // ピストンが作動ガスに行う/受ける微小仕事 dW = P * dV (J)

            // 【要素1：有限の燃焼期間 - Wiebe関数モデル】
            // クランク角の進行度に応じて、質量燃焼割合(MFB)をS字曲線で滑らかに算出
            let next_z = if (angle_deg as f64) >= params.combustion.wiebe_start_angle {
                let theta_rel = (angle_deg as f64) - params.combustion.wiebe_start_angle;
                if theta_rel >= params.combustion.wiebe_duration {
                    1.0
                } else {
                    let fraction = theta_rel / params.combustion.wiebe_duration;
                    // Wiebe関数の基本式: 1 - exp(-a * (Δθ / θ_d)^(m+1))
                    1.0 - (-params.combustion.wiebe_efficiency_a * fraction.powf(params.combustion.wiebe_shape_m + 1.0)).exp()
                }
            } else {
                0.0
            };
            
            let dz = next_z - current_z;

            // 微小クランク角間での化学燃料発熱量 dQ (J)
            let d_q = params.combustion.mixture_heating_value_j_kg * m_air * dz;

            // 【要素2：ガス分子の熱解離モデル】
            // 通常の温度依存 (cv_air + slope*ΔT) に加え、2000Kを超えると分子の解離（吸熱反応）により見かけの比熱が急激に跳ね上がる現象を再現
            let mut c_v = params.combustion.cv_air + params.combustion.cv_slope * (current_t - 293.15);
            if current_t > params.combustion.dissoc_start_temp_k {
                let t_diff = current_t - params.combustion.dissoc_start_temp_k;
                // 温度の2乗に比例して比熱成分を追加（超高温での過度な温度上昇を強烈にブロック）
                c_v += params.combustion.cv_dissoc_coefficient * t_diff.powi(2);
            }

            // 熱力学第一法則 (dQ = dU + dW -> dQ = m*cv*dT + P*dV) から温度変化 dT を解く
            let d_t = (d_q - d_work) / (m_air * c_v);
            current_t += d_t;

            // 燃焼組成変化に伴う分子数増加（約5%の気体定数Rの増大効果）
            let r_gas_current = params.combustion.r_gas_air * (1.0 + params.combustion.mol_increase_ratio * next_z);

            // 理想気体の状態方程式 (P = mRT/V) により、現在の物理的な筒内圧力を確定
            current_p = (m_air * r_gas_current * current_t) / volume_cc;

            // 【T-S線図用のエントロピー数値積分化】
            // 解析式を廃止し、第一法則の可逆熱入力の定義 (dS = dQ / T) をそのまま累積。
            // 燃焼が起きていない圧縮・膨張後半は dQ=0 となるため、グラフ上で完全な「垂直直線（等エントロピー線）」を描画可能
            if current_t > 0.0 {
                current_entropy += d_q / current_t;
            }

            // 正味の図示仕事を累積（圧縮時はdvがマイナスなので自動で仕事が差し引かれます）
            total_work_j += d_work;
            current_z = next_z;
        } else {
            // ③ 排気行程：排気バルブ開放に伴う大気圧・吸気条件へのリセット
            current_p = p_intake;
            current_t = t0;
            current_z = 0.0;
            current_entropy = 0.0;
        }

        prev_volume = volume_cc;

        points.push(SimulationPoint {
            crank_angle_deg: angle_deg as f64,
            volume_cc,
            piston_y_mm,
            pressure_mpa: current_p,
            temperature_k: current_t,
            entropy_j_k: current_entropy, 
        });
    }

    // 4. 性能曲線の全回転域計算
    let total_engine_work_j = total_work_j * (config.cylinders as f64);
    let base_indicated_torque = total_engine_work_j / (4.0 * PI);

    let mut performance_curve = Vec::new();
    let mut max_torque_nm = 0.0;
    let mut max_power_ps = 0.0;

    for rpm_iter in (1000..=9000).step_by(200) {
        let n = rpm_iter as f64;

        let volumetric_efficiency = params.performance.base_volumetric_efficiency 
            - ((n - params.performance.ve_rpm_center) / params.performance.ve_rpm_scale).powi(2) 
            * params.performance.ve_drop_coefficient;

        let friction_loss = params.performance.base_friction_loss 
            + params.performance.friction_rpm_coefficient * n;
        
        let net_torque = base_indicated_torque 
            * (volumetric_efficiency * (1.0 - config.boost_x100kpa * 0.05))
            * (1.0 - friction_loss);
        let torque_kgfm = net_torque * 0.10197;

        if net_torque > max_torque_nm {
            max_torque_nm = net_torque;
        }

        let power_kw = (net_torque * (2.0 * PI * n / 60.0)) / 1000.0;
        let power_ps = power_kw * 1.35962;
        if power_ps > max_power_ps {
            max_power_ps = power_ps;
        }

        performance_curve.push(PerformancePoint {
            rpm: n,
            torque_kgfm,
            power_ps,
        });
    }

    SimulationResult {
        points,
        performance_curve,
        max_torque_nm,
        max_power_ps,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![calculate_kinematics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}