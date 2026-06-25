use std::f64::consts::PI;

#[derive(serde::Deserialize)]
pub struct EngineConfig {
    pub bore_mm: f64,
    pub stroke_mm: f64,
    pub conrod_length_mm: f64,
    pub compression_ratio: f64,
    pub cylinders: i32, 
    pub rpm: f64,       
}

#[derive(serde::Serialize)]
pub struct SimulationPoint {
    pub crank_angle_deg: f64,
    pub volume_cc: f64,
    pub piston_y_mm: f64,     
    pub pressure_mpa: f64,    
    pub temperature_k: f64,   
}

#[derive(serde::Serialize)]
pub struct SimulationResult {
    pub points: Vec<SimulationPoint>,
    pub max_torque_nm: f64, // 【修正】現在のトルクではなく最大トルク
    pub max_power_ps: f64,  // 【修正】現在の馬力ではなく最高出力
}

#[tauri::command]
fn calculate_kinematics(config: EngineConfig) -> SimulationResult {
    let mut points = Vec::with_capacity(721);

    let bore_cm = config.bore_mm / 10.0;
    let stroke_cm = config.stroke_mm / 10.0;
    let conrod_cm = config.conrod_length_mm / 10.0;

    let r_cm = stroke_cm / 2.0;
    let area_cm2 = PI * (bore_cm / 2.0).powi(2);

    let v_d_cc = area_cm2 * stroke_cm;
    let v_c_cc = v_d_cc / (config.compression_ratio - 1.0);
    let max_volume = v_d_cc + v_c_cc;

    let p0 = 0.1;       
    let t0 = 293.15;    
    let kappa = 1.4;    

    let mut total_work_j = 0.0; 
    let mut prev_volume = max_volume;

    for angle_deg in 0..=720 {
        let theta = (angle_deg as f64).to_radians();

        let term1 = r_cm * theta.cos();
        let term2 = (conrod_cm.powi(2) - r_cm.powi(2) * theta.sin().powi(2)).sqrt();
        let x_cm = r_cm + conrod_cm - (term1 + term2);

        let volume_cc = v_c_cc + (area_cm2 * x_cm);
        let piston_y_mm = config.stroke_mm - (x_cm * 10.0);

        let (pressure, temperature) = if angle_deg >= 180 && angle_deg <= 360 {
            let p = p0 * (max_volume / volume_cc).powf(kappa);
            let t = t0 * (max_volume / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else if angle_deg > 360 && angle_deg <= 540 {
            let p_tdc_comp = p0 * (max_volume / v_c_cc).powf(kappa);
            let t_tdc_comp = t0 * (max_volume / v_c_cc).powf(kappa - 1.0);
            
            let p_comb_max = p_tdc_comp * 3.5; 
            let t_comb_max = t_tdc_comp * 2.5; 

            let p = p_comb_max * (v_c_cc / volume_cc).powf(kappa);
            let t = t_comb_max * (v_c_cc / volume_cc).powf(kappa - 1.0);
            (p, t)
        } else {
            (p0, t0)
        };

        if angle_deg > 0 {
            let dv = volume_cc - prev_volume;
            total_work_j += pressure * dv; 
        }
        prev_volume = volume_cc;

        points.push(SimulationPoint {
            crank_angle_deg: angle_deg as f64,
            volume_cc,
            piston_y_mm,
            pressure_mpa: pressure,
            temperature_k: temperature,
        });
    }

    let total_engine_work_j = total_work_j * (config.cylinders as f64);
    let base_indicated_torque = total_engine_work_j / (4.0 * PI);

    // 【修正】1000〜9000 RPMまで走査し、現実的な熱効率・摩擦損失を考慮した最大値を導出
    let mut max_torque_nm = 0.0;
    let mut max_power_ps = 0.0;

    for rpm_iter in (1000..=9000).step_by(100) {
        let n = rpm_iter as f64;
        
        // 充填効率 (4000 RPM付近をピークとする簡易二次曲線モデル)
        let volumetric_efficiency = 0.95 - ((n - 4000.0) / 6000.0).powi(2) * 0.2;
        
        // 機械的摩擦損失 (回転数に比例して増大)
        let friction_loss = 0.10 + 0.000015 * n;
        
        // 正味トルク
        let net_torque = base_indicated_torque * volumetric_efficiency * (1.0 - friction_loss);
        if net_torque > max_torque_nm {
            max_torque_nm = net_torque;
        }

        // 馬力算出 (PS)
        let power_kw = (net_torque * (2.0 * PI * n / 60.0)) / 1000.0;
        let power_ps = power_kw * 1.35962;
        if power_ps > max_power_ps {
            max_power_ps = power_ps;
        }
    }

    SimulationResult {
        points,
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