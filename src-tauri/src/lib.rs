mod diagnostics;
mod identity;
pub mod local_store;
mod printer;
mod socket;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let runtime = local_store::runtime::LocalStoreRuntime::initialize_for_app(app.handle());
            app.manage(runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            identity::device_key_storage_status,
            identity::ensure_device_identity,
            identity::sign_device_challenge,
            identity::load_device_identity_public,
            identity::save_device_identity_public,
            identity::load_peak_config,
            identity::save_peak_config,
            printer::print_document,
            printer::print_kitchen_ticket,
            printer::printer_status,
            diagnostics::host_diagnostics,
            socket::open_peak_socket,
            socket::send_peak_socket,
            socket::close_peak_socket,
            local_store::runtime::local_store_status,
            local_store::runtime::bind_terminal_authority,
            local_store::runtime::stage_offline_authorization,
            local_store::runtime::apply_terminal_lifecycle_event,
            local_store::runtime::authenticate_offline_staff,
            local_store::runtime::offline_eligibility_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Peak POS shell");
}
