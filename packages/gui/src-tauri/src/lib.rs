#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::Mutex;

struct SidecarState {
    child: Mutex<Option<RunningSidecar>>,
    generation: AtomicU64,
    project: Mutex<Option<PathBuf>>,
}

struct RunningSidecar {
    child: CommandChild,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarExit {
    generation: u64,
    code: Option<i32>,
}

#[tauri::command]
fn startup_project() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--project" {
            return args.next();
        }
        if let Some(path) = argument.strip_prefix("--project=") {
            return Some(path.to_owned());
        }
    }
    None
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://")
        || url.len() <= "https://".len()
        || url.chars().any(char::is_control)
    {
        return Err("Only HTTPS external URLs are allowed".to_owned());
    }

    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    command
        .arg(url)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn write_diagnostic_export(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("Diagnostic export must use a .json file".to_owned());
    }
    std::fs::write(path, content).map_err(|error| error.to_string())
}

fn global_settings_path() -> Option<PathBuf> {
    if let Some(agent_dir) = std::env::var_os("PI_CODING_AGENT_DIR") {
        return Some(PathBuf::from(agent_dir).join("settings.json"));
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| {
            PathBuf::from(home)
                .join(".pi")
                .join("agent")
                .join("settings.json")
        })
}

#[tauri::command]
async fn open_settings_file(state: State<'_, SidecarState>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let project_settings = state
        .project
        .lock()
        .await
        .as_ref()
        .map(|project| project.join(".pi").join("settings.json"));
    if Some(&path) != global_settings_path().as_ref() && Some(&path) != project_settings.as_ref() {
        return Err(
            "Only the active project's Pi settings or the Pi global settings can be opened"
                .to_owned(),
        );
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if !path.exists() {
        std::fs::write(&path, "{}\n").map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    command
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_project(
    app: AppHandle,
    state: State<'_, SidecarState>,
    path: String,
) -> Result<u64, String> {
    let canonical = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Unable to open project: {error}"))?;
    if !canonical.is_dir() {
        return Err("Project path is not a directory".to_owned());
    }

    let mut guard = state.child.lock().await;
    if let Some(previous) = guard.take() {
        previous.child.kill().map_err(|error| error.to_string())?;
    }
    let generation = state.generation.fetch_add(1, Ordering::Relaxed) + 1;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;

    let sidecar = app
        .shell()
        .sidecar("pi-app-server")
        .map_err(|error| error.to_string())?
        .env("PI_PACKAGE_DIR", resource_dir)
        .arg(canonical.as_os_str());
    let (mut events, child) = sidecar.spawn().map_err(|error| error.to_string())?;
    *guard = Some(RunningSidecar { child });
    drop(guard);
    *state.project.lock().await = Some(canonical);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let _ = app.emit("pi-sidecar-data", bytes);
                }
                CommandEvent::Stderr(bytes) => {
                    let message = String::from_utf8_lossy(&bytes).into_owned();
                    let _ = app.emit("pi-sidecar-log", message);
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app.emit(
                        "pi-sidecar-exit",
                        SidecarExit {
                            generation,
                            code: payload.code,
                        },
                    );
                }
                _ => {}
            }
        }
    });

    Ok(generation)
}

#[tauri::command]
async fn write_sidecar(state: State<'_, SidecarState>, bytes: Vec<u8>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    let child = guard
        .as_mut()
        .ok_or_else(|| "Pi sidecar is not running".to_owned())?;
    child.child.write(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_sidecar(state: State<'_, SidecarState>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(child) = guard.take() {
        child.child.kill().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
            project: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            startup_project,
            open_external_url,
            write_diagnostic_export,
            open_settings_file,
            open_project,
            write_sidecar,
            close_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pi desktop application");
}
