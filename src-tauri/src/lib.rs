mod diagnostics;
mod identity;
mod printer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            identity::load_device_identity,
            identity::save_device_identity,
            identity::device_key_storage_status,
            identity::load_peak_config,
            identity::save_peak_config,
            printer::print_document,
            printer::print_kitchen_ticket,
            printer::printer_status,
            diagnostics::host_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Peak POS shell");
}
