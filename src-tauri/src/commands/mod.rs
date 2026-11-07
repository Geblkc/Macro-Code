pub mod exec;
pub mod fs;
pub mod git;
pub mod keystore;
pub mod mcp;
pub mod paths;
mod proc_tree;
pub mod proxy;
pub mod stream;
pub mod updater;

pub use exec::{exec_cancel, exec_cmd, exec_cmd_stream, ExecState};
pub use fs::{
    apply_patch, glob_files, grep_files, list_dir, list_tree, memory_append, memory_read,
    read_file, undo_patch, write_file,
};
pub use git::{
    git_branches, git_commit, git_detect, git_diff, git_discard, git_fetch, git_init, git_log,
    git_pull, git_push, git_remotes, git_show, git_stage, git_status, git_switch, git_unstage,
};
pub use keystore::{delete_api_key, get_api_key, has_any_key, key_hint, key_status, set_api_key};
pub use mcp::{mcp_kill, mcp_read, mcp_spawn, mcp_write, McpState};
pub use paths::get_app_paths;
pub use proxy::{proxy_abort, proxy_fetch, ProxyState};
pub use stream::stream_anthropic;
pub use updater::update_support;
