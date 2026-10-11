// Tray shell for Blueprint. No windows: the portal (in the browser) is the UI.
// Owns the Bun sidecar (bot + portal + RPC): starts it, restarts it if it dies, stops it on quit.
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

const PORTAL_LOCAL: &str = "http://127.0.0.1:47614";

#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<CommandChild>>,
    quitting: Mutex<bool>,
}

fn spawn_sidecar(app: &AppHandle) {
    let portal_dir = app
        .path()
        .resource_dir()
        .map(|d| d.join("portal"))
        .unwrap_or_default();

    let cmd = match app.shell().sidecar("blueprint-bot") {
        Ok(c) => c
            .env("BLUEPRINT_PORTAL", &portal_dir)
            .env("BLUEPRINT_GIT", portal_dir.with_file_name("mingit").join("cmd").join("git.exe")),
        Err(e) => {
            eprintln!("sidecar missing: {e}");
            return;
        }
    };

    let (mut rx, child) = match cmd.spawn() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("sidecar failed to start: {e}");
            return;
        }
    };

    *app.state::<Sidecar>().child.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    print!("{}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }

        // Crash or exit: restart after a short pause unless the user quit.
        if !*app.state::<Sidecar>().quitting.lock().unwrap() {
            tokio::time::sleep(Duration::from_secs(3)).await;
            spawn_sidecar(&app);
        }
    });
}

fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<Sidecar>();
    *state.quitting.lock().unwrap() = true;

    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

async fn check_update(app: AppHandle) {
    let Ok(updater) = app.updater() else { return };

    if let Ok(Some(update)) = updater.check().await {
        stop_sidecar(&app);
        let _ = update.download_and_install(|_, _| {}, || {}).await;
        app.restart();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = app.opener().open_url(PORTAL_LOCAL, None::<&str>);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Sidecar::default())
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open portal", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Blueprint", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &update, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .tooltip("Blueprint")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = app.opener().open_url(PORTAL_LOCAL, None::<&str>);
                    }
                    "update" => {
                        tauri::async_runtime::spawn(check_update(app.clone()));
                    }
                    "quit" => {
                        stop_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            spawn_sidecar(app.handle());
            tauri::async_runtime::spawn(check_update(app.handle().clone()));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Blueprint")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                stop_sidecar(app);
            }
        });
}
