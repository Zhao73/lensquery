use crate::models::{CaptureResponse, CaptureSelection};

#[cfg(any(target_os = "windows", target_os = "macos"))]
use crate::models::{Bounds, CaptureEvidence};

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
        inspect_element(&selection.bounds, selection.text_scope.as_deref()).map(|element| {
            bounds = element.bounds;
            element.description
        })
    } else {
        None
    };
    #[cfg(target_os = "macos")]
    let accessible_text = if selection.mode == "element" {
        macos_accessibility_text(&selection.bounds, selection.text_scope.as_deref())
    } else {
        None
    };

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
        text_scope: selection.text_scope,
        annotation: selection.annotation,
        analysis_mode: selection.analysis_mode,
        output_format: selection.output_format,
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
fn inspect_element(point: &Bounds, text_scope: Option<&str>) -> Option<InspectedElement> {
    use uiautomation::{
        patterns::UITextPattern,
        types::{Point, TextUnit},
        UIAutomation,
    };

    let automation = UIAutomation::new().ok()?;
    let element = automation
        .element_from_point(Point::new(point.x.round() as i32, point.y.round() as i32))
        .ok()?;
    let rectangle = element.get_bounding_rectangle().ok()?;
    let name = element.get_name().unwrap_or_default();
    let role = element.get_localized_control_type().unwrap_or_default();
    let class_name = element.get_classname().unwrap_or_default();
    let automation_id = element.get_automation_id().unwrap_or_default();
    let scoped_text = element
        .get_pattern::<UITextPattern>()
        .ok()
        .and_then(|pattern| {
            let range = if point.width <= 1.0 && point.height <= 1.0 {
                pattern.get_range_from_point(Point::new(
                    point.x.round() as i32,
                    point.y.round() as i32,
                ))
            } else {
                pattern.get_document_range()
            }
            .ok()?;
            let unit = match text_scope {
                Some("word") => Some(TextUnit::Word),
                Some("paragraph") => Some(TextUnit::Paragraph),
                Some("page") | Some("screen") => Some(TextUnit::Document),
                _ => None,
            };
            if let Some(unit) = unit {
                range.expand_to_enclosing_unit(unit).ok()?;
            }
            range.get_text(16_000).ok()
        })
        .filter(|text| !text.trim().is_empty());
    let description = [
        (!role.is_empty()).then(|| format!("类型: {role}")),
        (!name.is_empty()).then(|| format!("名称: {name}")),
        (!class_name.is_empty()).then(|| format!("类: {class_name}")),
        (!automation_id.is_empty()).then(|| format!("AutomationId: {automation_id}")),
        scoped_text.map(|text| format!("文字: {}", text.trim())),
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

#[cfg(target_os = "macos")]
fn macos_accessibility_text(point: &Bounds, text_scope: Option<&str>) -> Option<String> {
    use std::ptr;

    use accessibility_sys::{
        kAXErrorSuccess, kAXRoleAttribute, kAXSelectedTextAttribute, kAXTitleAttribute,
        kAXValueAttribute, AXUIElementCopyAttributeValue, AXUIElementCopyElementAtPosition,
        AXUIElementCreateSystemWide, AXUIElementRef,
    };
    use core_foundation_sys::{
        base::{CFGetTypeID, CFRelease, CFTypeRef},
        string::{
            CFStringGetCString, CFStringGetLength, CFStringGetMaximumSizeForEncoding,
            CFStringGetTypeID,
        },
    };

    const UTF8: u32 = 0x0800_0100;

    unsafe fn copy_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
        use core_foundation_sys::string::{CFStringCreateWithCString, CFStringRef};
        let attribute = std::ffi::CString::new(attribute).ok()?;
        let key: CFStringRef = CFStringCreateWithCString(ptr::null(), attribute.as_ptr(), UTF8);
        if key.is_null() {
            return None;
        }
        let mut value: CFTypeRef = ptr::null();
        let status = AXUIElementCopyAttributeValue(element, key, &mut value);
        CFRelease(key as CFTypeRef);
        if status != kAXErrorSuccess || value.is_null() {
            return None;
        }
        let result = if CFGetTypeID(value) == CFStringGetTypeID() {
            let string = value as CFStringRef;
            let length = CFStringGetLength(string);
            let capacity =
                CFStringGetMaximumSizeForEncoding(length, UTF8).saturating_add(1) as usize;
            let mut buffer = vec![0_i8; capacity.max(1)];
            if CFStringGetCString(string, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) != 0 {
                std::ffi::CStr::from_ptr(buffer.as_ptr())
                    .to_str()
                    .ok()
                    .map(ToOwned::to_owned)
            } else {
                None
            }
        } else {
            None
        };
        CFRelease(value);
        result
    }

    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let mut element: AXUIElementRef = ptr::null_mut();
        let status =
            AXUIElementCopyElementAtPosition(system, point.x as f32, point.y as f32, &mut element);
        CFRelease(system as CFTypeRef);
        if status != kAXErrorSuccess || element.is_null() {
            return None;
        }
        let selected = copy_string(element, kAXSelectedTextAttribute);
        let value = copy_string(element, kAXValueAttribute);
        let title = copy_string(element, kAXTitleAttribute);
        let role = copy_string(element, kAXRoleAttribute);
        CFRelease(element as CFTypeRef);

        let source = selected
            .filter(|value| !value.trim().is_empty())
            .or_else(|| value.filter(|value| !value.trim().is_empty()))
            .or(title.filter(|value| !value.trim().is_empty()))?;
        let scoped = scope_accessibility_text(&source, text_scope);
        let role = role.unwrap_or_else(|| "AXElement".into());
        Some(format!("类型: {role} · 文字: {scoped}"))
    }
}

#[cfg(target_os = "macos")]
fn scope_accessibility_text(value: &str, scope: Option<&str>) -> String {
    let trimmed = value.trim();
    match scope {
        Some("word") => trimmed
            .split_whitespace()
            .next()
            .unwrap_or(trimmed)
            .chars()
            .take(16_000)
            .collect(),
        Some("paragraph") => trimmed
            .split("\n\n")
            .next()
            .unwrap_or(trimmed)
            .chars()
            .take(16_000)
            .collect(),
        _ => trimmed.chars().take(16_000).collect(),
    }
}
