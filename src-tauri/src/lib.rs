mod diagnostics;
mod identity;
#[cfg(target_os = "linux")]
mod linux_webview;
pub mod local_store;
mod printer;
mod raw_print;
mod socket;
mod yetu_http;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    linux_webview::apply_defaults();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let runtime = local_store::runtime::LocalStoreRuntime::initialize_for_app(app.handle());
            app.manage(runtime);
            app.manage(yetu_http::YetuHttp::new()?);
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
            printer::print_test_page,
            printer::print_raw,
            printer::get_print_attempt,
            printer::print_job_once,
            printer::resolve_print_not_printed,
            printer::list_printers,
            printer::load_printer_settings,
            printer::save_printer_settings,
            diagnostics::host_diagnostics,
            socket::open_peak_socket,
            socket::send_peak_socket,
            socket::close_peak_socket,
            yetu_http::yetu_request,
            local_store::runtime::local_store_status,
            local_store::runtime::get_sync_state,
            local_store::runtime::retry_sync,
            local_store::runtime::bind_terminal_authority,
            local_store::runtime::stage_offline_authorization,
            local_store::runtime::apply_terminal_lifecycle_event,
            local_store::runtime::authenticate_offline_staff,
            local_store::runtime::get_offline_staff_roster,
            local_store::runtime::offline_eligibility_status,
            local_store::runtime::install_catalog_snapshot,
            local_store::runtime::install_offline_bootstrap,
            local_store::runtime::get_local_catalog,
            local_store::runtime::get_or_create_order_draft,
            local_store::runtime::update_order_context,
            local_store::runtime::add_local_order_item,
            local_store::runtime::set_local_order_line_quantity,
            local_store::runtime::remove_local_order_line,
            local_store::runtime::get_local_order,
            local_store::runtime::discard_empty_local_order,
            local_store::runtime::commit_local_order,
            local_store::runtime::commit_offline_cash_sale,
            local_store::runtime::clear_active_staff_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Peak POS shell");
}
