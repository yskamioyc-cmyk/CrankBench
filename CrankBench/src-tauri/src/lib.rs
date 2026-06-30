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
    pub boost_x100kpa: f64, // ★ boost_bar から変更
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
    pub pressure_multiplier_base: f64,
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
    // 1 ×100kPa = 100kPa = 0.1MPa なので、数値を0.1倍して大気圧(0.1MPa)に加算します
    let p_intake = 0.1 + (config.boost_x100kpa * 0.1);
    let t0 = params.combustion.intake_temp_k;    
    let kappa = params.combustion.kappa;        

    // 3. ストイキ燃焼による燃焼圧力上昇の概算
    let mut points = Vec::with_capacity(721);
    let mut total_work_j = 0.0; 
    let mut prev_volume = max_volume;
    
    let c_v = params.combustion.cv_air;          
    let r_gas = params.combustion.r_gas_air;     

    let combustion_pressure_multiplier = params.combustion.pressure_multiplier_base;

    for angle_deg in 0..=720 {
        let theta = (angle_deg as f64).to_radians();

        let term1 = r_cm * theta.cos();
        let term2 = (conrod_cm.powi(2) - r_cm.powi(2) * theta.sin().powi(2)).sqrt();
        let x_cm = r_cm + conrod_cm - (term1 + term2);

        let volume_cc = v_c_cc + (area_cm2 * x_cm);
        let piston_y_mm = config.stroke_mm - (x_cm * 10.0);

        let (pressure, temperature) = if angle_deg >= 180 && angle_deg <= 360 {
            let p = p_intake * (max_volume / volume_cc).powf(kappa);
            let t = t0 * (max_volume / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else if angle_deg > 360 && angle_deg <= 540 {
            let p_tdc_comp = p_intake * (max_volume / v_c_cc).powf(kappa);
            let t_tdc_comp = t0 * (max_volume / v_c_cc).powf(kappa - 1.0);
            
            let p_comb_max = p_tdc_comp * combustion_pressure_multiplier; 
            let t_comb_max = t_tdc_comp * 2.9; 

            let p = p_comb_max * (v_c_cc / volume_cc).powf(kappa);
            let t = t_comb_max * (v_c_cc / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else {
            (p_intake, t0)
        };

        if angle_deg > 0 {
            let dv = volume_cc - prev_volume;
            total_work_j += pressure * dv; 
        }
        prev_volume = volume_cc;

        let entropy_j_k = c_v * (temperature / t0).ln() + r_gas * (volume_cc / max_volume).ln();

        points.push(SimulationPoint {
            crank_angle_deg: angle_deg as f64,
            volume_cc,
            piston_y_mm,
            pressure_mpa: pressure,
            temperature_k: temperature,
            entropy_j_k, 
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
        
        // ★ boost_x100kpa に変更（過給圧による背圧微減シミュレート）
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