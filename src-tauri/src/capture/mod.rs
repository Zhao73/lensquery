use crate::models::{Bounds, CaptureEvidence, CaptureResponse, CaptureSelection};

pub fn started() -> CaptureResponse {
    CaptureResponse {
        status: "started".into(),
        message: "询问模式已开启：点一下识别对象，按住拖动选择区域；Esc 取消。".into(),
        evidence: None,
    }
}

pub async fn complete(selection: CaptureSelection) -> Result<CaptureResponse, String> {
    if selection.mode != "region" && selection.mode != "element" {
        return Err("不支持的取景模式。".into());
    }
    complete_platform(selection).await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn complete_platform(selection: CaptureSelection) -> Result<CaptureResponse, String> {
    tauri::async_runtime::spawn_blocking(move || capture_native(selection))
        .await
        .map_err(|error| format!("取景任务异常结束: {error}"))?
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn capture_native(selection: CaptureSelection) -> Result<CaptureResponse, String> {
    use xcap::Monitor;

    #[cfg(target_os = "windows")]
    let mut bounds = selection.bounds.clone();
    #[cfg(not(target_os = "windows"))]
    let bounds = selection.bounds.clone();
    #[cfg(target_os = "windows")]
    let accessible_text = if selection.mode == "element" {
        inspect_element(&selection.bounds).map(|element| {
            bounds = element.bounds;
            element.description
        })
    } else {
        None
    };
    #[cfg(not(target_os = "windows"))]
    let accessible_text: Option<String> = None;

    let monitor = Monitor::from_point(bounds.x.round() as i32, bounds.y.round() as i32)
        .map_err(|error| format!("没有找到所选位置的显示器: {error}"))?;
    let monitor_x = monitor
        .x()
        .map_err(|error| format!("读取显示器坐标失败: {error}"))?;
    let monitor_y = monitor
        .y()
        .map_err(|error| format!("读取显示器坐标失败: {error}"))?;
    let monitor_width = monitor
        .width()
        .map_err(|error| format!("读取显示器宽度失败: {error}"))?;
    let monitor_height = monitor
        .height()
        .map_err(|error| format!("读取显示器高度失败: {error}"))?;

    let local_x = (bounds.x.round() as i64 - i64::from(monitor_x))
        .clamp(0, i64::from(monitor_width.saturating_sub(1))) as u32;
    let local_y = (bounds.y.round() as i64 - i64::from(monitor_y))
        .clamp(0, i64::from(monitor_height.saturating_sub(1))) as u32;
    let width = (bounds.width.round().max(1.0) as u32)
        .min(monitor_width.saturating_sub(local_x))
        .max(1);
    let height = (bounds.height.round().max(1.0) as u32)
        .min(monitor_height.saturating_sub(local_y))
        .max(1);

    let image = monitor
        .capture_region(local_x, local_y, width, height)
        .map_err(|error| format!("读取屏幕区域失败: {error}"))?;
    let output_directory = std::env::temp_dir().join("lensquery-captures");
    std::fs::create_dir_all(&output_directory)
        .map_err(|error| format!("创建临时取景目录失败: {error}"))?;
    let output_path = output_directory.join(format!("{}.png", uuid::Uuid::new_v4()));
    image
        .save(&output_path)
        .map_err(|error| format!("保存屏幕区域失败: {error}"))?;

    let evidence = CaptureEvidence {
        id: uuid::Uuid::new_v4().to_string(),
        kind: selection.mode,
        preview_url: format!(
            "file://{}",
            output_path.to_string_lossy().replace('\\', "/")
        ),
        bounds: Bounds {
            x: bounds.x,
            y: bounds.y,
            width: f64::from(width),
            height: f64::from(height),
        },
        window_title: None,
        process_name: None,
        accessible_text,
    };

    Ok(CaptureResponse {
        status: "started".into(),
        message: "所选内容已读取，正在后台分析。".into(),
        evidence: Some(evidence),
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
async fn complete_platform(_selection: CaptureSelection) -> Result<CaptureResponse, String> {
    Err("当前 Linux 构建尚未接入桌面截图后端。".into())
}

#[cfg(target_os = "windows")]
struct InspectedElement {
    bounds: Bounds,
    description: String,
}

#[cfg(target_os = "windows")]
fn inspect_element(point: &Bounds) -> Option<InspectedElement> {
    use uiautomation::{types::Point, UIAutomation};

    let automation = UIAutomation::new().ok()?;
    let element = automation
        .element_from_point(Point::new(point.x.round() as i32, point.y.round() as i32))
        .ok()?;
    let rectangle = element.get_bounding_rectangle().ok()?;
    let name = element.get_name().unwrap_or_default();
    let role = element.get_localized_control_type().unwrap_or_default();
    let class_name = element.get_classname().unwrap_or_default();
    let automation_id = element.get_automation_id().unwrap_or_default();
    let description = [
        (!role.is_empty()).then(|| format!("类型: {role}")),
        (!name.is_empty()).then(|| format!("名称: {name}")),
        (!class_name.is_empty()).then(|| format!("类: {class_name}")),
        (!automation_id.is_empty()).then(|| format!("AutomationId: {automation_id}")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    Some(InspectedElement {
        bounds: Bounds {
            x: f64::from(rectangle.get_left()),
            y: f64::from(rectangle.get_top()),
            width: f64::from(rectangle.get_width().max(1)),
            height: f64::from(rectangle.get_height().max(1)),
        },
        description,
    })
}
