use crate::models::CaptureResponse;

#[cfg(target_os = "windows")]
pub fn start(mode: &str) -> CaptureResponse {
    windows::start(mode)
}

#[cfg(not(target_os = "windows"))]
pub fn start(mode: &str) -> CaptureResponse {
    CaptureResponse {
        status: "unavailable".into(),
        message: format!(
            "已收到 {mode} 捕获请求。首个原生捕获后端面向 Windows 10/11；当前平台使用界面开发模式。"
        ),
        evidence: None,
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use crate::models::CaptureResponse;

    pub fn start(mode: &str) -> CaptureResponse {
        // The Windows overlay/window orchestration lands behind this stable command contract.
        // Keeping this explicit avoids pretending that a webview screenshot is native desktop capture.
        CaptureResponse {
            status: "started".into(),
            message: format!("正在准备 Windows {mode} 捕获层。"),
            evidence: None,
        }
    }
}
