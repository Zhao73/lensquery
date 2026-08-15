use std::{
    path::{Component, Path, PathBuf},
    process::Stdio,
};

use tokio::{process::Command, task::JoinSet, time::timeout};

use crate::{models::ProviderProfile, subprocess};

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
    let configured = profile
        .cli
        .as_ref()
        .and_then(|cli| cli.executable_path.as_deref())
        .map(PathBuf::from)
        .filter(|path| path.is_file());
    let executable = configured
        .or_else(|| {
            candidates
                .iter()
                .find_map(|command| resolve_executable(command))
        })
        .ok_or_else(|| format!("没有找到 {}。请安装后重新扫描。", candidates.join(" / ")))?;
    if profile.kind == "codex-cli" {
        Ok(resolve_bundled_codex(&executable).unwrap_or(executable))
    } else {
        Ok(executable)
    }
}

pub fn prepare_isolated_codex_home() -> Result<PathBuf, String> {
    let source = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| user_home_directory().map(|home| home.join(".codex")))
        .ok_or_else(|| "无法定位当前 Codex 配置目录。".to_string())?;
    if !source.is_dir() {
        return Err(format!("Codex 配置目录不存在: {}", source.display()));
    }
    let destination = lensquery_state_directory()?.join("agent-homes/codex");
    if source == destination {
        std::fs::create_dir_all(destination.join("sqlite"))
            .map_err(|error| format!("创建隔离 Codex 目录失败: {error}"))?;
        return Ok(destination);
    }
    prepare_isolated_codex_home_from(&source, &destination)?;
    Ok(destination)
}

fn user_home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn lensquery_state_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let directory = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Application Support/lensquery"));
    #[cfg(target_os = "windows")]
    let directory = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("LensQuery"));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let directory = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local/state"))
        })
        .map(|root| root.join("lensquery"));
    directory.ok_or_else(|| "无法定位 LensQuery 的本地状态目录。".to_string())
}

fn prepare_isolated_codex_home_from(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::create_dir_all(destination.join("sqlite"))
        .map_err(|error| format!("创建隔离 Codex 目录失败: {error}"))?;
    #[cfg(unix)]
    {
        set_private_directory_permissions(destination)?;
        set_private_directory_permissions(&destination.join("sqlite"))?;
    }

    for name in ["config.toml", "auth.json", "opencodex-catalog.json"] {
        let input = source.join(name);
        if input.is_file() {
            sync_file_reference(&input, &destination.join(name))?;
        }
    }
    let config_path = source.join("config.toml");
    if let Ok(config) = std::fs::read_to_string(&config_path) {
        for relative in referenced_config_files(&config) {
            let input = source.join(&relative);
            if input.is_file() {
                let output = destination.join(&relative);
                if let Some(parent) = output.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| format!("创建 Codex 配置子目录失败: {error}"))?;
                }
                sync_file_reference(&input, &output)?;
            }
        }
    }
    Ok(())
}

fn referenced_config_files(config: &str) -> Vec<PathBuf> {
    const KEYS: &[&str] = &[
        "model_instructions_file",
        "experimental_compact_prompt_file",
    ];
    config
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            if !KEYS.contains(&key.trim()) {
                return None;
            }
            let value = value.trim().trim_matches(['\'', '"']);
            let path = PathBuf::from(value);
            let safe = !path.is_absolute()
                && path
                    .components()
                    .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));
            safe.then_some(path)
        })
        .collect()
}

fn sync_file_reference(source: &Path, destination: &Path) -> Result<(), String> {
    if let Ok(metadata) = std::fs::symlink_metadata(destination) {
        if metadata.file_type().is_symlink()
            && std::fs::read_link(destination).is_ok_and(|target| target == source)
        {
            return Ok(());
        }
        if metadata.file_type().is_dir() {
            return Err(format!(
                "隔离 Codex 路径被目录占用: {}",
                destination.display()
            ));
        }
        std::fs::remove_file(destination)
            .map_err(|error| format!("更新隔离 Codex 文件失败: {error}"))?;
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, destination)
            .map_err(|error| format!("链接 Codex 配置失败: {error}"))?;
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_file(source, destination).is_err() {
            std::fs::copy(source, destination)
                .map_err(|error| format!("复制 Codex 配置失败: {error}"))?;
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        std::fs::copy(source, destination)
            .map_err(|error| format!("复制 Codex 配置失败: {error}"))?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let permissions = std::fs::Permissions::from_mode(0o700);
    std::fs::set_permissions(path, permissions)
        .map_err(|error| format!("设置隔离 Codex 目录权限失败: {error}"))
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
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    subprocess::isolate_process_tree(&mut command);
    let child = command.spawn().ok()?;
    let pid = child.id();
    let output = match timeout(
        std::time::Duration::from_secs(VERSION_TIMEOUT_SECONDS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.ok()?,
        Err(_) => {
            subprocess::kill_process_tree(pid);
            return None;
        }
    };
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

fn resolve_bundled_codex(executable: &Path) -> Option<PathBuf> {
    let path = executable
        .canonicalize()
        .unwrap_or_else(|_| executable.into());
    if path
        .components()
        .any(|component| component.as_os_str() == "vendor")
        && path.file_name().is_some_and(|name| {
            name == "codex" || name.to_string_lossy().eq_ignore_ascii_case("codex.exe")
        })
    {
        return Some(path);
    }

    let mut package_roots = Vec::new();
    for ancestor in path.ancestors() {
        if ancestor.file_name().is_some_and(|name| name == "codex")
            && ancestor
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == "@openai")
        {
            package_roots.push(ancestor.to_path_buf());
        }
    }
    if path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "bin")
    {
        if let Some(prefix) = path.parent().and_then(Path::parent) {
            package_roots.push(prefix.join("lib/node_modules/@openai/codex"));
        }
    }

    let (package, target) = codex_platform_layout()?;
    let binary = if cfg!(windows) { "codex.exe" } else { "codex" };
    package_roots
        .into_iter()
        .map(|root| {
            root.join("node_modules/@openai")
                .join(package)
                .join("vendor")
                .join(target)
                .join("bin")
                .join(binary)
        })
        .find(|candidate| candidate.is_file())
}

fn codex_platform_layout() -> Option<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some(("codex-darwin-arm64", "aarch64-apple-darwin")),
        ("macos", "x86_64") => Some(("codex-darwin-x64", "x86_64-apple-darwin")),
        ("linux", "aarch64") => Some(("codex-linux-arm64", "aarch64-unknown-linux-musl")),
        ("linux", "x86_64") => Some(("codex-linux-x64", "x86_64-unknown-linux-musl")),
        ("windows", "aarch64") => Some(("codex-win32-arm64", "aarch64-pc-windows-msvc")),
        ("windows", "x86_64") => Some(("codex-win32-x64", "x86_64-pc-windows-msvc")),
        _ => None,
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

    #[test]
    fn prefers_the_native_codex_binary_inside_an_npm_install() {
        let Some((package, target)) = codex_platform_layout() else {
            return;
        };
        let root =
            std::env::temp_dir().join(format!("lensquery-native-codex-{}", uuid::Uuid::new_v4()));
        let shim = root.join("bin/codex");
        let binary_name = if cfg!(windows) { "codex.exe" } else { "codex" };
        let native = root
            .join("lib/node_modules/@openai/codex/node_modules/@openai")
            .join(package)
            .join("vendor")
            .join(target)
            .join("bin")
            .join(binary_name);
        std::fs::create_dir_all(shim.parent().expect("shim parent")).expect("create shim parent");
        std::fs::create_dir_all(native.parent().expect("native parent"))
            .expect("create native parent");
        std::fs::write(&shim, "shim").expect("write shim");
        std::fs::write(&native, "native").expect("write native");
        assert_eq!(
            resolve_bundled_codex(&shim),
            Some(native.canonicalize().expect("canonical native path"))
        );
        std::fs::remove_dir_all(root).expect("remove fake npm install");
    }

    #[test]
    fn creates_a_history_isolated_codex_home_with_shared_credentials() {
        let root = std::env::temp_dir().join(format!(
            "lensquery-isolated-codex-home-{}",
            uuid::Uuid::new_v4()
        ));
        let source = root.join("source");
        let destination = root.join("destination");
        std::fs::create_dir_all(&source).expect("create source");
        std::fs::write(
            source.join("config.toml"),
            "model_instructions_file = \"./analyst.md\"\nexperimental_compact_prompt_file = \"../outside.md\"\n",
        )
        .expect("write config");
        std::fs::write(source.join("auth.json"), "{\"token\":\"fixture\"}").expect("write auth");
        std::fs::write(source.join("analyst.md"), "fixture instructions")
            .expect("write instructions");
        prepare_isolated_codex_home_from(&source, &destination).expect("prepare isolated home");
        assert!(destination.join("sqlite").is_dir());
        assert_eq!(
            std::fs::read_to_string(destination.join("config.toml")).expect("read linked config"),
            std::fs::read_to_string(source.join("config.toml")).expect("read source config")
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("auth.json")).expect("read linked auth"),
            "{\"token\":\"fixture\"}"
        );
        assert!(destination.join("analyst.md").exists());
        assert!(!destination.join("outside.md").exists());
        std::fs::remove_dir_all(root).expect("remove isolated home fixture");
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
