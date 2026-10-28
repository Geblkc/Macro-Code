mod commands;

use tauri::Manager;

use commands::{
    apply_patch, delete_api_key, exec_cmd, get_api_key, get_app_paths, glob_files, grep_files,
    has_any_key, key_hint, key_status, list_dir, list_tree, mcp_kill, mcp_read, mcp_spawn,
    mcp_write, memory_append, memory_read, proxy_abort, proxy_fetch, read_file, set_api_key,
    stream_anthropic, undo_patch, write_file, McpState, ProxyState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(McpState::default())
        .manage(ProxyState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:sessions.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "create sessions table",
                            sql: "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "create pending approvals table",
                            sql: "CREATE TABLE IF NOT EXISTS pending_approvals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, call_data TEXT NOT NULL, run_state TEXT, created_at INTEGER NOT NULL);",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "create audit log table",
                            sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, tool TEXT NOT NULL, args_preview TEXT NOT NULL, decision TEXT NOT NULL, result TEXT NOT NULL);",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_api_key,
            get_api_key,
            delete_api_key,
            key_status,
            has_any_key,
            key_hint,
            get_app_paths,
            stream_anthropic,
            list_dir,
            list_tree,
            memory_read,
            memory_append,
            read_file,
            grep_files,
            glob_files,
            apply_patch,
            undo_patch,
            write_file,
            mcp_spawn,
            mcp_write,
            mcp_read,
            mcp_kill,
            exec_cmd,
            proxy_fetch,
            proxy_abort
        ])
        .on_window_event(|window, event| {
            // Faz 5: asılı MCP sunucusu kalmasın — pencere kapanışında child'ları öldür.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<McpState>() {
                    state.kill_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
