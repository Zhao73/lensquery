use std::path::{Path, PathBuf};

use tokio::{process::Command, task::JoinSet, time::timeout};

use crate::models::ProviderProfile;

const VERSION_TIMEOUT_SECONDS: u64 = 2;

pub async fn discover_profiles() -> Vec<ProviderProfile> {
    let mut profiles = ProviderProfile::defaults();
    let mut probes = JoinSet::new();
    for (index, profile) in profiles.iter().enumerate() {
        if profile.cli.is_none() {
            continue;
        }
        let Some((command, path)) = candidate_commands(&profile.kind)
            .iter()
            .find_map(|command| {
                resolve_executable(command).map(|path| ((*command).to_string(), path))
            })
        else {
            continue;
        };
        probes.spawn(async move {
            let version = probe_version(&path).await;
            (index, command, path, version)
        });
    }
    while let Some(result) = probes.join_next().await {
        let Ok((index, command, path, version)) = result else {
            continue;
        };
        let Some(profile) = profiles.get_mut(index) else {
            continue;
        };
        let Some(cli) = profile.cli.as_mut() else {
            continue;
        };
        cli.command = command;
        cli.executable_path = Some(path.to_string_lossy().to_string());
        cli.status = if version.is_some() {
            "ready".into()
        } else {
            "version-timeout".into()
        };
        cli.version = version;
        profile.ready = true;
        profile.secret_configured = true;
    }
    profiles
}

pub fn resolve_profile_executable(profile: &ProviderProfile) -> Result<PathBuf, String> {
    let candidates = candidate_commands(&profile.kind);
    if candidates.is_empty() {
        return Err("所选通道不是受支持的本机 CLI。".into());
    }
    candidates
        .iter()
        .find_map(|command| resolve_executable(command))
        .ok_or_else(|| format!("没有找到 {}。请安装后重新扫描。", candidates.join(" / ")))
}

fn candidate_commands(kind: &str) -> &'static [&'static str] {
    match kind {
        "codex-cli" => &["codex"],
        "claude-cli" => &["claude"],
        "opencode-cli" => &["opencode", "opencode2"],
        "grok-cli" => &["grok"],
        _ => &[],
    }
}

async fn probe_version(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command.arg("--version").kill_on_drop(true);
    let output = timeout(
        std::time::Duration::from_secs(VERSION_TIMEOUT_SECONDS),
        command.output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        (!stderr.is_empty()).then_some(stderr)
    } else {
        Some(
            value
                .lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(120)
                .collect(),
        )
    }
}

#[cfg(windows)]
fn resolve_executable(command: &str) -> Option<PathBuf> {
    let extensions = std::env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .map(str::to_ascii_lowercase)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![".exe".into(), ".cmd".into(), ".bat".into(), ".com".into()]);
    for directory in search_directories() {
        let direct = directory.join(command);
        if direct.is_file() {
            return Some(direct);
        }
        for extension in &extensions {
            let candidate = directory.join(format!("{command}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn resolve_executable(command: &str) -> Option<PathBuf> {
    if command.contains(std::path::MAIN_SEPARATOR) {
        let path = PathBuf::from(command);
        return path.is_file().then_some(path);
    }
    search_directories()
        .map(|directory| directory.join(command))
        .find(|candidate| candidate.is_file())
}

fn search_directories() -> impl Iterator<Item = PathBuf> {
    let mut directories = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        directories.splice(
            0..0,
            [
                home.join(".local/bin"),
                home.join(".npm-global/bin"),
                home.join(".bun/bin"),
                home.join(".cargo/bin"),
                home.join(".opencode/bin"),
                home.join(".grok/bin"),
                home.join("AppData/Roaming/npm"),
            ],
        );
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        directories.push(PathBuf::from(local_app_data).join("Programs"));
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    let mut unique = Vec::with_capacity(directories.len());
    for directory in directories {
        if !unique.contains(&directory) {
            unique.push(directory);
        }
    }
    unique.into_iter()
}

pub fn merge_discovered(
    configured: &std::collections::HashMap<String, ProviderProfile>,
    discovered: Vec<ProviderProfile>,
) -> Vec<ProviderProfile> {
    let mut merged = configured.clone();
    for detected in discovered {
        merged
            .entry(detected.id.clone())
            .and_modify(|profile| {
                if detected.cli.is_some() {
                    profile.ready = detected.ready;
                    profile.secret_configured = detected.secret_configured;
                    profile.cli = detected.cli.clone();
                    profile.capabilities = detected.capabilities.clone();
                }
            })
            .or_insert(detected);
    }
    let mut values = merged.into_values().collect::<Vec<_>>();
    values.sort_by_key(|profile| provider_order(&profile.id));
    values
}

fn provider_order(id: &str) -> usize {
    match id {
        "codex-cli" => 0,
        "claude-cli" => 1,
        "opencode-cli" => 2,
        "grok-cli" => 3,
        "openai" => 4,
        "anthropic" => 5,
        _ => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn cli_defaults_include_all_supported_tools() {
        let profiles = ProviderProfile::defaults();
        let ids = profiles
            .iter()
            .map(|value| value.id.as_str())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"codex-cli"));
        assert!(ids.contains(&"claude-cli"));
        assert!(ids.contains(&"opencode-cli"));
        assert!(ids.contains(&"grok-cli"));
    }

    #[test]
    fn a_missing_cli_is_explicit() {
        let missing = crate::models::CliInstallation::missing("lensquery-definitely-missing");
        assert_eq!(missing.status, "missing");
        assert!(missing.executable_path.is_none());
    }

    #[tokio::test]
    async fn probes_and_merges_a_discovered_cli() {
        let root =
            std::env::temp_dir().join(format!("lensquery-cli-test-{}", uuid::Uuid::new_v4()));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).expect("create fake CLI directory");
        let executable = if cfg!(windows) {
            bin.join("codex.cmd")
        } else {
            bin.join("codex")
        };
        let script = if cfg!(windows) {
            "@echo codex-cli test\r\n"
        } else {
            "#!/bin/sh\nprintf 'codex-cli test\\n'\n"
        };
        std::fs::write(&executable, script).expect("write fake CLI");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&executable)
                .expect("fake CLI metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&executable, permissions).expect("make fake CLI executable");
        }
        let configured = ProviderProfile::defaults()
            .into_iter()
            .map(|profile| (profile.id.clone(), profile))
            .collect::<HashMap<_, _>>();
        let mut detected_codex = configured.get("codex-cli").expect("codex profile").clone();
        detected_codex.ready = true;
        detected_codex.secret_configured = true;
        detected_codex.cli = Some(crate::models::CliInstallation {
            command: "codex".into(),
            executable_path: Some(executable.to_string_lossy().to_string()),
            version: probe_version(&executable).await,
            status: "ready".into(),
            auto_detected: true,
        });
        let detected = merge_discovered(&configured, vec![detected_codex]);
        let codex = detected
            .iter()
            .find(|profile| profile.id == "codex-cli")
            .expect("codex profile");
        assert!(codex.ready);
        assert_eq!(
            codex.cli.as_ref().and_then(|cli| cli.version.as_deref()),
            Some("codex-cli test")
        );
        std::fs::remove_dir_all(root).expect("remove fake CLI directory");
    }
}
