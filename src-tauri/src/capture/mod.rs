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

    #[cfg(target_os = "macos")]
    if !crate::screen_capture_access_granted() {
        return Err("LensQuery 尚未取得“屏幕与系统音频录制”权限；已停止本次分析，避免把桌面壁纸误当成所选内容。".into());
    }

    let mut bounds = selection.bounds.clone();
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
    let inspection = if selection.mode == "element" {
        macos_inspect_element(&selection.bounds, selection.text_scope.as_deref())
    } else {
        None
    };
    #[cfg(target_os = "macos")]
    if let Some(element_bounds) = inspection
        .as_ref()
        .and_then(|element| element.bounds.clone())
    {
        bounds = element_bounds;
    }
    #[cfg(target_os = "macos")]
    let accessible_text = inspection
        .as_ref()
        .and_then(|element| element.description.clone());
    #[cfg(target_os = "macos")]
    let source_path = inspection.and_then(|element| element.source_path);
    #[cfg(target_os = "windows")]
    let source_path = None;

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
        source_path,
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
struct MacosElementInspection {
    bounds: Option<Bounds>,
    description: Option<String>,
    source_path: Option<String>,
}

#[cfg(target_os = "macos")]
fn macos_inspect_element(
    point: &Bounds,
    text_scope: Option<&str>,
) -> Option<MacosElementInspection> {
    use std::ptr;

    use accessibility_sys::{
        kAXChildrenAttribute, kAXDescriptionAttribute, kAXDocumentAttribute, kAXErrorSuccess,
        kAXFilenameAttribute, kAXHelpAttribute, kAXParentAttribute, kAXPositionAttribute,
        kAXRoleAttribute, kAXRoleDescriptionAttribute, kAXSelectedTextAttribute, kAXSizeAttribute,
        kAXTitleAttribute, kAXURLAttribute, kAXValueAttribute, kAXValueTypeCGPoint,
        kAXValueTypeCGSize, AXUIElementCopyAttributeValue, AXUIElementCopyElementAtPosition,
        AXUIElementCreateSystemWide, AXUIElementGetPid, AXUIElementRef, AXValueGetType,
        AXValueGetTypeID, AXValueGetValue, AXValueRef,
    };
    use core_foundation_sys::{
        array::{CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, CFArrayRef},
        base::{CFGetTypeID, CFRelease, CFTypeRef},
        string::{
            CFStringGetCString, CFStringGetLength, CFStringGetMaximumSizeForEncoding,
            CFStringGetTypeID, CFStringRef,
        },
        url::{kCFURLPOSIXPathStyle, CFURLCopyFileSystemPath, CFURLGetTypeID, CFURLRef},
    };

    const UTF8: u32 = 0x0800_0100;

    #[repr(C)]
    #[derive(Default)]
    struct AxPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct AxSize {
        width: f64,
        height: f64,
    }

    unsafe fn copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
        use core_foundation_sys::string::CFStringCreateWithCString;

        let attribute = std::ffi::CString::new(attribute).ok()?;
        let key = CFStringCreateWithCString(ptr::null(), attribute.as_ptr(), UTF8);
        if key.is_null() {
            return None;
        }
        let mut value: CFTypeRef = ptr::null();
        let status = AXUIElementCopyAttributeValue(element, key, &mut value);
        CFRelease(key as CFTypeRef);
        (status == kAXErrorSuccess && !value.is_null()).then_some(value)
    }

    unsafe fn string_from_ref(value: CFStringRef) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let length = CFStringGetLength(value);
        let capacity = CFStringGetMaximumSizeForEncoding(length, UTF8).saturating_add(1) as usize;
        let mut buffer = vec![0_i8; capacity.max(1)];
        if CFStringGetCString(value, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) == 0 {
            return None;
        }
        std::ffi::CStr::from_ptr(buffer.as_ptr())
            .to_str()
            .ok()
            .map(ToOwned::to_owned)
    }

    unsafe fn copy_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let value = copy_attribute(element, attribute)?;
        let result = if CFGetTypeID(value) == CFStringGetTypeID() {
            string_from_ref(value as CFStringRef)
        } else {
            None
        };
        CFRelease(value);
        result
    }

    unsafe fn copy_point(element: AXUIElementRef) -> Option<AxPoint> {
        let value = copy_attribute(element, kAXPositionAttribute)?;
        let mut point = AxPoint::default();
        let valid = CFGetTypeID(value) == AXValueGetTypeID()
            && AXValueGetType(value as AXValueRef) == kAXValueTypeCGPoint
            && AXValueGetValue(
                value as AXValueRef,
                kAXValueTypeCGPoint,
                (&mut point as *mut AxPoint).cast(),
            );
        CFRelease(value);
        valid.then_some(point)
    }

    unsafe fn copy_size(element: AXUIElementRef) -> Option<AxSize> {
        let value = copy_attribute(element, kAXSizeAttribute)?;
        let mut size = AxSize::default();
        let valid = CFGetTypeID(value) == AXValueGetTypeID()
            && AXValueGetType(value as AXValueRef) == kAXValueTypeCGSize
            && AXValueGetValue(
                value as AXValueRef,
                kAXValueTypeCGSize,
                (&mut size as *mut AxSize).cast(),
            );
        CFRelease(value);
        valid.then_some(size)
    }

    unsafe fn path_from_attribute(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let value = copy_attribute(element, attribute)?;
        let candidate = if CFGetTypeID(value) == CFURLGetTypeID() {
            let path = CFURLCopyFileSystemPath(value as CFURLRef, kCFURLPOSIXPathStyle);
            let result = string_from_ref(path);
            if !path.is_null() {
                CFRelease(path as CFTypeRef);
            }
            result
        } else if CFGetTypeID(value) == CFStringGetTypeID() {
            string_from_ref(value as CFStringRef).map(|path| {
                path.strip_prefix("file://")
                    .unwrap_or(&path)
                    .replace("%20", " ")
            })
        } else {
            None
        };
        CFRelease(value);
        candidate.filter(|path| {
            let path = std::path::Path::new(path);
            path.is_absolute() && path.is_file()
        })
    }

    unsafe fn find_source_path(element: AXUIElementRef) -> Option<String> {
        let mut current = element;
        let mut owns_current = false;
        for _ in 0..6 {
            for attribute in [kAXURLAttribute, kAXFilenameAttribute, kAXDocumentAttribute] {
                if let Some(path) = path_from_attribute(current, attribute) {
                    if owns_current {
                        CFRelease(current as CFTypeRef);
                    }
                    return Some(path);
                }
            }
            let Some(parent) = copy_attribute(current, kAXParentAttribute) else {
                break;
            };
            if owns_current {
                CFRelease(current as CFTypeRef);
            }
            current = parent as AXUIElementRef;
            owns_current = true;
        }
        if owns_current {
            CFRelease(current as CFTypeRef);
        }
        None
    }

    unsafe fn is_finder_element(element: AXUIElementRef) -> bool {
        use objc2_app_kit::NSRunningApplication;

        let mut pid = 0;
        if AXUIElementGetPid(element, &mut pid) != kAXErrorSuccess {
            return false;
        }
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .and_then(|application| application.bundleIdentifier())
            .is_some_and(|identifier| identifier.to_string() == "com.apple.finder")
    }

    unsafe fn collect_descendant_text(
        element: AXUIElementRef,
        depth: usize,
        visited: &mut usize,
        character_count: &mut usize,
        chunks: &mut Vec<String>,
        seen: &mut std::collections::HashSet<String>,
    ) {
        const MAX_DEPTH: usize = 14;
        const MAX_NODES: usize = 1_600;
        const MAX_CHARACTERS: usize = 60_000;

        if depth > MAX_DEPTH || *visited >= MAX_NODES || *character_count >= MAX_CHARACTERS {
            return;
        }
        *visited += 1;

        for attribute in [
            kAXValueAttribute,
            kAXTitleAttribute,
            kAXDescriptionAttribute,
            kAXHelpAttribute,
        ] {
            let Some(value) = copy_string(element, attribute) else {
                continue;
            };
            let value = value.trim();
            if value.is_empty() || !seen.insert(value.to_string()) {
                continue;
            }
            let remaining = MAX_CHARACTERS.saturating_sub(*character_count);
            let bounded = value.chars().take(remaining).collect::<String>();
            *character_count += bounded.chars().count();
            chunks.push(bounded);
            if *character_count >= MAX_CHARACTERS {
                return;
            }
        }

        let Some(children) = copy_attribute(element, kAXChildrenAttribute) else {
            return;
        };
        if CFGetTypeID(children) == CFArrayGetTypeID() {
            let children = children as CFArrayRef;
            let count = CFArrayGetCount(children);
            for index in 0..count {
                let child = CFArrayGetValueAtIndex(children, index) as AXUIElementRef;
                if !child.is_null() {
                    collect_descendant_text(
                        child,
                        depth + 1,
                        visited,
                        character_count,
                        chunks,
                        seen,
                    );
                }
                if *visited >= MAX_NODES || *character_count >= MAX_CHARACTERS {
                    break;
                }
            }
        }
        CFRelease(children);
    }

    unsafe fn collect_page_text(element: AXUIElementRef) -> Option<String> {
        let mut current = element;
        let mut owns_current = false;
        for _ in 0..16 {
            let role = copy_string(current, kAXRoleAttribute).unwrap_or_default();
            if matches!(
                role.as_str(),
                "AXWebArea" | "AXScrollArea" | "AXTextArea" | "AXDocument"
            ) {
                let mut visited = 0;
                let mut character_count = 0;
                let mut chunks = Vec::new();
                let mut seen = std::collections::HashSet::new();
                collect_descendant_text(
                    current,
                    0,
                    &mut visited,
                    &mut character_count,
                    &mut chunks,
                    &mut seen,
                );
                if owns_current {
                    CFRelease(current as CFTypeRef);
                }
                return (!chunks.is_empty()).then(|| chunks.join("\n"));
            }
            if matches!(role.as_str(), "AXWindow" | "AXApplication") {
                break;
            }
            let Some(parent) = copy_attribute(current, kAXParentAttribute) else {
                break;
            };
            if owns_current {
                CFRelease(current as CFTypeRef);
            }
            current = parent as AXUIElementRef;
            owns_current = true;
        }
        if owns_current {
            CFRelease(current as CFTypeRef);
        }
        None
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
        let position = copy_point(element);
        let size = copy_size(element);
        let bounds = position.zip(size).and_then(|(position, size)| {
            (position.x.is_finite()
                && position.y.is_finite()
                && size.width.is_finite()
                && size.height.is_finite()
                && size.width >= 2.0
                && size.height >= 2.0)
                .then_some(Bounds {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                })
        });
        // Only Finder/Desktop clicks become file evidence. Other applications may
        // expose a current-document URL on an ancestor, which must not turn an
        // ordinary button or text click into protected-folder access.
        let source_path = is_finder_element(element)
            .then(|| find_source_path(element))
            .flatten();
        let page_text = matches!(text_scope, Some("page") | Some("screen"))
            .then(|| collect_page_text(element))
            .flatten();
        let selected =
            copy_string(element, kAXSelectedTextAttribute).filter(|value| !value.trim().is_empty());
        let value =
            copy_string(element, kAXValueAttribute).filter(|value| !value.trim().is_empty());
        let title =
            copy_string(element, kAXTitleAttribute).filter(|value| !value.trim().is_empty());
        let help = copy_string(element, kAXHelpAttribute).filter(|value| !value.trim().is_empty());
        let description =
            copy_string(element, kAXDescriptionAttribute).filter(|value| !value.trim().is_empty());
        let role = copy_string(element, kAXRoleDescriptionAttribute)
            .or_else(|| copy_string(element, kAXRoleAttribute))
            .unwrap_or_else(|| "AXElement".into());
        CFRelease(element as CFTypeRef);

        let source = page_text
            .or(selected)
            .or(value)
            .or(title)
            .or(description)
            .or(help)
            .map(|value| scope_accessibility_text(&value, text_scope));
        let description = source
            .map(|text| format!("类型: {role} · 文字: {text}"))
            .or_else(|| Some(format!("类型: {role}")));
        Some(MacosElementInspection {
            bounds,
            description,
            source_path,
        })
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
